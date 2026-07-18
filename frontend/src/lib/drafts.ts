/**
 * Draft storage — the ONLY sanctioned use of localStorage for operational data.
 *
 * Architecture rule (AGENTS.md §3, backend-mediated Option A): durable data is
 * owned by the FastAPI backend. localStorage may hold only clearly-labeled,
 * short-lived UI drafts (unsaved edits that survive a refresh) and offline
 * fallback copies. Every draft written through this module:
 *   - is namespaced (`mjcc_draft_`) so it is identifiable as a draft,
 *   - carries a savedAt stamp,
 *   - EXPIRES: restoreDraft() discards drafts older than the TTL (default 24h),
 *     so stale local edits can never silently overlay fresh backend data weeks
 *     later — the exact failure mode the 2026-07-18 production audit flagged.
 *
 * Components must surface restored drafts to the user (banner/badge) rather
 * than silently merging them over live data.
 */

const PREFIX = 'mjcc_draft_';
export const DEFAULT_DRAFT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export type DraftEnvelope<T> = { data: T; savedAt: number };

export function draftKey(scope: string): string {
  return PREFIX + scope;
}

export function saveDraft<T>(scope: string, data: T): void {
  try {
    localStorage.setItem(
      draftKey(scope),
      JSON.stringify({ data, savedAt: Date.now() } satisfies DraftEnvelope<T>),
    );
  } catch {
    /* quota exceeded / storage disabled — drafts are best-effort */
  }
}

export function clearDraft(scope: string): void {
  try {
    localStorage.removeItem(draftKey(scope));
  } catch {
    /* silent */
  }
}

/**
 * Returns the draft plus its age, or null when absent/expired/corrupt.
 * Expired and corrupt drafts are removed on read so they cannot linger.
 */
export function restoreDraft<T>(
  scope: string,
  ttlMs: number = DEFAULT_DRAFT_TTL_MS,
): { data: T; savedAt: number } | null {
  try {
    const raw = localStorage.getItem(draftKey(scope));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DraftEnvelope<T>;
    if (
      !parsed ||
      typeof parsed.savedAt !== 'number' ||
      parsed.data === undefined
    ) {
      clearDraft(scope);
      return null;
    }
    if (Date.now() - parsed.savedAt > ttlMs) {
      clearDraft(scope);
      return null;
    }
    return { data: parsed.data, savedAt: parsed.savedAt };
  } catch {
    clearDraft(scope);
    return null;
  }
}

/**
 * Migrate a legacy (pre-namespace) draft key into the namespaced envelope.
 * Reads the old key once, re-saves under the new scope, removes the old key.
 * Legacy payloads have no trustworthy savedAt → stamped now (one extra TTL
 * window is acceptable; silently dropping user edits is not).
 */
export function migrateLegacyDraft<T>(
  legacyKey: string,
  scope: string,
  extract: (parsed: any) => T | null,
): void {
  try {
    const raw = localStorage.getItem(legacyKey);
    if (!raw) return;
    const data = extract(JSON.parse(raw));
    if (data !== null && restoreDraft(scope) === null) {
      saveDraft(scope, data);
    }
    localStorage.removeItem(legacyKey);
  } catch {
    try {
      localStorage.removeItem(legacyKey);
    } catch {
      /* silent */
    }
  }
}
