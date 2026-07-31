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

function canUseXvfb() {
  if (process.env.SLICE_USE_XVFB === '0') return false;
  return existsSync('/usr/bin/xvfb-run') && existsSync('/usr/bin/xauth');
}

function spawnSlicer(args, { useXvfb }) {
  const env = {
    ...process.env,
    HOME: process.env.HOME || '/home/node',
    XAUTHORITY: process.env.XAUTHORITY || '/tmp/.Xauthority'
  };
  if (useXvfb) {
    return spawn('xvfb-run', ['-a', config.slicerPath, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...env, DISPLAY: process.env.DISPLAY || ':99' }
    });
  }
  return spawn(config.slicerPath, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env
  });
}

function iniLines(values) {
  return Object.entries(values)
    .filter(([, value]) => value != null && value !== '')
    .map(([key, value]) => `${key} = ${value}`)
    .join('\n');
}

async function writeOverrideIni(filePath, settings) {
  const speeds = speedValues(settings.speedPreset);
  const body = iniLines({
    nozzle_diameter: settings.nozzleDiameterMm,
    layer_height: settings.layerHeightMm,
    first_layer_height: settings.layerHeightMm,
    fill_density: `${settings.infill}%`,
    perimeters: settings.walls,
    external_perimeter_speed: speeds.externalPerimeterSpeed,
    perimeter_speed: speeds.perimeterSpeed,
    infill_speed: speeds.infillSpeed,
    solid_infill_speed: speeds.infillSpeed,
    top_solid_infill_speed: speeds.topSolidInfillSpeed,
    travel_speed: speeds.travelSpeed,
    first_layer_speed: speeds.firstLayerSpeed
  });
  await fs.writeFile(filePath, `${body}\n`, 'utf8');
}

function runOnce(args, output, settings, useXvfb) {
  return new Promise((resolve, reject) => {
    const child = spawnSlicer(args, { useXvfb });
    let stderr = '';
    let stdout = '';
    child.stderr?.on('data', chunk => {
      stderr = `${stderr}${chunk}`.slice(-8000);
    });
    child.stdout?.on('data', chunk => {
      stdout = `${stdout}${chunk}`.slice(-4000);
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
      const detail = `${stderr}\n${stdout}`.trim();
      const written = resolveOutputPath(output);
      if (code === 0 && written) {
        if (written !== output) {
          fs.copyFile(written, output).then(() => resolve(settings)).catch(() => resolve(settings));
          return;
        }
        resolve(settings);
        return;
      }
      // Keep the message short for the UI; full detail stays on the error object.
      const compact = detail
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .filter(line => !/highest priority|config files loaded|run --help/i.test(line))
        .slice(-6)
        .join(' ');
      const error = new Error(compact || `Slicing failed (exit ${code})`);
      error.detail = detail;
      error.exitCode = code;
      reject(error);
    });
  });
}

export function slice(input, output, material, profileInput = DEFAULT_SLICE_SETTINGS) {
  const run = async () => {
    if (!config.slicerPath) throw new Error('Server slicer is unavailable');
    const { settings, error } = normalizeSliceSettings(profileInput);
    if (error || !settings) throw new Error(error || 'Invalid slice settings');
    if (!existsSync(input)) throw new Error('Upload file is missing for slicing');

    const printerIni = path.join(config.profiles, 'printer', 'p1s.ini');
    const printIni = path.join(config.profiles, 'print', '0.30.ini');
    const filamentIni = path.join(config.profiles, 'filament', `${material}.ini`);
    for (const file of [printerIni, printIni, filamentIni]) {
      if (!existsSync(file)) throw new Error(`Missing slicer profile: ${path.basename(file)}`);
    }

    await fs.mkdir(path.dirname(output), { recursive: true });
    const overrideIni = path.join(path.dirname(output), `${path.basename(output, '.gcode')}.overrides.ini`);
    await writeOverrideIni(overrideIni, settings);

    // Keep CLI minimal. Debian/bookworm PrusaSlicer rejects many inline option flags
    // and prints --help text instead of slicing.
    const args = [
      '--load', printerIni,
      '--load', printIni,
      '--load', filamentIni,
      '--load', overrideIni,
      '--export-gcode',
      '-o', output,
      input
    ];

    const preferXvfb = canUseXvfb();
    try {
      return await runOnce(args, output, settings, preferXvfb);
    } catch (firstError) {
      const detail = String(firstError.detail || firstError.message || '');
      const shouldRetryWithoutXvfb = preferXvfb && /xauth|xvfb-run|DISPLAY|cannot open display/i.test(detail);
      if (shouldRetryWithoutXvfb) {
        return runOnce(args, output, settings, false);
      }
      // Older builds only accept -g instead of --export-gcode.
      if (/unknown option|unrecognised option|export-gcode/i.test(detail)) {
        const legacyArgs = [
          '--load', printerIni,
          '--load', printIni,
          '--load', filamentIni,
          '--load', overrideIni,
          '-g',
          '-o', output,
          input
        ];
        return runOnce(legacyArgs, output, settings, preferXvfb);
      }
      throw firstError;
    } finally {
      await fs.unlink(overrideIni).catch(() => {});
    }
  };

  const queued = chain.then(run, run);
  chain = queued.catch(() => {});
  return queued;
}
