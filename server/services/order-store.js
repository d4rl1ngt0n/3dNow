import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';

const STORE_PATH = path.join(config.dataDir, 'orders.json');

const ORDER_STATUSES = [
  'new',
  'reviewing',
  'quoted',
  'awaiting-payment',
  'paid',
  'in-production',
  'completed',
  'shipped',
  'ready-pickup',
  'cancelled'
];

let cache = null;
let writeQueue = Promise.resolve();

async function ensureLoaded() {
  if (cache) return cache;
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
  try {
    const raw = await fs.readFile(STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    cache = Array.isArray(parsed.orders) ? parsed.orders : [];
  } catch (error) {
    if (error.code !== 'ENOENT') console.error(`Order store read failed: ${error.message}`);
    cache = [];
  }
  return cache;
}

async function persist() {
  const orders = await ensureLoaded();
  const tmp = `${STORE_PATH}.${process.pid}.tmp`;
  const payload = `${JSON.stringify({ orders, updatedAt: new Date().toISOString() }, null, 2)}\n`;
  await fs.writeFile(tmp, payload, 'utf8');
  await fs.rename(tmp, STORE_PATH);
}

function enqueueWrite() {
  writeQueue = writeQueue.then(persist).catch(error => {
    console.error(`Order store write failed: ${error.message}`);
  });
  return writeQueue;
}

function publicOrder(order) {
  return {
    id: order.id,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    type: order.type,
    flow: order.flow,
    status: order.status,
    summary: order.summary,
    filename: order.filename,
    jobId: order.jobId,
    customer: order.customer,
    payment: order.payment || null,
    quote: order.quote || null,
    details: order.details || {},
    notes: order.notes || '',
    files: (order.files || []).map((file, index) => ({
      index,
      originalname: file.originalname || file.filename || `file-${index + 1}`,
      mimetype: file.mimetype || null,
      size: file.size || null,
      available: Boolean(file.path)
    })),
    statusHistory: order.statusHistory || [],
    notifications: order.notifications || []
  };
}

export const orderStore = {
  statuses: ORDER_STATUSES,

  async list({ type, status, q, limit = 100 } = {}) {
    const orders = await ensureLoaded();
    const needle = String(q || '').trim().toLowerCase();
    const filtered = orders.filter(order => {
      if (type && order.type !== type) return false;
      if (status && order.status !== status) return false;
      if (!needle) return true;
      const haystack = [
        order.id,
        order.jobId,
        order.filename,
        order.summary,
        order.customer?.name,
        order.customer?.email,
        order.customer?.phone,
        order.type,
        order.flow,
        order.status
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(needle);
    });
    return filtered
      .slice()
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, Math.min(Number(limit) || 100, 500))
      .map(publicOrder);
  },

  async get(id) {
    const orders = await ensureLoaded();
    const order = orders.find(item => item.id === id);
    return order ? publicOrder(order) : null;
  },

  async getRaw(id) {
    const orders = await ensureLoaded();
    return orders.find(item => item.id === id) || null;
  },

  async findByJobId(jobId) {
    if (!jobId) return null;
    const orders = await ensureLoaded();
    return orders.find(item => item.jobId === jobId) || null;
  },

  async create(input) {
    const orders = await ensureLoaded();
    const now = new Date().toISOString();
    const status = ORDER_STATUSES.includes(input.status) ? input.status : 'new';
    const order = {
      id: input.id || randomUUID(),
      createdAt: now,
      updatedAt: now,
      type: input.type,
      flow: input.flow || null,
      status,
      summary: input.summary || '',
      filename: input.filename || null,
      jobId: input.jobId || null,
      customer: {
        name: input.customer?.name || null,
        email: input.customer?.email || null,
        phone: input.customer?.phone || null
      },
      payment: input.payment || null,
      quote: input.quote || null,
      details: input.details || {},
      notes: input.notes || '',
      files: (input.files || []).filter(Boolean).map(file => ({
        path: file.path || null,
        originalname: file.originalname || file.filename || null,
        filename: file.filename || null,
        mimetype: file.mimetype || null,
        size: file.size || null
      })),
      statusHistory: [{ status, at: now, note: input.historyNote || 'Created' }],
      notifications: []
    };
    orders.unshift(order);
    await enqueueWrite();
    return publicOrder(order);
  },

  async update(id, values = {}) {
    const orders = await ensureLoaded();
    const order = orders.find(item => item.id === id);
    if (!order) return null;
    const now = new Date().toISOString();

    if (values.status && values.status !== order.status) {
      if (!ORDER_STATUSES.includes(values.status)) {
        throw new Error(`Unsupported status: ${values.status}`);
      }
      order.status = values.status;
      order.statusHistory = order.statusHistory || [];
      order.statusHistory.push({
        status: values.status,
        at: now,
        note: values.statusNote || null
      });
    }

    if (values.notes !== undefined) order.notes = String(values.notes || '');
    if (values.summary !== undefined) order.summary = String(values.summary || '');
    if (values.payment) order.payment = { ...(order.payment || {}), ...values.payment };
    if (values.quote !== undefined) order.quote = values.quote;
    if (values.details) order.details = { ...(order.details || {}), ...values.details };
    if (values.customer) {
      order.customer = {
        name: values.customer.name ?? order.customer?.name ?? null,
        email: values.customer.email ?? order.customer?.email ?? null,
        phone: values.customer.phone ?? order.customer?.phone ?? null
      };
    }
    if (Array.isArray(values.files)) {
      order.files = values.files.filter(Boolean).map(file => ({
        path: file.path || null,
        originalname: file.originalname || file.filename || null,
        filename: file.filename || null,
        mimetype: file.mimetype || null,
        size: file.size || null
      }));
    }

    order.updatedAt = now;
    await enqueueWrite();
    return publicOrder(order);
  },

  async recordNotification(id, entry) {
    const orders = await ensureLoaded();
    const order = orders.find(item => item.id === id);
    if (!order) return null;
    order.notifications = order.notifications || [];
    order.notifications.push({
      type: entry.type || 'status-update',
      status: entry.status || order.status,
      at: new Date().toISOString(),
      delivered: Boolean(entry.delivered),
      to: entry.to || null,
      reason: entry.reason || null
    });
    order.updatedAt = new Date().toISOString();
    await enqueueWrite();
    return publicOrder(order);
  },

  async stats() {
    const orders = await ensureLoaded();
    const byStatus = Object.fromEntries(ORDER_STATUSES.map(status => [status, 0]));
    const byType = {};
    for (const order of orders) {
      byStatus[order.status] = (byStatus[order.status] || 0) + 1;
      byType[order.type] = (byType[order.type] || 0) + 1;
    }
    return {
      total: orders.length,
      byStatus,
      byType,
      open: orders.filter(order => !['completed', 'shipped', 'cancelled'].includes(order.status)).length
    };
  },

  async clear() {
    cache = [];
    await enqueueWrite();
  }
};
