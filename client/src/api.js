async function readJson(response, fallback) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || fallback);
  return body;
}

export async function getHealth() {
  return readJson(await fetch('/api/health'), 'Server unavailable');
}

export async function createJob(file, material, flow = 'student', quantity = 1, sliceSettings = {}) {
  const body = new FormData();
  body.append('file', file);
  body.append('material', material);
  body.append('infill', String(sliceSettings.infill ?? 15));
  body.append('walls', String(sliceSettings.walls ?? 2));
  body.append('nozzleDiameterMm', String(sliceSettings.nozzleDiameterMm ?? 0.6));
  body.append('layerHeightMm', String(sliceSettings.layerHeightMm ?? 0.3));
  body.append('speedPreset', String(sliceSettings.speedPreset ?? 'standard'));
  body.append('flow', flow);
  body.append('quantity', String(quantity));
  return readJson(await fetch('/api/jobs', { method: 'POST', body }), 'Upload failed');
}

export async function getJob(id) {
  return readJson(await fetch(`/api/jobs/${id}`), 'Server unavailable');
}

export async function reslice(id, payload, signal) {
  const body = typeof payload === 'string'
    ? { material: payload }
    : payload;
  return readJson(await fetch(`/api/jobs/${id}/reslice`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal
  }), 'Reslice failed');
}

export async function recordMaterialChoice(id, material) {
  return readJson(await fetch(`/api/jobs/${id}/material-choice`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ material })
  }), 'Could not save material preference');
}

export async function createCheckoutSession(id, configuration, studentId) {
  const body = new FormData();
  body.append('configuration', JSON.stringify(configuration));
  if (studentId) body.append('studentId', studentId, studentId.name);
  return readJson(await fetch(`/api/jobs/${id}/checkout-session`, {
    method: 'POST',
    body
  }), 'Could not start checkout');
}

export async function requestPrivateQuote(id, configuration) {
  return readJson(await fetch(`/api/jobs/${id}/private-quote-request`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(configuration)
  }), 'Could not send quote request');
}

export async function updateBusinessQuote(id, configuration) {
  return readJson(await fetch(`/api/jobs/${id}/business-quote`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(configuration)
  }), 'Could not update business estimate');
}

export async function requestBusinessQuote(id, configuration) {
  return readJson(await fetch(`/api/jobs/${id}/business-quote-request`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(configuration)
  }), 'Could not send business quote request');
}
