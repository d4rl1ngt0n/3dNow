import { spawn } from 'node:child_process';
import path from 'node:path';
import { existsSync, readdirSync, statSync } from 'node:fs';
import fs from 'node:fs/promises';
import { config } from '../config.js';
import { DEFAULT_SLICE_SETTINGS, normalizeSliceSettings, speedValues } from './slice-settings.js';

let chain = Promise.resolve();

export function slicerAvailable() {
  return !!config.slicerPath;
}

function resolveOutputPath(requested) {
  if (existsSync(requested)) return requested;
  const dir = path.dirname(requested);
  const base = path.basename(requested, path.extname(requested));
  const candidates = [
    requested,
    path.join(dir, `${base}_1.gcode`),
    path.join(dir, `${base}.gcode`)
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  if (!existsSync(dir)) return null;
  try {
    const files = readdirSync(dir)
      .filter(name => /\.gcode$/i.test(name))
      .map(name => ({ name, mtime: statSync(path.join(dir, name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    if (files[0]) return path.join(dir, files[0].name);
  } catch {
    return null;
  }
  return null;
}

function spawnSlicer(args) {
  const useXvfb = process.env.SLICE_USE_XVFB !== '0' && existsSync('/usr/bin/xvfb-run');
  if (useXvfb) {
    return spawn('xvfb-run', ['-a', config.slicerPath, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        HOME: process.env.HOME || '/home/node',
        DISPLAY: process.env.DISPLAY || ':99'
      }
    });
  }
  return spawn(config.slicerPath, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      HOME: process.env.HOME || '/home/node'
    }
  });
}

export function slice(input, output, material, profileInput = DEFAULT_SLICE_SETTINGS) {
  const run = async () => {
    if (!config.slicerPath) throw new Error('Server slicer is unavailable');
    const { settings, error } = normalizeSliceSettings(profileInput);
    if (error || !settings) throw new Error(error || 'Invalid slice settings');
    if (!existsSync(input)) throw new Error('Upload file is missing for slicing');

    await fs.mkdir(path.dirname(output), { recursive: true });
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

    await new Promise((resolve, reject) => {
      const child = spawnSlicer(args);
      let stderr = '';
      let stdout = '';
      child.stderr?.on('data', chunk => {
        stderr = `${stderr}${chunk}`.slice(-6000);
      });
      child.stdout?.on('data', chunk => {
        stdout = `${stdout}${chunk}`.slice(-2000);
      });
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('Slicing timed out'));
      }, config.sliceTimeoutMs);
      child.on('error', err => {
        clearTimeout(timer);
        reject(new Error(err.message || 'Slicing failed to start'));
      });
      child.on('close', code => {
        clearTimeout(timer);
        const written = resolveOutputPath(output);
        if (code === 0 && written) {
          if (written !== output) {
            // Normalize to the requested path when Prusa renamed the file.
            fs.copyFile(written, output).then(resolve).catch(() => resolve(settings));
            return;
          }
          return resolve(settings);
        }
        const detail = `${stderr}\n${stdout}`.trim().split('\n').filter(Boolean).slice(-4).join(' ');
        reject(new Error(detail || `Slicing failed (exit ${code})`));
      });
    });

    return settings;
  };

  const queued = chain.then(run, run);
  chain = queued.catch(() => {});
  return queued;
}
