import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import { orderStore } from '../services/order-store.js';
import { STATUS_LABELS, customerStatusCopy } from '../services/orders.js';
import { sendCustomerStatusUpdate } from '../services/mail.js';
import {
  adminConfigured,
  createAdminSession,
  destroyAdminSession,
  readAdminToken,
  requireAdmin,
  verifyAdminPassword
} from '../middleware/admin-auth.js';

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
      filename: raw.filename
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

adminRouter.get('/orders/:id/files/:index', async (req, res) => {
  const raw = await orderStore.getRaw(req.params.id);
  if (!raw) return res.status(404).json({ error: 'Order not found.' });
  const index = Number(req.params.index);
  const file = raw.files?.[index];
  if (!file?.path) return res.status(404).json({ error: 'File not found.' });

  try {
    await fs.access(file.path);
  } catch {
    return res.status(404).json({ error: 'File is no longer on disk.' });
  }

  const downloadName = file.originalname || file.filename || path.basename(file.path);
  res.download(file.path, downloadName);
});
