import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';

const STORE_PATH = path.join(config.dataDir, 'settings.json');
const SECRET_UNCHANGED = '';

let cached = null;

const DEFAULTS = {
  publicUrl: '',
  notifyTo: '',
  adminPassword: '',
  smtp: {
    host: '',
    port: 587,
    secure: false,
    user: '',
    pass: '',
    from: ''
  },
  shopify: {
    shop: '',
    clientId: '',
    clientSecret: '',
    accessToken: '',
    webhookSecret: ''
  },
  stripe: {
    secretKey: '',
    webhookSecret: ''
  }
};

function deepMerge(base, patch) {
  const out = { ...base };
  for (const [key, value] of Object.entries(patch || {})) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = deepMerge(base[key] && typeof base[key] === 'object' ? base[key] : {}, value);
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

async function readFile() {
  try {
    const raw = await fs.readFile(STORE_PATH, 'utf8');
    return deepMerge(DEFAULTS, JSON.parse(raw));
  } catch (error) {
    if (error.code !== 'ENOENT') console.error(`Settings read failed: ${error.message}`);
    return structuredClone(DEFAULTS);
  }
}

async function writeFile(settings) {
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
  const tmp = `${STORE_PATH}.${process.pid}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(settings, null, 2)}\n`);
  await fs.rename(tmp, STORE_PATH);
}

export function applySettingsToConfig(settings) {
  if (settings.publicUrl) config.publicUrl = settings.publicUrl;
  if (settings.notifyTo) config.notifyTo = settings.notifyTo;
  if (settings.adminPassword) config.admin.password = settings.adminPassword;

  if (settings.smtp) {
    if (settings.smtp.host != null && settings.smtp.host !== '') config.smtp.host = settings.smtp.host;
    if (settings.smtp.port != null && settings.smtp.port !== '') config.smtp.port = Number(settings.smtp.port) || config.smtp.port;
    if (typeof settings.smtp.secure === 'boolean') config.smtp.secure = settings.smtp.secure;
    if (settings.smtp.user != null && settings.smtp.user !== '') config.smtp.user = settings.smtp.user;
    if (settings.smtp.pass) config.smtp.pass = settings.smtp.pass;
    if (settings.smtp.from != null && settings.smtp.from !== '') config.smtp.from = settings.smtp.from;
  }

  if (settings.shopify) {
    if (settings.shopify.shop != null && settings.shopify.shop !== '') config.shopify.shop = settings.shopify.shop;
    if (settings.shopify.clientId != null && settings.shopify.clientId !== '') config.shopify.clientId = settings.shopify.clientId;
    if (settings.shopify.clientSecret) config.shopify.clientSecret = settings.shopify.clientSecret;
    if (settings.shopify.accessToken) config.shopify.accessToken = settings.shopify.accessToken;
    if (settings.shopify.webhookSecret) {
      config.shopify.webhookSecret = settings.shopify.webhookSecret;
    } else if (settings.shopify.clientSecret) {
      config.shopify.webhookSecret = settings.shopify.clientSecret;
    }
  }

  if (settings.stripe) {
    if (settings.stripe.secretKey) config.stripe.secretKey = settings.stripe.secretKey;
    if (settings.stripe.webhookSecret) config.stripe.webhookSecret = settings.stripe.webhookSecret;
  }
}

export async function loadRuntimeSettings() {
  cached = await readFile();
  applySettingsToConfig(cached);
  return cached;
}

export async function getRuntimeSettings() {
  if (!cached) cached = await readFile();
  return cached;
}

function isSecretPlaceholder(value) {
  if (value == null) return true;
  const text = String(value);
  return text === SECRET_UNCHANGED || /^•+$/.test(text) || text === '********' || text === '__UNCHANGED__';
}

function pickSecret(nextValue, currentValue) {
  if (isSecretPlaceholder(nextValue)) return currentValue || '';
  if (nextValue === '__CLEAR__') return '';
  return String(nextValue);
}

export async function updateRuntimeSettings(patch = {}) {
  const current = await getRuntimeSettings();
  const next = structuredClone(current);

  if (patch.publicUrl != null) next.publicUrl = String(patch.publicUrl).trim();
  if (patch.notifyTo != null) next.notifyTo = String(patch.notifyTo).trim();
  if (patch.adminPassword != null && !isSecretPlaceholder(patch.adminPassword)) {
    const password = String(patch.adminPassword);
    if (password.length < 8) throw new Error('Admin password must be at least 8 characters.');
    next.adminPassword = password;
  }

  if (patch.smtp) {
    if (patch.smtp.host != null) next.smtp.host = String(patch.smtp.host).trim();
    if (patch.smtp.port != null && patch.smtp.port !== '') next.smtp.port = Number(patch.smtp.port) || 587;
    if (typeof patch.smtp.secure === 'boolean') next.smtp.secure = patch.smtp.secure;
    if (patch.smtp.user != null) next.smtp.user = String(patch.smtp.user).trim();
    if (patch.smtp.pass != null) next.smtp.pass = pickSecret(patch.smtp.pass, current.smtp.pass);
    if (patch.smtp.from != null) next.smtp.from = String(patch.smtp.from).trim();
  }

  if (patch.shopify) {
    if (patch.shopify.shop != null) next.shopify.shop = String(patch.shopify.shop).trim();
    if (patch.shopify.clientId != null) next.shopify.clientId = String(patch.shopify.clientId).trim();
    if (patch.shopify.clientSecret != null) {
      next.shopify.clientSecret = pickSecret(patch.shopify.clientSecret, current.shopify.clientSecret);
    }
    if (patch.shopify.accessToken != null) {
      next.shopify.accessToken = pickSecret(patch.shopify.accessToken, current.shopify.accessToken);
    }
    if (patch.shopify.webhookSecret != null) {
      next.shopify.webhookSecret = pickSecret(patch.shopify.webhookSecret, current.shopify.webhookSecret);
    }
  }

  if (patch.stripe) {
    if (patch.stripe.secretKey != null) {
      next.stripe.secretKey = pickSecret(patch.stripe.secretKey, current.stripe.secretKey);
    }
    if (patch.stripe.webhookSecret != null) {
      next.stripe.webhookSecret = pickSecret(patch.stripe.webhookSecret, current.stripe.webhookSecret);
    }
  }

  await writeFile(next);
  cached = next;
  applySettingsToConfig(next);
  return next;
}

export function publicSettingsView() {
  const smtpReady = Boolean(config.smtp.host && config.smtp.user && config.smtp.pass);
  const shopifyReady = Boolean(
    config.shopify.shop
    && (config.shopify.accessToken || (config.shopify.clientId && config.shopify.clientSecret))
  );

  return {
    publicUrl: config.publicUrl || '',
    notifyTo: config.notifyTo || '',
    adminPasswordConfigured: Boolean(config.admin.password),
    smtp: {
      host: config.smtp.host || '',
      port: config.smtp.port || 587,
      secure: Boolean(config.smtp.secure),
      user: config.smtp.user || '',
      passConfigured: Boolean(config.smtp.pass),
      from: config.smtp.from || ''
    },
    shopify: {
      shop: config.shopify.shop || '',
      clientId: config.shopify.clientId || '',
      clientSecretConfigured: Boolean(config.shopify.clientSecret),
      accessTokenConfigured: Boolean(config.shopify.accessToken),
      webhookSecretConfigured: Boolean(config.shopify.webhookSecret)
    },
    stripe: {
      secretKeyConfigured: Boolean(config.stripe.secretKey),
      webhookSecretConfigured: Boolean(config.stripe.webhookSecret)
    },
    checks: {
      adminPassword: Boolean(config.admin.password),
      publicUrl: Boolean(config.publicUrl && /^https?:\/\//.test(config.publicUrl)),
      notifyTo: Boolean(config.notifyTo && config.notifyTo.includes('@')),
      smtp: smtpReady,
      shopify: shopifyReady
    },
    endpoints: {
      shopifyWebhook: config.publicUrl
        ? `${String(config.publicUrl).replace(/\/$/, '')}/api/webhooks/shopify/orders-paid`
        : '',
      health: config.publicUrl
        ? `${String(config.publicUrl).replace(/\/$/, '')}/api/health`
        : '/api/health',
      admin: config.publicUrl
        ? `${String(config.publicUrl).replace(/\/$/, '')}/admin`
        : '/admin'
    }
  };
}
