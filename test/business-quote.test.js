import test from 'node:test';
import assert from 'node:assert/strict';
import {
  businessQuantityMultiplier,
  businessQuote,
  businessSecurityFactor,
  BUSINESS_MACHINE_RATE_PER_HOUR,
  BUSINESS_VAT_RATE
} from '../server/services/quote.js';
import { PRINTERS } from '../server/services/printer.js';

test('uses Alfred quantity multipliers', () => {
  assert.equal(businessQuantityMultiplier(1), 4);
  assert.equal(businessQuantityMultiplier(6), 4);
  assert.equal(businessQuantityMultiplier(19), 4);
  assert.equal(businessQuantityMultiplier(20), 3.5);
  assert.equal(businessQuantityMultiplier(21), 3.5);
  assert.equal(businessQuantityMultiplier(49), 3.5);
  assert.equal(businessQuantityMultiplier(50), 2.5);
  assert.equal(businessQuantityMultiplier(99), 2.5);
  assert.equal(businessQuantityMultiplier(100), 1.8);
});

test('security factor scales with model height vs printer', () => {
  assert.equal(businessSecurityFactor({ z: 0 }, PRINTERS.h2s), 1.2);
  assert.ok(businessSecurityFactor({ z: 1 }, PRINTERS.h2s) > 1.2);
  assert.ok(businessSecurityFactor({ z: 1 }, PRINTERS.h2s) < 1.21);
  assert.equal(businessSecurityFactor({ z: PRINTERS.h2s.volume.z }, PRINTERS.h2s), 2);
  assert.equal(businessSecurityFactor(null, PRINTERS.h2s), 1.2);
});

test('replays Objekt 1 sitz defaults with VAT and free shipping', () => {
  const quote = businessQuote({
    printTimeSec: 10 * 3600,
    weightG: 410,
    quantity: 20,
    securityFactor: 1.2,
    printer: PRINTERS.h2s
  });
  assert.equal(quote.materialCost, 196.8);
  assert.equal(quote.machineCost, 84);
  assert.equal(quote.eigenkosten, 280.8);
  assert.equal(quote.multiplier, 3.5);
  assert.equal(quote.productionTotal, 982.8);
  assert.equal(quote.unitPriceNet, 49.14);
  assert.equal(quote.netTotal, 982.8);
  assert.equal(quote.vatRate, BUSINESS_VAT_RATE);
  assert.equal(quote.vatAmount, 186.73);
  assert.equal(quote.shippingCost, 0);
  assert.equal(quote.freeShipping, true);
  assert.equal(quote.total, 1169.53);
  assert.equal(quote.unitPrice, 58.48);
  assert.equal(quote.printer.ratePerHour, BUSINESS_MACHINE_RATE_PER_HOUR);
});

test('replays planning case 350 g / 12 h / qty 6 with VAT', () => {
  const quote = businessQuote({
    printTimeSec: 12 * 3600,
    weightG: 350,
    quantity: 6,
    securityFactor: 1.2
  });
  assert.equal(quote.materialCost, 50.4);
  assert.equal(quote.machineCost, 37.92);
  assert.equal(quote.eigenkosten, 88.32);
  assert.equal(quote.multiplier, 4);
  assert.equal(quote.productionTotal, 353.28);
  assert.equal(quote.netTotal, 353.28);
  assert.equal(quote.vatAmount, 67.12);
  assert.equal(quote.total, 420.4);
  assert.equal(quote.unitPrice, 70.07);
});

test('replays 470 g / 6 h / qty 21 with VAT', () => {
  const quote = businessQuote({
    printTimeSec: 6 * 3600,
    weightG: 470,
    quantity: 21,
    securityFactor: 1.2
  });
  assert.equal(quote.materialCost, 236.88);
  assert.equal(quote.machineCost, 57.36);
  assert.equal(quote.eigenkosten, 294.24);
  assert.equal(quote.multiplier, 3.5);
  assert.equal(quote.productionTotal, 1029.84);
  assert.equal(quote.netTotal, 1029.84);
  assert.equal(quote.vatAmount, 195.67);
  assert.equal(quote.total, 1225.51);
  assert.equal(quote.unitPrice, 58.36);
});

test('always prices machine time at Pro €0.30/h even for P1S routing', () => {
  const quote = businessQuote({
    printTimeSec: 5 * 3600,
    weightG: 100,
    quantity: 10,
    securityFactor: 1.2,
    printer: PRINTERS.p1s
  });
  assert.equal(quote.printer.ratePerHour, 0.3);
});

test('adds selected business options then VAT on the full net', () => {
  const quote = businessQuote({
    printTimeSec: 12 * 3600,
    weightG: 350,
    quantity: 6,
    securityFactor: 1.2,
    speed: 'priority',
    engineering: 'editing'
  });
  assert.equal(quote.productionTotal, 353.28);
  assert.equal(quote.speedCost, 59);
  assert.equal(quote.editingCost, 89);
  assert.equal(quote.netTotal, 501.28);
  assert.equal(quote.vatAmount, 95.24);
  assert.equal(quote.shippingCost, 0);
  assert.equal(quote.total, 596.52);
});

test('returns null without verified weight', () => {
  assert.equal(businessQuote({
    printTimeSec: 3600,
    weightG: null,
    quantity: 1,
    securityFactor: 1.2
  }), null);
});
