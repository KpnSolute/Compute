import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import type { User } from './lib/constants';
import {
  clearBackendToken,
  getBackendToken,
  initAuthRefresh,
  isBackendTokenPersistent,
  realLogout,
} from './lib/supabase';
import { startSessionWatch, stopSessionWatch, markSessionActivity, IDLE_LIMIT_MS, LAST_ACTIVITY_KEY } from './lib/session';
import { api, reportSessionEvent } from './lib/api';
import { Login } from './components/Login';
import { Portal } from './components/Portal';
import { ComputeLanding, WorkspaceConsole } from './components/ComputeHome';
import { setActiveWorkspaceContext, setActiveWorkspaceSlug, workspaceCompatibilityRedirect, workspacePath, resolveTenantFromRequest, workspaceLoginPath, workspaceRouteSurface, providerOriginRedirectUrl } from './lib/workspace';
import { WorkspaceSignInPrompt } from './components/WorkspaceSignInPrompt';

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
  const [pathname, setPathname] = useState(window.location.pathname);
  const [newVersionAvailable, setNewVersionAvailable] = useState(false);
  const [idleWarningSeconds, setIdleWarningSeconds] = useState<number | null>(null);
  const [verifiedTenantSlug, setVerifiedTenantSlug] = useState<string | null>(null);
  const [tenantResolutionPending, setTenantResolutionPending] = useState(false);
  const ssoLaunchStarted = useRef(false);

  const navigate = useCallback((path: string) => {
    window.history.pushState(null, '', path);
    setPathname(window.location.pathname);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // Provider-origin redirect: known provider origins (e.g. *.onrender.com)
  // are redirected to the canonical Compute origin before any tenant UI renders.
  // Corporate subdomains and future custom domains are never redirected.
  useEffect(() => {
    const redirectUrl = providerOriginRedirectUrl(
      window.location.hostname,
      window.location.pathname,
      window.location.search,
      window.location.hash,
    );
    if (redirectUrl) {
      window.location.replace(redirectUrl);
    }
  }, []);

  useEffect(() => {
    const onPopState = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    const canonical = workspaceCompatibilityRedirect(
      pathname,
      window.location.search,
      window.location.hash,
    );
    if (!canonical) return;
    // Compatibility: /workspaces/{slug} redirects to canonical /{slug}.
    window.history.replaceState(null, '', canonical);
    setPathname(window.location.pathname);
  }, [pathname]);

  useEffect(() => {
    if (!user || ssoLaunchStarted.current) return;
    const params = new URLSearchParams(window.location.search);
    const launch = params.get('launch');
    if (launch !== 'lioncafe' && launch !== 'marquee') return;
    ssoLaunchStarted.current = true;
    const start = launch === 'marquee' ? api.startSso('marquee') : api.startLunchvoiceSso();
    start
      .then(({ redirect_url }) => window.location.replace(redirect_url))
      .catch((error) => {
        ssoLaunchStarted.current = false;
        params.delete('launch');
        const query = params.toString();
        window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
        showToast(`<span>${error instanceof Error ? error.message : `Could not open ${launch}.`}</span>`);
      });
  }, [user]);

  // Central session teardown — called by logout and session-expired handler.
  const teardown = useCallback(async (
    reason?: 'idle' | 'unauthorized' | 'logout',
    origin?: string,
    detail?: string,
  ) => {
    stopSessionWatch();
    setIdleWarningSeconds(null);
    // Record WHY before the token goes away, so the audit event can still be
    // attributed. 'unauthorized' is skipped: api.ts already reported it with
    // the failing request path, which is the more useful record.
    if (reason !== 'unauthorized') {
      reportSessionEvent(origin || reason || 'logout', detail || '', window.location.pathname);
    }
    await realLogout();
    clearStoredSession();
    try { localStorage.removeItem(LAST_ACTIVITY_KEY); } catch {}
    setUser(null);
    if (reason === 'idle') {
      showToast('<span>Signed out after 30 minutes of inactivity.</span>');
    } else if (reason === 'unauthorized') {
      showToast('<span>Session expired — please sign in again.</span>');
    }
  }, []);

  // Boot: register auth-refresh bridge; if session is restored, start watcher + validate token once.
  useEffect(() => {
    const onIdleWarning = (e: Event) => {
      const remainingMs = Number((e as CustomEvent<{ remainingMs?: number }>).detail?.remainingMs || 0);
      setIdleWarningSeconds(Math.max(1, Math.ceil(remainingMs / 1000)));
    };
    const onIdleWarningCancelled = () => setIdleWarningSeconds(null);
    window.addEventListener('mjc:session-idle-warning', onIdleWarning);
    window.addEventListener('mjc:session-idle-warning-cancelled', onIdleWarningCancelled);
    return () => {
      window.removeEventListener('mjc:session-idle-warning', onIdleWarning);
      window.removeEventListener('mjc:session-idle-warning-cancelled', onIdleWarningCancelled);
    };
  }, []);

  useEffect(() => {
    initAuthRefresh();
    if (user) {
      startSessionWatch();
      // A 401 here dispatches mjc:session-expired automatically via api.ts req().
      api.getMe()
        .then((me) => {
          const next = { ...user, ...me };
          if (next.tenant?.slug) setActiveWorkspaceSlug(next.tenant.slug, false);
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
      const info = (e as CustomEvent<{ reason?: string; origin?: string; detail?: string }>).detail;
      const reason = info?.reason as 'idle' | 'unauthorized' | 'logout' | undefined;
      teardown(reason, info?.origin, info?.detail);
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
    if (u.tenant?.slug && u.tenant?.id) {
      setActiveWorkspaceContext(u.tenant.slug, u.tenant.id, false);
    } else if (u.tenant?.slug) {
      setActiveWorkspaceSlug(u.tenant.slug, false);
    }
    setUser(u);
    startSessionWatch();
    saveStoredSession(u, remember);
    showToast('<span>Signed in as ' + (u.display_name || u.username) + '</span>', 2600);
    const requestedTenant = resolveTenantFromRequest(window.location.hostname, pathname);
    if (requestedTenant?.by === 'path') {
      navigate(workspacePath(requestedTenant.slug));
    } else {
      navigate('/');
    }
  }

  function handleLogout() {
    teardown('logout').catch(() => {});
  }

  function handleWorkspaceChange(slug: string) {
    if (slug === user?.tenant?.slug) return;
    const tenantId = user?.workspaces?.find((workspace) => workspace.slug === slug)?.id;
    if (tenantId) setActiveWorkspaceContext(slug, tenantId);
    else setActiveWorkspaceSlug(slug);
    window.location.reload();
  }

  // Tenant resolution is class-aware: a corporate subdomain identifies its
  // tenant, otherwise the canonical slug path does. No hostname is special-cased.
  const resolvedTenant = resolveTenantFromRequest(window.location.hostname, pathname);
  const corporateHost = resolvedTenant?.by === 'subdomain';
  const routeWorkspaceSlug = resolvedTenant?.slug ?? null;

  useEffect(() => {
    if (!routeWorkspaceSlug) {
      setVerifiedTenantSlug(null);
      setTenantResolutionPending(false);
      return;
    }
    let current = true;
    setVerifiedTenantSlug(null);
    setTenantResolutionPending(true);
    api.resolveWorkspace(routeWorkspaceSlug)
      .then(({ workspace }) => {
        if (!current) return;
        if (workspace.slug === routeWorkspaceSlug) {
          // The pre-login resolve endpoint intentionally does not return the
          // immutable tenant id; set slug only. The authenticated /me response
          // will establish the full context after login.
          setActiveWorkspaceSlug(workspace.slug, false);
          setVerifiedTenantSlug(workspace.slug);
        } else {
          setVerifiedTenantSlug(null);
        }
      })
      .catch(() => {
        if (current) setVerifiedTenantSlug(null);
      })
      .finally(() => {
        if (current) setTenantResolutionPending(false);
      });
    return () => { current = false; };
  }, [routeWorkspaceSlug]);

  const routeSurface = workspaceRouteSurface(
    window.location.hostname,
    pathname,
    verifiedTenantSlug,
  );

  const landing = (
    <ComputeLanding
      user={user}
      onOpenWorkspace={(slug) => navigate(workspacePath(slug))}
      onOpenConsole={(slug) => navigate(`${workspacePath(slug)}/console`)}
      onLogout={handleLogout}
    />
  );

  let primary: ReactNode;
  if (routeSurface === 'product' || tenantResolutionPending) {
    // Tenant credentials are never shown until the backend resolves the slug
    // to one active immutable tenant. Unknown and unavailable routes remain on
    // the neutral product landing. This also keeps generic /login neutral.
    primary = landing;
  } else if (routeWorkspaceSlug && routeSurface === 'tenant-login' && !user) {
    // Tenant-branded staff sign-in at /{slug}/login or corporate-host /login.
    primary = <Login onLogin={handleLogin} layout="split" workspaceSlug={routeWorkspaceSlug} />;
  } else if (routeWorkspaceSlug && routeSurface === 'tenant-login' && user) {
    primary = <Portal user={user} onLogout={handleLogout} onWorkspaceChange={handleWorkspaceChange} density="comfortable" />;
  } else if (routeWorkspaceSlug && !user) {
    // A signed-out visitor to a workspace root does NOT get an automatic
    // credential prompt. The client cannot tell a real workspace slug from a
    // mistyped path, so auto-rendering a login here turns every unknown URL
    // into a branded sign-in form for a workspace that may not exist.
    // Sign-in is an explicit step inside the tenant route.
    primary = (
      <WorkspaceSignInPrompt
        slug={routeWorkspaceSlug}
        onSignIn={() => navigate(corporateHost ? '/login' : workspaceLoginPath(routeWorkspaceSlug))}
        onHome={() => navigate('/')}
      />
    );
  } else if (routeWorkspaceSlug && user && routeSurface === 'tenant-console') {
    primary = (
      <WorkspaceConsole
        user={user}
        slug={routeWorkspaceSlug}
        onBack={() => navigate('/')}
        onOpenOperations={() => navigate(corporateHost ? '/' : workspacePath(routeWorkspaceSlug))}
        onLogout={handleLogout}
      />
    );
  } else if (routeWorkspaceSlug && user) {
    primary = (
      <Portal
        user={user}
        onLogout={handleLogout}
        onWorkspaceChange={handleWorkspaceChange}
        density="comfortable"
      />
    );
  } else {
    // Any unmatched path — signed in or out — shows the product landing. It must
    // never fall back to a tenant's branded credential prompt.
    primary = landing;
  }

  return (
    <>
      {primary}
      {user && idleWarningSeconds !== null && (
        <div role="alertdialog" aria-live="assertive" aria-label="Session timeout warning" style={{
          position: 'fixed', top: 18, left: '50%', transform: 'translateX(-50%)',
          width: 'min(460px, calc(100vw - 28px))', zIndex: 10000,
          background: 'var(--surface, #fff)', color: 'var(--ink, #0f172a)',
          border: '2px solid #d97706', borderRadius: 12, padding: '14px 16px',
          boxShadow: '0 12px 32px rgba(0,0,0,.22)',
        }}>
          <strong>Still working?</strong>
          <div style={{ marginTop: 5, fontSize: 13, lineHeight: 1.45 }}>
            You will be signed out in {idleWarningSeconds} second{idleWarningSeconds === 1 ? '' : 's'} because there has been no activity.
          </div>
          <button type="button" onClick={() => markSessionActivity()} style={{
            marginTop: 10, padding: '7px 12px', borderRadius: 7, border: 0,
            background: 'var(--accent, #2563eb)', color: '#fff', cursor: 'pointer', fontWeight: 700,
          }}>
            Keep me signed in
          </button>
        </div>
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
