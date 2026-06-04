import { useState, useEffect } from 'react';
import { I, KpnMark } from '../lib/icons';
import { backendLogin, backendPinLogin, realLogin } from '../lib/supabase';
import type { User } from '../lib/constants';

interface LoginProps {
  onLogin: (user: User, remember: boolean) => void;
  layout?: 'split' | 'centered';
}

export function Login({ onLogin, layout = 'split' }: LoginProps) {
  const [mode, setMode] = useState<'admin' | 'staff'>('admin');
  const [username, setU] = useState('');
  const [password, setP] = useState('');
  const [pin, setPin] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(true);
  const [err, setErr] = useState('');
  const [pinErr, setPinErr] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setErr('');
    setPinErr(false);
  }, [mode]);

  async function doLogin(type: 'admin' | 'staff', pinVal?: string) {
    setBusy(true);
    setErr('');

    let res;

    if (type === 'staff') {
      res = await backendPinLogin(username, pinVal || '');
    } else {
      const supaRes = await realLogin({ username, type: 'admin', password });
      if (!supaRes.ok) {
        setBusy(false);
        setErr(supaRes.error || 'Login failed');
        return;
      }
      if (supaRes.user?.access_token) {
        res = await backendLogin(supaRes.user.access_token);
      } else {
        setBusy(false);
        setErr('No auth token received from Supabase');
        return;
      }
    }

    setBusy(false);
    if (!res.ok) {
      setErr(res.error || 'Login failed');
      if (type === 'staff') {
        setPinErr(true);
        setTimeout(() => {
          setPin('');
          setPinErr(false);
        }, 420);
      }
      return;
    }
    if (res.user) onLogin(res.user, remember);
  }

  function onAdminSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!busy) doLogin('admin');
  }

  function pressKey(d: string) {
    if (busy) return;
    setErr('');
    if (d === 'del') {
      setPin((p) => p.slice(0, -1));
      return;
    }
    if (pin.length >= 4) return;
    const next = pin + d;
    setPin(next);
    if (next.length === 4) setTimeout(() => doLogin('staff', next), 160);
  }

  return (
    <div className="auth" data-layout={layout}>
      <aside className="auth-brand">
        <div className="brand-top">
          <KpnMark size={48} />
          <div>
            <h1>KpnCompute</h1>
            <p>Data Management Platform</p>
          </div>
        </div>
        <div className="brand-mid">
          <div className="eyebrow">Operations Console</div>
          <h2>Inventory, menus &amp; sourcing — one secure console.</h2>
          <p>
            Track on-hand counts and par levels, reconcile vendor invoices, plan the 28-day cycle menu, and manage staff
            access by role — all synced live across every device.
          </p>
          <div className="brand-stats">
            <div>
              <div className="bs-val">214</div>
              <div className="bs-lbl">Line items</div>
            </div>
            <div>
              <div className="bs-val">9</div>
              <div className="bs-lbl">Categories</div>
            </div>
            <div>
              <div className="bs-val">4</div>
              <div className="bs-lbl">Access roles</div>
            </div>
          </div>
        </div>
        <div className="brand-foot">
          <span className="dot"></span> Operations Console · v3.0
        </div>
      </aside>

      <main className="auth-form-wrap">
        <div className="auth-card fade-in">
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 18 }}>
            <img src="/icons.svg#logo" alt="KpnCompute" style={{ height: 60, objectFit: 'contain' }} />
          </div>
          <div className="ac-head">
            <h3>Sign in to the console</h3>
          </div>

          <div className="seg" role="tablist">
            <button
              data-on={mode === 'admin'}
              onClick={() => setMode('admin')}
              role="tab"
              aria-selected={mode === 'admin'}
            >
              {I.lock({ className: 'si' })} Admin / Manager
            </button>
            <button
              data-on={mode === 'staff'}
              onClick={() => setMode('staff')}
              role="tab"
              aria-selected={mode === 'staff'}
            >
              {I.qr({ className: 'si' })} Staff PIN
            </button>
          </div>

          {err && (
            <div className="auth-err">
              {I.alert({ style: { width: 16, height: 16, flexShrink: 0 } })}
              <span>{err}</span>
            </div>
          )}

          {mode === 'admin' ? (
            <form onSubmit={onAdminSubmit}>
              <div className="field has-icon">
                <label>Username</label>
                {I.user({ className: 'fi' })}
                <input
                  className="ipt"
                  autoFocus
                  value={username}
                  onChange={(e) => setU(e.target.value)}
                  placeholder="e.g. amartin"
                  autoComplete="username"
                />
              </div>
              <div className="field has-icon">
                <label>Password</label>
                {I.lock({ className: 'fi' })}
                <input
                  className="ipt"
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setP(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                />
                <button type="button" className="pw-toggle" onClick={() => setShowPw((s) => !s)} aria-label="Toggle password">
                  {showPw ? I.eyeOff({ style: { width: 17, height: 17 } }) : I.eye({ style: { width: 17, height: 17 } })}
                </button>
              </div>
              <div className="row-between">
                <label className="check">
                  <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Keep me
                  signed in
                </label>
              </div>
              <button className="btn-auth" type="submit" disabled={busy}>
                {busy ? (
                  'Verifying…'
                ) : (
                  <>
                    Sign in {I.logout({ style: { width: 16, height: 16 } })}
                  </>
                )}
              </button>
            </form>
          ) : (
            <div>
              <div className="field has-icon">
                <label>Staff username</label>
                {I.user({ className: 'fi' })}
                <input
                  className="ipt"
                  autoFocus
                  value={username}
                  onChange={(e) => setU(e.target.value)}
                  placeholder="e.g. rkhan"
                  autoComplete="username"
                />
              </div>
              <label style={{ display: 'block', fontSize: 11.5, fontWeight: 700, marginBottom: 4 }}>
                Enter 4-digit PIN
              </label>
              <div className="pin-display">
                {[0, 1, 2, 3].map((i) => (
                  <span key={i} className="pin-dot" data-filled={i < pin.length} data-error={pinErr}></span>
                ))}
              </div>
              <div className="keypad">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
                  <button key={d} className="key" onClick={() => pressKey(d)}>
                    {d}
                  </button>
                ))}
                <button className="key fn" onClick={() => setPin('')} disabled={busy}>
                  Clear
                </button>
                <button className="key" onClick={() => pressKey('0')}>
                  0
                </button>
                <button className="key fn" onClick={() => pressKey('del')} disabled={busy} aria-label="Delete">
                  ⌫
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
