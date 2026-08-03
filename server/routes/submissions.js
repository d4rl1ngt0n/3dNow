import { Router } from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { sendAdminEmail, sendCustomerContactConfirmation, sendCustomerIdeaConfirmation } from '../services/mail.js';
import {
  registerContactSubmission,
  registerIdeaSubmission,
  registerLegacyOrderSubmission
} from '../services/orders.js';

const upload = multer({ dest: config.submissions, limits: { fileSize: config.uploadLimit } });
export const submissionsRouter = Router();

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const text = value => String(value || '').trim();
const validEmail = value => emailPattern.test(text(value));

async function notify(res, payload, orderNumber = null) {
  try {
    await sendAdminEmail(payload);
    res.status(202).json({ accepted: true, emailDelivered: true, orderNumber });
  } catch (error) {
    console.error(`Submission email failed: ${error.message}`);
    res.status(202).json({ accepted: true, emailDelivered: false, orderNumber });
  }
}

submissionsRouter.post('/contact', async (req, res) => {
  const name = text(req.body?.name);
  const email = text(req.body?.email);
  const message = text(req.body?.message);
  if (!name || !validEmail(email) || !message) {
    return res.status(400).json({ error: 'Name, a valid email address, and a message are required.' });
  }

  const phone = text(req.body.phone);
  let order = null;
  try {
    order = await registerContactSubmission({ name, email, phone, message });
  } catch (error) {
    console.error(`Order registry failed for contact: ${error.message}`);
  }
  const orderNumber = order?.id || null;

  const [adminResult, customerResult] = await Promise.allSettled([
    sendAdminEmail({
      subject: `3DNow ${orderNumber || 'contact'} · contact from ${name}`,
      lines: [
        `Order number: ${orderNumber || 'n/a'}`,
        'Type: Contact request',
        `Name: ${name}`,
        `Email: ${email}`,
        `Phone: ${phone || 'Not provided'}`,
        '',
        'Message:',
        message
      ]
    }),
    sendCustomerContactConfirmation({ email, name, orderNumber })
  ]);

  if (adminResult.status === 'rejected') {
    console.error(`Contact notification failed: ${adminResult.reason.message}`);
  }
  if (customerResult.status === 'rejected') {
    console.error(`Contact confirmation failed: ${customerResult.reason.message}`);
  }

  return res.status(202).json({
    accepted: true,
    orderNumber,
    emailDelivered: adminResult.status === 'fulfilled' && adminResult.value.delivered,
    customerEmailDelivered: customerResult.status === 'fulfilled' && customerResult.value.delivered
  });
});

submissionsRouter.post('/idea', upload.single('reference'), async (req, res) => {
  const name = text(req.body?.name);
  const email = text(req.body?.email);
  const description = text(req.body?.description);
  const phone = text(req.body?.phone);
  const deadline = text(req.body?.deadline);
  const quantity = Number(req.body?.quantity);
  if (!name || !validEmail(email) || !description) {
    return res.status(400).json({ error: 'Name, a valid email address, and a description are required.' });
  }
  if (!Number.isInteger(quantity) || quantity < 1) {
    return res.status(400).json({ error: 'Enter how many prints you need (at least 1).' });
  }
  if (deadline) {
    const tomorrow = new Date();
    tomorrow.setHours(0, 0, 0, 0);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const selected = new Date(`${deadline}T00:00:00`);
    if (Number.isNaN(selected.getTime()) || selected < tomorrow) {
      return res.status(400).json({ error: 'Choose a future date for your preferred deadline.' });
    }
  }

  let order = null;
  try {
    order = await registerIdeaSubmission({
      name,
      email,
      phone,
      description,
      deadline,
      quantity,
      file: req.file
    });
  } catch (error) {
    console.error(`Order registry failed for idea: ${error.message}`);
  }
  const orderNumber = order?.id || null;

  const [adminResult, customerResult] = await Promise.allSettled([
    sendAdminEmail({
      subject: `3DNow ${orderNumber || 'design'} · design request from ${name}`,
      lines: [
        `Order number: ${orderNumber || 'n/a'}`,
        'Type: Design service request',
        `Name: ${name}`,
        `Email: ${email}`,
        `Phone: ${phone || 'Not provided'}`,
        `Number of prints: ${quantity}`,
        `Preferred deadline: ${deadline || 'Not provided'}`,
        '',
        'Description:',
        description
      ],
      files: [req.file]
    }),
    sendCustomerIdeaConfirmation({ email, name, description, deadline, quantity, orderNumber })
  ]);
  if (adminResult.status === 'rejected') {
    console.error(`Design request notification failed: ${adminResult.reason.message}`);
  }
  if (customerResult.status === 'rejected') {
    console.error(`Design request confirmation failed: ${customerResult.reason.message}`);
  }
  return res.status(202).json({
    accepted: true,
    orderNumber,
    emailDelivered: adminResult.status === 'fulfilled' && adminResult.value.delivered,
    customerEmailDelivered: customerResult.status === 'fulfilled' && customerResult.value.delivered
  });
});

submissionsRouter.post('/orders', upload.fields([{ name: 'model', maxCount: 1 }, { name: 'studentId', maxCount: 1 }]), async (req, res) => {
  const flow = text(req.body?.flow);
  const contactEmail = text(req.body?.contactEmail);
  const contactPhone = text(req.body?.contactPhone);
  const configuration = text(req.body?.configuration);
  if (!['student', 'business', 'private'].includes(flow) || (!validEmail(contactEmail) && !contactPhone) || !configuration) {
    return res.status(400).json({ error: 'A valid order flow, contact method, and configuration are required.' });
  }

  const files = [
    ...(req.files?.model || []),
    ...(req.files?.studentId || [])
  ];

  let order = null;
  try {
    order = await registerLegacyOrderSubmission({
      flow,
      contactEmail,
      contactPhone,
      configuration,
      files
    });
  } catch (error) {
    console.error(`Order registry failed for legacy order: ${error.message}`);
  }
  const orderNumber = order?.id || null;

  return notify(res, {
    subject: `3DNow ${orderNumber || flow} · ${flow} ${flow === 'business' ? 'quote request' : 'order request'}`,
    lines: [
      `Order number: ${orderNumber || 'n/a'}`,
      'Type: Order configuration',
      `Flow: ${flow}`,
      `Contact email: ${contactEmail || 'Not provided'}`,
      `Contact phone: ${contactPhone || 'Not provided'}`,
      '',
      'Configuration:',
      configuration
    ],
    files
  }, orderNumber);
});
