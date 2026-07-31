const n = value => { const x = Number(value); return Number.isFinite(x) ? x : null; };

const hms = value => {
  const text = String(value).trim();
  // Bambu often emits days too, e.g. "1d 9h 32m 37s"
  const hmsMatch = text.match(/^(?:(\d+)\s*d)?\s*(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?\s*(?:(\d+)\s*s)?$/i);
  if (hmsMatch && hmsMatch[0].trim()) {
    return ((+hmsMatch[1] || 0) * 86400)
      + ((+hmsMatch[2] || 0) * 3600)
      + ((+hmsMatch[3] || 0) * 60)
      + (+hmsMatch[4] || 0);
  }
  const colon = text.match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
  if (colon) return (+colon[1] || 0) * 3600 + (+colon[2] || 0) * 60 + (+colon[3] || 0);
  return null;
};

function cleanMeta(value) {
  if (value == null) return null;
  const text = String(value).split(/\\n|\n/)[0].trim().replace(/^["']|["']$/g, '');
  return text || null;
}

function numberList(value) {
  if (value == null) return [];
  return String(value)
    .split(/[,;|]/)
    .map(part => n(part.replace(/[^\d.eE+-]/g, '')))
    .filter(value => value != null && value >= 0);
}

function sumNumberList(value) {
  const parts = numberList(value);
  if (!parts.length) return null;
  return parts.reduce((sum, part) => sum + part, 0);
}

function commentValue(line, keys) {
  const pattern = keys.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const match = line.match(new RegExp(`^;\\s*(?:${pattern})\\s*[:=]\\s*(.+)$`, 'i'));
  return match ? cleanMeta(match[1]) : null;
}

function numberAfter(line, pattern) {
  const match = line.match(pattern);
  return match ? n(match[1]) : null;
}

function weightFromLine(line) {
  const patterns = [
    /total\s+filament\s+weight\s*(?:\[\s*g\s*\])?\s*[:=]\s*([0-9.,;| ]+)/i,
    /(?:^|;)\s*filament\s+weight\s*(?:\[\s*g\s*\])?\s*[:=]\s*([0-9.,;| ]+)/i,
    /(?:total\s+)?filament(?:\s+used)?\s*\[\s*g\s*\]\s*[:=]\s*([0-9.,;| ]+)/i,
    /(?:total\s+)?filament(?:\s+used)?\s*[:=]\s*([0-9.,;| ]+)\s*g\b/i,
    /filament_used_g\s*[:=]\s*([0-9.,;| ]+)/i,
    /filament_weight(?:_total)?\s*[:=]\s*([0-9.,;| ]+)/i
  ];
  for (const pattern of patterns) {
    const match = line.match(pattern);
    if (!match) continue;
    const total = sumNumberList(match[1]);
    if (total != null) return total;
  }
  return null;
}

function lengthFromLine(line) {
  const patterns = [
    /total\s+filament\s+length\s*(?:\[\s*mm\s*\])?\s*[:=]\s*([0-9.,;| ]+)/i,
    /(?:total\s+)?filament(?:\s+used)?\s*\[\s*mm\s*\]\s*[:=]\s*([0-9.,;| ]+)/i,
    /filament_used_mm\s*[:=]\s*([0-9.,;| ]+)/i,
    /filament_length\s*[:=]\s*([0-9.,;| ]+)/i
  ];
  for (const pattern of patterns) {
    const match = line.match(pattern);
    if (!match) continue;
    const total = sumNumberList(match[1]);
    if (total != null) return total;
  }
  return null;
}

function volumeFromLine(line) {
  const patterns = [
    /total\s+filament\s+volume\s*(?:\[\s*cm\s*\^?\s*3\s*\])?\s*[:=]\s*([0-9.,;| ]+)/i,
    /(?:total\s+)?filament(?:\s+used)?\s*\[\s*cm3\s*\]\s*[:=]\s*([0-9.,;| ]+)/i,
    /filament_used_cm3\s*[:=]\s*([0-9.,;| ]+)/i,
    /filament_volume\s*[:=]\s*([0-9.,;| ]+)/i
  ];
  for (const pattern of patterns) {
    const match = line.match(pattern);
    if (!match) continue;
    const total = sumNumberList(match[1]);
    if (total != null) return total;
  }
  return null;
}

function parseCommentMetadata(lines) {
  const metadata = {
    slicer: null,
    printerModel: null,
    filamentType: null,
    layerHeightMm: null,
    nozzleDiameterMm: null,
    maxZHeightMm: null,
    layerCount: null,
    filamentDensityGcm3: null,
    filamentDiameterMm: null
  };
  let weightG = null;
  let filamentVolCm3 = null;
  let filamentLengthMm = null;
  let printTimeSec = null;
  let modelPrintTimeSec = null;

  for (const line of lines) {
    const lower = line.toLowerCase();

    if (/generated with|prusa.?slicer|orca.?slicer|bambu studio|bambustudio|cura/.test(lower)) {
      metadata.slicer ||= line.replace(/^;\s*/, '');
    }
    if (/^;\s*bambustudio\b/i.test(line)) metadata.slicer ||= line.replace(/^;\s*/, '');

    weightG ??= weightFromLine(line);
    filamentVolCm3 ??= volumeFromLine(line);
    filamentLengthMm ??= lengthFromLine(line);

    const totalTime = line.match(/total estimated time\s*[:=]\s*([^;]+)/i)?.[1]?.trim();
    if (totalTime) printTimeSec = hms(totalTime) ?? n(totalTime);

    const modelTime = line.match(/model printing time\s*[:=]\s*([^;]+)/i)?.[1]?.trim();
    if (modelTime) modelPrintTimeSec = hms(modelTime) ?? n(modelTime);

    if (printTimeSec == null) {
      const genericTime = line.match(/(?:estimated(?:\s+printing)?\s+time(?:\s*\([^)]*\))?|print\s+time)\s*[:=]\s*([^;\r\n]+)/i)?.[1]?.trim();
      if (genericTime && !/layer|travel|magnitude/i.test(line)) printTimeSec = hms(genericTime) ?? n(genericTime);
    }

    if (printTimeSec == null) {
      const curaTime = line.match(/^;\s*TIME:\s*(\d+)/i)?.[1];
      if (curaTime) printTimeSec = n(curaTime);
    }

    metadata.maxZHeightMm ??= numberAfter(line, /max_z_height\s*[:=]\s*([\d.]+)/i);
    metadata.layerCount ??= numberAfter(line, /total layer number\s*[:=]\s*(\d+)/i);

    metadata.filamentDensityGcm3 ??= numberAfter(line, /filament_density\s*[:=]\s*([\d.]+)/i);
    metadata.filamentDiameterMm ??= numberAfter(line, /filament_diameter\s*[:=]\s*([\d.]+)/i);

    metadata.printerModel ||= commentValue(line, ['printer_model', 'printer model']);
    metadata.filamentType ||= commentValue(line, ['filament_type', 'filament type', 'material type']);
    metadata.layerHeightMm ??= n(commentValue(line, ['layer_height', 'layer height']));
    metadata.nozzleDiameterMm ??= n(commentValue(line, ['nozzle_diameter', 'nozzle diameter']));

    if (!metadata.printerModel) {
      const machine = line.match(/machine:\s*(P1S|A2L|H2S|X1|A1)/i)?.[1];
      if (machine) metadata.printerModel = machine.toUpperCase() === 'X1' ? 'Bambu Lab X1 Carbon' : `Bambu Lab ${machine.toUpperCase()}`;
    }
  }

  printTimeSec ??= modelPrintTimeSec;

  if (weightG == null) {
    weightG = deriveWeightG(
      filamentLengthMm,
      metadata.filamentDiameterMm ?? 1.75,
      metadata.filamentDensityGcm3 ?? 1.24
    );
  }

  const hasHeaders = weightG != null && printTimeSec != null;
  const confidence = hasHeaders ? 'header' : (weightG != null || printTimeSec != null ? 'partial' : null);

  return {
    weightG,
    filamentVolCm3,
    filamentLengthMm,
    printTimeSec,
    metadata,
    confidence
  };
}

function extractHeaderBlock(text) {
  const match = text.match(/;\s*HEADER_BLOCK_START([\s\S]*?);\s*HEADER_BLOCK_END/i);
  return match ? match[1] : null;
}

function scanCommentLines(text, { stopAtConfig = true, maxLines = 2500 } = {}) {
  const lines = [];
  for (const raw of text.split(/\r?\n/)) {
    if (lines.length >= maxLines) break;
    const trimmed = raw.trim();
    if (stopAtConfig && /^;\s*CONFIG_BLOCK_START/i.test(trimmed)) break;
    if (trimmed.startsWith(';')) lines.push(trimmed);
  }
  return lines;
}

// PrusaSlicer writes filament/time summaries near the end of the file.
function scanFooterCommentLines(text, { maxLines = 800 } = {}) {
  const all = text.split(/\r?\n/);
  const start = Math.max(0, all.length - maxLines);
  const lines = [];
  for (let i = start; i < all.length; i += 1) {
    const trimmed = all[i].trim();
    if (trimmed.startsWith(';')) lines.push(trimmed);
  }
  return lines;
}

function scanConfigCommentLines(text, { maxLines = 800 } = {}) {
  const configMatch = text.match(/;\s*CONFIG_BLOCK_START([\s\S]*?);\s*CONFIG_BLOCK_END/i);
  if (!configMatch) return [];
  return configMatch[1]
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.startsWith(';'))
    .slice(0, maxLines);
}

function deriveWeightG(lengthMm, diameterMm, densityGcm3) {
  if (!Number.isFinite(lengthMm) || !Number.isFinite(diameterMm) || !Number.isFinite(densityGcm3)) return null;
  const radiusMm = diameterMm / 2;
  const volumeMm3 = Math.PI * radiusMm * radiusMm * lengthMm;
  return (volumeMm3 / 1000) * densityGcm3;
}

export function bboxFromGcode(text, { maxMoves = 400000 } = {}) {
  let absXYZ = true;
  let absE = true;
  let x = 0;
  let y = 0;
  let z = 0;
  let e = 0;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  let moves = 0;

  const touch = (nx, ny, nz) => {
    if (Number.isFinite(nx)) { minX = Math.min(minX, nx); maxX = Math.max(maxX, nx); }
    if (Number.isFinite(ny)) { minY = Math.min(minY, ny); maxY = Math.max(maxY, ny); }
    if (Number.isFinite(nz)) { minZ = Math.min(minZ, nz); maxZ = Math.max(maxZ, nz); }
  };

  for (const raw of text.split(/\r?\n/)) {
    if (moves >= maxMoves) break;
    const line = raw.replace(/;.*/, '').trim();
    if (!line) continue;
    if (/^G90\b/.test(line)) { absXYZ = true; continue; }
    if (/^G91\b/.test(line)) { absXYZ = false; continue; }
    if (/^M82\b/.test(line)) { absE = true; continue; }
    if (/^M83\b/.test(line)) { absE = false; continue; }
    if (/^G92\b/.test(line)) {
      const get = key => {
        const match = line.match(new RegExp(`${key}(-?[\\d.]+)`, 'i'));
        return match ? n(match[1]) : null;
      };
      if (get('X') != null) x = get('X');
      if (get('Y') != null) y = get('Y');
      if (get('Z') != null) z = get('Z');
      if (get('E') != null) e = get('E');
      continue;
    }
    if (!/^G[0-3]\b/.test(line)) continue;
    const get = key => {
      const match = line.match(new RegExp(`${key}(-?[\\d.]+)`, 'i'));
      return match ? n(match[1]) : null;
    };
    const nx = get('X');
    const ny = get('Y');
    const nz = get('Z');
    const ne = get('E');
    const nextX = nx == null ? x : absXYZ ? nx : x + nx;
    const nextY = ny == null ? y : absXYZ ? ny : y + ny;
    const nextZ = nz == null ? z : absXYZ ? nz : z + nz;
    const nextE = ne == null ? e : absE ? ne : e + ne;
    // Travel/wipe/homing inflate size to the whole bed. Only extrusion builds the part.
    if (ne != null && nextE > e) {
      touch(nextX, nextY, nextZ);
      moves += 1;
    }
    x = nextX;
    y = nextY;
    z = nextZ;
    e = nextE;
  }

  if (!Number.isFinite(minX)) return null;

  return {
    x: maxX - minX,
    y: maxY - minY,
    z: maxZ - minZ,
    min: { x: minX, y: minY, z: minZ },
    max: { x: maxX, y: maxY, z: maxZ }
  };
}

function scanConfigKeys(text) {
  const keys = {
    printerModel: ['printer_model', 'printer model'],
    filamentType: ['filament_type', 'filament type', 'material type'],
    layerHeightMm: ['layer_height', 'layer height'],
    nozzleDiameterMm: ['nozzle_diameter', 'nozzle diameter']
  };
  const found = { printerModel: null, filamentType: null, layerHeightMm: null, nozzleDiameterMm: null };
  const configMatch = text.match(/;\s*CONFIG_BLOCK_START([\s\S]*?);\s*CONFIG_BLOCK_END/i);
  const section = configMatch ? configMatch[1] : text;
  for (const raw of section.split(/\r?\n/).slice(0, 400)) {
    const line = raw.trim();
    if (!line.startsWith(';')) continue;
    for (const [field, aliases] of Object.entries(keys)) {
      if (found[field] != null) continue;
      const value = commentValue(line, aliases);
      if (value == null) continue;
      found[field] = field.endsWith('Mm') ? n(value) : value;
    }
  }
  return found;
}

export function parseGcode(input, { segments = false, maxSegments = 10000, bbox = true } = {}) {
  const text = Buffer.isBuffer(input) ? input.toString('utf8') : input;
  const headerBlock = extractHeaderBlock(text);
  const headerLines = headerBlock
    ? headerBlock.split(/\r?\n/).map(line => line.trim()).filter(line => line.startsWith(';'))
    : [];
  // Merge HEADER_BLOCK + head comments + config + footer. Some Bambu/Orca exports
  // put printer/type in CONFIG and weight/time only in header or footer.
  const commentLines = [
    ...headerLines,
    ...scanCommentLines(text),
    ...scanConfigCommentLines(text),
    ...scanFooterCommentLines(text)
  ];
  const parsed = parseCommentMetadata(commentLines);
  const config = scanConfigKeys(text);
  parsed.metadata.printerModel ||= config.printerModel;
  parsed.metadata.filamentType ||= config.filamentType;
  if (config.layerHeightMm) parsed.metadata.layerHeightMm = config.layerHeightMm;
  if (config.nozzleDiameterMm) parsed.metadata.nozzleDiameterMm = config.nozzleDiameterMm;

  if (bbox) {
    const scanned = bboxFromGcode(text);
    const headerZ = parsed.metadata.maxZHeightMm;
    if (scanned) {
      // Prefer slicer-reported model height when present; scanned Z can miss upper layers.
      const z = Number.isFinite(headerZ) ? headerZ : scanned.z;
      parsed.bboxMm = { x: scanned.x, y: scanned.y, z };
      parsed.bboxMinMax = { min: scanned.min, max: { ...scanned.max, z: (scanned.min?.z ?? 0) + z } };
      if (!parsed.metadata.maxZHeightMm) parsed.metadata.maxZHeightMm = scanned.z;
    } else if (headerZ != null) {
      parsed.bboxMm = { x: null, y: null, z: headerZ };
    }
  }

  if (!segments) return parsed;

  let absolute = true;
  let e = 0;
  let x = 0;
  let y = 0;
  let z = 0;
  const toolpath = [];

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/;.*/, '').trim();
    if (/^M82\b/.test(line)) absolute = true;
    if (/^M83\b/.test(line)) absolute = false;
    if (/^G92\b/.test(line)) {
      const value = line.match(/E(-?[\d.]+)/i);
      if (value) e = +value[1];
    }
    if (!/^G[01]\b/.test(line)) continue;
    const get = key => {
      const match = line.match(new RegExp(`${key}(-?[\\d.]+)`, 'i'));
      return match ? n(match[1]) : null;
    };
    const nx = get('X');
    const ny = get('Y');
    const nz = get('Z');
    const ne = get('E');
    const nextE = ne == null ? e : absolute ? ne : e + ne;
    if (ne != null && nextE > e && toolpath.length < maxSegments) toolpath.push([x, y, z, nx ?? x, ny ?? y, nz ?? z]);
    x = nx ?? x;
    y = ny ?? y;
    z = nz ?? z;
    e = nextE;
  }

  return { ...parsed, toolpath };
}
