/* ══════════════════════════════════════════════════════════════
   App bootstrap — root component that wires session, theme tweaks,
   and the login → portal switch. Kept in its own file so the HTML
   shell is purely a manifest of components.
═══════════════════════════════════════════════════════════════ */

const SKEY = 'kpn_session';
const ACCENTS = {
  '#1E73E8': '#1660C8',  // KPN blue
  '#4F46E5': '#4338CA',  // indigo
  '#0E7490': '#0B5C73',  // teal
};
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "loginLayout": "split",
  "accent": "#4F46E5",
  "density": "comfortable"
}/*EDITMODE-END*/;

function loadSession(){
  try{ return JSON.parse(localStorage.getItem(SKEY) || 'null'); }catch(e){ return null; }
}

function App(){
  const [user, setUser] = React.useState(loadSession);
  const [t, setTweak] = window.useTweaks(TWEAK_DEFAULTS);

  React.useEffect(()=>{
    const root = document.documentElement;
    root.style.setProperty('--accent', t.accent);
    root.style.setProperty('--accent-2', ACCENTS[t.accent] || t.accent);
  }, [t.accent]);

  function handleLogin(u, remember){
    setUser(u);
    if(remember){ try{ localStorage.setItem(SKEY, JSON.stringify(u)); }catch(e){} }
    else { try{ localStorage.removeItem(SKEY); }catch(e){} }
    window.toast && window.toast('Signed in as ' + (u.display_name || u.username));
  }
  function handleLogout(){
    if(window.realLogout) window.realLogout();
    setUser(null);
    try{ localStorage.removeItem(SKEY); }catch(e){}
  }

  const panel = (
    <window.TweaksPanel>
      <window.TweakSection label="Sign-in"/>
      <window.TweakRadio label="Login layout" value={t.loginLayout} options={['split','centered']}
        onChange={v=>setTweak('loginLayout', v)} />
      <window.TweakSection label="Theme"/>
      <window.TweakColor label="Accent" value={t.accent} options={Object.keys(ACCENTS)}
        onChange={v=>setTweak('accent', v)} />
      <window.TweakSection label="Portal"/>
      <window.TweakRadio label="Density" value={t.density} options={['comfortable','compact']}
        onChange={v=>setTweak('density', v)} />
    </window.TweaksPanel>
  );

  return (
    <React.Fragment>
      {!user
        ? <window.Login onLogin={handleLogin} layout={t.loginLayout} />
        : <window.Portal user={user} onLogout={handleLogout} density={t.density} />}
      {panel}
    </React.Fragment>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
