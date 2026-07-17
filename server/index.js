import express from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import { config } from './config.js';
import { jobsRouter } from './routes/jobs.js';
import { submissionsRouter } from './routes/submissions.js';
import { paymentsRouter } from './routes/payments.js';
import { slicerAvailable } from './services/slicer.js';
import { ensureStorage } from './services/storage.js';

await ensureStorage();
const app = express();
const dist = path.join(config.root, 'dist');
const marketingSite = path.join(config.root, '3dnow_17.html');
const quoteEngine = path.join(dist, 'index.html');
const paymentResult = path.join(config.root, 'server/views/payment-result.html');
let brandLogo;

async function getBrandLogo() {
  if (brandLogo) return brandLogo;
  const source = await fs.readFile(marketingSite, 'utf8');
  const match = source.match(/class="brand-logo"\s+src="data:image\/png;base64,([^"]+)"/);
  if (!match) throw new Error('Brand logo was not found.');
  brandLogo = Buffer.from(match[1], 'base64');
  return brandLogo;
}

app.use('/api/payments', express.raw({ type: 'application/json' }), paymentsRouter);
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

app.get('/', (_, res) => res.sendFile(marketingSite));
app.use(express.static(dist));
app.get(['/quote-engine', '/quote-engine-students', '/quote-engine-business', '/quote-engine-private'], (_, res) => res.sendFile(quoteEngine, error => {
  if (error) res.status(404).send('Build the quote engine first.');
}));
app.get(['/quote-engine/payment-success', '/quote-engine/payment-cancelled'], (_, res) => res.sendFile(paymentResult, error => {
  if (error) res.status(404).send('Payment result page is unavailable.');
}));
app.get('*', (_, res) => res.sendFile(marketingSite));

if (process.env.NODE_ENV !== 'test' && !process.argv.includes('--test')) {
  app.listen(config.port, () => console.log(`3DNow site listening on ${config.port}`));
}

export default app;
