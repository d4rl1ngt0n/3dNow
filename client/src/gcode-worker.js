import { packToolpathSegments, parseGcodeToolpath } from './gcode-toolpath.js';

self.onmessage = event => {
  const payload = event.data;
  const source = payload?.bytes
    ? new Uint8Array(payload.bytes)
    : typeof payload === 'string'
      ? payload
      : payload?.text;

  const result = parseGcodeToolpath(source, {
    maxVoxels: payload?.maxSegments || payload?.maxVoxels || 70000,
    onProgress(value) {
      self.postMessage({ type: 'progress', value });
    }
  });

  const packed = packToolpathSegments(result);
  self.postMessage({
    type: 'result',
    segments: packed,
    truncated: result.truncated,
    voxelSize: result.voxelSize,
    bounds: result.bounds
  }, [packed.buffer]);
};
