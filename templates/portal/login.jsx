/* ══════════════════════════════════════════════════════════════
   Food Service Data Management — Login.
   Connection-aware: when a Supabase project is configured, auth runs
   against the REAL backend (user_profiles + Supabase Auth). Otherwise
   it falls back to a self-contained demo so the portal is explorable.
═══════════════════════════════════════════════════════════════ */

/* Brand mark (used on dark navy surfaces where the PNG logo won't read) */
function KpnMark({ size=52 }){
  return (
    <svg width={size} height={size*1.15} viewBox="0 0 52 60" fill="none" aria-hidden="true">
      <path d="M40 9 A24 24 0 1 0 45 30" stroke="#9DBEF0" strokeWidth="2.4" strokeLinecap="round" opacity=".55"/>
      <circle cx="24" cy="30" r="18" stroke="#BFD6F7" strokeWidth="1.4" opacity=".5"/>
      <ellipse cx="24" cy="30" rx="8.5" ry="18" stroke="#BFD6F7" strokeWidth="1.2" opacity=".4"/>
      <line x1="6" y1="30" x2="42" y2="30" stroke="#BFD6F7" strokeWidth="1.2" opacity=".4"/>
      <path d="M9 20 H39 M9 40 H39" stroke="#BFD6F7" strokeWidth="1.1" opacity=".3"/>
      <path d="M10 47 C18 40 16 30 26 27 C35 24 33 15 41 12" stroke="#2E86F0" strokeWidth="3.4" strokeLinecap="round" fill="none"/>
      <path d="M35.5 11 L43 11 L42 18.5 Z" fill="#2E86F0"/>
      <circle cx="11" cy="47" r="3.4" fill="#2E86F0"/>
      <circle cx="11" cy="47" r="1.2" fill="#fff"/>
    </svg>
  );
}

/* ── Supabase connection modal (shared with the portal) ── */
const SUPA_SQL = `-- Run in Supabase → SQL Editor
create table if not exists inventory_sync (
  id integer primary key,
  data jsonb,
  synced_by text,
  synced_at timestamptz default now()
);
-- Allow the portal (anon key) to read the directory + inventory.
-- user_profiles must already exist (id, username, display_name,
-- last_name, role, pin, active).
alter table inventory_sync enable row level security;
create policy "read inv" on inventory_sync for select using (true);
create policy "read profiles" on user_profiles for select using (true);`;

function SupaSetupModal({ onClose, onSaved }){
  const cfg = window.getSupaConfig();
  const [url, setUrl] = useState(cfg.url);
  const [key, setKey] = useState(cfg.key);
  const [err, setErr] = useState('');
  const connected = window.isConnected();

  function save(){
    const u=url.trim(), k=key.trim();
    if(!u.includes('supabase.co')){ setErr('Enter a valid Project URL (ends in .supabase.co).'); return; }
    if(!k.startsWith('eyJ')){ setErr('Enter the anon / public key (starts with eyJ…).'); return; }
    window.saveSupaConfig(u, k);
    onSaved && onSaved();
    onClose();
  }
  function disconnect(){
    window.clearSupaConfig();
    setUrl(''); setKey('');
    onSaved && onSaved();
    onClose();
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h3>{window.I.cloud()} Connect data source</h3>
            <div className="sub">Link this portal to your Supabase project. Logins and inventory then run against your live data — the same project the inventory dashboard syncs to.</div>
          </div>
          <button className="modal-x" onClick={onClose} aria-label="Close">{window.I.x()}</button>
        </div>
        <div className="modal-body">
          <div className={'conn-status '+(connected?'on':'off')}>
            <span className="d"></span>
            {connected ? 'Connected — using live Supabase data' : 'Not connected — demo mode active'}
          </div>

          {err && <div className="auth-err" style={{marginBottom:14}}>{window.I.alert({style:{width:16,height:16,flexShrink:0}})}<span>{err}</span></div>}

          <div className="field">
            <label>Project URL</label>
            <input className="ipt mono" value={url} onChange={e=>setUrl(e.target.value)}
              placeholder="https://abcdefghijkl.supabase.co" />
          </div>
          <div className="field">
            <label>anon / public key</label>
            <input className="ipt mono" value={key} onChange={e=>setKey(e.target.value)}
              placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…" />
            <div className="hint">Settings → API in your Supabase dashboard. The anon key is safe for browsers; never paste the <b>service_role</b> key here.</div>
          </div>

          <details style={{margin:'4px 0 6px'}}>
            <summary style={{fontSize:12,fontWeight:700,cursor:'pointer',color:'var(--navy-2)'}}>First-time setup (read policies)</summary>
            <div className="sql-box">{SUPA_SQL}</div>
          </details>
        </div>
        <div className="modal-foot">
          {connected && <button className="btn" style={{flex:'0 0 auto',color:'var(--red)'}} onClick={disconnect}>Disconnect</button>}
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={save}>{window.I.check({style:{width:15,height:15}})} Save &amp; connect</button>
        </div>
      </div>
    </div>
  );
}

function DemoCreds({ onUse }){
  const rows = [
    { r:'Administrator', u:'amartin', s:'kpn2026',   type:'admin' },
    { r:'Manager',       u:'dcortez', s:'kpn2026',   type:'admin' },
    { r:'Staff (PIN)',   u:'rkhan',   s:'PIN 4729',  type:'staff', secret:'4729' },
  ];
  return (
    <div className="demo-creds">
      <div className="dc-h">{window.I.lock({style:{width:13,height:13}})} Demo credentials — click to fill</div>
      <table>
        <tbody>
          {rows.map((row,i)=>(
            <tr key={i}>
              <td>{row.r}</td>
              <td className="k">{row.u}</td>
              <td className="k">{row.type==='staff'?'PIN 4729':'kpn2026'}</td>
              <td className="use" onClick={()=>onUse(row)}>Use →</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Login({ onLogin, layout='split', onConnChange }){
  const [mode, setMode]   = useState('admin');
  const [username, setU]  = useState('');
  const [password, setP]  = useState('');
  const [pin, setPin]     = useState('');
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(true);
  const [err, setErr]     = useState('');
  const [pinErr, setPinErr] = useState(false);
  const [busy, setBusy]   = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [connected, setConnected] = useState(window.isConnected());

  useEffect(()=>{ setErr(''); setPinErr(false); }, [mode]);

  function refreshConn(){
    const c = window.isConnected();
    setConnected(c);
    onConnChange && onConnChange(c);
  }

  async function doLogin(type, pinVal){
    setBusy(true); setErr('');
    const payload = type==='staff'
      ? { username, type:'staff', pin: pinVal }
      : { username, type:'admin', password };
    let res;
    if(connected){
      res = await window.realLogin(payload);
    }else{
      await new Promise(r=>setTimeout(r,420));
      res = window.mockLogin(payload);
    }
    setBusy(false);
    if(!res.ok){
      setErr(res.error);
      if(type==='staff'){ setPinErr(true); setTimeout(()=>{ setPin(''); setPinErr(false); }, 420); }
      return;
    }
    onLogin(res.user, remember);
  }

  function onAdminSubmit(e){ e.preventDefault(); if(!busy) doLogin('admin'); }

  function pressKey(d){
    if(busy) return;
    setErr('');
    if(d==='del'){ setPin(p=>p.slice(0,-1)); return; }
    if(pin.length>=4) return;
    const next = pin + d;
    setPin(next);
    if(next.length===4) setTimeout(()=>doLogin('staff', next), 160);
  }

  function useCred(row){
    if(row.type==='staff'){ setMode('staff'); setU(row.u); setPin(''); }
    else { setMode('admin'); setU(row.u); setP(row.s); }
    setErr('');
  }

  return (
    <div className="auth" data-layout={layout}>
      <aside className="auth-brand">
        <div className="brand-top">
          <KpnMark size={48}/>
          <div>
            <h1>KPN Food Service</h1>
            <p>Data Management Platform</p>
          </div>
        </div>
        <div className="brand-mid">
          <div className="eyebrow">Operations Console</div>
          <h2>Inventory, menus &amp; sourcing — one secure console.</h2>
          <p>Track on-hand counts and par levels, reconcile vendor invoices, plan the 28-day cycle menu, and manage staff access by role — all synced live across every device.</p>
          <div className="brand-stats">
            <div><div className="bs-val">214</div><div className="bs-lbl">Line items</div></div>
            <div><div className="bs-val">9</div><div className="bs-lbl">Categories</div></div>
            <div><div className="bs-val">4</div><div className="bs-lbl">Access roles</div></div>
          </div>
        </div>
        <div className="brand-foot"><span className="dot"></span> {connected ? 'Live · Supabase connected' : 'Demo mode · not connected'} · v3.0</div>
      </aside>

      <main className="auth-form-wrap">
        <div className="auth-card fade-in">
          <div style={{display:'flex',justifyContent:'center',marginBottom:18}}>
            <img src="portal/kpn-logo.png" alt="KPN Food Service" style={{height:60,objectFit:'contain'}}/>
          </div>
          <div className="ac-head">
            <h3>Sign in to the console</h3>
            <p>Choose your access type to continue.</p>
          </div>

          <div className="seg" role="tablist">
            <button data-on={mode==='admin'} onClick={()=>setMode('admin')} role="tab">
              {window.I.lock({className:'si'})} Admin / Manager
            </button>
            <button data-on={mode==='staff'} onClick={()=>setMode('staff')} role="tab">
              {window.I.qr({className:'si'})} Staff PIN
            </button>
          </div>

          {err && <div className="auth-err">{window.I.alert({style:{width:16,height:16,flexShrink:0}})}<span>{err}</span></div>}

          {mode==='admin' ? (
            <form onSubmit={onAdminSubmit}>
              <div className="field has-icon">
                <label>Username</label>
                {window.I.user({className:'fi'})}
                <input className="ipt" autoFocus value={username} onChange={e=>setU(e.target.value)}
                  placeholder="e.g. amartin" autoComplete="username"/>
              </div>
              <div className="field has-icon">
                <label>Password</label>
                {window.I.lock({className:'fi'})}
                <input className="ipt" type={showPw?'text':'password'} value={password}
                  onChange={e=>setP(e.target.value)} placeholder="••••••••" autoComplete="current-password"/>
                <button type="button" className="pw-toggle" onClick={()=>setShowPw(s=>!s)} aria-label="Toggle password">
                  {showPw ? window.I.eyeOff({style:{width:17,height:17}}) : window.I.eye({style:{width:17,height:17}})}
                </button>
              </div>
              <div className="row-between">
                <label className="check"><input type="checkbox" checked={remember} onChange={e=>setRemember(e.target.checked)}/> Keep me signed in</label>
                <span className="link" onClick={()=>alert('Contact your administrator to reset your password.')}>Forgot password?</span>
              </div>
              <button className="btn-auth" type="submit" disabled={busy}>
                {busy ? 'Verifying…' : <>Sign in {window.I.logout({style:{width:16,height:16}})}</>}
              </button>
            </form>
          ) : (
            <div>
              <div className="field has-icon">
                <label>Staff username</label>
                {window.I.user({className:'fi'})}
                <input className="ipt" autoFocus value={username} onChange={e=>setU(e.target.value)}
                  placeholder="e.g. rkhan" autoComplete="username"/>
              </div>
              <label style={{display:'block',fontSize:11.5,fontWeight:700,marginBottom:4}}>Enter 4-digit PIN</label>
              <div className="pin-display">
                {[0,1,2,3].map(i=>(
                  <span key={i} className="pin-dot" data-filled={i<pin.length} data-error={pinErr}></span>
                ))}
              </div>
              <div className="keypad">
                {['1','2','3','4','5','6','7','8','9'].map(d=>(
                  <button key={d} className="key" onClick={()=>pressKey(d)}>{d}</button>
                ))}
                <button className="key fn" onClick={()=>setPin('')} disabled={busy}>Clear</button>
                <button className="key" onClick={()=>pressKey('0')}>0</button>
                <button className="key fn" onClick={()=>pressKey('del')} disabled={busy} aria-label="Delete">⌫</button>
              </div>
            </div>
          )}

          {!connected && <DemoCreds onUse={useCred}/>}

          <div className="auth-note" style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:10}}>
            <span style={{display:'inline-flex',alignItems:'center',gap:7}}>
              <span className={'conn-dot'} style={{width:8,height:8,borderRadius:'50%',background:connected?'#16A34A':'#94A3B8',display:'inline-block'}}></span>
              {connected ? 'Connected to Supabase' : 'Demo mode — not connected'}
            </span>
            <span className="link" onClick={()=>setShowSetup(true)}>{connected?'Manage':'Connect data source'} →</span>
          </div>
        </div>
      </main>

      {showSetup && <SupaSetupModal onClose={()=>setShowSetup(false)} onSaved={refreshConn}/>}
    </div>
  );
}

window.Login = Login;
window.KpnMark = KpnMark;
window.SupaSetupModal = SupaSetupModal;
