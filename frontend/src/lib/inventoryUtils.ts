import { itemEndingValue, itemTotals, isBelowPar } from './inventoryFormulas';

export const CCOLOR: Record<string, string> = {
  // Current taxonomy (as of June 2026 rename)
  Dairy: '#0D9488',
  Cereal: '#B45309',
  Beverages: '#2563EB',
  Snacks: '#7C3AED',
  'Dry Goods': '#92400E',
  Produce: '#15803D',
  Meats: '#B91C1C',
  'Frozen Food': '#0369A1',
  Disposables: '#6B7280',
  'New Items': '#F59E0B',
  // Legacy aliases — kept for backward compatibility with items not yet remapped
  'Produce & Fresh': '#15803D',
  'Protein & Meat': '#B91C1C',
  'Frozen Foods': '#0369A1',
  Supplies: '#6B7280',
  Bread: '#CA8A04',
  Condiments: '#DB2777',
};

export function catColor(c: string) {
  return CCOLOR[c] || '#1E73E8';
}

export function iTotal(it: any) {
  return itemEndingValue(it);
}

export function invToList(inv: any) {
  if (Array.isArray(inv)) return inv;
  const out: any[] = [];
  Object.keys(inv || {}).forEach((cat) => {
    if (Array.isArray(inv[cat])) {
      inv[cat].forEach((it: any) => out.push({ ...it, cat }));
    }
  });
  return out;
}

export function grandTotal(inv: any) {
  return invToList(inv).reduce((s, i) => s + iTotal(i), 0);
}

export function catTotals(inv: any) {
  return Object.keys(inv || {})
    .map((cat) => ({
      name: cat,
      color: catColor(cat),
      val: (inv[cat] || []).reduce((s: number, i: any) => s + iTotal(i), 0),
      count: (inv[cat] || []).length,
    }))
    .sort((a, b) => b.val - a.val);
}

export function reorders(inv: any) {
  return invToList(inv).filter((i) => isBelowPar(itemTotals(i).ending, i.par));
}

export function groupByCategory(items: any[]) {
  const dict: Record<string, any[]> = {};
  for (const it of items || []) {
    const cat = it.category || 'Uncategorized';
    if (!dict[cat]) dict[cat] = [];
    dict[cat].push(it);
  }
  return dict;
}
