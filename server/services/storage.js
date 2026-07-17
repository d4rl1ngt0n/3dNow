import fs from 'node:fs/promises';
import { config } from '../config.js';

export async function ensureStorage() {
  await Promise.all([
    fs.mkdir(config.uploads, { recursive: true }),
    fs.mkdir(config.submissions, { recursive: true }),
    fs.mkdir(config.output, { recursive: true })
  ]);
}
