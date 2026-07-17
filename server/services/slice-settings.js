export const DEFAULT_SLICE_SETTINGS = {
  nozzleDiameterMm: 0.6,
  layerHeightMm: 0.3,
  infill: 15,
  walls: 2,
  speedPreset: 'standard'
};

export const NOZZLE_OPTIONS = [0.4, 0.6];
export const LAYER_OPTIONS = [0.2, 0.28, 0.3];
export const SPEED_PRESETS = {
  standard: {
    externalPerimeterSpeed: 120,
    perimeterSpeed: 150,
    infillSpeed: 100,
    topSolidInfillSpeed: 150,
    travelSpeed: 500,
    firstLayerSpeed: 35
  },
  fast: {
    externalPerimeterSpeed: 180,
    perimeterSpeed: 220,
    infillSpeed: 160,
    topSolidInfillSpeed: 200,
    travelSpeed: 600,
    firstLayerSpeed: 50
  }
};

function asNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function normalizeSliceSettings(input = {}) {
  const nozzleDiameterMm = asNumber(input.nozzleDiameterMm ?? input.nozzle, DEFAULT_SLICE_SETTINGS.nozzleDiameterMm);
  const layerHeightMm = asNumber(input.layerHeightMm ?? input.layerHeight, DEFAULT_SLICE_SETTINGS.layerHeightMm);
  const infill = Math.round(asNumber(input.infill ?? input.fillDensity, DEFAULT_SLICE_SETTINGS.infill));
  const walls = Math.round(asNumber(input.walls ?? input.perimeters, DEFAULT_SLICE_SETTINGS.walls));
  const speedPreset = String(input.speedPreset || DEFAULT_SLICE_SETTINGS.speedPreset).toLowerCase();

  if (!NOZZLE_OPTIONS.includes(nozzleDiameterMm)) {
    return { error: 'Nozzle must be 0.4 or 0.6 mm.' };
  }
  if (!LAYER_OPTIONS.includes(layerHeightMm)) {
    return { error: 'Layer height must be 0.2, 0.28 or 0.3 mm.' };
  }
  if (!Number.isInteger(infill) || infill < 0 || infill > 100) {
    return { error: 'Infill must be between 0 and 100%.' };
  }
  if (!Number.isInteger(walls) || walls < 1 || walls > 6) {
    return { error: 'Walls must be between 1 and 6.' };
  }
  if (!SPEED_PRESETS[speedPreset]) {
    return { error: 'Speed preset must be standard or fast.' };
  }
  if (layerHeightMm > nozzleDiameterMm * 0.8) {
    return { error: `Layer height ${layerHeightMm} mm is too tall for a ${nozzleDiameterMm} mm nozzle.` };
  }

  return {
    settings: {
      nozzleDiameterMm,
      layerHeightMm,
      infill,
      walls,
      speedPreset
    }
  };
}

export function speedValues(preset) {
  return SPEED_PRESETS[preset] || SPEED_PRESETS.standard;
}
