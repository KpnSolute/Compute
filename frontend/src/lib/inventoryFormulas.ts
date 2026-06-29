/**
 * Canonical Monthly Inventory Template formulas — single source of truth (UI).
 *
 * Mirror of backend/inventory_formulas.py. Every component computes the template's
 * derived columns through these helpers instead of re-deriving the arithmetic
 * inline, so the spreadsheet logic lives in one place on each side. Keep the two
 * files in lockstep.
 *
 * Grid (per item):
 *   Total Received = SUM(Received Wk1..Wk3)
 *   Total Pulled   = SUM(Pulled Wk1..Wk3)
 *   Ending OH      = Opening OH + Total Received - Total Pulled
 */

export function num(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = parseFloat(String(v ?? '').replace(/[$,]/g, '').trim());
  return Number.isFinite(n) ? n : 0;
}

export function totalReceived(w1r?: unknown, w2r?: unknown, w3r?: unknown): number {
  return num(w1r) + num(w2r) + num(w3r);
}

export function totalPulled(w1p?: unknown, w2p?: unknown, w3p?: unknown): number {
  return num(w1p) + num(w2p) + num(w3p);
}

/** Ending OH = Opening + Total Received - Total Pulled (may be negative). */
export function endingOh(opening?: unknown, received?: unknown, pulled?: unknown): number {
  return num(opening) + num(received) - num(pulled);
}

/** Stock on hand never displays below zero; negatives are an over-pull signal. */
export function endingQty(opening?: unknown, received?: unknown, pulled?: unknown): number {
  return Math.max(0, endingOh(opening, received, pulled));
}

export function isNegativeEnding(opening?: unknown, received?: unknown, pulled?: unknown): boolean {
  return endingOh(opening, received, pulled) < 0;
}

export function isBelowPar(ending: unknown, par: unknown): boolean {
  return num(par) > 0 && num(ending) < num(par);
}

export function isTempSku(sku: unknown): boolean {
  return String(sku ?? '').trim().toUpperCase().startsWith('TEMP');
}

export function receivedValue(received: unknown, unitPrice: unknown): number {
  return num(received) * num(unitPrice);
}

export function pulledValue(pulled: unknown, unitPrice: unknown): number {
  return num(pulled) * num(unitPrice);
}

export function openingValue(opening: unknown, openingUnitCost: unknown): number {
  return num(opening) * num(openingUnitCost);
}

export function endingValue(openingVal: unknown, receivedVal: unknown, pulledVal: unknown): number {
  return Math.max(0, num(openingVal) + num(receivedVal) - num(pulledVal));
}

/**
 * Resolve an inventory item's total received/pulled/ending qty from whatever
 * fields are present, preferring backend-computed values (totalReceived /
 * totalPulled / closingQty) and falling back to the raw weekly cells. Mirrors how
 * the API derives them, so the UI and API never disagree.
 */
export function itemTotals(it: Record<string, unknown>): {
  received: number;
  pulled: number;
  ending: number;
} {
  const received = typeof it.totalReceived === 'number'
    ? (it.totalReceived as number)
    : totalReceived(it.w1r, it.w2r, it.w3r);
  const pulled = typeof it.totalPulled === 'number'
    ? (it.totalPulled as number)
    : totalPulled(it.w1p, it.w2p, it.w3p);
  const ending = typeof it.closingQty === 'number'
    ? (it.closingQty as number)
    : endingQty(it.onHand, received, pulled);
  return { received, pulled, ending };
}

/** Ending dollar value of an item, preferring stored value, then ending×price. */
export function itemEndingValue(it: Record<string, unknown>): number {
  if (typeof it.value === 'number') return it.value as number;
  if (typeof it.endingValue === 'number') return it.endingValue as number;
  return itemTotals(it).ending * num(it.price);
}
