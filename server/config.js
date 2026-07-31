import path from 'node:path';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const storageRoot = process.env.STORAGE_ROOT
  ? path.resolve(process.env.STORAGE_ROOT)
  : path.join(root, 'server');

// Probe with --help: Mac app builds reject --version (exit 1) even though CLI slicing works.
function commandWorks(command) {
  if (!command) return false;
  const check = spawnSync(command, ['--help'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32'
  });
  if (check.error) return false;
  const out = `${check.stdout || ''}${check.stderr || ''}`;
  return check.status === 0 || /prusa.?slicer/i.test(out);
}

function macAppCandidates() {
  if (process.platform !== 'darwin') return [];
  const roots = ['/Applications'];
  if (process.env.HOME) roots.push(path.join(process.env.HOME, 'Applications'));
  const apps = [
    'PrusaSlicer.app/Contents/MacOS/PrusaSlicer',
    'Original Prusa Drivers/PrusaSlicer.app/Contents/MacOS/PrusaSlicer'
  ];
  return roots.flatMap(rootDir => apps.map(app => path.join(rootDir, app)));
}

function resolveSlicerPath() {
  const fromEnv = process.env.PRUSA_SLICER_PATH;
  const candidates = [
    fromEnv,
    'prusa-slicer',
    'PrusaSlicer',
    ...macAppCandidates()
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate.includes(path.sep) || candidate.startsWith('/')) {
      if (!existsSync(candidate)) continue;
    }
    if (commandWorks(candidate)) return candidate;
  }
  return null;
}

export const config = {
  root, port: Number(process.env.PORT || 3000), uploadLimit: 100 * 1024 * 1024,
  slicerPath: resolveSlicerPath(),
  sliceTimeoutMs: Number(process.env.SLICE_TIMEOUT_MS || 600000),
  sliceThreads: Number(process.env.SLICE_THREADS || 4),
  profiles: path.join(root, 'server/slicer-profiles'),
  uploads: path.join(storageRoot, 'uploads'),
  submissions: path.join(storageRoot, 'submissions'),
  output: path.join(storageRoot, 'output', 'gcode'),
  dataDir: path.join(storageRoot, 'data'),
  notifyTo: process.env.NOTIFY_TO || 'freddarlington98@gmail.com',
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || process.env.SMTP_USER || '3DNow <no-reply@localhost>'
  },
  emailAttachmentLimit: Number(process.env.EMAIL_ATTACHMENT_LIMIT_BYTES || 20 * 1024 * 1024),
  publicUrl: process.env.PUBLIC_URL || `http://localhost:${Number(process.env.PORT || 3000)}`,
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || ''
  },
  shopify: {
    shop: process.env.SHOPIFY_SHOP || '',
    accessToken: process.env.SHOPIFY_ACCESS_TOKEN || '',
    webhookSecret: process.env.SHOPIFY_WEBHOOK_SECRET || ''
  },
  admin: {
    password: process.env.ADMIN_PASSWORD || ''
  }
};
