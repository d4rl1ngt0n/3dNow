import { Router } from 'express';
import { jobStore } from '../services/job-store.js';
import { sendAdminEmail, sendCustomerOrderConfirmation } from '../services/mail.js';
import { registerPaidStudentOrder } from '../services/orders.js';

function formatAddress(address) {
  if (!address) return 'Not provided';
  return [address.address1, address.address2, [address.zip, address.city].filter(Boolean).join(' '), address.province, address.country]
    .filter(Boolean)
    .join(', ');
}

async function notifyPaidOrder(job, order) {
  const details = job.orderDetails || {};
  const shippingAddress = formatAddress(order.shipping_address);
  const customerEmail = order.email || order.contact_email || details.contactEmail;
  const totalCents = Math.round(parseFloat(order.total_price || '0') * 100);

  const lines = [
    `Job ID: ${job.id}`,
    `Payment status: paid`,
    `Shopify order: ${order.name || order.id}`,
    `File: ${job.filename}`,
    `Package: ${details.packageName || job.quote?.package?.name || 'Manual review'}`,
    `Amount paid: EUR${(totalCents / 100).toFixed(2)}`,
    `Requested material: ${job.requestedMaterial || job.material}`,
    `Engineering support: ${details.engineering || 'None'}`,
    `Production speed: ${details.speed || 'standard'}`,
    `Verification: ${details.verificationMethod || 'Not provided'}`,
    `University email: ${details.universityEmail || 'Not provided'}`,
    `Customer email: ${customerEmail || 'Not provided'}`,
    `Shipping address: ${shippingAddress}`
  ];

  await sendAdminEmail({
    subject: `3DNow paid student print order: ${job.filename}`,
    lines,
    files: [job.upload, job.studentIdFile]
  });

  if (customerEmail) {
    await sendCustomerOrderConfirmation({
      email: customerEmail,
      filename: job.filename,
      packageName: details.packageName || job.quote?.package?.name,
      totalCents,
      shippingAddress
    });
  }
}

export const shopifyWebhooksRouter = Router();

shopifyWebhooksRouter.post('/orders-paid', async (req, res) => {
  let order;
  try {
    order = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).send('Invalid JSON');
  }

  if (!order || order.financial_status !== 'paid') return res.json({ received: true });

  const noteAttrs = order.note_attributes || [];
  const jobId = noteAttrs.find(a => a.name === 'jobId')?.value;
  if (!jobId) {
    console.log('Shopify webhook: no jobId in note_attributes, skipping.');
    return res.json({ received: true });
  }

  const job = jobStore.get(jobId);
  if (!job) {
    console.log(`Shopify webhook: job ${jobId} not found in memory.`);
    return res.json({ received: true });
  }
  if (job.payment?.status === 'paid') return res.json({ received: true });

  const totalCents = Math.round(parseFloat(order.total_price || '0') * 100);
  job.payment = {
    ...job.payment,
    status: 'paid',
    shopifyOrderId: String(order.id),
    shopifyOrderName: order.name,
    totalCents,
    paidAt: new Date().toISOString()
  };

  const fakeSession = {
    id: `shopify-${order.id}`,
    amount_total: totalCents,
    customer_details: {
      email: order.email || order.contact_email,
      name: order.shipping_address?.name || order.billing_address?.name || null
    },
    shipping_details: {
      address: order.shipping_address ? {
        line1: order.shipping_address.address1,
        line2: order.shipping_address.address2,
        postal_code: order.shipping_address.zip,
        city: order.shipping_address.city,
        state: order.shipping_address.province,
        country: order.shipping_address.country
      } : null
    }
  };

  try {
    await registerPaidStudentOrder(job, fakeSession);
  } catch (error) {
    console.error(`Order registry failed for paid order: ${error.message}`);
  }

  try {
    await notifyPaidOrder(job, order);
  } catch (error) {
    console.error(`Paid order notification failed: ${error.message}`);
  }

  return res.json({ received: true });
});
