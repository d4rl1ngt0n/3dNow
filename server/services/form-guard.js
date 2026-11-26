const buckets = new Map();
const RATE_LIMIT = Number(process.env.SUBMISSION_RATE_LIMIT || 5);
const RATE_WINDOW_MS = Number(process.env.SUBMISSION_RATE_WINDOW_MS || 10 * 60 * 1000);
const MIN_FILL_MS = Number(process.env.SUBMISSION_MIN_FILL_MS || 1200);

export function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket?.remoteAddress || 'unknown';
}

export function rateLimited(ip, { limit = RATE_LIMIT, windowMs = RATE_WINDOW_MS } = {}) {
  const now = Date.now();
  const fresh = (buckets.get(ip) || []).filter(stamp => now - stamp < windowMs);
  if (fresh.length >= limit) {
    buckets.set(ip, fresh);
    return true;
  }
  fresh.push(now);
  buckets.set(ip, fresh);
  return false;
}

export function honeypotFilled(body = {}) {
  const traps = [body.website, body.hp_website, body.company_url, body.fax];
  return traps.some(value => String(value || '').trim() !== '');
}

export function submittedTooFast(body = {}, minMs = MIN_FILL_MS) {
  const started = Number(body.startedAt);
  if (!Number.isFinite(started) || started <= 0) return false;
  const elapsed = Date.now() - started;
  return elapsed >= 0 && elapsed < minMs;
}

export function turnstileConfigured() {
  return Boolean(process.env.TURNSTILE_SECRET_KEY);
}

export function turnstileSiteKey() {
  return process.env.TURNSTILE_SITE_KEY || '';
}

function turnstileToken(body = {}, headers = {}) {
  return String(
    body.turnstileToken
    || body['cf-turnstile-response']
    || headers['cf-turnstile-response']
    || ''
  ).trim();
}

export async function verifyTurnstile(token, ip) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return { ok: true, skipped: true };
  if (!token) return { ok: false, reason: 'missing' };

  const payload = new URLSearchParams({
    secret,
    response: token,
    remoteip: ip || ''
  });
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: payload
  });
  const result = await response.json().catch(() => ({}));
  if (!result.success) return { ok: false, reason: 'failed' };
  return { ok: true };
}

export async function guardSubmission(req, { requireTurnstile = true } = {}) {
  const ip = clientIp(req);
  const body = req.body || {};
  if (rateLimited(ip)) {
    return { blocked: true, status: 429, error: 'Too many requests. Please wait a few minutes and try again.' };
  }
  if (honeypotFilled(body) || submittedTooFast(body)) {
    return { blocked: true, silent: true };
  }
  if (requireTurnstile && turnstileConfigured()) {
    const check = await verifyTurnstile(turnstileToken(body, req.headers), ip);
    if (!check.ok) {
      return { blocked: true, status: 400, error: 'Please confirm you are not a robot and try again.' };
    }
  }
  return { blocked: false };
}

export function silentAccept(res) {
  return res.status(202).json({ accepted: true, emailDelivered: false });
}
