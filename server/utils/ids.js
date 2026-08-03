import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { config } from '../config.js';

const COUNTER_PATH = path.join(config.dataDir, 'id-counter.json');
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

let writeQueue = Promise.resolve();

async function readCounter() {
  try {
    const raw = await fs.readFile(COUNTER_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const value = Number(parsed?.next);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
  } catch (error) {
    if (error.code !== 'ENOENT') console.error(`ID counter read failed: ${error.message}`);
    return 1;
  }
}

async function writeCounter(next) {
  await fs.mkdir(path.dirname(COUNTER_PATH), { recursive: true });
  const tmp = `${COUNTER_PATH}.${process.pid}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify({ next, updatedAt: new Date().toISOString() }, null, 2)}\n`);
  await fs.rename(tmp, COUNTER_PATH);
}

/**
 * Sequential company order ids: 3DN0001, 3DN0002, ...
 * Shared across jobs and orders so every shippable request keeps one reference.
 *
 * Rule (canonical):
 * - 3DN#### is the primary order number for customers, ops, packing, and DHL labels.
 * - Shopify #1001 is a payment reference only (student checkout). Never use it as the company order number.
 */
export async function next3dnId() {
  let allocated = '';
  writeQueue = writeQueue.then(async () => {
    const next = await readCounter();
    allocated = `3DN${String(next).padStart(4, '0')}`;
    await writeCounter(next + 1);
  }).catch(error => {
    console.error(`ID counter write failed: ${error.message}`);
    throw error;
  });
  await writeQueue;
  return allocated;
}

/** Fallback random short id (legacy / tests). */
export function createShortId(length = 8, exists = null) {
  const size = Math.max(4, Math.min(32, Number(length) || 8));
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const bytes = randomBytes(size);
    let id = '';
    for (let i = 0; i < size; i += 1) {
      id += ALPHABET[bytes[i] % ALPHABET.length];
    }
    if (!exists || !exists(id)) return id;
  }
  throw new Error('Could not allocate a unique short id');
}

export function displayShortId(id) {
  if (!id) return '';
  const raw = String(id);
  if (/^3DN\d+$/i.test(raw) || raw.length <= 12) return raw.toUpperCase();
  return raw.replace(/-/g, '').slice(0, 8).toUpperCase();
}
