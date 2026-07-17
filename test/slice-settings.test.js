import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSliceSettings, DEFAULT_SLICE_SETTINGS } from '../server/services/slice-settings.js';

test('defaults normalize cleanly', () => {
  const { settings, error } = normalizeSliceSettings({});
  assert.equal(error, undefined);
  assert.deepEqual(settings, DEFAULT_SLICE_SETTINGS);
});

test('accepts custom quote settings', () => {
  const { settings, error } = normalizeSliceSettings({
    nozzleDiameterMm: 0.4,
    layerHeightMm: 0.2,
    infill: 20,
    walls: 3,
    speedPreset: 'fast'
  });
  assert.equal(error, undefined);
  assert.equal(settings.nozzleDiameterMm, 0.4);
  assert.equal(settings.layerHeightMm, 0.2);
  assert.equal(settings.infill, 20);
  assert.equal(settings.walls, 3);
  assert.equal(settings.speedPreset, 'fast');
});

test('rejects invalid nozzle or layer pairs', () => {
  assert.match(normalizeSliceSettings({ nozzleDiameterMm: 0.5 }).error, /Nozzle/);
  assert.match(normalizeSliceSettings({ layerHeightMm: 0.25 }).error, /Layer height/);
});
