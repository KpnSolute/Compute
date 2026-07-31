export const IDLE_LIMIT_MS = 30 * 60 * 1000;
export const IDLE_WARNING_MS = 10 * 1000;
export const LAST_ACTIVITY_KEY = 'mjc_last_activity';
const BACKEND_TOKEN_KEY = 'mjc_backend_token';

let _intervalId: ReturnType<typeof setInterval> | null = null;
let _cleanup: Array<() => void> = [];
let _lastWrite = 0;
let _idleWarningActive = false;

function readLastActivity(): number {
  try {
    return parseInt(localStorage.getItem(LAST_ACTIVITY_KEY) || '0', 10) || 0;
  } catch {
    return 0;
  }
}

function writeLastActivity() {
  try {
    localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
  } catch {}
}

function throttledWriteActivity() {
  const now = Date.now();
  if (now - _lastWrite >= 15_000) {
    _lastWrite = now;
    writeLastActivity();
  }
}

export function markSessionActivity() {
  if (_idleWarningActive) {
    _idleWarningActive = false;
    window.dispatchEvent(new CustomEvent('mjc:session-idle-warning-cancelled'));
  }
  throttledWriteActivity();
}

function checkIdle() {
  // A visible app is an active session from the user's perspective.  Do not
  // sign someone out while they are reading or working in the open portal;
  // background/API activity also refreshes this timestamp through api.ts.
  if (document.visibilityState === 'visible') {
    throttledWriteActivity();
    return;
  }
  const last = readLastActivity();
  const idleMs = last > 0 ? Date.now() - last : 0;
  if (last > 0 && idleMs >= IDLE_LIMIT_MS) {
    stopSessionWatch();
    window.dispatchEvent(
      new CustomEvent('mjc:session-expired', {
        // `origin` is the precise audit reason; `reason` stays one of the three
        // values the UI branches on. App.tsx's teardown reports `origin`.
        detail: {
          reason: 'idle',
          origin: 'idle',
          detail: `no activity for ${Math.round((Date.now() - last) / 60000)} min`,
        },
      }),
    );
    return;
  }
  if (last > 0 && idleMs >= IDLE_LIMIT_MS - IDLE_WARNING_MS) {
    _idleWarningActive = true;
    window.dispatchEvent(new CustomEvent('mjc:session-idle-warning', {
      detail: { remainingMs: Math.max(0, IDLE_LIMIT_MS - idleMs) },
    }));
  } else if (_idleWarningActive) {
    _idleWarningActive = false;
    window.dispatchEvent(new CustomEvent('mjc:session-idle-warning-cancelled'));
  }
}

function onStorageEvent(e: StorageEvent) {
  if (e.key === LAST_ACTIVITY_KEY) {
    // Another tab bumped activity — already reflected in shared localStorage; no local action needed.
    return;
  }
  if (e.key === BACKEND_TOKEN_KEY && !e.newValue) {
    // Token removed in another tab (logout or expiry elsewhere).
    stopSessionWatch();
    window.dispatchEvent(
      new CustomEvent('mjc:session-expired', {
        detail: {
          reason: 'logout',
          origin: 'cross_tab_logout',
          detail: 'backend token cleared in another tab',
        },
      }),
    );
  }
}

function onVisibilityChange() {
  if (!document.hidden) {
    markSessionActivity();
  }
}

const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'click', 'scroll', 'touchstart'] as const;

export function startSessionWatch() {
  if (_intervalId !== null) return;

  writeLastActivity();
  _lastWrite = Date.now();

  const onActivity = () => throttledWriteActivity();
  for (const evt of ACTIVITY_EVENTS) {
    window.addEventListener(evt, onActivity, { passive: true });
  }
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('storage', onStorageEvent);

  // Check every second so the full ten-second warning window is reliable.
  _intervalId = setInterval(checkIdle, 1_000);

  _cleanup = [
    () => {
      for (const evt of ACTIVITY_EVENTS) window.removeEventListener(evt, onActivity);
    },
    () => document.removeEventListener('visibilitychange', onVisibilityChange),
    () => window.removeEventListener('storage', onStorageEvent),
  ];
}

export function stopSessionWatch() {
  if (_intervalId !== null) {
    clearInterval(_intervalId);
    _intervalId = null;
  }
  for (const fn of _cleanup) fn();
  _cleanup = [];
}
