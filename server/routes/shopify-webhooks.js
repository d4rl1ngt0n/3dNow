import { Router } from 'express';
import { jobStore } from '../services/job-store.js';
import { sendAdminEmail, sendCustomerOrderConfirmation } from '../services/mail.js';
import { markStudentOrderPaidFromShopify } from '../services/orders.js';
import { verifyShopifyWebhook } from '../services/shopify-checkout.js';
import { config } from '../config.js';

function formatAddress(address) {
  if (!address) return 'Not provided';
  return [address.address1, address.address2, [address.zip, address.city].filter(Boolean).join(' '), address.province, address.country]
    .filter(Boolean)
    .join(', ');
}

function shippingFromShopify(order) {
  const address = order.shipping_address;
  if (!address) return null;
  return {
    name: address.name || [address.first_name, address.last_name].filter(Boolean).join(' ') || null,
    line1: address.address1 || null,
    line2: address.address2 || null,
    postal_code: address.zip || null,
    city: address.city || null,
    state: address.province || null,
    country: address.country || null,
    phone: address.phone || null
  };
}

async function notifyPaidOrder({ job, orderRecord, order }) {
  const details = job?.orderDetails || orderRecord?.details || {};
  const shippingAddress = formatAddress(order.shipping_address);
  const customerEmail = order.email || order.contact_email || details.contactEmail || orderRecord?.customer?.email;
  const totalCents = Math.round(parseFloat(order.total_price || '0') * 100);
  const filename = job?.filename || orderRecord?.filename || order.name || 'order';
  const orderNumber = job?.id || orderRecord?.id || orderRecord?.jobId || null;
  const shopifyOrderName = order.name || orderRecord?.payment?.shopifyOrderName || null;

  const lines = [
    `Order number: ${orderNumber || 'n/a'}`,
    `Payment status: paid`,
    shopifyOrderName ? `Shopify payment ref: ${shopifyOrderName}` : null,
    `File: ${filename}`,
    `Package: ${details.packageName || job?.quote?.package?.name || 'Manual review'}`,
    `Amount paid: EUR${(totalCents / 100).toFixed(2)}`,
    `Requested material: ${details.material || job?.requestedMaterial || job?.material || 'n/a'}`,
    `Engineering support: ${details.engineering || 'None'}`,
    `Production speed: ${details.speed || 'standard'}`,
    `Verification: ${details.verificationMethod || 'Not provided'}`,
    `University email: ${details.universityEmail || 'Not provided'}`,
    `Customer email: ${customerEmail || 'Not provided'}`,
    `Shipping address: ${shippingAddress}`
  ].filter(Boolean);

  await sendAdminEmail({
    subject: `3DNow ${orderNumber || 'paid'} · student print · ${filename}`,
    lines,
    files: job ? [job.upload, job.studentIdFile] : (orderRecord?.files || [])
  });

  if (customerEmail) {
    await sendCustomerOrderConfirmation({
      email: customerEmail,
      filename,
      packageName: details.packageName || job?.quote?.package?.name,
      totalCents,
      shippingAddress,
      orderNumber
    });
  }
}

export const shopifyWebhooksRouter = Router();

shopifyWebhooksRouter.post('/orders-paid', async (req, res) => {
  const rawBody = Buffer.isBuffer(req.body)
    ? req.body
    : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {}), 'utf8');
  const hmac = req.get('X-Shopify-Hmac-Sha256');

  if (config.shopify.webhookSecret) {
    if (!verifyShopifyWebhook(rawBody, hmac)) {
      console.error('Shopify webhook HMAC verification failed.');
      return res.status(401).send('Invalid webhook signature');
    }
  } else {
    console.warn('SHOPIFY_WEBHOOK_SECRET is not set. Accepting webhook without HMAC verification.');
  }

  let order;
  try {
    order = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).send('Invalid JSON');
  }

  if (!order || order.financial_status !== 'paid') return res.json({ received: true });

  const noteAttrs = order.note_attributes || [];
  const fromAttrs = noteAttrs.find(a => a.name === 'orderNumber' || a.name === 'jobId')?.value;
  const fromNote = typeof order.note === 'string'
    ? (order.note.match(/(?:Order number|jobId)\s*[:=]\s*(3DN\d+|[a-zA-Z0-9_-]+)/i)?.[1] || null)
    : null;
  const fromTags = typeof order.tags === 'string'
    ? (order.tags.match(/\b(3DN\d+)\b/i)?.[1] || null)
    : null;
  const jobId = fromAttrs || fromNote || fromTags;
  if (!jobId) {
    console.log('Shopify webhook: no 3DN order number in note_attributes/tags, skipping.');
    return res.json({ received: true });
  }

  const job = jobStore.get(jobId);
  if (job?.payment?.status === 'paid') return res.json({ received: true });

  const totalCents = Math.round(parseFloat(order.total_price || '0') * 100);
  const shipping = shippingFromShopify(order);
  const paidAt = new Date().toISOString();

  if (job) {
    job.payment = {
      ...job.payment,
      status: 'paid',
      shopifyOrderId: String(order.id),
      shopifyOrderName: order.name,
      totalCents,
      paidAt,
      shippingAddress: shipping
    };
    jobStore.touch(job.id);
  }

  let orderRecord = null;
  try {
    orderRecord = await markStudentOrderPaidFromShopify({
      jobId,
      job,
      shopifyOrder: order,
      totalCents,
      shippingAddress: shipping,
      paidAt
    });
  } catch (error) {
    console.error(`Order registry failed for paid order: ${error.message}`);
  }

  try {
    await notifyPaidOrder({ job, orderRecord, order });
  } catch (error) {
    console.error(`Paid order notification failed: ${error.message}`);
  }

  return res.json({ received: true });
});
