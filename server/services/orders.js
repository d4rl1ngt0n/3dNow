import { orderStore } from './order-store.js';

function fileRef(file) {
  if (!file?.path) return null;
  return {
    path: file.path,
    originalname: file.originalname || file.filename || null,
    filename: file.filename || null,
    mimetype: file.mimetype || null,
    size: file.size || null
  };
}

export async function registerBusinessQuote(job) {
  const request = job.businessQuoteRequest || {};
  const existing = await orderStore.findByJobId(job.id);
  const payload = {
    type: 'business-quote',
    flow: 'business',
    status: 'new',
    summary: `Business quote · ${job.filename} · ${job.quote?.totalFormatted || 'pending'}`,
    filename: job.filename,
    jobId: job.id,
    customer: {
      name: null,
      email: request.contactEmail || null,
      phone: request.contactPhone || null
    },
    quote: job.quote || null,
    details: {
      material: job.requestedMaterial || job.material,
      color: request.color,
      quantity: request.quantity || job.quantity,
      speed: request.speed,
      engineering: request.engineering,
      contactMethod: request.contactMethod,
      metrics: {
        weightG: job.metrics?.weightG ?? null,
        printTimeSec: job.metrics?.printTimeSec ?? null,
        printer: job.metrics?.printer?.name || job.quote?.printer?.name || null
      }
    },
    files: [fileRef(job.upload)].filter(Boolean),
    historyNote: 'Business quote request received'
  };

  if (existing) {
    return orderStore.update(existing.id, {
      ...payload,
      status: existing.status === 'new' ? 'new' : existing.status,
      statusNote: 'Business quote details refreshed'
    });
  }
  return orderStore.create(payload);
}

export async function registerPrivateQuote(job) {
  const request = job.privateQuoteRequest || {};
  const existing = await orderStore.findByJobId(job.id);
  const payload = {
    type: 'private-quote',
    flow: 'private',
    status: 'new',
    summary: `Private quote · ${job.filename} · qty ${request.quantity || 1}`,
    filename: job.filename,
    jobId: job.id,
    customer: {
      name: null,
      email: request.contactEmail || null,
      phone: request.contactPhone || null
    },
    details: {
      material: request.material || job.requestedMaterial || job.material,
      color: request.color,
      quantity: request.quantity,
      speed: request.speed,
      engineering: request.engineering,
      contactMethod: request.contactMethod,
      metrics: {
        weightG: job.metrics?.weightG ?? null,
        printTimeSec: job.metrics?.printTimeSec ?? null
      }
    },
    files: [fileRef(job.upload)].filter(Boolean),
    historyNote: 'Private quote request received'
  };

  if (existing) {
    return orderStore.update(existing.id, {
      ...payload,
      statusNote: 'Private quote details refreshed'
    });
  }
  return orderStore.create(payload);
}

export async function registerCheckoutPending(job) {
  const details = job.orderDetails || {};
  const existing = await orderStore.findByJobId(job.id);
  const payload = {
    type: 'student-order',
    flow: 'student',
    status: 'awaiting-payment',
    summary: `Student checkout · ${job.filename} · ${details.packageName || job.quote?.package?.name || 'package'}`,
    filename: job.filename,
    jobId: job.id,
    customer: {
      name: null,
      email: details.contactEmail || null,
      phone: details.contactPhone || null
    },
    payment: job.payment || { status: 'pending' },
    quote: job.quote || null,
    details: {
      packageName: details.packageName || job.quote?.package?.name || null,
      material: job.requestedMaterial || job.material,
      engineering: details.engineering || null,
      speed: details.speed || 'standard',
      verificationMethod: details.verificationMethod || null,
      universityEmail: details.universityEmail || null,
      contactMethod: details.contactMethod || null
    },
    files: [fileRef(job.upload), fileRef(job.studentIdFile)].filter(Boolean),
    historyNote: 'Shopify checkout started'
  };

  if (existing) {
    return orderStore.update(existing.id, {
      status: 'awaiting-payment',
      statusNote: 'Checkout restarted',
      payment: payload.payment,
      customer: payload.customer,
      details: payload.details,
      quote: payload.quote,
      files: payload.files,
      summary: payload.summary
    });
  }
  return orderStore.create(payload);
}

export async function registerPaidStudentOrder(job, session) {
  const details = job.orderDetails || {};
  const existing = await orderStore.findByJobId(job.id);
  const customerEmail = session?.customer_details?.email || details.contactEmail || null;
  const payload = {
    type: 'student-order',
    flow: 'student',
    status: 'paid',
    summary: `Paid student print · ${job.filename}`,
    filename: job.filename,
    jobId: job.id,
    customer: {
      name: session?.customer_details?.name || null,
      email: customerEmail,
      phone: details.contactPhone || null
    },
    payment: {
      status: 'paid',
      sessionId: session?.id || job.payment?.sessionId || null,
      totalCents: session?.amount_total ?? job.payment?.totalCents ?? null,
      paidAt: job.payment?.paidAt || new Date().toISOString(),
      shippingAddress: session?.shipping_details?.address || job.payment?.shippingAddress || null,
      shopifyDraftOrderId: job.payment?.shopifyDraftOrderId || null,
      shopifyOrderId: job.payment?.shopifyOrderId || null,
      shopifyOrderName: job.payment?.shopifyOrderName || null
    },
    quote: job.quote || null,
    details: {
      packageName: details.packageName || job.quote?.package?.name || null,
      material: job.requestedMaterial || job.material,
      engineering: details.engineering || null,
      speed: details.speed || 'standard',
      verificationMethod: details.verificationMethod || null,
      universityEmail: details.universityEmail || null
    },
    files: [fileRef(job.upload), fileRef(job.studentIdFile)].filter(Boolean),
    historyNote: 'Payment confirmed'
  };

  if (existing) {
    return orderStore.update(existing.id, {
      status: 'paid',
      statusNote: 'Payment confirmed',
      payment: payload.payment,
      customer: payload.customer,
      details: payload.details,
      quote: payload.quote,
      files: payload.files,
      summary: payload.summary
    });
  }
  return orderStore.create(payload);
}

export async function markStudentOrderPaidFromShopify({
  jobId,
  job = null,
  shopifyOrder,
  totalCents,
  shippingAddress,
  paidAt
}) {
  const existing = await orderStore.findByJobId(jobId);
  const details = job?.orderDetails || existing?.details || {};
  const noteAttrs = shopifyOrder?.note_attributes || [];
  const attr = name => noteAttrs.find(item => item.name === name)?.value || null;
  const customerEmail = shopifyOrder?.email
    || shopifyOrder?.contact_email
    || details.contactEmail
    || existing?.customer?.email
    || null;
  const customerName = shippingAddress?.name
    || [shopifyOrder?.shipping_address?.first_name, shopifyOrder?.shipping_address?.last_name].filter(Boolean).join(' ')
    || existing?.customer?.name
    || null;
  const filename = job?.filename || existing?.filename || attr('filename') || shopifyOrder?.name || 'order';
  const packageName = details.packageName
    || job?.quote?.package?.name
    || attr('package')
    || existing?.details?.packageName
    || null;

  const payload = {
    type: 'student-order',
    flow: 'student',
    status: 'paid',
    summary: `Paid student print · ${filename}`,
    filename,
    jobId,
    customer: {
      name: customerName,
      email: customerEmail,
      phone: details.contactPhone || existing?.customer?.phone || shopifyOrder?.shipping_address?.phone || null
    },
    payment: {
      status: 'paid',
      sessionId: `shopify-${shopifyOrder?.id || ''}`,
      totalCents: totalCents ?? existing?.payment?.totalCents ?? null,
      paidAt: paidAt || new Date().toISOString(),
      shippingAddress: shippingAddress || existing?.payment?.shippingAddress || null,
      shopifyDraftOrderId: job?.payment?.shopifyDraftOrderId || existing?.payment?.shopifyDraftOrderId || null,
      shopifyOrderId: shopifyOrder?.id != null ? String(shopifyOrder.id) : existing?.payment?.shopifyOrderId || null,
      shopifyOrderName: shopifyOrder?.name || existing?.payment?.shopifyOrderName || null
    },
    quote: job?.quote || existing?.quote || null,
    details: {
      packageName,
      material: details.material || job?.requestedMaterial || job?.material || attr('material') || existing?.details?.material || null,
      engineering: details.engineering || attr('engineering') || existing?.details?.engineering || null,
      speed: details.speed || attr('speed') || existing?.details?.speed || 'standard',
      verificationMethod: details.verificationMethod || attr('verificationMethod') || existing?.details?.verificationMethod || null,
      universityEmail: details.universityEmail || attr('universityEmail') || existing?.details?.universityEmail || null
    },
    files: job
      ? [fileRef(job.upload), fileRef(job.studentIdFile)].filter(Boolean)
      : (existing?.files || []),
    historyNote: 'Shopify payment confirmed'
  };

  if (existing) {
    if (existing.status === 'paid' && existing.payment?.shopifyOrderId) {
      return orderStore.get(existing.id);
    }
    return orderStore.update(existing.id, {
      status: 'paid',
      statusNote: 'Shopify payment confirmed',
      payment: payload.payment,
      customer: payload.customer,
      details: payload.details,
      quote: payload.quote,
      files: payload.files?.length ? payload.files : undefined,
      summary: payload.summary
    });
  }

  return orderStore.create(payload);
}

export async function registerContactSubmission({ name, email, phone, message }) {
  return orderStore.create({
    type: 'contact',
    flow: null,
    status: 'new',
    summary: `Contact · ${name}`,
    customer: { name, email, phone: phone || null },
    details: { message },
    historyNote: 'Contact form received'
  });
}

export async function registerIdeaSubmission({ name, email, phone, description, deadline, file }) {
  return orderStore.create({
    type: 'idea',
    flow: null,
    status: 'new',
    summary: `Design request · ${name}`,
    customer: { name, email, phone: phone || null },
    details: { description, deadline: deadline || null },
    files: [fileRef(file)].filter(Boolean),
    historyNote: 'Design request received'
  });
}

export async function registerLegacyOrderSubmission({ flow, contactEmail, contactPhone, configuration, files }) {
  return orderStore.create({
    type: 'legacy-order',
    flow: flow || null,
    status: 'new',
    summary: `Legacy ${flow} request`,
    customer: {
      name: null,
      email: contactEmail || null,
      phone: contactPhone || null
    },
    details: { configuration },
    files: (files || []).map(fileRef).filter(Boolean),
    historyNote: 'Legacy order configuration received'
  });
}

export const STATUS_LABELS = {
  new: 'New',
  reviewing: 'Under review',
  quoted: 'Quote sent',
  'awaiting-payment': 'Awaiting payment',
  paid: 'Paid',
  'in-production': 'In production',
  completed: 'Completed',
  shipped: 'Shipped',
  'ready-pickup': 'Ready for pickup',
  cancelled: 'Cancelled'
};

export function customerStatusCopy(status, order) {
  const filename = order.filename || 'your print';
  const map = {
    reviewing: `We are reviewing ${filename} and will update you shortly.`,
    quoted: `Your quote for ${filename} is ready. Reply to this email if you have questions.`,
    'awaiting-payment': `Payment is still pending for ${filename}. Reply if you need a fresh checkout link.`,
    paid: `Payment for ${filename} is confirmed. We are preparing production.`,
    'in-production': `${filename} is now in production at our Düsseldorf workshop.`,
    completed: `${filename} is complete. We will share shipping or pickup details next.`,
    shipped: `${filename} has been shipped. Tracking details follow if available.`,
    'ready-pickup': `${filename} is ready for pickup at our Düsseldorf workshop.`,
    cancelled: `Your request for ${filename} has been cancelled. Contact us if this looks wrong.`
  };
  return map[status] || `Your 3DNow order status is now: ${STATUS_LABELS[status] || status}.`;
}
