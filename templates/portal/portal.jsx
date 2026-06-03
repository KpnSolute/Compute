/* ══════════════════════════════════════════════════════════════
   Food Service Data Management — Portal shell.
   Pulls LIVE data from Supabase (inventory_sync + user_profiles) when
   connected; falls back to demo data otherwise.
═══════════════════════════════════════════════════════════════ */

function toast(msg){
  let t = document.getElementById('toast');
  if(!t){ t = document.createElement('div'); t.id='toast'; document.body.appendChild(t); }
  t.innerHTML=''; const span=document.createElement('span'); span.textContent=msg;
  t.appendChild(span); t.classList.add('show');
  clearTimeout(window.__tt); window.__tt=setTimeout(()=>t.classList.remove('show'),2600);
}
const initials = (u)=> ((u.display_name?.[0]||'') + (u.last_name?.[0]||'')).toUpperCase() || (u.username||'?').slice(0,2).toUpperCase();
const ROLE_LVL = (r)=> window.ROLE_LEVEL[r]||0;

/* ── Live inventory hook ── */
function useInventory(connected){
  const [state, setState] = useState({ loading:false, inv:null, syncedBy:null, syncedAt:null, error:null });
  const load = React.useCallback(async ()=>{
    if(!connected){ setState({ loading:false, inv:null, error:null }); return; }
    setState(s=>({ ...s, loading:true, error:null }));
    const res = await window.fetchInventory();
    if(res.ok) setState({ loading:false, inv:res.inv, syncedBy:res.syncedBy, syncedAt:res.syncedAt, error: res.inv?null:'empty' });
    else setState({ loading:false, inv:null, error:res.error });
  }, [connected]);
  useEffect(()=>{ load(); }, [load]);
  return [state, load];
}

/* ── Topbar ── */
function Topbar({ user, period, setPeriod, connected, syncState, onSync, onOpenSetup }){
  const [menu, setMenu] = useState(false);
  useEffect(()=>{
    const close=()=>setMenu(false);
    if(menu){ window.addEventListener('click', close); return ()=>window.removeEventListener('click', close); }
  }, [menu]);
  const [m,y] = period;
  let badgeClass='inv-badge', badgeText, badgeIcon='rt';
  if(!connected){ badgeClass+=' demo'; badgeText='Demo mode'; }
  else if(syncState==='loading'){ badgeClass+=' syncing'; badgeText='Syncing…'; }
  else if(syncState==='error'){ badgeClass+=' err'; badgeText='Sync error'; }
  else badgeText='LIVE · Supabase';

  return (
    <header className="topbar">
      <div className="tb-left">
        <span style={{display:'flex'}}><window.KpnMark size={26}/></span>
        <div>
          <div className="tb-title">Food Service Data Management</div>
          <div className="tb-sub">Inventory · 28-Day Menu · Sourcing</div>
        </div>
      </div>
      <div className="tb-right">
        <span className={badgeClass} onClick={connected?onSync:onOpenSetup} title={connected?'Click to refresh':'Click to connect'}>
          <span className="rt"></span>{badgeText}
        </span>
        <select className="tb-select" value={m} onChange={e=>setPeriod([+e.target.value, y])}>
          {window.MONTHS.map((nm,i)=><option key={i} value={i}>{nm}</option>)}
        </select>
        <select className="tb-select" value={y} onChange={e=>setPeriod([m, +e.target.value])}>
          {[2024,2025,2026].map(yr=><option key={yr} value={yr}>{yr}</option>)}
        </select>
        <div className="tb-user" onClick={e=>{e.stopPropagation(); setMenu(v=>!v);}}>
          <div className="avatar">{initials(user)}</div>
          <div className="hide-sm">
            <div className="nm">{user.display_name} {user.last_name}</div>
            <div className="rl">{window.ROLE_LABEL[user.role]}</div>
          </div>
          {menu && (
            <div className="usermenu" onClick={e=>e.stopPropagation()}>
              <div className="um-head">
                <div className="nm">{user.display_name} {user.last_name}</div>
                <div className="em">{user.username}@mjc-cafeteria.com</div>
              </div>
              <button className="um-item">{window.I.user()} My profile</button>
              <button className="um-item" onClick={onOpenSetup}>{window.I.database()} Data source</button>
              <button className="um-item danger" onClick={()=>window.__logout()}>{window.I.logout()} Sign out</button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

/* ── Sidebar ── */
function Sidebar({ user, active, setActive, reorderCount, stagedCount }){
  const lvl = ROLE_LVL(user.role);
  return (
    <nav className="sidebar">
      {window.NAV.map(group=>{
        const items = group.items.filter(it=>lvl>=it.min);
        if(!items.length) return null;
        return (
          <div key={group.group}>
            <div className="nav-group-lbl">{group.group}</div>
            {items.map(it=>(
              <button key={it.key} className="nav-item" data-active={active===it.key} onClick={()=>setActive(it.key)}>
                {window.I[it.icon]()}
                <span>{it.label==='Source Control' && lvl<20 ? 'My Submissions' : it.label}</span>
                {it.key==='inventory' && reorderCount>0 && <span className="nb">{reorderCount}</span>}
                {it.key==='sourcectrl' && stagedCount>0 && <span className="nb">{stagedCount}</span>}
              </button>
            ))}
          </div>
        );
      })}
      <div className="sidebar-foot">
        Signed in as <b>{window.ROLE_LABEL[user.role]}</b><br/>
        <span style={{fontFamily:'BlinkMacSystemFont'}}>KPN Food Service · v3.0</span>
      </div>
    </nav>
  );
}

/* ── shared loading / error blocks ── */
function Loading({ label='Loading live data…' }){
  return <div className="load-wrap"><div className="spinner"></div><div>{label}</div></div>;
}
function ConnectBanner({ onOpen }){
  return (
    <div className="banner info">
      {window.I.cloud()}
      <span>Showing demo data. Connect your Supabase project to see live inventory.</span>
      <span className="bx" onClick={onOpen}>Connect →</span>
    </div>
  );
}

/* ── Dashboard — integrated operations cockpit (mirrors the SOP main dash) ── */
const MEAL_ICON = { Breakfast:'🌅', Brunch:'🍳', Lunch:'☀️', Dinner:'🌙', Snack:'🍎' };

function Dashboard({ user, period, connected, invState, onSync, onOpenSetup, go }){
  const lvl = ROLE_LVL(user.role);
  const live = connected ? invState.inv : window.demoInvFor(period[0],period[1]);
  const todayISO = new Date().toISOString().slice(0,10);

  // ── inventory roll-up ──
  let gt=0, reorderList=[], catRows=[], itemCount=0;
  if(live){
    gt = window.grandTotal(live);
    reorderList = window.reorders(live);
    const ct = window.catTotals(live);
    const maxCat = ct.length? ct[0].val : 1;
    itemCount = window.invToList(live).length;
    catRows = ct.slice(0,7).map(c=>({ name:c.name, color:c.color, val:window.fmtMoney(c.val), pct: maxCat? Math.max(4,Math.round(c.val/maxCat*100)) : 0 }));
  }

  // ── monthly inventory summary (opening → received → issued → closing) ──
  const monRows = window.invToList(live||{}).map(it=>({
    price:it.price||0, opening:it.onHand||0,
    received:(it.w1r||0)+(it.w2r||0)+(it.w3r||0)+(it.w4r||0), issued:0,
  }));
  const miSum = monRows.reduce((a,r)=>{
    a.open += r.opening*r.price; a.recv += r.received*r.price;
    a.close += Math.max(0,r.opening+r.received-r.issued)*r.price; return a;
  }, { open:0, recv:0, close:0 });

  // ── today's menu ──
  const dayKey = window.DOW_KEYS[new Date().getDay()];
  const menu = window.DS.cycleMenu()[dayKey] || {};
  const menuMeals = ['Breakfast','Brunch','Lunch','Dinner','Snack'].filter(m=>menu[m]&&menu[m].length);

  // ── meal log today (from saved logs) ──
  const ml = window.loadLog ? window.loadLog('meallog:'+todayISO, null) : null;
  const mlRows = (ml && ml.rows) || [];
  const mlCount = m => mlRows.filter(r=>r[m[0]]).length;
  const mlTotals = { B:mlCount('B'), L:mlCount('L'), D:mlCount('D'),
    T: mlRows.filter(r=>r.ticket && !String(r.ticket).toUpperCase().includes('COMP')).length };

  // ── events ──
  const upcoming = window.DS.events().filter(e=>e.date>=todayISO).sort((a,b)=>a.date.localeCompare(b.date));
  const nextEvent = upcoming[0];
  const invoices = window.DS.invoices(period);
  const invoiceTotal = invoices.reduce((s,i)=>s+(i.total||0),0), invoiceCount = invoices.length;

  const fmtShort = iso => new Date(iso+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'});

  // ── KPI strip ──
  const KPIS = [
    { key:'val', label:'Inventory Value', icon:'dollar', tint:'#1E73E8', bg:'#EFF5FE', val:window.fmtMoney(gt), sub:itemCount+' line items', to:'inventory' },
    { key:'low', label:'Below Par', icon:'alert', tint:'#D97706', bg:'#FEF3C7', val:String(reorderList.length), sub:'flagged for reorder', to:'inventory' },
    { key:'meals', label:'Meals Logged', icon:'users', tint:'#1B3A6B', bg:'#EEF2F8', val:String(mlTotals.B+mlTotals.L+mlTotals.D), sub:'today', to:'mballot' },
    { key:'mi', label:'Closing Value', icon:'fileText', tint:'#0E7490', bg:'#ECFEFF', val:window.fmtMoney(miSum.close), sub:'monthly inventory', to:'moninv' },
    { key:'inv', label:'Invoices', icon:'inbox', tint:'#059669', bg:'#F0FDF4', val:String(invoiceCount), sub:window.fmtMoney(invoiceTotal)+' this month', to:'moninv' },
    { key:'evt', label:'Next Event', icon:'calCheck', tint:'#6D28D9', bg:'#EDE9FE', val:nextEvent?fmtShort(nextEvent.date):'—', sub:nextEvent?nextEvent.title:'none scheduled', to:'events', small:true },
  ];

  const QUICK = [
    { label:'Log HACCP reading', icon:'thermo', to:'haccp' },
    { label:'Log staff meal', icon:'users', to:'mballot' },
    { label:'Food request form', icon:'inbox', to:'foodreq' },
    { label:'Run inspection', icon:'clipboard', to:'inspection' },
    { label:'Daily operations', icon:'checkSquare', to:'dailyops' },
    { label:'Monthly inventory', icon:'fileText', to:'moninv' },
  ];

  return (
    <div className="fade-in">
      <div className="page-head">
        <div>
          <h2>Welcome back, {user.display_name||user.username}</h2>
          <div className="ph-sub">
            Operations overview · {new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'})}
            {live && invState.syncedAt && <> · synced {new Date(invState.syncedAt).toLocaleString()}</>}
          </div>
        </div>
        <div className="ph-actions">
          {connected
            ? <button className="btn" onClick={onSync}>{window.I.refresh()} Refresh</button>
            : <button className="btn" onClick={onOpenSetup}>{window.I.cloud()} Connect</button>}
          {lvl>=20 && <button className="btn primary" onClick={()=>go&&go('moninv')}>{window.I.plus()} New entry</button>}
        </div>
      </div>

      {!connected && <ConnectBanner onOpen={onOpenSetup}/>}
      {connected && invState.loading && <Loading/>}
      {connected && invState.error && invState.error!=='empty' &&
        <div className="banner warn">{window.I.alert()}<span>Couldn’t load live data: {invState.error}</span><span className="bx" onClick={onSync}>Retry</span></div>}

      {/* KPI strip */}
      <div className="stat-grid kpi6">
        {KPIS.map(s=>(
          <div className="stat-card kpi-card" key={s.key} onClick={()=>go&&go(s.to)}>
            <div className="sc-top"><div className="sc-ic" style={{background:s.bg,color:s.tint}}>{window.I[s.icon]()}</div></div>
            <div className="sc-lbl">{s.label}</div>
            <div className="sc-val" style={s.small?{fontSize:16,fontFamily:'var(--font)'}:null}>{s.val}</div>
            <div className="sc-delta eq" style={{marginTop:4,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{s.sub}</div>
          </div>
        ))}
      </div>

      <div className="grid-2">
        {/* LEFT column */}
        <div style={{display:'flex',flexDirection:'column',gap:16}}>
          {/* today's menu */}
          <div className="card">
            <div className="card-head">
              <h3>Today&rsquo;s menu · {window.DOW_FULL[dayKey]}</h3>
              <span className="ch-link" onClick={()=>go&&go('menu')} style={{cursor:'pointer'}}>Full menu →</span>
            </div>
            <div className="card-body" style={{display:'flex',flexDirection:'column',gap:11}}>
              {menuMeals.length===0 && <div style={{fontSize:12,color:'var(--faint)'}}>No menu for today.</div>}
              {menuMeals.map(meal=>(
                <div key={meal} className="dash-meal">
                  <div className="dm-head">{MEAL_ICON[meal]} {meal}</div>
                  <div className="dm-items">
                    {meal==='Snack'
                      ? menu[meal].join(' · ')
                      : menu[meal].map(it=>(typeof it==='string'?it:it.item)).join(' · ')}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* inventory by category */}
          <div className="card">
            <div className="card-head">
              <h3>Inventory value by category</h3>
              <span className="ch-link" onClick={()=>go&&go('inventory')} style={{cursor:'pointer'}}>{connected?'Live':window.MONTHS[period[0]]+' '+period[1]}</span>
            </div>
            <div className="card-body flush">
              {catRows.map(c=>(
                <div className="cat-row" key={c.name}>
                  <span className="cat-dot" style={{background:c.color}}></span>
                  <span className="cat-nm">{c.name}</span>
                  <span className="cat-bar"><span className="cat-fill" style={{width:c.pct+'%',background:c.color}}></span></span>
                  <span className="cat-val">{c.val}</span>
                </div>
              ))}
            </div>
          </div>

          {/* inventory alerts */}
          <div className="card">
            <div className="card-head">
              <h3>Inventory alerts</h3>
              <span className="viol-pill" style={{margin:0}}>{window.I.alert({style:{width:13,height:13}})} {reorderList.length} below par</span>
            </div>
            <div className="card-body">
              {reorderList.length===0
                ? <div style={{fontSize:12,color:'var(--faint)'}}>All items at or above par level.</div>
                : <div className="alert-chips">
                    {reorderList.slice(0,12).map((r,i)=>(
                      <span className="alert-chip" key={i}>{r.desc}<b>{r.onHand||0}/{r.par}</b></span>
                    ))}
                    {reorderList.length>12 && <span className="alert-more" onClick={()=>go&&go('inventory')}>+{reorderList.length-12} more →</span>}
                  </div>}
            </div>
          </div>
        </div>

        {/* RIGHT column */}
        <div style={{display:'flex',flexDirection:'column',gap:16}}>
          {/* meal log today */}
          <div className="card">
            <div className="card-head">
              <h3>Meal log · today</h3>
              <span className="ch-link" onClick={()=>go&&go('mballot')} style={{cursor:'pointer'}}>Full log →</span>
            </div>
            <div className="card-body">
              <div className="dash-meal-counts">
                {[['Breakfast',mlTotals.B],['Lunch',mlTotals.L],['Dinner',mlTotals.D],['Tickets',mlTotals.T]].map(([l,n])=>(
                  <div className="dmc" key={l}><span className="dmc-n">{n}</span><span className="dmc-l">{l}</span></div>
                ))}
              </div>
            </div>
          </div>

          {/* monthly inventory summary */}
          <div className="card">
            <div className="card-head">
              <h3>Monthly inventory · {window.MONTHS[period[0]]}</h3>
              <span className="ch-link" onClick={()=>go&&go('moninv')} style={{cursor:'pointer'}}>Manage →</span>
            </div>
            <div className="card-body">
              <div className="mi-mini">
                <div className="mim" style={{background:'#EEF2F8'}}><span className="mim-l" style={{color:'#1B3A6B'}}>Opening</span><span className="mim-v">{window.fmtMoney(miSum.open)}</span></div>
                <div className="mim" style={{background:'#F0FDF4'}}><span className="mim-l" style={{color:'#166534'}}>Received</span><span className="mim-v" style={{color:'#166534'}}>{window.fmtMoney(miSum.recv)}</span></div>
                <div className="mim" style={{background:'#EFF5FE'}}><span className="mim-l" style={{color:'#1660C8'}}>Closing</span><span className="mim-v" style={{color:'#1660C8'}}>{window.fmtMoney(miSum.close)}</span></div>
              </div>
            </div>
          </div>

          {/* upcoming events */}
          <div className="card">
            <div className="card-head">
              <h3>Upcoming events</h3>
              <span className="ch-link" onClick={()=>go&&go('events')} style={{cursor:'pointer'}}>Calendar →</span>
            </div>
            <div className="card-body flush">
              {upcoming.slice(0,4).map(e=>{
                const meta = window.DS.catMeta()[e.cat] || { color:'#475569', bg:'#F1F5F9', dot:'#64748B' };
                return (
                  <div className="up-ev" key={e.id} onClick={()=>go&&go('events')}>
                    <span className="up-dot" style={{background:meta.dot}}></span>
                    <span className="up-title">{e.title}</span>
                    <span className="up-date">{fmtShort(e.date)}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* quick actions */}
          <div className="card">
            <div className="card-head"><h3>Quick actions</h3></div>
            <div className="card-body">
              <div className="qa-grid">
                {QUICK.map(q=>(
                  <button className="qa-btn" key={q.to} onClick={()=>go&&go(q.to)}>{window.I[q.icon]({style:{width:15,height:15}})}<span>{q.label}</span></button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Inventory ── */
function Inventory({ user, period, connected, invState, onSync, onOpenSetup }){
  const lvl = ROLE_LVL(user.role);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');

  const live = connected && invState.inv;
  let rows, cats;
  if(live){
    rows = window.invToList(invState.inv).map(it=>({
      sku:it.sku, desc:it.desc, cat:it.cat, price:it.price||0,
      onHand:it.onHand||0, par:it.par||0,
      status:((it.onHand||0)<(it.par||0)&&(it.par||0)>0)?'low':'ok',
      value:window.iTotal(it),
    }));
    cats = [...new Set(rows.map(r=>r.cat))];
  }else{
    rows = window.INVENTORY_SAMPLE.map(r=>({ ...r, value:r.price*r.onHand }));
    cats = [...new Set(rows.map(r=>r.cat))];
  }
  const filtered = rows.filter(r=>
    (!cat || r.cat===cat) &&
    (!q || (r.desc||'').toLowerCase().includes(q.toLowerCase()) || String(r.sku||'').includes(q)));

  return (
    <div className="fade-in">
      <div className="page-head">
        <div>
          <h2>Inventory</h2>
          <div className="ph-sub">
            {window.MONTHS[period[0]]} {period[1]} · {filtered.length} of {rows.length} items{live?' · live':' · demo'}
          </div>
        </div>
        <div className="ph-actions">
          <button className="btn">{window.I.scan()} Scan</button>
          {connected && <button className="btn" onClick={onSync}>{window.I.refresh()} Refresh</button>}
          {lvl>=30 && <button className="btn primary">{window.I.plus()} Add item</button>}
        </div>
      </div>

      {!connected && <ConnectBanner onOpen={onOpenSetup}/>}
      {connected && invState.loading && <Loading/>}
      {connected && invState.error && invState.error!=='empty' &&
        <div className="banner warn">{window.I.alert()}<span>Couldn’t load live data: {invState.error}</span><span className="bx" onClick={onSync}>Retry</span></div>}

      {(!connected || invState.inv) && (
        <div className="card">
          <div className="card-head" style={{gap:10,flexWrap:'wrap'}}>
            <div style={{position:'relative',flex:1,minWidth:200,maxWidth:340}}>
              <span style={{position:'absolute',left:11,top:8,color:'var(--faint)'}}>{window.I.search({style:{width:16,height:16}})}</span>
              <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search SKU or description…"
                style={{width:'100%',padding:'8px 12px 8px 34px',border:'1px solid var(--line)',borderRadius:8,fontSize:12.5}}/>
            </div>
            <select className="btn" value={cat} onChange={e=>setCat(e.target.value)} style={{paddingRight:8}}>
              <option value="">All categories</option>
              {cats.map(c=><option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="card-body flush tbl-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>SKU</th><th>Description</th><th>Category</th>
                  <th className="r">Unit Price</th><th className="r">On Hand</th><th className="r">Par</th>
                  <th>Status</th><th className="r">Value</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r,i)=>(
                  <tr key={(r.sku||'')+i}>
                    <td className="num" style={{color:'var(--muted)'}}>{r.sku||'—'}</td>
                    <td style={{fontWeight:600}}>{r.desc}</td>
                    <td><span style={{display:'inline-flex',alignItems:'center',gap:6}}>
                      <span style={{width:8,height:8,borderRadius:2,background:window.catColor(r.cat)}}></span>{r.cat}</span></td>
                    <td className="r num">${(r.price||0).toFixed(2)}</td>
                    <td className="r num">{r.onHand}</td>
                    <td className="r num" style={{color:'var(--faint)'}}>{r.par}</td>
                    <td>{r.status==='low' ? <span className="pill warn">Below par</span> : <span className="pill ok">In stock</span>}</td>
                    <td className="r num">{window.fmtMoneyFull(r.value)}</td>
                  </tr>
                ))}
                {!filtered.length && <tr><td colSpan="8" style={{textAlign:'center',padding:30,color:'var(--faint)'}}>No items match your filters.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Users (admin only) ── */
function Users({ connected, onOpenSetup }){
  const [state, setState] = useState({ loading:connected, users:null, error:null });
  useEffect(()=>{
    let alive=true;
    if(!connected){ setState({ loading:false, users:window.USERS, error:null }); return; }
    (async()=>{
      setState({ loading:true, users:null, error:null });
      const res = await window.fetchProfiles();
      if(!alive) return;
      if(res.ok) setState({ loading:false, users:res.users, error:null });
      else setState({ loading:false, users:null, error:res.error });
    })();
    return ()=>{ alive=false; };
  }, [connected]);

  const users = state.users || [];
  return (
    <div className="fade-in">
      <div className="page-head">
        <div>
          <h2>Users &amp; Access</h2>
          <div className="ph-sub">{users.length} accounts · role-based access control{connected?' · live':' · demo'}</div>
        </div>
        <div className="ph-actions"><button className="btn primary">{window.I.plus()} Invite user</button></div>
      </div>

      {!connected && <ConnectBanner onOpen={onOpenSetup}/>}
      {state.loading && <Loading label="Loading directory…"/>}
      {state.error && <div className="banner warn">{window.I.alert()}<span>Couldn’t load users: {state.error}</span></div>}

      {!state.loading && !state.error && (
        <div className="card">
          <div className="card-body flush tbl-wrap">
            <table className="data">
              <thead><tr><th>User</th><th>Username</th><th>Role</th><th>Auth method</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {users.map(u=>(
                  <tr key={u.id||u.username}>
                    <td><div className="user-cell"><div className="avatar">{initials(u)}</div><div><div style={{fontWeight:700}}>{u.display_name} {u.last_name||''}</div><div style={{fontSize:11,color:'var(--faint)'}}>{u.username}@mjc-cafeteria.com</div></div></div></td>
                    <td className="num" style={{color:'var(--muted)'}}>{u.username}</td>
                    <td><span className={'pill role-'+u.role}>{window.ROLE_LABEL[u.role]||u.role}</span></td>
                    <td style={{color:'var(--muted)'}}>{u.role==='staff'?'4-digit PIN':'Password'}</td>
                    <td>{u.active?<span className="pill ok">Active</span>:<span className="pill off">Disabled</span>}</td>
                    <td style={{display:'flex',gap:6}}>
                      <button className="btn" style={{padding:'5px 9px'}}>{window.I.edit({style:{width:14,height:14}})}</button>
                      <button className="btn" style={{padding:'5px 9px',color:'var(--red)'}}>{window.I.del({style:{width:14,height:14}})}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Placeholder modules ── */
const PAGE_INFO = {
  menu:       { icon:'calendar', title:'28-Day Cycle Menu', sub:'Plan the rotating cycle menu, map recipes to inventory items, and forecast quantities against on-hand counts.', feats:['28-day rotation','Recipe → SKU mapping','Quantity forecasting','Nutrition / HACCP notes'] },
  barcodes:   { icon:'qr', title:'Barcodes & Scan', sub:'Generate CODE128 / QR labels and run mobile scan sessions to update on-hand counts in real time.', feats:['Bulk label export','Camera scan sessions','Auto on-hand sync','Print sheets'] },
  sourcectrl: { icon:'branch', title:'Source Control', sub:'Every inventory change is staged, reviewed, and committed — with full history and one-click revert.', feats:['Staged commits','Diff & review','Change history','Revert to commit'] },
  archives:   { icon:'archive', title:'Archives', sub:'Monthly snapshots, vendor invoices, and exported reports — retained and searchable.', feats:['Monthly snapshots','Invoice archive','Report exports','Audit trail'] },
  settings:   { icon:'settings', title:'Settings', sub:'Configure the data source, AI invoice parsing, and platform preferences.', feats:['Supabase connection','AI provider & model','Org preferences','API keys'] },
};
function Placeholder({ pageKey, onOpenSetup }){
  const p = PAGE_INFO[pageKey] || { icon:'grid', title:'Page', sub:'', feats:[] };
  return (
    <div className="fade-in">
      <div className="page-head"><div><h2>{p.title}</h2><div className="ph-sub">Module preview</div></div></div>
      <div className="placeholder">
        <div className="pic">{window.I[p.icon]()}</div>
        <h3>{p.title}</h3>
        <p>{p.sub}</p>
        <div className="feature-list">
          {p.feats.map((f,i)=>(<div className="fl" key={i}>{window.I.checkCircle()} {f}</div>))}
        </div>
        {pageKey==='settings' && <div style={{marginTop:22}}><button className="btn primary" onClick={onOpenSetup}>{window.I.database({style:{width:15,height:15}})} Manage data source</button></div>}
      </div>
    </div>
  );
}

/* ── Archives — monthly snapshots ── */
function Archives({ period }){
  const arch = window.DEMO_ARCHIVES || [];
  return (
    <div className="fade-in">
      <div className="page-head">
        <div><h2>Archives</h2><div className="ph-sub">Monthly inventory snapshots · retained for audit</div></div>
        <div className="ph-actions"><button className="btn">{window.I.download()} Export all</button></div>
      </div>
      <div className="stat-grid">
        {arch.slice(0,4).map(a=>(
          <div className="stat-card" key={a.period}>
            <div className="sc-top">
              <div className="sc-ic" style={{background: a.status==='live'?'#F0FDF4':'#EEF2F8', color:a.status==='live'?'#059669':'#1B3A6B'}}>{window.I.archive()}</div>
              {a.status==='live' && <span className="pill ok">Live</span>}
            </div>
            <div className="sc-lbl">{a.label}</div>
            <div className="sc-val">{window.fmtMoney(a.value)}</div>
            <div className="sc-delta eq" style={{marginTop:4}}>{a.items} items · {a.low} below par</div>
          </div>
        ))}
      </div>
      <div className="card">
        <div className="card-head"><h3>All snapshots</h3></div>
        <div className="card-body flush tbl-wrap">
          <table className="data">
            <thead><tr><th>Period</th><th className="r">On-Hand Value</th><th className="r">Line Items</th><th className="r">Below Par</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {arch.map(a=>(
                <tr key={a.period}>
                  <td style={{fontWeight:700}}>{a.label}</td>
                  <td className="r num">{window.fmtMoneyFull(a.value)}</td>
                  <td className="r num">{a.items}</td>
                  <td className="r num" style={{color:a.low?'var(--amber)':'var(--green)'}}>{a.low}</td>
                  <td>{a.status==='live'?<span className="pill ok">Live</span>:<span className="pill off">Archived</span>}</td>
                  <td className="r"><button className="btn" style={{padding:'5px 11px'}}>{window.I.download({style:{width:14,height:14}})} CSV</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ── Portal root ── */
function Portal({ user, onLogout, density='comfortable' }){
  const lvl = ROLE_LVL(user.role);
  const [active, setActive] = useState('dashboard');
  const [period, setPeriod] = useState([4, 2026]);
  const [connected, setConnected] = useState(window.isConnected());
  const [showSetup, setShowSetup] = useState(false);
  const [invState, reloadInv] = useInventory(connected);
  const [stagedCount, setStagedCount] = useState(window.DS.staged().length);

  useEffect(()=>{ window.__logout = onLogout; }, [onLogout]);

  const navItem = window.NAV.flatMap(g=>g.items).find(it=>it.key===active);
  useEffect(()=>{ if(navItem && lvl < navItem.min) setActive('dashboard'); }, [active]);

  function onConnSaved(){
    const c = window.isConnected();
    setConnected(c);
    if(c){ toast('Connected to Supabase'); setTimeout(reloadInv, 60); }
    else toast('Disconnected — demo mode');
  }
  function doSync(){ reloadInv(); toast('Refreshing live data…'); }

  const reorderCount = (connected && invState.inv) ? window.reorders(invState.inv).length : 0;
  const syncState = invState.loading?'loading':(invState.error&&invState.error!=='empty'?'error':'ok');

  const common = { user, period, connected, invState, onSync:doSync, onOpenSetup:()=>setShowSetup(true), go:setActive };
  let page;
  if(active==='dashboard') page = <Dashboard {...common}/>;
  else if(active==='inventory') page = <window.InventorySheet {...common}/>;
  else if(active==='moninv' && lvl>=20) page = <window.MonthlyInventory user={user} period={period} connected={connected}/>;
  else if(active==='menu' && lvl>=20) page = <window.CycleMenu user={user} period={period}/>;
  else if(active==='events') page = <window.EventsCalendar user={user} period={period}/>;
  else if(active==='haccp') page = <window.ComplianceHub user={user} connected={connected}/>;
  else if(active==='dailyops') page = <window.DailyOps user={user} connected={connected}/>;
  else if(active==='inspection') page = <window.InspectionSheet user={user} connected={connected}/>;
  else if(active==='snackbar') page = <window.SnackBar user={user} connected={connected}/>;
  else if(active==='mballot') page = <window.MealLog user={user} connected={connected}/>;
  else if(active==='foodreq') page = <window.FoodRequest user={user} connected={connected}/>;
  else if(active==='sourcectrl') page = <window.SourceControl user={user} connected={connected} onCountChange={setStagedCount}/>;
  else if(active==='reports' && lvl>=30) page = <window.Reports user={user} period={period} connected={connected} invState={invState}/>;
  else if(active==='archives' && lvl>=20) page = <Archives period={period}/>;
  else if(active==='users' && lvl>=40) page = <Users connected={connected} onOpenSetup={()=>setShowSetup(true)}/>;
  else page = <Placeholder pageKey={active} onOpenSetup={()=>setShowSetup(true)}/>;

  return (
    <div className="portal" data-density={density}>
      <Topbar user={user} period={period} setPeriod={setPeriod} connected={connected}
        syncState={syncState} onSync={doSync} onOpenSetup={()=>setShowSetup(true)}/>
      <Sidebar user={user} active={active} setActive={setActive} reorderCount={reorderCount} stagedCount={stagedCount}/>
      <main className="main">{page}</main>
      {showSetup && <window.SupaSetupModal onClose={()=>setShowSetup(false)} onSaved={onConnSaved}/>}
    </div>
  );
}

window.Portal = Portal;
window.toast = toast;
window.Loading = Loading;
window.ConnectBanner = ConnectBanner;
