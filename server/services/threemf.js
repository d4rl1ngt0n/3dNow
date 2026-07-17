import { unzipSync } from 'fflate';
import { parseGcode } from './gcode.js';
import { analyzeTriangles } from './geometry.js';

const LIMITS = { entries: 200, entry: 300 * 1024 * 1024, total: 500 * 1024 * 1024 };

function readAttr(tag, name) {
  return tag.match(new RegExp(`${name}="([^"]+)"`, 'i'))?.[1] ?? null;
}

export function parse3mfModelXml(xml) {
  if (!xml) return null;

  const vertexMap = new Map();
  let vertexIndex = 0;
  const vertices = [];

  for (const tag of xml.matchAll(/<vertex\b[^/>]*\/>/gi)) {
    const x = Number(readAttr(tag[0], 'x'));
    const y = Number(readAttr(tag[0], 'y'));
    const z = Number(readAttr(tag[0], 'z'));
    if ([x, y, z].every(Number.isFinite)) {
      vertexMap.set(vertexIndex++, [x, y, z]);
    }
  }

  for (const tag of xml.matchAll(/<triangle\b[^/>]*\/>/gi)) {
    const v1 = Number(readAttr(tag[0], 'v1'));
    const v2 = Number(readAttr(tag[0], 'v2'));
    const v3 = Number(readAttr(tag[0], 'v3'));
    if (![v1, v2, v3].every(index => vertexMap.has(index))) continue;
    for (const index of [v1, v2, v3]) vertices.push(...vertexMap.get(index));
  }

  if (vertices.length < 9) {
    const points = [...vertexMap.values()];
    if (!points.length) return null;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const point of points) {
      for (let i = 0; i < 3; i += 1) {
        min[i] = Math.min(min[i], point[i]);
        max[i] = Math.max(max[i], point[i]);
      }
    }
    return {
      volumeCm3: null,
      surfaceAreaCm2: null,
      triangleCount: 0,
      bboxMm: { x: max[0] - min[0], y: max[1] - min[1], z: max[2] - min[2] },
      isManifold: null
    };
  }

  return analyzeTriangles(vertices);
}

function aggregatePlates(plates) {
  if (!plates.length) return null;
  return {
    weightG: plates.reduce((sum, plate) => sum + (plate.parsed.weightG || 0), 0),
    filamentVolCm3: plates.reduce((sum, plate) => sum + (plate.parsed.filamentVolCm3 || 0), 0) || null,
    filamentLengthMm: plates.reduce((sum, plate) => sum + (plate.parsed.filamentLengthMm || 0), 0) || null,
    printTimeSec: plates.reduce((sum, plate) => sum + (plate.parsed.printTimeSec || 0), 0),
    confidence: plates.every(plate => plate.parsed.confidence === 'header') ? 'header'
      : plates.some(plate => plate.parsed.confidence) ? 'partial' : null,
    metadata: plates[0]?.parsed.metadata ?? null,
    bboxMm: mergeBboxes(plates.map(plate => plate.parsed.bboxMm).filter(Boolean))
  };
}

function mergeBboxes(boxes) {
  if (!boxes.length) return null;
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const box of boxes) {
    if (box.min && box.max) {
      min.x = Math.min(min.x, box.min.x);
      min.y = Math.min(min.y, box.min.y);
      min.z = Math.min(min.z, box.min.z);
      max.x = Math.max(max.x, box.max.x);
      max.y = Math.max(max.y, box.max.y);
      max.z = Math.max(max.z, box.max.z);
    } else if (box.x != null && box.y != null && box.z != null) {
      max.x = Math.max(max.x, box.x);
      max.y = Math.max(max.y, box.y);
      max.z = Math.max(max.z, box.z);
    }
  }
  if (!Number.isFinite(min.x)) return boxes[0];
  return { x: max.x - min.x, y: max.y - min.y, z: max.z - min.z, min, max };
}

// Bambu plate JSON stores object footprint as [minX, minY, maxX, maxY].
function bboxFromPlateJson(json) {
  if (!json) return null;
  const values = Array.isArray(json.bbox_all) ? json.bbox_all
    : Array.isArray(json.bbox_objects?.[0]?.bbox) ? json.bbox_objects[0].bbox
      : null;
  if (!values || values.length < 4) return null;
  const [minX, minY, maxX, maxY] = values.map(Number);
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
  return {
    x: Math.abs(maxX - minX),
    y: Math.abs(maxY - minY),
    z: null,
    min: { x: minX, y: minY, z: null },
    max: { x: maxX, y: maxY, z: null }
  };
}

function plateNumberFromName(name) {
  const match = String(name).match(/plate[_-]?(\d+)/i);
  return match ? Number(match[1]) : null;
}

export function inspect3mf(buffer) {
  let files;
  try {
    files = unzipSync(new Uint8Array(buffer));
  } catch {
    throw new Error('Invalid 3MF archive');
  }

  const names = Object.keys(files);
  if (names.length > LIMITS.entries) throw new Error('3MF has too many entries');

  let total = 0;
  for (const name of names) {
    if (name.includes('..') || name.startsWith('/')) throw new Error('Invalid 3MF path');
    const size = files[name].length;
    total += size;
    if (size > LIMITS.entry || total > LIMITS.total) throw new Error('3MF exceeds safe extraction limits');
  }

  const model = names.find(entry => /^3D\/.*\.model$/i.test(entry));
  const modelXml = model ? Buffer.from(files[model]).toString('utf8') : null;
  const geometry = parse3mfModelXml(modelXml);
  const gcodeNames = names.filter(entry => /\.gco(de)?$/i.test(entry));
  const plateJsonByNumber = new Map();
  for (const name of names) {
    if (!/plate[_-]?\d+\.json$/i.test(name)) continue;
    try {
      const json = JSON.parse(Buffer.from(files[name]).toString('utf8'));
      const number = plateNumberFromName(name);
      if (number != null) plateJsonByNumber.set(number, bboxFromPlateJson(json));
    } catch {
      // ignore malformed plate metadata
    }
  }

  const plates = gcodeNames.map((name, index) => {
    const plate = plateNumberFromName(name) || index + 1;
    const parsed = parseGcode(Buffer.from(files[name]));
    const footprint = plateJsonByNumber.get(plate);
    if (footprint) {
      const z = parsed.metadata?.maxZHeightMm ?? parsed.bboxMm?.z ?? null;
      parsed.bboxMm = {
        x: footprint.x,
        y: footprint.y,
        z
      };
      parsed.bboxMinMax = {
        min: { x: footprint.min.x, y: footprint.min.y, z: 0 },
        max: { x: footprint.max.x, y: footprint.max.y, z: z ?? 0 }
      };
    }
    return { plate, name, parsed };
  });

  if (!model && !gcodeNames.length) throw new Error('3MF model and embedded G-code are missing');

  const all = plates.length ? aggregatePlates(plates) : null;

  return {
    modelXml,
    geometry,
    gcodeFiles: gcodeNames.map(name => ({ name, data: Buffer.from(files[name]) })),
    plates,
    all
  };
}
