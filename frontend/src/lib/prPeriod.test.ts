import { describe, expect, it } from 'vitest';
import { periodKey, prPeriod } from './prPeriod';

describe('reading a pull request period from its entity_scope', () => {
    it('reads the period from a weekly pull-sheet scope', () => {
        // These are the real scopes of the five requests that sat unmergeable
        // in the Review Queue: July and August 2026, both published.
        expect(prPeriod('inventory:w3:issued:8:2026')).toEqual({ month: 8, year: 2026 });
        expect(prPeriod('inventory:w1:issued:8:2026')).toEqual({ month: 8, year: 2026 });
        expect(prPeriod('inventory:w2:issued:7:2026')).toEqual({ month: 7, year: 2026 });
    });

    it('keeps the month 1-indexed, matching the month-status API', () => {
        // 7 is July, not August. MONTH_LABELS is zero-indexed and the caller
        // subtracts one; getting this backwards would name the wrong period.
        expect(prPeriod('inventory:w2:issued:7:2026')?.month).toBe(7);
        expect(prPeriod('inventory:w1:received:12:2026')).toEqual({ month: 12, year: 2026 });
        expect(prPeriod('inventory:w1:received:1:2026')).toEqual({ month: 1, year: 2026 });
    });

    it('reads any week and direction', () => {
        expect(prPeriod('inventory:w1:received:3:2027')).toEqual({ month: 3, year: 2027 });
        expect(prPeriod('menu:w2:issued:5:2026')).toEqual({ month: 5, year: 2026 });
    });

    it('returns null for a bare entity scope, which names no period', () => {
        for (const scope of ['inventory', 'menu', 'user', 'compliance', 'event', 'ops', 'mixed', 'unknown']) {
            expect(prPeriod(scope)).toBeNull();
        }
    });

    it('returns null for missing or empty input', () => {
        expect(prPeriod(undefined)).toBeNull();
        expect(prPeriod(null)).toBeNull();
        expect(prPeriod('')).toBeNull();
    });

    it('returns null when the shape is close but wrong', () => {
        expect(prPeriod('inventory:w2:issued:7')).toBeNull();
        expect(prPeriod('inventory:w2:issued:7:2026:extra')).toBeNull();
        expect(prPeriod('inventory:w2:7:2026')).toBeNull();
    });

    it('returns null for a month outside 1-12', () => {
        expect(prPeriod('inventory:w2:issued:0:2026')).toBeNull();
        expect(prPeriod('inventory:w2:issued:13:2026')).toBeNull();
        expect(prPeriod('inventory:w2:issued:-1:2026')).toBeNull();
    });

    it('returns null for a non-numeric or implausible period', () => {
        expect(prPeriod('inventory:w2:issued:July:2026')).toBeNull();
        expect(prPeriod('inventory:w2:issued:7:26')).toBeNull();
        expect(prPeriod('inventory:w2:issued:7:not-a-year')).toBeNull();
        expect(prPeriod('inventory:w2:issued:7.5:2026')).toBeNull();
    });
});

describe('period keys', () => {
    it('is stable for the same period and distinct across periods', () => {
        expect(periodKey({ month: 7, year: 2026 })).toBe('7-2026');
        expect(periodKey({ month: 7, year: 2026 })).toBe(periodKey({ month: 7, year: 2026 }));
        expect(periodKey({ month: 8, year: 2026 })).not.toBe(periodKey({ month: 7, year: 2026 }));
        expect(periodKey({ month: 7, year: 2027 })).not.toBe(periodKey({ month: 7, year: 2026 }));
    });
});
