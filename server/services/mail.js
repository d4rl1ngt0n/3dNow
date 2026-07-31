import fs from 'node:fs/promises';
import path from 'node:path';
import nodemailer from 'nodemailer';
import { config } from '../config.js';

let transporter;
let logoPromise;

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

async function getBrandLogo() {
  logoPromise ||= fs.readFile(path.join(config.root, 'server/assets/brand-logo.png')).catch(async () => {
    const source = await fs.readFile(path.join(config.root, '3dnow_17.html'), 'utf8');
    const match = source.match(/class="brand-logo"\s+src="data:image\/png;base64,([^"]+)"/);
    return match ? Buffer.from(match[1], 'base64') : null;
  }).catch(() => null);
  return logoPromise;
}

function renderEmailHtml({ subject, lines, audience }) {
  const isAdmin = audience === 'admin';
  const title = isAdmin ? 'New 3DNow request' : 'Thanks for contacting 3DNow';
  const preheader = isAdmin ? 'A new customer request needs your attention.' : 'We have received your request and will be in touch soon.';
  const content = lines.filter(Boolean).map(line => `<p style="margin:0 0 14px;color:#3f4545;font:15px/1.6 Arial,sans-serif;white-space:pre-wrap">${escapeHtml(line)}</p>`).join('');
  const actionLabel = isAdmin ? 'Open 3DNow' : 'Visit 3DNow';
  const actionHref = config.publicUrl;
  const recipientLabel = isAdmin ? 'Internal notification' : 'Customer confirmation';

  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f6f4ef;color:#16191d">
    <div style="display:none;max-height:0;overflow:hidden;color:#f6f4ef;opacity:0">${escapeHtml(preheader)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f6f4ef">
      <tr><td style="padding:32px 16px">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:640px;margin:0 auto">
          <tr><td style="padding:0 8px 18px">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
              <td style="padding-right:12px"><img src="cid:3dnow-logo" width="118" alt="3DNow" style="display:block;width:118px;height:auto;border:0"></td>
              <td style="color:#76726a;font:11px/1.2 Arial,sans-serif;letter-spacing:1.2px;text-transform:uppercase">3D printing, now</td>
            </tr></table>
          </td></tr>
          <tr><td style="border:1px solid #ded9d0;border-radius:16px;background:#ffffff;overflow:hidden">
            <div style="height:5px;background:#0f766e"></div>
            <div style="padding:34px 32px 30px">
              <p style="margin:0 0 14px;color:#0f766e;font:600 11px/1.2 Arial,sans-serif;letter-spacing:1.2px;text-transform:uppercase">${recipientLabel}</p>
              <h1 style="margin:0 0 12px;color:#16191d;font:600 29px/1.15 Arial,sans-serif;letter-spacing:-.5px">${title}</h1>
              <p style="margin:0 0 26px;color:#69655f;font:15px/1.55 Arial,sans-serif">${escapeHtml(subject)}</p>
              <div style="border-top:1px solid #ebe7e0;padding-top:22px">${content}</div>
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-top:26px"><tr>
                <td style="border-radius:9px;background:#0f766e"><a href="${escapeHtml(actionHref)}" style="display:inline-block;padding:13px 18px;color:#ffffff;font:600 14px/1 Arial,sans-serif;text-decoration:none">${actionLabel}</a></td>
              </tr></table>
            </div>
          </td></tr>
          <tr><td style="padding:24px 8px 0;color:#76726a;font:13px/1.6 Arial,sans-serif">
            <p style="margin:0 0 10px">Quick links</p>
            <p style="margin:0"><a href="${escapeHtml(config.publicUrl)}" style="color:#0f766e;text-decoration:none">Home</a><span style="padding:0 8px;color:#bbb5ab">|</span><a href="${escapeHtml(`${config.publicUrl}/#fileservice`)}" style="color:#0f766e;text-decoration:none">Design service</a><span style="padding:0 8px;color:#bbb5ab">|</span><a href="${escapeHtml(`${config.publicUrl}/#contact`)}" style="color:#0f766e;text-decoration:none">Contact</a></p>
            <p style="margin:18px 0 0;color:#938e86;font-size:12px">3DNow, Düsseldorf</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

function smtpConfigured() {
  return Boolean(config.smtp.host && config.smtp.user && config.smtp.pass);
}

function getTransporter() {
  if (!smtpConfigured()) return null;
  transporter ||= nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    requireTLS: !config.smtp.secure,
    auth: { user: config.smtp.user, pass: config.smtp.pass }
  });
  return transporter;
}

export async function emailAttachment(file) {
  if (!file?.path) return { attachment: null, reference: null };
  const size = file.size ?? (await fs.stat(file.path)).size;
  const reference = `${path.basename(path.dirname(file.path))}/${path.basename(file.path)}`;
  if (size > config.emailAttachmentLimit) {
    return {
      attachment: null,
      reference: `${file.originalname || file.filename} is stored privately as ${reference} (${Math.ceil(size / 1024 / 1024)} MB).`
    };
  }
  return {
    attachment: {
      filename: file.originalname || file.filename || 'upload',
      path: file.path,
      contentType: file.mimetype
    },
    reference: null
  };
}

async function sendEmail({ to, subject, lines = [], files = [], audience = 'customer' }) {
  const prepared = await Promise.all(files.filter(Boolean).map(emailAttachment));
  const details = [
    ...lines.filter(Boolean),
    ...prepared.map(item => item.reference).filter(Boolean)
  ];
  const transport = getTransporter();
  if (!transport) {
    console.warn(`Email not sent: SMTP is not configured. ${subject}`);
    return { delivered: false, reason: 'SMTP is not configured' };
  }

  const logo = await getBrandLogo();
  await transport.sendMail({
    from: config.smtp.from,
    to,
    subject,
    text: details.join('\n'),
    html: renderEmailHtml({ subject, lines: details, audience }),
    attachments: [
      ...(logo ? [{ filename: '3dnow-logo.png', content: logo, cid: '3dnow-logo', contentType: 'image/png' }] : []),
      ...prepared.map(item => item.attachment).filter(Boolean)
    ]
  });
  return { delivered: true };
}

export async function sendAdminEmail({ subject, lines = [], files = [] }) {
  return sendEmail({ to: config.notifyTo, subject, lines, files, audience: 'admin' });
}

export async function sendCustomerOrderConfirmation({ email, filename, packageName, totalCents, shippingAddress }) {
  return sendEmail({
    to: email,
    subject: '3DNow payment confirmed for your student print',
    lines: [
      'Thanks, your payment has been confirmed.',
      `File: ${filename}`,
      `Package: ${packageName || 'Pending manual review'}`,
      `Amount paid: ${Number.isFinite(totalCents) ? `€${(totalCents / 100).toFixed(2)}` : 'Not available'}`,
      `Shipping address: ${shippingAddress || 'Not available'}`,
      '',
      'We will now review your file for production and contact you with the next steps.'
    ]
  });
}

export async function sendCustomerPrivateQuoteConfirmation({ email, filename }) {
  return sendEmail({
    to: email,
    subject: '3DNow received your quote request',
    lines: [
      'Thanks, we received your private print quote request.',
      `File: ${filename}`,
      '',
      'We will review your file and chosen options, then email your quote. Payment is only requested after you approve it.',
      '',
      '3DNow'
    ]
  });
}

export async function sendCustomerBusinessQuoteConfirmation({ email, filename, totalFormatted }) {
  return sendEmail({
    to: email,
    subject: '3DNow received your business quote request',
    lines: [
      'Thanks, we received your production request.',
      `File: ${filename}`,
      `Estimated production price: ${totalFormatted || 'Pending review'}`,
      '',
      'We will review your file and production requirements, then contact you with the final quote. No payment is requested until you approve it.',
      '',
      '3DNow'
    ]
  });
}

export async function sendCustomerIdeaConfirmation({ email, name, description, deadline }) {
  return sendEmail({
    to: email,
    subject: '3DNow received your design request',
    lines: [
      `Hi ${name},`,
      '',
      'Thanks for sending your idea. We have received your request and will review it before contacting you with the next steps.',
      '',
      'Your request:',
      description,
      `Preferred deadline: ${deadline || 'Not provided'}`,
      '',
      '3DNow'
    ]
  });
}

export async function sendCustomerContactConfirmation({ email, name }) {
  return sendEmail({
    to: email,
    subject: '3DNow received your message',
    lines: [
      `Hi ${name},`,
      '',
      'Thanks for contacting 3DNow. We have received your message and will reply as soon as possible.',
      '',
      '3DNow'
    ]
  });
}

export async function sendCustomerStatusUpdate({ email, name, statusLabel, message, filename }) {
  const greeting = name ? `Hi ${name},` : 'Hi,';
  return sendEmail({
    to: email,
    subject: `3DNow update: ${statusLabel}`,
    lines: [
      greeting,
      '',
      message,
      filename ? `File: ${filename}` : '',
      '',
      'If you have questions, reply to this email or contact us via 3d-now.de.',
      '',
      '3DNow'
    ].filter(line => line !== '')
  });
}
