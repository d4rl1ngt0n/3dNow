function readNumber(line, axis) {
  const index = line.indexOf(axis);
  if (index < 0) return null;
  let cursor = index + 1;
  if (cursor >= line.length) return null;
  const start = cursor;
  if (line[cursor] === '+' || line[cursor] === '-') cursor += 1;
  let sawDigit = false;
  while (cursor < line.length) {
    const code = line.charCodeAt(cursor);
    if (code >= 48 && code <= 57) {
      sawDigit = true;
      cursor += 1;
      continue;
    }
    if (line[cursor] === '.' || line[cursor] === 'e' || line[cursor] === 'E') {
      cursor += 1;
      continue;
    }
    break;
  }
  if (!sawDigit) return null;
  const value = Number(line.slice(start, cursor));
  return Number.isFinite(value) ? value : null;
}

function toScene(x, y, z) {
  return { x, y: z, z: y };
}

function forEachGcodeLine(bytes, onLine) {
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const chunkSize = 2 * 1024 * 1024;
  let carry = new Uint8Array(0);
  let offset = 0;
  let lineIndex = 0;

  while (offset < bytes.length) {
    const end = Math.min(bytes.length, offset + chunkSize);
    const chunk = bytes.subarray(offset, end);
    offset = end;

    let buffer = chunk;
    if (carry.length) {
      buffer = new Uint8Array(carry.length + chunk.length);
      buffer.set(carry, 0);
      buffer.set(chunk, carry.length);
    }

    let start = 0;
    for (let index = 0; index < buffer.length; index += 1) {
      if (buffer[index] !== 10) continue;
      let lineEnd = index;
      if (lineEnd > start && buffer[lineEnd - 1] === 13) lineEnd -= 1;
      lineIndex += 1;
      onLine(decoder.decode(buffer.subarray(start, lineEnd)), lineIndex, offset);
      start = index + 1;
    }
    carry = start < buffer.length ? buffer.slice(start) : new Uint8Array(0);
  }

  if (carry.length) {
    lineIndex += 1;
    onLine(decoder.decode(carry), lineIndex, bytes.byteLength);
  }

  return lineIndex;
}

function usefulComment(line) {
  return line.includes('printing object') || /CHANGE_LAYER|LAYER_CHANGE|LAYER:\s*\d+/i.test(line);
}

function chooseVoxelSize(byteLength) {
  if (byteLength > 120 * 1024 * 1024) return 4.2;
  if (byteLength > 40 * 1024 * 1024) return 3.2;
  if (byteLength > 12 * 1024 * 1024) return 2.4;
  return 1.8;
}

function parseGcodeToolpathInternal(bytes, { maxVoxels, requireScope, onProgress, voxelSize } = {}) {
  const totalBytes = bytes.byteLength || 1;
  let size = voxelSize || chooseVoxelSize(totalBytes);
  let voxels = new Map();
  let absXYZ = true;
  let absE = true;
  let x = 0;
  let y = 0;
  let z = 0;
  let e = 0;
  let printingObject = false;
  let seenLayer = false;
  let hasObjectMarkers = false;
  let truncated = false;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  const recomputeBounds = () => {
    minX = Infinity;
    minY = Infinity;
    minZ = Infinity;
    maxX = -Infinity;
    maxY = -Infinity;
    maxZ = -Infinity;
    for (const [cx, cy, cz] of voxels.values()) {
      if (cx < minX) minX = cx;
      if (cy < minY) minY = cy;
      if (cz < minZ) minZ = cz;
      if (cx > maxX) maxX = cx;
      if (cy > maxY) maxY = cy;
      if (cz > maxZ) maxZ = cz;
    }
  };

  const coarsen = () => {
    const next = size * 1.65;
    const merged = new Map();
    for (const [cx, cy, cz] of voxels.values()) {
      const ix = Math.round(cx / next);
      const iy = Math.round(cy / next);
      const iz = Math.round(cz / next);
      merged.set(`${ix},${iy},${iz}`, [ix * next, iy * next, iz * next]);
    }
    size = next;
    voxels = merged;
    truncated = true;
    recomputeBounds();
  };

  const addVoxel = (sx, sy, sz) => {
    while (voxels.size >= maxVoxels) coarsen();
    const ix = Math.round(sx / size);
    const iy = Math.round(sy / size);
    const iz = Math.round(sz / size);
    const key = `${ix},${iy},${iz}`;
    if (voxels.has(key)) return;
    const cx = ix * size;
    const cy = iy * size;
    const cz = iz * size;
    voxels.set(key, [cx, cy, cz]);
    if (cx < minX) minX = cx;
    if (cy < minY) minY = cy;
    if (cz < minZ) minZ = cz;
    if (cx > maxX) maxX = cx;
    if (cy > maxY) maxY = cy;
    if (cz > maxZ) maxZ = cz;
  };

  const stampSegment = (x0, y0, z0, x1, y1, z1) => {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dz = z1 - z0;
    const length = Math.hypot(dx, dy, dz);
    if (!Number.isFinite(length) || length < 1e-6) {
      addVoxel(x1, y1, z1);
      return;
    }
    const steps = Math.max(1, Math.ceil(length / (size * 0.75)));
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      addVoxel(x0 + dx * t, y0 + dy * t, z0 + dz * t);
    }
  };

  forEachGcodeLine(bytes, (raw, lineIndex, processedBytes) => {
    if (onProgress && lineIndex % 12000 === 0) {
      onProgress(Math.min(99, Math.round((processedBytes / totalBytes) * 100)));
    }
    if (!raw) return;

    let cursor = 0;
    while (cursor < raw.length && raw.charCodeAt(cursor) <= 32) cursor += 1;
    if (cursor >= raw.length) return;

    if (raw.charCodeAt(cursor) === 59) {
      if (!usefulComment(raw)) return;
      if (/start printing object/i.test(raw)) {
        hasObjectMarkers = true;
        printingObject = true;
      } else if (/stop printing object/i.test(raw)) {
        printingObject = false;
      } else if (/CHANGE_LAYER|LAYER_CHANGE|LAYER:\s*\d+/i.test(raw)) {
        seenLayer = true;
      }
      return;
    }

    let end = raw.indexOf(';', cursor);
    if (end < 0) end = raw.length;
    while (end > cursor && raw.charCodeAt(end - 1) <= 32) end -= 1;
    const line = raw.slice(cursor, end);
    if (!line) return;

    const head = line[0];
    if (head === 'G' || head === 'g') {
      if (line.startsWith('G90') || line.startsWith('g90')) {
        absXYZ = true;
        return;
      }
      if (line.startsWith('G91') || line.startsWith('g91')) {
        absXYZ = false;
        return;
      }
      if (line.startsWith('G92') || line.startsWith('g92')) {
        const nx = readNumber(line, 'X');
        const ny = readNumber(line, 'Y');
        const nz = readNumber(line, 'Z');
        const ne = readNumber(line, 'E');
        if (nx != null) x = nx;
        if (ny != null) y = ny;
        if (nz != null) z = nz;
        if (ne != null) e = ne;
        return;
      }

      let digitAt = 1;
      while (line[digitAt] === '0') digitAt += 1;
      const moveDigit = line.charCodeAt(digitAt);
      if (moveDigit < 48 || moveDigit > 51) return;
      const nextChar = line.charCodeAt(digitAt + 1);
      if (nextChar >= 48 && nextChar <= 57) return;

      if (requireScope) {
        if (hasObjectMarkers) {
          if (!printingObject) return;
        } else if (!seenLayer) {
          return;
        }
      }

      const nx = readNumber(line, 'X');
      const ny = readNumber(line, 'Y');
      const nz = readNumber(line, 'Z');
      const ne = readNumber(line, 'E');

      const nextX = nx == null ? x : absXYZ ? nx : x + nx;
      const nextY = ny == null ? y : absXYZ ? ny : y + ny;
      const nextZ = nz == null ? z : absXYZ ? nz : z + nz;
      const nextE = ne == null ? e : absE ? ne : e + ne;
      const extruding = ne != null && nextE > e;

      if (extruding) {
        const start = toScene(x, y, z);
        const endPoint = toScene(nextX, nextY, nextZ);
        stampSegment(start.x, start.y, start.z, endPoint.x, endPoint.y, endPoint.z);
      }

      x = nextX;
      y = nextY;
      z = nextZ;
      e = nextE;
      return;
    }

    if (head === 'M' || head === 'm') {
      if (line.startsWith('M82') || line.startsWith('m82')) absE = true;
      else if (line.startsWith('M83') || line.startsWith('m83')) absE = false;
    }
  });

  if (onProgress) onProgress(100);
  const centers = Array.from(voxels.values());
  return {
    voxels: centers,
    segments: centers,
    truncated,
    voxelSize: size,
    bounds: Number.isFinite(minX)
      ? { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] }
      : null
  };
}

function toBytes(source) {
  if (source instanceof Uint8Array) return source;
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  if (typeof source === 'string') return new TextEncoder().encode(source);
  throw new Error('Unsupported G-code source');
}

export function parseGcodeToolpath(source, {
  maxVoxels = 55000,
  maxSegments = maxVoxels,
  requireScope = true,
  onProgress,
  voxelSize
} = {}) {
  const bytes = toBytes(source);
  const limit = maxVoxels || maxSegments;
  if (!requireScope || bytes.byteLength > 12 * 1024 * 1024) {
    return parseGcodeToolpathInternal(bytes, {
      maxVoxels: limit,
      requireScope: false,
      onProgress,
      voxelSize
    });
  }
  const scoped = parseGcodeToolpathInternal(bytes, {
    maxVoxels: limit,
    requireScope: true,
    onProgress,
    voxelSize
  });
  if (scoped.voxels.length) return scoped;
  return parseGcodeToolpathInternal(bytes, {
    maxVoxels: limit,
    requireScope: false,
    onProgress,
    voxelSize
  });
}

export function packToolpathSegments(result) {
  const voxels = result?.voxels || result;
  const packed = new Float32Array(voxels.length * 3);
  for (let index = 0; index < voxels.length; index += 1) {
    const voxel = voxels[index];
    const offset = index * 3;
    packed[offset] = voxel[0];
    packed[offset + 1] = voxel[1];
    packed[offset + 2] = voxel[2];
  }
  return packed;
}

export function unpackToolpathSegments(packed) {
  if (!packed?.length) return [];
  if (Array.isArray(packed)) {
    if (Array.isArray(packed[0]) && packed[0].length >= 6) {
      return packed.map(segment => [(segment[0] + segment[3]) / 2, (segment[1] + segment[4]) / 2, (segment[2] + segment[5]) / 2]);
    }
    return packed;
  }
  // New format: xyz centers. Old format: 6-float segments.
  if (packed.length % 6 === 0 && packed.length % 3 !== 0) {
    const segments = [];
    for (let offset = 0; offset < packed.length; offset += 6) {
      segments.push([
        (packed[offset] + packed[offset + 3]) / 2,
        (packed[offset + 1] + packed[offset + 4]) / 2,
        (packed[offset + 2] + packed[offset + 5]) / 2
      ]);
    }
    return segments;
  }
  const voxels = [];
  for (let offset = 0; offset < packed.length; offset += 3) {
    voxels.push([packed[offset], packed[offset + 1], packed[offset + 2]]);
  }
  return voxels;
}
