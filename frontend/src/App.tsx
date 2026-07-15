import { useState, useEffect, useCallback, useRef } from 'react';
import type { User } from './lib/constants';
import {
  clearBackendToken,
  getBackendToken,
  initAuthRefresh,
  isBackendTokenPersistent,
  realLogout,
} from './lib/supabase';
import { startSessionWatch, stopSessionWatch, IDLE_LIMIT_MS, LAST_ACTIVITY_KEY } from './lib/session';
import { api } from './lib/api';
import { Login } from './components/Login';
import { Portal } from './components/Portal';

const SKEY = 'kpn_session';
const ACCOUNT_REFRESH_MS = 5 * 60 * 1000;

function readStoredSession(): User | null {
  try {
    return JSON.parse(sessionStorage.getItem(SKEY) || localStorage.getItem(SKEY) || 'null');
  } catch {
    return null;
  }
}

function saveStoredSession(user: User, remember = isBackendTokenPersistent()) {
  try {
    if (remember) {
      localStorage.setItem(SKEY, JSON.stringify(user));
      sessionStorage.removeItem(SKEY);
    } else {
      sessionStorage.setItem(SKEY, JSON.stringify(user));
      localStorage.removeItem(SKEY);
    }
  } catch {}
}

function clearStoredSession() {
  try { localStorage.removeItem(SKEY); } catch {}
  try { sessionStorage.removeItem(SKEY); } catch {}
}

function loadSession(): User | null {
  try {
    const u = readStoredSession();
    const hasToken = !!getBackendToken();
    if (!u || !hasToken) {
      clearBackendToken();
      if (u) clearStoredSession();
      return null;
    }
    // Reject sessions that are past the idle limit.
    const lastActivity = parseInt(localStorage.getItem(LAST_ACTIVITY_KEY) || '0', 10);
    if (lastActivity > 0 && Date.now() - lastActivity > IDLE_LIMIT_MS) {
      clearBackendToken();
      clearStoredSession();
      try { localStorage.removeItem(LAST_ACTIVITY_KEY); } catch {}
      return null;
    }
    return u;
  } catch { return null; }
}

type ToastEl = HTMLElement & { __tt?: ReturnType<typeof setTimeout> };

function showToast(html: string, duration = 4000) {
  const t = document.getElementById('toast') as ToastEl | null;
  if (!t) return;
  t.innerHTML = html;
  t.classList.add('show');
  clearTimeout(t.__tt);
  t.__tt = setTimeout(() => t.classList.remove('show'), duration);
}

function App() {
  const [user, setUser] = useState<User | null>(loadSession);
  const [newVersionAvailable, setNewVersionAvailable] = useState(false);
  const ssoLaunchStarted = useRef(false);

  useEffect(() => {
    if (!user || ssoLaunchStarted.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('launch') !== 'lioncafe') return;
    ssoLaunchStarted.current = true;
    api.startLunchvoiceSso()
      .then(({ redirect_url }) => window.location.replace(redirect_url))
      .catch((error) => {
        ssoLaunchStarted.current = false;
        params.delete('launch');
        const query = params.toString();
        window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
        showToast(`<span>${error instanceof Error ? error.message : 'Could not open LionCafe.'}</span>`);
      });
  }, [user]);

  // Central session teardown — called by logout and session-expired handler.
  const teardown = useCallback(async (reason?: 'idle' | 'unauthorized' | 'logout') => {
    stopSessionWatch();
    await realLogout();
    clearStoredSession();
    try { localStorage.removeItem(LAST_ACTIVITY_KEY); } catch {}
    setUser(null);
    if (reason === 'idle') {
      showToast('<span>Signed out after 30 minutes of inactivity.</span>');
    } else if (reason === 'unauthorized') {
      showToast('<span>Session expired — please sign in again.</span>');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Boot: register auth-refresh bridge; if session is restored, start watcher + validate token once.
  useEffect(() => {
    initAuthRefresh();
    if (user) {
      startSessionWatch();
      // A 401 here dispatches mjc:session-expired automatically via api.ts req().
      api.getMe()
        .then((me) => {
          const next = { ...user, ...me };
          setUser(next);
          saveStoredSession(next);
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Account control freshness: role, active status, and profile edits should not
  // wait for a full browser restart. Validate on a short cadence and on focus.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    let inFlight = false;

    async function refreshAccount() {
      if (inFlight || !getBackendToken()) return;
      inFlight = true;
      try {
        const me = await api.getMe();
        if (cancelled) return;
        setUser((prev) => {
          if (!prev) return prev;
          const next = { ...prev, ...me };
          saveStoredSession(next);
          return next;
        });
      } catch {
        // api.ts owns 401 teardown dispatch; non-auth failures should not kick the user out.
      } finally {
        inFlight = false;
      }
    }

    const intervalId = setInterval(refreshAccount, ACCOUNT_REFRESH_MS);
    const onVisibility = () => {
      if (!document.hidden) void refreshAccount();
    };
    window.addEventListener('focus', onVisibility);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
      window.removeEventListener('focus', onVisibility);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Session-expired listener — handles both inline 401s and idle/cross-tab expirations.
  useEffect(() => {
    const onExpired = (e: Event) => {
      const reason = (e as CustomEvent<{ reason?: string }>).detail?.reason as
        | 'idle'
        | 'unauthorized'
        | 'logout'
        | undefined;
      teardown(reason);
    };
    window.addEventListener('mjc:session-expired', onExpired);
    return () => window.removeEventListener('mjc:session-expired', onExpired);
  }, [teardown]);

  useEffect(() => {
    const onProfileUpdated = (e: Event) => {
      const updated = (e as CustomEvent<{ user?: Partial<User> }>).detail?.user;
      if (!updated) return;
      setUser((prev) => {
        if (!prev || (updated.id && updated.id !== prev.id)) return prev;
        const next = { ...prev, ...updated };
        saveStoredSession(next);
        return next;
      });
    };
    window.addEventListener('mjcc:user-profile-updated', onProfileUpdated);
    return () => window.removeEventListener('mjcc:user-profile-updated', onProfileUpdated);
  }, []);

  // Version check — P0.7: detect new deploys and prompt a non-blocking reload.
  useEffect(() => {
    if (!import.meta.env.PROD) return;
    const buildId = __BUILD_ID__;
    if (!buildId) return;

    async function checkVersion() {
      try {
        const res = await fetch('/version.json', { cache: 'no-store' });
        if (!res.ok) return;
        const data: { buildId?: string } = await res.json();
        if (data.buildId && data.buildId !== buildId) {
          setNewVersionAvailable(true);
        }
      } catch {}
    }

    void checkVersion();
    const intervalId = setInterval(checkVersion, 10 * 60 * 1000);
    const onVisibility = () => { if (!document.hidden) void checkVersion(); };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  function handleLogin(u: User, remember: boolean) {
    setUser(u);
    startSessionWatch();
    saveStoredSession(u, remember);
    showToast('<span>Signed in as ' + (u.display_name || u.username) + '</span>', 2600);
  }

  function handleLogout() {
    teardown('logout').catch(() => {});
  }

  return (
    <>
      {!user ? (
        <Login onLogin={handleLogin} layout="split" />
      ) : (
        <Portal user={user} onLogout={handleLogout} density="comfortable" />
      )}
      {newVersionAvailable && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: 'var(--surface-1, #1e293b)', color: 'var(--text-1, #f1f5f9)',
          padding: '10px 20px', borderRadius: 8, boxShadow: '0 4px 20px rgba(0,0,0,.4)',
          display: 'flex', alignItems: 'center', gap: 12, zIndex: 9999,
          whiteSpace: 'nowrap',
        }}>
          <span>A new version is available.</span>
          <button
            onClick={() => location.reload()}
            style={{
              background: 'var(--accent, #3b82f6)', color: '#fff',
              border: 'none', borderRadius: 4, padding: '4px 12px', cursor: 'pointer', fontSize: 13,
            }}
          >
            Reload
          </button>
          <button
            onClick={() => setNewVersionAvailable(false)}
            style={{
              background: 'transparent', color: 'var(--text-2, #94a3b8)',
              border: 'none', cursor: 'pointer', fontSize: 16, lineHeight: 1,
            }}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}
    </>
  );
}

export default App;
