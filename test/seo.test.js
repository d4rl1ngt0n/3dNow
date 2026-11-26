import test from 'node:test';
import assert from 'node:assert/strict';
import app from '../server/index.js';

async function withServer(run) {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  try {
    return await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
  }
}

test('quote engine responses are marked noindex', () => withServer(async base => {
  for (const path of ['/api/health', '/robots.txt', '/some-unknown-page']) {
    const res = await fetch(base + path);
    assert.equal(res.headers.get('x-robots-tag'), 'noindex', path);
  }
}));

test('robots.txt keeps pages crawlable but hides admin and api', () => withServer(async base => {
  const res = await fetch(`${base}/robots.txt`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/plain/);
  const body = await res.text();
  assert.match(body, /^User-agent: \*$/m);
  assert.match(body, /^Disallow: \/admin$/m);
  assert.match(body, /^Disallow: \/api\/$/m);
  assert.doesNotMatch(body, /^Disallow: \/$/m);
}));
