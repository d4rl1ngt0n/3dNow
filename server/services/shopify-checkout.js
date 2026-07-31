import { config } from '../config.js';
import crypto from 'node:crypto';

const SHIPPING_COUNTRIES = ['AT', 'BE', 'DE', 'DK', 'ES', 'FI', 'FR', 'IE', 'IT', 'LU', 'NL', 'PL', 'PT', 'SE'];
const STUDENT_PACKAGES = {
  Basic: { rank: 0, price: 39 },
  Medium: { rank: 1, price: 69 },
  Large: { rank: 2, price: 89 }
};
const FILE_EDITING_CENTS = 9000;

function shopifyHeaders() {
  return {
    'Content-Type': 'application/json',
    'X-Shopify-Access-Token': config.shopify.accessToken
  };
}

function shopifyUrl(path) {
  const shop = config.shopify.shop.replace(/\.myshopify\.com$/, '');
  return `https://${shop}.myshopify.com/admin/api/2024-01${path}`;
}

export function calculateOrderTotal(job, details) {
  if (!job.quote) throw new Error('A verified automatic quote is required before checkout.');
  const automaticPackage = job.quote.package.name;
  const selectedPackage = details.packageName || automaticPackage;
  if (!STUDENT_PACKAGES[selectedPackage]) throw new Error('Choose a valid student package.');
  if (STUDENT_PACKAGES[selectedPackage].rank < STUDENT_PACKAGES[automaticPackage].rank) {
    throw new Error(`Your verified file weight requires at least the ${automaticPackage} package.`);
  }

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
  if (!config.shopify.shop || !config.shopify.accessToken) {
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

  const draftOrder = {
    draft_order: {
      line_items: [{
        title: `3DNow student print: ${total.packageName}`,
        price: totalEur,
        quantity: 1,
        requires_shipping: true,
        taxable: true
      }],
      note: description,
      note_attributes: [
        { name: 'jobId', value: job.id },
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
    headers: shopifyHeaders(),
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
  const secret = config.shopify.accessToken;
  const hash = crypto
    .createHmac('sha256', secret)
    .update(payload, 'utf8')
    .digest('base64');
  return crypto.timingSafeEqual(
    Buffer.from(hash),
    Buffer.from(hmacHeader || '')
  );
}
