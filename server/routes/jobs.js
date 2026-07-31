import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { jobStore } from '../services/job-store.js';
import { parseGcode } from '../services/gcode.js';
import { inspect3mf } from '../services/threemf.js';
import { routePrinter, printerFromMetadata } from '../services/printer.js';
import { businessQuote, studentQuote, MATERIALS } from '../services/quote.js';
import { slice, slicerAvailable } from '../services/slicer.js';
import { DEFAULT_SLICE_SETTINGS, normalizeSliceSettings } from '../services/slice-settings.js';
import { modelBounds } from '../services/geometry.js';
import { sendAdminEmail, sendCustomerBusinessQuoteConfirmation, sendCustomerPrivateQuoteConfirmation } from '../services/mail.js';
import { createShopifyCheckout } from '../services/shopify-checkout.js';
import { isEligibleStudentEmail } from '../services/student-email.js';
import { registerBusinessQuote, registerCheckoutPending, registerPrivateQuote } from '../services/orders.js';

const upload = multer({ dest: config.uploads, limits: { fileSize: config.uploadLimit } });
const orderUpload = multer({ dest: config.submissions, limits: { fileSize: config.uploadLimit } });
const supported = new Set(['stl', 'obj', '3mf', 'gcode', 'gco', 'nc']);

const baseMetrics = source => ({
  source,
  confidence: null,
  volumeCm3: null,
  surfaceAreaCm2: null,
  triangleCount: null,
  bboxMm: null,
  isManifold: null,
  weightG: null,
  filamentVolCm3: null,
  filamentLengthMm: null,
  printTimeSec: null,
  printer: null,
  gcodeMetadata: null,
  plateCount: null,
  plates: null
});

function resolveMaterialInput(value) {
  const raw = String(value || 'PLA').trim();
  if (/^not\s*sure$/i.test(raw)) return { sliceMaterial: 'PLA', requestedMaterial: 'Not sure' };
  const material = raw.toUpperCase();
  if (!MATERIALS[material]) return null;
  return { sliceMaterial: material, requestedMaterial: material };
}

function publicJob(job) {
  return {
    jobId: job.id,
    status: job.status,
    progress: job.progress,
    filename: job.filename,
    format: job.format,
    flow: job.flow,
    metrics: job.metrics,
    quote: job.quote,
    requestedMaterial: job.requestedMaterial,
    slice: { status: job.sliceStatus, outputPath: null, outputPaths: job.outputPaths || [], profiles: job.profiles },
    warnings: job.warnings,
    error: job.error
  };
}

function applyGeometry(job, geometry) {
  if (!geometry) return;
  const metrics = job.metrics;
  metrics.bboxMm = geometry.bboxMm ?? metrics.bboxMm;
  metrics.volumeCm3 = geometry.volumeCm3 ?? metrics.volumeCm3;
  metrics.surfaceAreaCm2 = geometry.surfaceAreaCm2 ?? metrics.surfaceAreaCm2;
  metrics.triangleCount = geometry.triangleCount ?? metrics.triangleCount;
  metrics.isManifold = geometry.isManifold ?? metrics.isManifold;
}

function applyGcode(job, parsed, source) {
  const metrics = job.metrics;
  Object.assign(metrics, {
    source,
    confidence: parsed.confidence,
    weightG: parsed.weightG,
    filamentVolCm3: parsed.filamentVolCm3,
    filamentLengthMm: parsed.filamentLengthMm,
    printTimeSec: parsed.printTimeSec,
    gcodeMetadata: parsed.metadata,
    bboxMm: parsed.bboxMm ?? metrics.bboxMm
  });

  const declared = printerFromMetadata(parsed.metadata?.printerModel);
  const routed = declared || routePrinter(metrics.bboxMm).printer;
  metrics.printer = routed;

  if (parsed.confidence === 'header' && routed) {
    job.quote = job.flow === 'business'
      ? businessQuote({ printTimeSec: metrics.printTimeSec, printer: routed, quantity: job.quantity })
      : studentQuote({
        material: job.material,
        weightG: metrics.weightG,
        printTimeSec: metrics.printTimeSec,
        printer: routed
      });
  } else if (!parsed.confidence) {
    job.warnings.push('Sliced metadata is incomplete. This file needs manual review.');
  } else if (parsed.confidence === 'partial') {
    job.warnings.push('Only partial sliced metadata was found. Automatic pricing needs verified weight and print time.');
  } else if (!routed) {
    job.warnings.push('Production details need confirmation before we can issue your quote.');
  }
}

async function sliceAndQuote(job, route) {
  if (!slicerAvailable()) {
    job.warnings.push('Server slicer is unavailable. Mesh dimensions were analyzed, but automatic slicing requires Docker or a host PrusaSlicer install.');
    job.status = 'manual-review';
    job.sliceStatus = 'unavailable';
    job.progress = 100;
    return;
  }

  job.status = 'slicing';
  job.sliceStatus = 'slicing';
  job.progress = 45;
  const out = path.join(config.output, `${job.id}.gcode`);
  await slice(job.filePath, out, job.material, job.profiles);
  job.progress = 85;
  job.outputPaths = [path.basename(out)];
  applyGcode(job, parseGcode(await fs.readFile(out)), 'slicer');
  job.metrics.printer ||= route.printer;
  job.quote = job.metrics.printer && job.metrics.printTimeSec != null
    ? job.flow === 'business'
      ? businessQuote({ printTimeSec: job.metrics.printTimeSec, printer: job.metrics.printer, quantity: job.quantity })
      : job.metrics.weightG != null
        ? studentQuote({
          material: job.material,
          weightG: job.metrics.weightG,
          printTimeSec: job.metrics.printTimeSec,
          printer: job.metrics.printer
        })
        : null
    : null;
  job.status = job.quote ? 'ready' : 'manual-review';
  job.sliceStatus = 'ready';
  job.progress = 100;
}

async function process(job) {
  try {
    job.status = 'analyzing';
    job.progress = 20;
    const data = await fs.readFile(job.filePath);

    if (['gcode', 'gco', 'nc'].includes(job.format)) {
      applyGcode(job, parseGcode(data), 'gcode');
      job.status = job.quote ? 'ready' : 'manual-review';
      job.progress = 100;
      return;
    }

    if (job.format === '3mf') {
      const info = inspect3mf(data);
      applyGeometry(job, info.geometry);

      if (info.gcodeFiles.length) {
        job.outputPaths = [];
        for (const file of info.gcodeFiles) {
          const name = path.join(config.output, `${job.id}-${path.basename(file.name)}`);
          await fs.writeFile(name, file.data);
          job.outputPaths.push(path.basename(name));
        }

        applyGcode(job, { ...info.all, metadata: info.all.metadata }, '3mf-gcode');
        job.metrics.plateCount = info.plates.length;
        job.metrics.plates = info.plates.map(plate => ({
          plate: plate.plate,
          weightG: plate.parsed.weightG,
          printTimeSec: plate.parsed.printTimeSec,
          filamentLengthMm: plate.parsed.filamentLengthMm,
          bboxMm: plate.parsed.bboxMm,
          metadata: plate.parsed.metadata
        }));

        if (!job.metrics.bboxMm && info.geometry?.bboxMm) job.metrics.bboxMm = info.geometry.bboxMm;
        job.status = job.quote ? 'ready' : 'manual-review';
        job.progress = 100;
        return;
      }

      if (info.geometry) {
        const route = routePrinter(job.metrics.bboxMm);
        job.metrics.printer = route.printer || null;
        job.metrics.source = '3mf-mesh';
        if (route.error) {
          job.warnings.push(route.error);
          job.status = 'manual-review';
          job.sliceStatus = 'skipped';
          job.progress = 100;
          return;
        }
        await sliceAndQuote(job, route);
        return;
      }

      throw new Error('3MF contains no readable mesh or embedded G-code.');
    }

    // Unsliced mesh formats (STL/OBJ): slice on the server, then quote from generated G-code.
    job.metrics.bboxMm = modelBounds(job.format, data);
    const route = routePrinter(job.metrics.bboxMm);
    job.metrics.printer = route.printer || null;
    job.metrics.source = job.format;
    if (route.error) {
      job.warnings.push(route.error);
      job.status = 'manual-review';
      job.sliceStatus = 'skipped';
      job.progress = 100;
      return;
    }
    await sliceAndQuote(job, route);
  } catch (error) {
    job.status = error.message.includes('unavailable') || error.message.includes('build volume') ? 'manual-review' : 'error';
    job.sliceStatus = 'error';
    job.error = error.message;
    job.warnings.push(error.message);
  }
}

export const jobsRouter = Router();

jobsRouter.post('/', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'A file is required' });
  const format = path.extname(req.file.originalname).slice(1).toLowerCase();
  if (!supported.has(format)) {
    await fs.unlink(req.file.path).catch(() => {});
    return res.status(415).json({ error: 'Unsupported format' });
  }
  const resolved = resolveMaterialInput(req.body.material);
  if (!resolved) {
    await fs.unlink(req.file.path).catch(() => {});
    return res.status(400).json({ error: 'Unsupported material' });
  }
  const flow = req.body.flow === 'business' ? 'business' : 'student';
  const quantity = Number(req.body.quantity || 1);
  if (!Number.isInteger(quantity) || quantity < 1) {
    await fs.unlink(req.file.path).catch(() => {});
    return res.status(400).json({ error: 'Business quantity must be at least one.' });
  }
  const normalized = normalizeSliceSettings({
    nozzleDiameterMm: req.body.nozzleDiameterMm ?? req.body.nozzle,
    layerHeightMm: req.body.layerHeightMm ?? req.body.layerHeight,
    infill: req.body.infill,
    walls: req.body.walls,
    speedPreset: req.body.speedPreset
  });
  if (normalized.error) {
    await fs.unlink(req.file.path).catch(() => {});
    return res.status(400).json({ error: normalized.error });
  }
  // PrusaSlicer CLI requires a real extension (.stl/.obj/.3mf). Multer stores bare hashes.
  const stampedPath = `${req.file.path}.${format}`;
  await fs.rename(req.file.path, stampedPath);
  req.file.path = stampedPath;
  const job = {
    id: randomUUID(),
    filename: req.file.originalname,
    format,
    filePath: stampedPath,
    upload: req.file,
    material: resolved.sliceMaterial,
    requestedMaterial: resolved.requestedMaterial,
    flow,
    quantity,
    status: 'queued',
    progress: 0,
    metrics: baseMetrics(format === '3mf' ? '3mf' : format),
    quote: null,
    sliceStatus: 'queued',
    outputPaths: [],
    profiles: { ...DEFAULT_SLICE_SETTINGS, ...normalized.settings },
    warnings: [],
    error: null
  };
  jobStore.create(job);
  process(job);
  res.status(202).json({ jobId: job.id, status: 'queued' });
});

jobsRouter.get('/:jobId', (req, res) => {
  const job = jobStore.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(publicJob(job));
});

jobsRouter.post('/:jobId/reslice', async (req, res) => {
  const job = jobStore.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (!['stl', 'obj', '3mf'].includes(job.format)) {
    return res.status(409).json({ error: 'Only mesh uploads can be re-sliced.' });
  }

  if (job.format === '3mf') {
    try {
      const info = inspect3mf(await fs.readFile(job.filePath));
      if (info.gcodeFiles.length) {
        return res.status(409).json({ error: 'This 3MF already contains sliced G-code.' });
      }
      if (!info.geometry) {
        return res.status(409).json({ error: 'This 3MF has no mesh to slice.' });
      }
      applyGeometry(job, info.geometry);
    } catch (error) {
      return res.status(409).json({ error: error.message || 'Unable to inspect 3MF for re-slice.' });
    }
  } else if (!job.metrics.bboxMm) {
    try {
      const data = await fs.readFile(job.filePath);
      job.metrics.bboxMm = modelBounds(job.format, data);
    } catch (error) {
      return res.status(409).json({ error: error.message || 'Unable to read mesh bounds for re-slice.' });
    }
  }

  const normalized = normalizeSliceSettings({
    ...job.profiles,
    nozzleDiameterMm: req.body?.nozzleDiameterMm ?? req.body?.nozzle ?? job.profiles?.nozzleDiameterMm,
    layerHeightMm: req.body?.layerHeightMm ?? req.body?.layerHeight ?? job.profiles?.layerHeightMm,
    infill: req.body?.infill ?? job.profiles?.infill,
    walls: req.body?.walls ?? job.profiles?.walls,
    speedPreset: req.body?.speedPreset ?? job.profiles?.speedPreset
  });
  if (normalized.error) return res.status(400).json({ error: normalized.error });
  if (normalized.settings) job.profiles = { ...DEFAULT_SLICE_SETTINGS, ...job.profiles, ...normalized.settings };

  const material = resolveMaterialInput(req.body?.material || job.material);
  if (!material) return res.status(400).json({ error: 'Unsupported material' });
  job.material = material.sliceMaterial;
  job.requestedMaterial = material.requestedMaterial;
  job.quote = null;
  job.error = null;
  job.warnings = [];
  job.outputPaths = [];
  job.metrics = {
    ...baseMetrics(job.format === '3mf' ? '3mf-mesh' : job.format),
    bboxMm: job.metrics.bboxMm,
    volumeCm3: job.metrics.volumeCm3,
    surfaceAreaCm2: job.metrics.surfaceAreaCm2,
    triangleCount: job.metrics.triangleCount,
    isManifold: job.metrics.isManifold
  };

  const route = routePrinter(job.metrics.bboxMm);
  job.metrics.printer = route.printer || null;
  if (route.error) {
    job.warnings.push(route.error);
    job.status = 'manual-review';
    job.sliceStatus = 'skipped';
    job.progress = 100;
    return res.status(409).json({ error: route.error, ...publicJob(job) });
  }

  res.status(202).json(publicJob(job));
  sliceAndQuote(job, route).catch(error => {
    job.status = error.message.includes('unavailable') || error.message.includes('build volume') ? 'manual-review' : 'error';
    job.sliceStatus = 'error';
    job.error = error.message;
    job.warnings.push(error.message);
  });
});

jobsRouter.post('/:jobId/material-choice', async (req, res) => {
  const job = jobStore.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  const resolved = resolveMaterialInput(req.body.material);
  if (!resolved) return res.status(400).json({ error: 'Unsupported material' });
  job.requestedMaterial = resolved.requestedMaterial;
  res.status(202).json({ jobId: job.id, requestedMaterial: job.requestedMaterial });
});

jobsRouter.post('/:jobId/business-quote', (req, res) => {
  const job = jobStore.get(req.params.jobId);
  const quantity = Number(req.body?.quantity);
  const speed = ['standard', 'priority', 'express'].includes(req.body?.speed) ? req.body.speed : 'standard';
  const engineering = ['review', 'editing'].includes(req.body?.engineering) ? req.body.engineering : null;
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.flow !== 'business') return res.status(409).json({ error: 'This job is not a business request.' });
  if (!Number.isInteger(quantity) || quantity < 1) {
    return res.status(400).json({ error: 'Enter a quantity of at least one.' });
  }
  if (!job.metrics.printTimeSec || !job.metrics.printer) {
    return res.status(409).json({ error: 'Verified print time and printer details are required for a business estimate.' });
  }
  job.quantity = quantity;
  job.businessOptions = { speed, engineering };
  job.quote = businessQuote({ printTimeSec: job.metrics.printTimeSec, printer: job.metrics.printer, quantity, speed, engineering });
  return res.json(publicJob(job));
});

jobsRouter.post('/:jobId/business-quote-request', async (req, res) => {
  const job = jobStore.get(req.params.jobId);
  const details = req.body || {};
  const contactMethod = details.contactMethod === 'phone' ? 'phone' : 'email';
  const contact = contactMethod === 'phone' ? String(details.contactPhone || '').trim() : String(details.contactEmail || '').trim();
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.flow !== 'business' || !job.metrics.printTimeSec || !job.metrics.printer) {
    return res.status(409).json({ error: 'A verified business estimate is required before requesting a quote.' });
  }
  const speed = ['standard', 'priority', 'express'].includes(details.speed) ? details.speed : 'standard';
  const engineering = ['review', 'editing'].includes(details.engineering) ? details.engineering : null;
  job.businessOptions = { speed, engineering };
  job.quote = businessQuote({ printTimeSec: job.metrics.printTimeSec, printer: job.metrics.printer, quantity: job.quantity, speed, engineering });
  if (!contact) return res.status(400).json({ error: 'Add your preferred contact details.' });
  if (contactMethod === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) {
    return res.status(400).json({ error: 'Enter a valid contact email address.' });
  }
  if (engineering === 'editing' && details.fileEditingAcknowledged !== true) {
    return res.status(400).json({ error: 'Confirm the file editing terms before requesting your quote.' });
  }

  job.businessQuoteRequest = {
    requestedAt: new Date().toISOString(),
    contactMethod,
    contactEmail: String(details.contactEmail || '').trim(),
    contactPhone: String(details.contactPhone || '').trim(),
    speed,
    engineering,
    color: details.color || 'Black',
    quantity: job.quantity
  };
  try {
    await sendAdminEmail({
      subject: `3DNow business quote request: ${job.filename}`,
      lines: [
        `Job ID: ${job.id}`,
        `File: ${job.filename}`,
        `Quantity: ${job.quote.quantity}`,
        `Printer: ${job.quote.printer.name}`,
        `Print time per part: ${job.quote.printer.printHours} hours`,
        `Printer rate: €${job.quote.printer.ratePerHour}/hour`,
        `Quantity multiplier: ×${job.quote.multiplier}`,
        `Estimated unit price: €${job.quote.unitPrice.toFixed(2)}`,
        `Production subtotal: €${job.quote.productionTotal.toFixed(2)}`,
        `Priority or express cost: €${job.quote.speedCost.toFixed(2)}`,
        `Expert review cost: €${job.quote.reviewCost.toFixed(2)}`,
        `File editing first hour: €${job.quote.editingCost.toFixed(2)}`,
        `Estimated production price: ${job.quote.totalFormatted}`,
        `Material: ${job.requestedMaterial || job.material}`,
        `Colour: ${job.businessQuoteRequest.color}`,
        `Production speed: ${job.businessQuoteRequest.speed}`,
        `Engineering support: ${job.businessQuoteRequest.engineering || 'None'}`,
        ...(job.businessQuoteRequest.engineering === 'editing' ? ['File editing note: The first hour is included. Additional time requires customer approval before further charges.'] : []),
        `Preferred contact: ${contactMethod}`,
        `Contact: ${contact}`
      ],
      files: [job.upload]
    });
    if (contactMethod === 'email') {
      await sendCustomerBusinessQuoteConfirmation({ email: contact, filename: job.filename, totalFormatted: job.quote.totalFormatted });
    }
    await registerBusinessQuote(job).catch(error => {
      console.error(`Order registry failed for business quote: ${error.message}`);
    });
    return res.status(201).json({ message: 'Business quote request received.' });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Could not send business quote request.' });
  }
});

jobsRouter.post('/:jobId/private-quote-request', async (req, res) => {
  const job = jobStore.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const details = req.body || {};
  const contactMethod = details.contactMethod === 'phone' ? 'phone' : 'email';
  const contact = contactMethod === 'phone' ? String(details.contactPhone || '').trim() : String(details.contactEmail || '').trim();
  const quantity = Number(details.quantity);
  if (!contact) return res.status(400).json({ error: 'Add your preferred contact details.' });
  if (!Number.isInteger(quantity) || quantity < 1) {
    return res.status(400).json({ error: 'Enter the number of prints you need.' });
  }
  if (contactMethod === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) {
    return res.status(400).json({ error: 'Enter a valid contact email address.' });
  }

  job.privateQuoteRequest = {
    requestedAt: new Date().toISOString(),
    contactMethod,
    contactEmail: String(details.contactEmail || '').trim(),
    contactPhone: String(details.contactPhone || '').trim(),
    speed: details.speed || 'standard',
    engineering: details.engineering || null,
    material: job.requestedMaterial || job.material,
    color: details.color || 'Black',
    quantity
  };

  try {
    await sendAdminEmail({
      subject: `3DNow private quote request: ${job.filename}`,
      lines: [
        `Job ID: ${job.id}`,
        `File: ${job.filename}`,
        `Material: ${job.privateQuoteRequest.material}`,
        `Colour: ${job.privateQuoteRequest.color}`,
        `Quantity: ${job.privateQuoteRequest.quantity}`,
        `Production speed: ${job.privateQuoteRequest.speed}`,
        `Engineering support: ${job.privateQuoteRequest.engineering || 'None'}`,
        `Preferred contact: ${contactMethod}`,
        `Contact: ${contact}`,
        `Weight: ${job.metrics.weightG ?? 'Pending analysis'} g`,
        `Print time: ${job.metrics.printTimeSec ?? 'Pending analysis'} seconds`
      ],
      files: [job.upload]
    });
    if (contactMethod === 'email') {
      await sendCustomerPrivateQuoteConfirmation({ email: contact, filename: job.filename });
    }
    await registerPrivateQuote(job).catch(error => {
      console.error(`Order registry failed for private quote: ${error.message}`);
    });
    return res.status(201).json({ message: 'Quote request received.' });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Could not send quote request.' });
  }
});

jobsRouter.post('/:jobId/checkout-session', orderUpload.single('studentId'), async (req, res) => {
  const job = jobStore.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (!job.quote) return res.status(409).json({ error: 'A verified automatic quote is required before checkout.' });

  let details;
  try {
    details = JSON.parse(req.body.configuration || '{}');
  } catch {
    return res.status(400).json({ error: 'Invalid request configuration.' });
  }
  const contact = details.contactMethod === 'phone' ? details.contactPhone : details.contactEmail;
  if (!contact || !details.verificationMethod) {
    return res.status(400).json({ error: 'Student verification and contact details are required.' });
  }
  if (details.verificationMethod === 'id' && !req.file) {
    return res.status(400).json({ error: 'A student ID file is required for ID verification.' });
  }
  if (details.verificationMethod === 'email' && !isEligibleStudentEmail(details.universityEmail)) {
    return res.status(400).json({ error: 'Enter a valid .edu, school, college or university email address.' });
  }
  if (details.contactMethod === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(details.contactEmail || '')) {
    return res.status(400).json({ error: 'A valid contact email address is required.' });
  }

  try {
    const checkout = await createShopifyCheckout(job, details);
    job.orderDetails = details;
    job.studentIdFile = req.file || null;
    job.payment = { status: 'pending', shopifyDraftOrderId: checkout.id, totalCents: checkout.totalCents };
    await registerCheckoutPending(job).catch(error => {
      console.error(`Order registry failed for checkout: ${error.message}`);
    });
    return res.status(201).json({ sessionId: checkout.id, url: checkout.url });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Could not start checkout.' });
  }
});
