import { PRINTERS } from './printer.js';
export const MATERIALS = { PLA: { densityGcm3: 1.24, ratePerCm3: .08 }, PETG: { densityGcm3: 1.27, ratePerCm3: .09 }, ABS: { densityGcm3: 1.04, ratePerCm3: .10 }, TPU: { densityGcm3: 1.21, ratePerCm3: .12 } };

export function businessQuantityMultiplier(quantity) {
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error('Business quantity must be at least one.');
  // Single prototype: Ben rate × 8. Production runs start at 10 with Ben batch factors.
  if (quantity === 1) return 8;
  if (quantity < 10) {
    throw new Error('Production runs start at 10 pieces. Use quantity 1 for a single prototype.');
  }
  // Ben: ×1.8 for 100+ · ×2.5 for 50+ · ×3 for 20+ · else ×4 (10–19)
  if (quantity >= 100) return 1.8;
  if (quantity >= 50) return 2.5;
  if (quantity >= 20) return 3;
  return 4;
}

export function businessQuote({ printTimeSec, printer, quantity, speed = 'standard', engineering = null }) {
  if (!Number.isFinite(printTimeSec) || printTimeSec < 0 || !printer?.ratePerHour) return null;
  const selected = PRINTERS[printer.id] || printer;
  const printHours = Number((printTimeSec / 3600).toFixed(2));
  let multiplier;
  try {
    multiplier = businessQuantityMultiplier(quantity);
  } catch {
    return null;
  }
  const unitPrintCost = Number((printHours * selected.ratePerHour).toFixed(2));
  const unitPrice = Number((unitPrintCost * multiplier).toFixed(2));
  const productionTotal = Number((unitPrice * quantity).toFixed(2));
  const speedCost = speed === 'priority' ? 59 : speed === 'express' ? 39 : 0;
  const reviewCost = engineering === 'review' ? 15 : 0;
  const editingCost = engineering === 'editing' ? 110 : 0;
  const total = Number((productionTotal + speedCost + reviewCost + editingCost).toFixed(2));
  return {
    currency: 'EUR',
    flow: 'business',
    mode: quantity === 1 ? 'prototype' : 'production',
    quantity,
    multiplier,
    printer: { id: selected.id, name: selected.name, ratePerHour: selected.ratePerHour, printHours },
    unitPrintCost,
    unitPrice,
    productionTotal,
    speedCost,
    reviewCost,
    editingCost,
    total,
    totalFormatted: `${total.toFixed(2).replace('.', ',')} €`
  };
}

export function studentQuote({ material, weightG, printTimeSec, printer }) {
  if (!Number.isFinite(weightG) || !printer) return null;
  // Student package price is weight-only. Speed / expert review / editing are add-ons at checkout.
  // Basic: up to 150 g · Medium: up to 300 g · Large: above 300 g
  const packageInfo = weightG <= 150
    ? { name: 'Basic', minWeightG: 0, maxWeightG: 150, price: 39 }
    : weightG <= 300
      ? { name: 'Medium', minWeightG: 150, maxWeightG: 300, price: 69 }
      : { name: 'Large', minWeightG: 300, maxWeightG: null, price: 89 };
  const printHours = Number(((printTimeSec || 0) / 3600).toFixed(2));
  const selected = PRINTERS[printer.id] || printer;
  return {
    currency: 'EUR',
    flow: 'student',
    material,
    weightG,
    package: packageInfo,
    printer: {
      id: selected.id,
      name: selected.name,
      ratePerHour: selected.ratePerHour,
      printHours,
      machineFee: Number((printHours * selected.ratePerHour).toFixed(2))
    },
    total: packageInfo.price,
    totalFormatted: `${packageInfo.price.toFixed(2).replace('.', ',')} €`
  };
}
