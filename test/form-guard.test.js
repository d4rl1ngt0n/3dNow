import test from 'node:test';
import assert from 'node:assert/strict';
import { honeypotFilled, submittedTooFast, rateLimited } from '../server/services/form-guard.js';

test('honeypotFilled is true when website trap has a value', () => {
  assert.equal(honeypotFilled({ website: 'http://spam.test' }), true);
  assert.equal(honeypotFilled({ website: '  ' }), false);
  assert.equal(honeypotFilled({ name: 'Ada' }), false);
});

test('submittedTooFast only flags a recent startedAt', () => {
  assert.equal(submittedTooFast({}), false);
  assert.equal(submittedTooFast({ startedAt: Date.now() }, 1200), true);
  assert.equal(submittedTooFast({ startedAt: Date.now() - 5000 }, 1200), false);
});

test('rateLimited trips after the configured burst', () => {
  const ip = `test-${Date.now()}`;
  for (let i = 0; i < 5; i += 1) {
    assert.equal(rateLimited(ip, { limit: 5, windowMs: 60_000 }), false);
  }
  assert.equal(rateLimited(ip, { limit: 5, windowMs: 60_000 }), true);
});
