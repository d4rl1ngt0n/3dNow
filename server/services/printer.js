export const PRINTERS = {
  p1s: { id: 'p1s', name: 'P1S', ratePerHour: 0.12, volume: { x: 256, y: 256, z: 256 } },
  a2l: { id: 'a2l', name: 'A2L', ratePerHour: 0.30, volume: { x: 330, y: 320, z: 325 } },
  h2s: { id: 'h2s', name: 'H2S', ratePerHour: 0.30, volume: { x: 340, y: 320, z: 340 } },
  onePro: { id: 'one-pro', name: 'One Pro', ratePerHour: 0.30, volume: null }
};
export function printerFromMetadata(name = '') {
  const n = String(name || '').toLowerCase();
  if (n.includes('p1s')) return PRINTERS.p1s;
  if (n.includes('a2l')) return PRINTERS.a2l;
  if (n.includes('h2s')) return PRINTERS.h2s;
  if (n.includes('one pro')) return PRINTERS.onePro;
  return null;
}

function fitsVolume(bbox, volume) {
  if (bbox.z > volume.z) return false;
  return (bbox.x <= volume.x && bbox.y <= volume.y)
    || (bbox.x <= volume.y && bbox.y <= volume.x);
}

export function routePrinter(bbox) {
  if (!bbox) return { printer: null, error: null };
  for (const printer of [PRINTERS.p1s, PRINTERS.a2l, PRINTERS.h2s]) {
    if (fitsVolume(bbox, printer.volume)) return { printer, error: null };
  }
  const over = Object.entries(bbox).filter(([axis, value]) => value > PRINTERS.h2s.volume[axis]);
  return over.length ? { printer: null, error: `Model exceeds H2S build volume on ${over.map(([a]) => a.toUpperCase()).join(', ')} axis.` } : { printer: PRINTERS.h2s, error: null };
}
