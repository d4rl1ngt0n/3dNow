import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import { orderStore } from '../services/order-store.js';
import { STATUS_LABELS, customerStatusCopy } from '../services/orders.js';
import { sendCustomerStatusUpdate, resetMailTransport } from '../services/mail.js';
import {
  getRuntimeSettings,
  publicSettingsView,
  updateRuntimeSettings
} from '../services/runtime-settings.js';
import {
  adminConfigured,
  createAdminSession,
  destroyAdminSession,
  readAdminToken,
  requireAdmin,
  verifyAdminPassword
} from '../middleware/admin-auth.js';
import { config } from '../config.js';

export const adminRouter = Router();

function sessionCookie(token) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `3dnow_admin=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${12 * 60 * 60}${secure}`;
}

adminRouter.get('/status', (_req, res) => {
  res.json({ configured: adminConfigured() });
});

adminRouter.post('/login', (req, res) => {
  if (!adminConfigured()) {
    return res.status(503).json({ error: 'Admin access is not configured. Set ADMIN_PASSWORD on the server.' });
  }
  const password = String(req.body?.password || '');
  if (!verifyAdminPassword(password)) {
    return res.status(401).json({ error: 'Incorrect password.' });
  }
  const token = createAdminSession();
  res.setHeader('Set-Cookie', sessionCookie(token));
  return res.json({ ok: true, token });
});

adminRouter.post('/logout', (req, res) => {
  destroyAdminSession(readAdminToken(req));
  res.setHeader('Set-Cookie', '3dnow_admin=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  return res.json({ ok: true });
});

adminRouter.use(requireAdmin);

adminRouter.get('/me', (_req, res) => {
  res.json({ ok: true });
});

adminRouter.get('/stats', async (_req, res) => {
  res.json(await orderStore.stats());
});

adminRouter.get('/orders', async (req, res) => {
  const orders = await orderStore.list({
    type: req.query.type || undefined,
    status: req.query.status || undefined,
    q: req.query.q || undefined,
    limit: req.query.limit || 100
  });
  res.json({ orders, statuses: orderStore.statuses, labels: STATUS_LABELS });
});

adminRouter.get('/orders/:id', async (req, res) => {
  const order = await orderStore.get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  res.json({ order, statuses: orderStore.statuses, labels: STATUS_LABELS });
});

adminRouter.patch('/orders/:id', async (req, res) => {
  try {
    const body = req.body || {};
    const order = await orderStore.update(req.params.id, {
      status: body.status,
      statusNote: body.statusNote || body.note || null,
      notes: body.notes,
      summary: body.summary,
      customer: body.customer
    });
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    res.json({ order });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Could not update order.' });
  }
});

adminRouter.post('/orders/:id/notify', async (req, res) => {
  const raw = await orderStore.getRaw(req.params.id);
  if (!raw) return res.status(404).json({ error: 'Order not found.' });

  const email = String(req.body?.email || raw.customer?.email || '').trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'A valid customer email is required to send an update.' });
  }

  const status = req.body?.status || raw.status;
  const statusLabel = STATUS_LABELS[status] || status;
  const message = String(req.body?.message || '').trim() || customerStatusCopy(status, raw);

  try {
    const result = await sendCustomerStatusUpdate({
      email,
      name: raw.customer?.name,
      statusLabel,
      message,
      filename: raw.filename,
      orderNumber: raw.id
    });
    await orderStore.recordNotification(raw.id, {
      type: 'status-update',
      status,
      delivered: result.delivered,
      to: email,
      reason: result.reason || null
    });
    if (req.body?.status && req.body.status !== raw.status) {
      await orderStore.update(raw.id, {
        status: req.body.status,
        statusNote: req.body.statusNote || `Customer notified: ${statusLabel}`
      });
    }
    const order = await orderStore.get(raw.id);
    return res.json({
      order,
      delivered: result.delivered,
      reason: result.reason || null
    });
  } catch (error) {
    await orderStore.recordNotification(raw.id, {
      type: 'status-update',
      status,
      delivered: false,
      to: email,
      reason: error.message
    });
    return res.status(500).json({ error: error.message || 'Could not send customer update.' });
  }
});

function mimeFromName(name) {
  const ext = path.extname(String(name || '')).toLowerCase();
  return ({
    '.stl': 'model/stl',
    '.obj': 'model/obj',
    '.3mf': 'model/3mf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.pdf': 'application/pdf',
    '.gcode': 'text/plain',
    '.gco': 'text/plain',
    '.nc': 'text/plain'
  })[ext] || null;
}

function safeDownloadName(name) {
  return String(name || 'file').replace(/[\r\n"]/g, '_');
}

adminRouter.get('/orders/:id/files/:index', async (req, res) => {
  const raw = await orderStore.getRaw(req.params.id);
  if (!raw) return res.status(404).json({ error: 'Order not found.' });
  const index = Number(req.params.index);
  const file = raw.files?.[index];
  if (!file?.path) return res.status(404).json({ error: 'File not found.' });

  const absolute = path.resolve(file.path);
  try {
    await fs.access(absolute);
  } catch {
    return res.status(404).json({ error: 'File is no longer on disk.' });
  }

  const downloadName = safeDownloadName(file.originalname || file.filename || path.basename(absolute));
  const contentType = file.mimetype || mimeFromName(downloadName) || 'application/octet-stream';
  const inline = req.query.inline === '1' || req.query.disposition === 'inline';

  res.setHeader('Content-Type', contentType);
  res.setHeader(
    'Content-Disposition',
    `${inline ? 'inline' : 'attachment'}; filename="${downloadName}"`
  );
  return res.sendFile(absolute);
});

adminRouter.get('/settings', async (_req, res) => {
  await getRuntimeSettings();
  res.json({ settings: publicSettingsView() });
});

adminRouter.put('/settings', async (req, res) => {
  try {
    await updateRuntimeSettings(req.body || {});
    resetMailTransport();
    res.json({ settings: publicSettingsView(), ok: true });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Could not save settings.' });
  }
});

adminRouter.post('/settings/test-email', async (req, res) => {
  const to = String(req.body?.to || config.notifyTo || '').trim();
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return res.status(400).json({ error: 'Enter a valid test recipient email.' });
  }
  try {
    if (!config.smtp.host || !config.smtp.user || !config.smtp.pass) {
      return res.status(400).json({ ok: false, delivered: false, reason: 'SMTP is not configured.' });
    }
    const nodemailer = (await import('nodemailer')).default;
    const transport = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      requireTLS: !config.smtp.secure,
      auth: { user: config.smtp.user, pass: config.smtp.pass }
    });
    await transport.sendMail({
      from: config.smtp.from || config.smtp.user,
      to,
      subject: '3DNow SMTP test',
      text: [
        'This is a test email from the 3DNow Ops settings page.',
        `Public URL: ${config.publicUrl}`,
        `SMTP host: ${config.smtp.host}`,
        `From: ${config.smtp.from || config.smtp.user}`
      ].join('\n')
    });
    return res.json({ ok: true, delivered: true, to });
  } catch (error) {
    return res.status(500).json({ ok: false, delivered: false, reason: error.message });
  }
});

adminRouter.get('/settings/shopify-status', async (_req, res) => {
  try {
    const { ensureOrdersPaidWebhook, shopifyConfigured } = await import('../services/shopify-checkout.js');
    if (!shopifyConfigured()) {
      return res.json({ ok: false, reason: 'Shopify is not configured yet.' });
    }
    const result = await ensureOrdersPaidWebhook();
    return res.status(result.ok ? 200 : 500).json(result);
  } catch (error) {
    return res.status(500).json({ ok: false, reason: error.message });
  }
});
