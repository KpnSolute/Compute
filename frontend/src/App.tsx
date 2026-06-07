import { useState, useEffect } from 'react';
import type { User } from './lib/constants';
import { clearBackendToken, getBackendToken } from './lib/supabase';
import { Login } from './components/Login';
import { Portal } from './components/Portal';

const SKEY = 'kpn_session';

function loadSession(): User | null {
  try {
    const u = JSON.parse(localStorage.getItem(SKEY) || 'null');
    const hasToken = !!getBackendToken();
    if (!u || !hasToken) {
      // Stale/partial session (kpn_session present but no valid mjc_backend_token, or neither).
      // Force clean login instead of mounting Portal and firing unauthenticated API calls (causes 401 spam + "Invalid or expired token").
      clearBackendToken();
      if (u) {
        try { localStorage.removeItem(SKEY); } catch {}
      }
      return null;
    }
    return u;
  } catch { return null; }
}

function App() {
  const [user, setUser] = useState<User | null>(loadSession);

  useEffect(() => {
    const onExpired = () => {
      try { localStorage.removeItem(SKEY); } catch {}
      setUser(null);
      // Show toast if available
      const t = document.getElementById('toast');
      if (t) {
        t.innerHTML = '<span>Session expired — please sign in again.</span>';
        t.classList.add('show');
        setTimeout(() => t.classList.remove('show'), 4000);
      }
    };
    window.addEventListener('mjc:session-expired', onExpired);
    return () => window.removeEventListener('mjc:session-expired', onExpired);
  }, []);

  function handleLogin(u: User, remember: boolean) {
    setUser(u);
    if (remember) {
      try { localStorage.setItem(SKEY, JSON.stringify(u)); } catch {}
    } else {
      try { localStorage.removeItem(SKEY); } catch {}
    }
    const t = document.getElementById('toast');
    if (t) {
      t.innerHTML = '';
      const span = document.createElement('span');
      span.textContent = 'Signed in as ' + (u.display_name || u.username);
      t.appendChild(span);
      t.classList.add('show');
      clearTimeout((window as any).__tt);
      (window as any).__tt = setTimeout(() => t.classList.remove('show'), 2600);
    }
  }

  function handleLogout() {
    clearBackendToken();
    setUser(null);
    try { localStorage.removeItem(SKEY); } catch {}
  }

  return !user ? (
    <Login onLogin={handleLogin} layout="split" />
  ) : (
    <Portal user={user} onLogout={handleLogout} density="comfortable" />
  );
}

export default App;
