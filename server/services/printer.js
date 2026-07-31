export const PRINTERS = {
  // Ben (iFactory3D): €0.12/h P1S, €0.30/h H2S / One Pro. P1S when build volume is under 250 mm.
  p1s: { id: 'p1s', name: 'P1S', ratePerHour: 0.12, volume: { x: 250, y: 250, z: 250 }, exclusiveVolume: true },
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

function fitsVolume(bbox, volume, exclusive = false) {
  const ok = exclusive
    ? (value, limit) => value < limit
    : (value, limit) => value <= limit;
  if (!ok(bbox.z, volume.z)) return false;
  return (ok(bbox.x, volume.x) && ok(bbox.y, volume.y))
    || (ok(bbox.x, volume.y) && ok(bbox.y, volume.x));
}

export function routePrinter(bbox) {
  if (!bbox) return { printer: null, error: null };
  for (const printer of [PRINTERS.p1s, PRINTERS.a2l, PRINTERS.h2s]) {
    if (fitsVolume(bbox, printer.volume, Boolean(printer.exclusiveVolume))) return { printer, error: null };
  }
  const over = Object.entries(bbox).filter(([axis, value]) => value > PRINTERS.h2s.volume[axis]);
  return over.length ? { printer: null, error: `Model exceeds H2S build volume on ${over.map(([a]) => a.toUpperCase()).join(', ')} axis.` } : { printer: PRINTERS.h2s, error: null };
}
