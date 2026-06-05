import { useState } from 'react';
import type { User } from './lib/constants';
import { clearBackendToken } from './lib/supabase';
import { Login } from './components/Login';
import { Portal } from './components/Portal';

const SKEY = 'kpn_session';

function loadSession(): User | null {
  try {
    const u = JSON.parse(localStorage.getItem(SKEY) || 'null');
    if (!u) clearBackendToken(); // no remembered session → purge stale JWT
    return u;
  } catch { return null; }
}

function App() {
  const [user, setUser] = useState<User | null>(loadSession);

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
