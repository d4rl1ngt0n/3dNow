import { spawn } from 'node:child_process';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { config } from '../config.js';
import { DEFAULT_SLICE_SETTINGS, normalizeSliceSettings, speedValues } from './slice-settings.js';

let chain = Promise.resolve();

export function slicerAvailable() {
  return !!config.slicerPath;
}

export function slice(input, output, material, profileInput = DEFAULT_SLICE_SETTINGS) {
  const run = () => new Promise((resolve, reject) => {
    if (!config.slicerPath) return reject(new Error('Server slicer is unavailable'));
    const { settings, error } = normalizeSliceSettings(profileInput);
    if (error || !settings) return reject(new Error(error || 'Invalid slice settings'));
    const speeds = speedValues(settings.speedPreset);
    const args = [
      '--load', path.join(config.profiles, 'printer', 'p1s.ini'),
      '--load', path.join(config.profiles, 'print', '0.30.ini'),
      '--load', path.join(config.profiles, 'filament', `${material}.ini`),
      '--nozzle-diameter', String(settings.nozzleDiameterMm),
      '--layer-height', String(settings.layerHeightMm),
      '--first-layer-height', String(settings.layerHeightMm),
      '--fill-density', `${settings.infill}%`,
      '--perimeters', String(settings.walls),
      '--external-perimeter-speed', String(speeds.externalPerimeterSpeed),
      '--perimeter-speed', String(speeds.perimeterSpeed),
      '--infill-speed', String(speeds.infillSpeed),
      '--solid-infill-speed', String(speeds.infillSpeed),
      '--top-solid-infill-speed', String(speeds.topSolidInfillSpeed),
      '--travel-speed', String(speeds.travelSpeed),
      '--first-layer-speed', String(speeds.firstLayerSpeed),
      '--threads', String(config.sliceThreads),
      '-g',
      '-o', output,
      input
    ];
    const child = spawn(config.slicerPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', chunk => {
      stderr = `${stderr}${chunk}`.slice(-4000);
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Slicing timed out'));
    }, config.sliceTimeoutMs);
    child.on('error', () => {
      clearTimeout(timer);
      reject(new Error('Slicing failed'));
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0 && existsSync(output)) return resolve(settings);
      const detail = stderr.trim().split('\n').filter(Boolean).slice(-3).join(' ');
      reject(new Error(detail || 'Slicing failed'));
    });
  });
  const queued = chain.then(run, run);
  chain = queued.catch(() => {});
  return queued;
}
