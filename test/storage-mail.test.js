import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { config } from '../server/config.js';
import { emailAttachment } from '../server/services/mail.js';
import { ensureStorage } from '../server/services/storage.js';

test('creates private upload storage directories', async () => {
  await ensureStorage();
  for (const directory of [config.uploads, config.submissions, config.output]) {
    assert.equal((await fs.stat(directory)).isDirectory(), true);
  }
});

test('attaches small files and references large files', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), '3dnow-mail-'));
  const small = path.join(temporary, 'small.stl');
  const large = path.join(temporary, 'large.stl');
  await fs.writeFile(small, 'model');
  await fs.writeFile(large, '');
  await fs.truncate(large, config.emailAttachmentLimit + 1);

  const smallResult = await emailAttachment({ path: small, originalname: 'small.stl', mimetype: 'model/stl' });
  const largeResult = await emailAttachment({ path: large, originalname: 'large.stl', mimetype: 'model/stl' });

  assert.equal(smallResult.attachment.filename, 'small.stl');
  assert.equal(smallResult.reference, null);
  assert.equal(largeResult.attachment, null);
  assert.match(largeResult.reference, /large\.stl/);
  await fs.rm(temporary, { recursive: true, force: true });
});
