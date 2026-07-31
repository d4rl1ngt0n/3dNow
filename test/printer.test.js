import test from 'node:test';
import assert from 'node:assert/strict';
import { printerFromMetadata, routePrinter } from '../server/services/printer.js';

test('uses declared sliced printer metadata and hourly rates', () => {
  assert.equal(printerFromMetadata('Bambu Lab P1S').ratePerHour, 0.12);
  assert.equal(printerFromMetadata('Bambu Lab A2L').ratePerHour, 0.30);
  assert.equal(printerFromMetadata('Bambu Lab H2S').ratePerHour, 0.30);
  assert.equal(printerFromMetadata('One Pro belt printer').ratePerHour, 0.30);
});

test('P1S accepts models under 250 mm', () => {
  assert.equal(routePrinter({ x: 249.9, y: 249.9, z: 249.9 }).printer.id, 'p1s');
});

test('a model at or beyond 250 mm routes off P1S', () => {
  assert.equal(routePrinter({ x: 250, y: 100, z: 100 }).printer.id, 'a2l');
});

test('a model beyond the P1S volume routes to A2L', () => {
  assert.equal(routePrinter({ x: 240, y: 268, z: 116.5 }).printer.id, 'a2l');
});

test('a model beyond the A2L volume routes to H2S', () => {
  assert.equal(routePrinter({ x: 335, y: 320, z: 325 }).printer.id, 'h2s');
});

test('routing permits a model that fits after a 90 degree plate rotation', () => {
  assert.equal(routePrinter({ x: 320, y: 330, z: 325 }).printer.id, 'a2l');
});

test('overflow requires review', () => {
  assert.match(routePrinter({ x: 341, y: 1, z: 1 }).error, /X/);
});
