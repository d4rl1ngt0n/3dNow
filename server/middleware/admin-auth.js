import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

const sessions = new Map();
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function pruneSessions() {
  const now = Date.now();
  for (const [key, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(key);
  }
}

export function adminConfigured() {
  return Boolean(config.admin.password);
}

export function verifyAdminPassword(password) {
  const expected = config.admin.password;
  if (!expected || typeof password !== 'string') return false;
  const left = Buffer.from(password);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function createAdminSession() {
  pruneSessions();
  const token = randomBytes(32).toString('hex');
  sessions.set(hashToken(token), {
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL_MS
  });
  return token;
}

export function destroyAdminSession(token) {
  if (!token) return;
  sessions.delete(hashToken(token));
}

export function readAdminToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  const cookie = req.headers.cookie || '';
  const match = cookie.match(/(?:^|;\s*)3dnow_admin=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

export function requireAdmin(req, res, next) {
  if (!adminConfigured()) {
    return res.status(503).json({ error: 'Admin access is not configured. Set ADMIN_PASSWORD.' });
  }
  pruneSessions();
  const token = readAdminToken(req);
  if (!token) return res.status(401).json({ error: 'Sign in required.' });
  const session = sessions.get(hashToken(token));
  if (!session || session.expiresAt <= Date.now()) {
    if (session) sessions.delete(hashToken(token));
    return res.status(401).json({ error: 'Session expired. Sign in again.' });
  }
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  req.adminToken = token;
  return next();
}
