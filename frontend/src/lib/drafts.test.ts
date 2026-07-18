/**
 * localStorage draft policy tests — drafts are the ONLY sanctioned localStorage
 * use for operational data (backend owns durable data). These pin the audit
 * follow-ups: drafts expire, corrupt drafts are dropped, legacy un-expiring
 * keys migrate once, and restored drafts carry their savedAt for UI labeling.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_DRAFT_TTL_MS,
  clearDraft,
  draftKey,
  migrateLegacyDraft,
  restoreDraft,
  saveDraft,
} from './drafts';

describe('drafts', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useRealTimers();
  });

  it('round-trips a draft with its savedAt stamp', () => {
    saveDraft('ops_7_2026', [{ sku: 'A', w2r: 4 }]);
    const restored = restoreDraft<any[]>('ops_7_2026');
    expect(restored).not.toBeNull();
    expect(restored!.data).toEqual([{ sku: 'A', w2r: 4 }]);
    expect(typeof restored!.savedAt).toBe('number');
  });

  it('expires drafts older than the TTL and removes them from storage', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-18T00:00:00Z'));
    saveDraft('ops_7_2026', [{ sku: 'A' }]);
    vi.setSystemTime(
      new Date(Date.parse('2026-07-18T00:00:00Z') + DEFAULT_DRAFT_TTL_MS + 1),
    );
    expect(restoreDraft('ops_7_2026')).toBeNull();
    expect(localStorage.getItem(draftKey('ops_7_2026'))).toBeNull();
  });

  it('keeps drafts younger than the TTL', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-18T00:00:00Z'));
    saveDraft('ops_7_2026', ['x']);
    vi.setSystemTime(new Date('2026-07-18T12:00:00Z')); // 12h later
    expect(restoreDraft('ops_7_2026')).not.toBeNull();
  });

  it('drops corrupt payloads instead of restoring them', () => {
    localStorage.setItem(draftKey('bad'), '{not json');
    expect(restoreDraft('bad')).toBeNull();
    expect(localStorage.getItem(draftKey('bad'))).toBeNull();

    localStorage.setItem(draftKey('bad2'), JSON.stringify({ nope: 1 }));
    expect(restoreDraft('bad2')).toBeNull();
  });

  it('clearDraft removes the draft', () => {
    saveDraft('s', 1);
    clearDraft('s');
    expect(restoreDraft('s')).toBeNull();
  });

  it('migrates a legacy key once and removes it', () => {
    localStorage.setItem(
      'mjcc_ops_draft_7_2026',
      JSON.stringify({ rows: [{ sku: 'LEG' }], savedAt: 123 }),
    );
    migrateLegacyDraft<any[]>(
      'mjcc_ops_draft_7_2026',
      'ops_7_2026',
      (p) => (Array.isArray(p?.rows) ? p.rows : null),
    );
    expect(localStorage.getItem('mjcc_ops_draft_7_2026')).toBeNull();
    const restored = restoreDraft<any[]>('ops_7_2026');
    expect(restored!.data).toEqual([{ sku: 'LEG' }]);
  });

  it('legacy migration never clobbers an existing namespaced draft', () => {
    saveDraft('ops_7_2026', ['current']);
    localStorage.setItem(
      'mjcc_ops_draft_7_2026',
      JSON.stringify({ rows: ['stale'] }),
    );
    migrateLegacyDraft<any[]>(
      'mjcc_ops_draft_7_2026',
      'ops_7_2026',
      (p) => (Array.isArray(p?.rows) ? p.rows : null),
    );
    expect(restoreDraft<any[]>('ops_7_2026')!.data).toEqual(['current']);
    expect(localStorage.getItem('mjcc_ops_draft_7_2026')).toBeNull();
  });
});
