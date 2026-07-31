import express from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import { config } from './config.js';
import { jobsRouter } from './routes/jobs.js';
import { submissionsRouter } from './routes/submissions.js';
import { paymentsRouter } from './routes/payments.js';
import { adminRouter } from './routes/admin.js';
import { shopifyWebhooksRouter } from './routes/shopify-webhooks.js';
import { slicerAvailable } from './services/slicer.js';
import { ensureStorage } from './services/storage.js';

await ensureStorage();
const app = express();
const dist = path.join(config.root, 'dist');
const marketingSite = path.join(config.root, '3dnow_17.html');
const quoteEngine = path.join(dist, 'index.html');
const adminApp = path.join(dist, 'admin.html');
const paymentResult = path.join(config.root, 'server/views/payment-result.html');
let brandLogo;

// Allow Shopify site to iframe the quote engine + CORS for form posts from the storefront
app.use((req, res, next) => {
  const origin = req.headers.origin || '';
  const allowed =
    !origin ||
    /https?:\/\/(www\.)?3d-now\.de$/i.test(origin) ||
    /\.myshopify\.com$/i.test(origin) ||
    /localhost(:\d+)?$/i.test(origin) ||
    /127\.0\.0\.1(:\d+)?$/i.test(origin);

  if (allowed && origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }

  res.setHeader(
    'Content-Security-Policy',
    "frame-ancestors 'self' https://3d-now.de https://www.3d-now.de https://*.myshopify.com https://admin.shopify.com"
  );
  res.removeHeader('X-Frame-Options');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  next();
});

async function getBrandLogo() {
  if (brandLogo) return brandLogo;
  const source = await fs.readFile(marketingSite, 'utf8');
  const match = source.match(/class="brand-logo"\s+src="data:image\/png;base64,([^"]+)"/);
  if (!match) throw new Error('Brand logo was not found.');
  brandLogo = Buffer.from(match[1], 'base64');
  return brandLogo;
}

app.use('/api/payments', express.raw({ type: 'application/json' }), paymentsRouter);
app.use('/api/webhooks/shopify', express.json(), shopifyWebhooksRouter);
app.use(express.json());
app.get('/api/health', (_, res) => res.json({ ok: true, slicerAvailable: slicerAvailable() }));
app.get('/brand-logo', async (_, res) => {
  try {
    res.type('png').send(await getBrandLogo());
  } catch {
    res.status(404).end();
  }
});
app.use('/api/jobs', jobsRouter);
app.use('/api/submissions', submissionsRouter);
app.use('/api/admin', adminRouter);

app.get('/', (_, res) => res.sendFile(marketingSite));
app.use(express.static(dist));
app.get(['/quote-engine', '/quote-engine-students', '/quote-engine-business', '/quote-engine-private'], (_, res) => res.sendFile(quoteEngine, error => {
  if (error) res.status(404).send('Build the quote engine first.');
}));
app.get(['/quote-engine-fileservice', '/quote-engine-file-service'], (_, res) => {
  const fileserviceApp = path.join(dist, 'fileservice.html');
  res.sendFile(fileserviceApp, error => {
    if (error) res.status(404).send('Build the file service form first (npm run build).');
  });
});
app.get(['/quote-engine/payment-success', '/quote-engine/payment-cancelled'], (_, res) => res.sendFile(paymentResult, error => {
  if (error) res.status(404).send('Payment result page is unavailable.');
}));
app.get(['/admin', '/admin/'], (_, res) => res.sendFile(adminApp, error => {
  if (error) res.status(404).send('Build the admin dashboard first (npm run build).');
}));
app.get('*', (_, res) => res.sendFile(marketingSite));

if (process.env.NODE_ENV !== 'test' && !process.argv.includes('--test')) {
  app.listen(config.port, () => console.log(`3DNow site listening on ${config.port}`));
}

export default app;
