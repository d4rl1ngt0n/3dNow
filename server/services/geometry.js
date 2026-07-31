export function analyzeTriangles(vertices) {
  if (!vertices?.length || vertices.length % 9) throw new Error('Invalid mesh');
  let volume = 0;
  let area = 0;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const edges = new Map();

  for (let i = 0; i < vertices.length; i += 9) {
    const p = [
      [vertices[i], vertices[i + 1], vertices[i + 2]],
      [vertices[i + 3], vertices[i + 4], vertices[i + 5]],
      [vertices[i + 6], vertices[i + 7], vertices[i + 8]]
    ];
    for (const q of p) {
      for (let a = 0; a < 3; a += 1) {
        min[a] = Math.min(min[a], q[a]);
        max[a] = Math.max(max[a], q[a]);
      }
    }
    const ab = p[1].map((v, j) => v - p[0][j]);
    const ac = p[2].map((v, j) => v - p[0][j]);
    const cross = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0]
    ];
    area += Math.hypot(...cross) / 2;
    volume += (p[0][0] * cross[0] + p[0][1] * cross[1] + p[0][2] * cross[2]) / 6;
    for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) {
      const k = [p[a], p[b]].map(q => q.map(v => v.toFixed(5)).join(',')).sort().join('|');
      edges.set(k, (edges.get(k) || 0) + 1);
    }
  }

  return {
    volumeCm3: Math.abs(volume) / 1000,
    surfaceAreaCm2: area / 100,
    triangleCount: vertices.length / 9,
    bboxMm: { x: max[0] - min[0], y: max[1] - min[1], z: max[2] - min[2] },
    isManifold: [...edges.values()].every(v => v === 2)
  };
}

function isAsciiStl(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 15) return false;
  const head = buffer.subarray(0, Math.min(256, buffer.length)).toString('latin1').toLowerCase();
  if (!head.includes('solid')) return false;
  // Binary STLs can coincidentally start with "solid"; prefer binary if triangle count fits the file size.
  if (buffer.length >= 84) {
    const triangles = buffer.readUInt32LE(80);
    const expected = 84 + (triangles * 50);
    if (triangles > 0 && expected === buffer.length) return false;
  }
  return true;
}

function boundsFromPoints(pts) {
  if (!pts.length) return null;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) {
    for (let i = 0; i < 3; i += 1) {
      min[i] = Math.min(min[i], p[i]);
      max[i] = Math.max(max[i], p[i]);
    }
  }
  return { x: max[0] - min[0], y: max[1] - min[1], z: max[2] - min[2] };
}

export function modelBounds(format, buffer) {
  const pts = [];
  const add = (x, y, z) => {
    if ([x, y, z].every(Number.isFinite)) pts.push([x, y, z]);
  };

  if (format === 'obj') {
    for (const line of buffer.toString('utf8').split(/\r?\n/)) {
      const m = line.match(/^v\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)/);
      if (m) add(+m[1], +m[2], +m[3]);
    }
    return boundsFromPoints(pts);
  }

  if (format === 'stl') {
    if (isAsciiStl(buffer)) {
      for (const line of buffer.toString('utf8').split(/\r?\n/)) {
        const m = line.match(/^\s*vertex\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)/i);
        if (m) add(+m[1], +m[2], +m[3]);
      }
      return boundsFromPoints(pts);
    }

    if (buffer.length >= 84) {
      const triangles = buffer.readUInt32LE(80);
      const end = Math.min(buffer.length, 84 + (triangles * 50));
      for (let o = 84; o + 50 <= end; o += 50) {
        for (let p = o + 12; p <= o + 36; p += 12) {
          add(buffer.readFloatLE(p), buffer.readFloatLE(p + 4), buffer.readFloatLE(p + 8));
        }
      }
    }
    return boundsFromPoints(pts);
  }

  return null;
}
