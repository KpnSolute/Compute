/**
 * Reading the accounting period a pull request targets.
 *
 * A request's `entity_scope` is either the weekly pull-sheet form,
 * `entity:w{week}:{direction}:{month}:{year}` (built server-side by
 * `_pr_scope_for_entry`), or a bare entity type such as "inventory", "menu",
 * "mixed" or "unknown". Only the five-part form names a period.
 *
 * This matters because a request against a published period can never be
 * merged — the backend refuses to overwrite published inventory and offers no
 * override — so the queue uses this to say so up front. Being wrong in either
 * direction is costly: labelling a live request "blocked" would push someone
 * to close valid work. So the parse is deliberately strict and returns null for
 * anything it does not fully recognise.
 *
 * Note the month is 1-indexed here (7 = July), matching both the scope string
 * and the month-status API, and NOT the zero-indexed MONTH_LABELS array.
 */
export interface PrPeriod {
    month: number;
    year: number;
}

export function prPeriod(entityScope?: string | null): PrPeriod | null {
    const parts = String(entityScope || '').split(':');
    if (parts.length !== 5) return null;
    const month = Number(parts[3]);
    const year = Number(parts[4]);
    if (!Number.isInteger(month) || month < 1 || month > 12) return null;
    if (!Number.isInteger(year) || year < 2000 || year > 2999) return null;
    return { month, year };
}

/** Stable map key for a period, so each one is looked up only once. */
export const periodKey = (period: PrPeriod) => `${period.month}-${period.year}`;
