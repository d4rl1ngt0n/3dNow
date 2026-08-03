import { config } from '../config.js';
import crypto from 'node:crypto';
import { studentPackageFromTotalWeight } from './quote.js';

const STUDENT_PACKAGES = {
  Basic: { rank: 0, price: 39 },
  Medium: { rank: 1, price: 69 },
  Large: { rank: 2, price: 89 }
};
const FILE_EDITING_CENTS = 8900;

let cachedToken = null;
let tokenExpiresAt = 0;

function shopDomain() {
  return config.shopify.shop.replace(/\.myshopify\.com$/i, '').replace(/^https?:\/\//, '');
}

function shopifyUrl(path) {
  return `https://${shopDomain()}.myshopify.com/admin/api/2024-01${path}`;
}

export function shopifyConfigured() {
  return Boolean(
    config.shopify.shop
    && (config.shopify.accessToken || (config.shopify.clientId && config.shopify.clientSecret))
  );
}

function webhookSigningSecret() {
  return config.shopify.webhookSecret || config.shopify.clientSecret || '';
}

async function getAccessToken() {
  if (config.shopify.accessToken && !(config.shopify.clientId && config.shopify.clientSecret)) {
    return config.shopify.accessToken;
  }

  if (config.shopify.clientId && config.shopify.clientSecret) {
    if (cachedToken && Date.now() < tokenExpiresAt - 60_000) return cachedToken;

    const response = await fetch(`https://${shopDomain()}.myshopify.com/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: config.shopify.clientId,
        client_secret: config.shopify.clientSecret
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Shopify token request failed: ${response.status} ${body}`);
    }

    const data = await response.json();
    cachedToken = data.access_token;
    tokenExpiresAt = Date.now() + (Number(data.expires_in || 86399) * 1000);
    return cachedToken;
  }

  if (config.shopify.accessToken) return config.shopify.accessToken;
  throw new Error('Shopify payment is not configured yet.');
}

async function shopifyHeaders() {
  return {
    'Content-Type': 'application/json',
    'X-Shopify-Access-Token': await getAccessToken()
  };
}

export function calculateOrderTotal(job, details) {
  if (!job.quote) throw new Error('A verified automatic quote is required before checkout.');
  const quantity = Number.isInteger(Number(details.quantity)) && Number(details.quantity) > 0
    ? Number(details.quantity)
    : (job.quantity || job.quote.quantity || 1);
  const fileWeightG = Number(job.metrics?.weightG ?? job.quote.weightG);
  const totalWeightG = Number.isFinite(fileWeightG) ? fileWeightG * quantity : null;
  const automaticPackage = Number.isFinite(totalWeightG)
    ? studentPackageFromTotalWeight(totalWeightG).name
    : job.quote.package.name;
  const selectedPackage = details.packageName || automaticPackage;
  if (!STUDENT_PACKAGES[selectedPackage]) throw new Error('Choose a valid student package.');
  if (STUDENT_PACKAGES[selectedPackage].rank < STUDENT_PACKAGES[automaticPackage].rank) {
    throw new Error(`Your verified total weight (${Math.round(totalWeightG)} g) requires at least the ${automaticPackage} package.`);
  }
  job.quantity = quantity;

  const speedCents = details.speed === 'priority' ? 3900 : details.speed === 'express' ? 1900 : 0;
  const reviewCents = details.engineering === 'review' && selectedPackage === 'Basic' ? 1500 : 0;
  const editingCents = details.engineering === 'editing' ? FILE_EDITING_CENTS : 0;
  const baseCents = Math.round(STUDENT_PACKAGES[selectedPackage].price * 100);
  return {
    packageName: selectedPackage,
    baseCents,
    speedCents,
    reviewCents,
    editingCents,
    totalCents: baseCents + speedCents + reviewCents + editingCents
  };
}

export async function createShopifyCheckout(job, details) {
  if (!shopifyConfigured()) {
    throw new Error('Shopify payment is not configured yet.');
  }

  const total = calculateOrderTotal(job, details);
  const totalEur = (total.totalCents / 100).toFixed(2);

  const extras = [
    details.speed === 'priority' ? 'Priority production' : details.speed === 'express' ? 'Express production' : null,
    total.packageName !== 'Basic' ? 'Expert review included' : details.engineering === 'review' ? 'Expert review' : null,
    details.engineering === 'editing' ? 'File editing (first hour)' : null
  ].filter(Boolean);

  const description = [
    job.filename,
    job.requestedMaterial || job.material,
    ...extras
  ].filter(Boolean).join(' | ');

  const customerEmail = details.contactMethod === 'email' ? details.contactEmail : undefined;

  // 3DN is the company order number. Shopify #n stays a payment reference only.
  const orderNumber = String(job.id);
  const draftOrder = {
    draft_order: {
      line_items: [{
        title: `${orderNumber} · 3DNow student print · ${total.packageName}`,
        price: totalEur,
        quantity: 1,
        requires_shipping: true,
        taxable: true,
        properties: [
          { name: 'Order number', value: orderNumber },
          { name: 'File', value: String(job.filename || '').slice(0, 100) }
        ]
      }],
      tags: `${orderNumber}, 3dnow-student`,
      note: `Order number: ${orderNumber}\njobId=${orderNumber}\n${description}`,
      note_attributes: [
        { name: 'orderNumber', value: orderNumber },
        { name: 'jobId', value: orderNumber },
        { name: 'filename', value: job.filename },
        { name: 'package', value: total.packageName },
        { name: 'material', value: job.requestedMaterial || job.material },
        { name: 'engineering', value: details.engineering || 'none' },
        { name: 'speed', value: details.speed || 'standard' },
        { name: 'verificationMethod', value: details.verificationMethod || '' },
        { name: 'universityEmail', value: details.universityEmail || '' }
      ],
      ...(customerEmail ? { email: customerEmail } : {}),
      use_customer_default_address: false,
      shipping_line: {
        title: 'Standard Shipping',
        price: '0.00'
      }
    }
  };

  const response = await fetch(shopifyUrl('/draft_orders.json'), {
    method: 'POST',
    headers: await shopifyHeaders(),
    body: JSON.stringify(draftOrder)
  });

  if (!response.ok) {
    const body = await response.text();
    console.error('Shopify Draft Order error:', response.status, body);
    throw new Error('Could not create Shopify checkout. Please try again.');
  }

  const data = await response.json();
  const created = data.draft_order;

  return {
    id: String(created.id),
    url: created.invoice_url,
    totalCents: total.totalCents
  };
}

export function verifyShopifyWebhook(payload, hmacHeader) {
  const secret = webhookSigningSecret();
  if (!secret || !hmacHeader) return false;
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload || ''), 'utf8');
  const hash = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('base64');
  try {
    const expected = Buffer.from(hash);
    const received = Buffer.from(String(hmacHeader));
    return expected.length === received.length && crypto.timingSafeEqual(expected, received);
  } catch {
    return false;
  }
}

export async function ensureOrdersPaidWebhook() {
  if (!shopifyConfigured() || !config.publicUrl) {
    return { ok: false, reason: 'Shopify or PUBLIC_URL is not configured.' };
  }
  const address = `${config.publicUrl.replace(/\/$/, '')}/api/webhooks/shopify/orders-paid`;
  const listResponse = await fetch(shopifyUrl('/webhooks.json'), { headers: await shopifyHeaders() });
  if (!listResponse.ok) {
    const body = await listResponse.text();
    return { ok: false, reason: `Could not list webhooks: ${listResponse.status} ${body}` };
  }
  const list = await listResponse.json();
  const existing = (list.webhooks || []).find(hook => hook.topic === 'orders/paid' && hook.address === address);
  if (existing) return { ok: true, id: existing.id, address, created: false };

  const createResponse = await fetch(shopifyUrl('/webhooks.json'), {
    method: 'POST',
    headers: await shopifyHeaders(),
    body: JSON.stringify({
      webhook: {
        topic: 'orders/paid',
        address,
        format: 'json'
      }
    })
  });
  if (!createResponse.ok) {
    const body = await createResponse.text();
    return { ok: false, reason: `Could not create webhook: ${createResponse.status} ${body}` };
  }
  const created = await createResponse.json();
  return { ok: true, id: created.webhook?.id, address, created: true };
}
