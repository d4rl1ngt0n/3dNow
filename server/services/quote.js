import { PRINTERS } from './printer.js';

export const MATERIALS = {
  PLA: { densityGcm3: 1.24, ratePerCm3: .08 },
  PETG: { densityGcm3: 1.27, ratePerCm3: .09 },
  ABS: { densityGcm3: 1.04, ratePerCm3: .10 },
  TPU: { densityGcm3: 1.21, ratePerCm3: .12 }
};

/** Alfred / Objekt 1 defaults for business production costing. */
export const BUSINESS_MACHINE_RATE_PER_HOUR = 0.3;
export const BUSINESS_MATERIAL_EUR_PER_KG = 20;
export const BUSINESS_LABOR_FLAT_EUR = 10;
export const BUSINESS_SECURITY_MIN = 1.2;
export const BUSINESS_SECURITY_MAX = 2;
export const BUSINESS_VAT_RATE = 0.19;
export const BUSINESS_SHIPPING_EUR = 0;
const FALLBACK_PRINTER_Z_MM = 340;

function money(value) {
  return Number(Number(value).toFixed(2));
}

/**
 * Alfred quantity markup on Eigenkosten.
 * ≥100 → ×1.8 · ≥50 → ×2.5 · ≥20 → ×3.5 · &lt;20 → ×4
 */
export function businessQuantityMultiplier(quantity) {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new Error('Business quantity must be at least one.');
  }
  if (quantity >= 100) return 1.8;
  if (quantity >= 50) return 2.5;
  if (quantity >= 20) return 3.5;
  return 4;
}

/**
 * Security factor from model height vs printer build height.
 * Small relative height → 1.2. Full printer height → 2.0.
 */
export function businessSecurityFactor(bboxMm, printer) {
  const modelZ = Number(bboxMm?.z);
  const printerZ = Number(printer?.volume?.z) || FALLBACK_PRINTER_Z_MM;
  if (!Number.isFinite(modelZ) || modelZ <= 0 || !Number.isFinite(printerZ) || printerZ <= 0) {
    return BUSINESS_SECURITY_MIN;
  }
  const ratio = Math.min(1, Math.max(0, modelZ / printerZ));
  const factor = BUSINESS_SECURITY_MIN + (BUSINESS_SECURITY_MAX - BUSINESS_SECURITY_MIN) * ratio;
  return Number(Math.min(BUSINESS_SECURITY_MAX, Math.max(BUSINESS_SECURITY_MIN, factor)).toFixed(4));
}

/**
 * Business auto-quote from Alfred Objekt 1:
 * material + machine(time+labor) with security, then quantity markup.
 * Machine rate is always Pro €0.30/h.
 * Customer-facing total includes 19% VAT; shipping is free (€0).
 */
export function businessQuote({
  printTimeSec,
  weightG,
  bboxMm = null,
  printer = null,
  quantity,
  speed = 'standard',
  engineering = null,
  materialEurPerKg = BUSINESS_MATERIAL_EUR_PER_KG,
  laborFlatEur = BUSINESS_LABOR_FLAT_EUR,
  securityFactor = null
}) {
  if (!Number.isFinite(printTimeSec) || printTimeSec < 0) return null;
  if (!Number.isFinite(weightG) || weightG <= 0) return null;
  if (!Number.isInteger(quantity) || quantity < 1) return null;

  let multiplier;
  try {
    multiplier = businessQuantityMultiplier(quantity);
  } catch {
    return null;
  }

  const selected = printer ? (PRINTERS[printer.id] || printer) : null;
  const printHours = Number((printTimeSec / 3600).toFixed(2));
  const security = Number.isFinite(securityFactor)
    ? Number(Math.min(BUSINESS_SECURITY_MAX, Math.max(BUSINESS_SECURITY_MIN, securityFactor)).toFixed(4))
    : businessSecurityFactor(bboxMm, selected);

  const weightKgTotal = (weightG / 1000) * quantity;
  const materialCost = money(materialEurPerKg * weightKgTotal * security);
  const machineCost = money(security * (printHours * quantity * BUSINESS_MACHINE_RATE_PER_HOUR + laborFlatEur));
  const eigenkosten = money(materialCost + machineCost);
  const productionTotal = money(eigenkosten * multiplier);
  const unitPriceNet = money(productionTotal / quantity);
  const eigenkostenPerPiece = money(eigenkosten / quantity);

  const speedCost = speed === 'priority' ? 59 : speed === 'express' ? 39 : 0;
  const reviewCost = engineering === 'review' ? 35 : 0;
  const editingCost = engineering === 'editing' ? 89 : 0;
  const netTotal = money(productionTotal + speedCost + reviewCost + editingCost);
  const vatAmount = money(netTotal * BUSINESS_VAT_RATE);
  const shippingCost = BUSINESS_SHIPPING_EUR;
  const total = money(netTotal + vatAmount + shippingCost);
  const unitPrice = money(total / quantity);

  return {
    currency: 'EUR',
    flow: 'business',
    mode: quantity === 1 ? 'prototype' : 'production',
    quantity,
    multiplier,
    securityFactor: security,
    weightG,
    materialEurPerKg,
    laborFlatEur,
    materialCost,
    machineCost,
    eigenkosten,
    eigenkostenPerPiece,
    printer: {
      id: selected?.id || 'one-pro',
      name: selected?.name || 'One Pro',
      ratePerHour: BUSINESS_MACHINE_RATE_PER_HOUR,
      printHours
    },
    unitPrintCost: money(printHours * BUSINESS_MACHINE_RATE_PER_HOUR),
    unitPriceNet,
    unitPrice,
    productionTotal,
    speedCost,
    reviewCost,
    editingCost,
    netTotal,
    vatRate: BUSINESS_VAT_RATE,
    vatAmount,
    shippingCost,
    freeShipping: true,
    vatInclusive: true,
    total,
    totalFormatted: `${total.toFixed(2).replace('.', ',')} €`
  };
}

/** Package from total filament weight (file weight × number of prints). */
export function studentPackageFromTotalWeight(totalWeightG) {
  // Basic: up to 150 g · Medium: up to 300 g · Large: above 300 g
  if (totalWeightG <= 150) return { name: 'Basic', minWeightG: 0, maxWeightG: 150, price: 39 };
  if (totalWeightG <= 300) return { name: 'Medium', minWeightG: 150, maxWeightG: 300, price: 69 };
  return { name: 'Large', minWeightG: 300, maxWeightG: null, price: 89 };
}

export function studentQuote({ material, weightG, printTimeSec, printer, quantity = 1 }) {
  if (!Number.isFinite(weightG) || !printer) return null;
  const qty = Number.isInteger(quantity) && quantity > 0 ? quantity : 1;
  const totalWeightG = Number((weightG * qty).toFixed(4));
  // Student package price is total-weight-only. Speed / expert review / editing are add-ons at checkout.
  const packageInfo = studentPackageFromTotalWeight(totalWeightG);
  const printHours = Number(((printTimeSec || 0) / 3600).toFixed(2));
  const selected = PRINTERS[printer.id] || printer;
  return {
    currency: 'EUR',
    flow: 'student',
    material,
    weightG,
    quantity: qty,
    totalWeightG,
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
