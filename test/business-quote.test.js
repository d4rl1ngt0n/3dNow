import test from 'node:test';
import assert from 'node:assert/strict';
import { businessQuantityMultiplier, businessQuote } from '../server/services/quote.js';
import { PRINTERS } from '../server/services/printer.js';

test('uses prototype ×8 and Ben production multipliers', () => {
  assert.equal(businessQuantityMultiplier(1), 8);
  assert.throws(() => businessQuantityMultiplier(5), /start at 10/);
  assert.equal(businessQuantityMultiplier(10), 4);
  assert.equal(businessQuantityMultiplier(19), 4);
  assert.equal(businessQuantityMultiplier(20), 3);
  assert.equal(businessQuantityMultiplier(49), 3);
  assert.equal(businessQuantityMultiplier(50), 2.5);
  assert.equal(businessQuantityMultiplier(99), 2.5);
  assert.equal(businessQuantityMultiplier(100), 1.8);
});

test('calculates a single prototype at Ben rate × 8', () => {
  // 5 h × €0.12/h = €0.60 · ×8 = €4.80
  const quote = businessQuote({ printTimeSec: 5 * 3600, printer: PRINTERS.p1s, quantity: 1 });
  assert.equal(quote.mode, 'prototype');
  assert.equal(quote.unitPrintCost, 0.6);
  assert.equal(quote.multiplier, 8);
  assert.equal(quote.unitPrice, 4.8);
  assert.equal(quote.total, 4.8);
});

test('calculates P1S production estimates from print hours and quantity', () => {
  // 5 h × €0.12/h = €0.60 · ×4 (qty 10–19) = €2.40/unit · ×10 = €24
  const quote = businessQuote({ printTimeSec: 5 * 3600, printer: PRINTERS.p1s, quantity: 10 });
  assert.equal(quote.mode, 'production');
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
  assert.equal(quote.editingCost, 89);
  assert.equal(quote.total, 172);
});
