import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';

const STORE_PATH = path.join(config.dataDir, 'jobs.json');
const jobs = new Map();
let loaded = false;
let writeQueue = Promise.resolve();

function serializeJob(job) {
  return {
    id: job.id,
    filename: job.filename,
    format: job.format,
    flow: job.flow,
    material: job.material,
    requestedMaterial: job.requestedMaterial,
    quantity: job.quantity,
    status: job.status,
    progress: job.progress,
    metrics: job.metrics,
    quote: job.quote,
    warnings: job.warnings,
    error: job.error,
    sliceStatus: job.sliceStatus,
    outputPaths: job.outputPaths,
    profiles: job.profiles,
    orderDetails: job.orderDetails || null,
    payment: job.payment || null,
    businessOptions: job.businessOptions || null,
    businessQuoteRequest: job.businessQuoteRequest || null,
    privateQuoteRequest: job.privateQuoteRequest || null,
    upload: job.upload ? {
      path: job.upload.path,
      originalname: job.upload.originalname,
      filename: job.upload.filename,
      mimetype: job.upload.mimetype,
      size: job.upload.size
    } : null,
    studentIdFile: job.studentIdFile ? {
      path: job.studentIdFile.path,
      originalname: job.studentIdFile.originalname,
      filename: job.studentIdFile.filename,
      mimetype: job.studentIdFile.mimetype,
      size: job.studentIdFile.size
    } : null,
    filePath: job.filePath || null,
    createdAt: job.createdAt || null,
    updatedAt: job.updatedAt || null
  };
}

async function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
  try {
    const raw = await fs.readFile(STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed.jobs) ? parsed.jobs : [];
    for (const job of list) {
      if (job?.id) jobs.set(job.id, job);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') console.error(`Job store read failed: ${error.message}`);
  }
}

async function persist() {
  await ensureLoaded();
  const payload = `${JSON.stringify({
    jobs: [...jobs.values()].map(serializeJob),
    updatedAt: new Date().toISOString()
  }, null, 2)}\n`;
  const tmp = `${STORE_PATH}.${process.pid}.tmp`;
  await fs.writeFile(tmp, payload, 'utf8');
  await fs.rename(tmp, STORE_PATH);
}

function enqueueWrite() {
  writeQueue = writeQueue.then(persist).catch(error => {
    console.error(`Job store write failed: ${error.message}`);
  });
  return writeQueue;
}

export const jobStore = {
  async ready() {
    await ensureLoaded();
  },
  create(job) {
    const now = new Date().toISOString();
    job.createdAt = job.createdAt || now;
    job.updatedAt = now;
    jobs.set(job.id, job);
    enqueueWrite();
    return job;
  },
  get(id) {
    return jobs.get(id) || null;
  },
  update(id, values) {
    const job = jobs.get(id);
    if (!job) return null;
    Object.assign(job, values, { updatedAt: new Date().toISOString() });
    enqueueWrite();
    return job;
  },
  touch(id) {
    const job = jobs.get(id);
    if (!job) return null;
    job.updatedAt = new Date().toISOString();
    enqueueWrite();
    return job;
  },
  clear() {
    jobs.clear();
    enqueueWrite();
  }
};

await jobStore.ready();
