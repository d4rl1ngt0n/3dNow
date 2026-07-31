import test from 'node:test';
import assert from 'node:assert/strict';
import { businessQuantityMultiplier, businessQuote } from '../server/services/quote.js';
import { PRINTERS } from '../server/services/printer.js';

test('uses Ben quantity multipliers at each boundary', () => {
  assert.equal(businessQuantityMultiplier(1), 4);
  assert.equal(businessQuantityMultiplier(19), 4);
  assert.equal(businessQuantityMultiplier(20), 3);
  assert.equal(businessQuantityMultiplier(49), 3);
  assert.equal(businessQuantityMultiplier(50), 2.5);
  assert.equal(businessQuantityMultiplier(99), 2.5);
  assert.equal(businessQuantityMultiplier(100), 1.8);
});

test('calculates P1S business estimates from actual print hours and quantity', () => {
  // 5 h × €0.12/h = €0.60 · ×4 (qty < 20) = €2.40/unit · ×10 = €24
  const quote = businessQuote({ printTimeSec: 5 * 3600, printer: PRINTERS.p1s, quantity: 10 });
  assert.equal(quote.unitPrintCost, 0.6);
  assert.equal(quote.multiplier, 4);
  assert.equal(quote.unitPrice, 2.4);
  assert.equal(quote.total, 24);
});

test('uses the H2S rate for A2L and H2S business estimates', () => {
  // 5 h × €0.30/h = €1.50 · ×1.8 (qty 100+) = €2.70/unit · ×100 = €270
  assert.equal(businessQuote({ printTimeSec: 5 * 3600, printer: PRINTERS.a2l, quantity: 100 }).total, 270);
  assert.equal(businessQuote({ printTimeSec: 5 * 3600, printer: PRINTERS.h2s, quantity: 100 }).total, 270);
});

test('adds selected business options to the production total', () => {
  const quote = businessQuote({
    printTimeSec: 5 * 3600,
    printer: PRINTERS.p1s,
    quantity: 10,
    speed: 'priority',
    engineering: 'editing'
  });
  assert.equal(quote.productionTotal, 24);
  assert.equal(quote.speedCost, 59);
  assert.equal(quote.editingCost, 110);
  assert.equal(quote.total, 193);
});
