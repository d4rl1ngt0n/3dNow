import { Router } from 'express';
import { jobStore } from '../services/job-store.js';
import { sendAdminEmail, sendCustomerOrderConfirmation } from '../services/mail.js';
import { verifyWebhook } from '../services/payments.js';
import { registerPaidStudentOrder } from '../services/orders.js';

function formatAddress(address) {
  if (!address) return 'Not provided';
  return [address.line1, address.line2, [address.postal_code, address.city].filter(Boolean).join(' '), address.state, address.country]
    .filter(Boolean)
    .join(', ');
}

async function notifyPaidOrder(job, session) {
  const details = job.orderDetails || {};
  const shippingAddress = formatAddress(session.shipping_details?.address);
  const customerEmail = session.customer_details?.email || details.contactEmail;

  const lines = [
    `Job ID: ${job.id}`,
    `Payment status: paid`,
    `Stripe session: ${session.id}`,
    `File: ${job.filename}`,
    `Package: ${details.packageName || job.quote?.package?.name || 'Manual review'}`,
    `Amount paid: €${((session.amount_total || 0) / 100).toFixed(2)}`,
    `Requested material: ${job.requestedMaterial || job.material}`,
    `Engineering support: ${details.engineering || 'None'}`,
    `Production speed: ${details.speed || 'standard'}`,
    `Verification: ${details.verificationMethod || 'Not provided'}`,
    `University email: ${details.universityEmail || 'Not provided'}`,
    `Customer email: ${customerEmail || 'Not provided'}`,
    `Customer phone: ${details.contactPhone || 'Not provided'}`,
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
      totalCents: session.amount_total,
      shippingAddress
    });
  }
}

export const paymentsRouter = Router();

paymentsRouter.post('/webhook', async (req, res) => {
  const signature = req.headers['stripe-signature'];
  if (!signature) return res.status(400).send('Missing Stripe signature.');

  let event;
  try {
    event = verifyWebhook(req.body, signature);
  } catch (error) {
    return res.status(400).send(`Webhook verification failed: ${error.message}`);
  }

  if (event.type !== 'checkout.session.completed') return res.json({ received: true });

  const session = event.data.object;
  if (session.payment_status !== 'paid') return res.json({ received: true });
  const job = jobStore.get(session.metadata?.jobId);
  if (!job) return res.status(404).json({ error: 'Order job not found.' });
  if (job.payment?.status === 'paid') return res.json({ received: true });

  job.payment = {
    ...job.payment,
    status: 'paid',
    sessionId: session.id,
    totalCents: session.amount_total,
    paidAt: new Date().toISOString()
  };

  try {
    await registerPaidStudentOrder(job, session);
  } catch (error) {
    console.error(`Order registry failed for paid order: ${error.message}`);
  }

  try {
    await notifyPaidOrder(job, session);
  } catch (error) {
    console.error(`Paid order notification failed: ${error.message}`);
  }

  return res.json({ received: true });
});
