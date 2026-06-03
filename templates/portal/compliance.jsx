/* ══════════════════════════════════════════════════════════════
   Compliance & HACCP hub — faithful digital versions of the MJCC
   paper forms. Tabs: Temperature Log · Sanitizer · Machine ·
   Cooling & Reheating · Taste Panel. Persists per form+appliance+month
   via window.saveLog/loadLog (localStorage + optional Supabase).
═══════════════════════════════════════════════════════════════ */

const APPLIANCES = [
  { id:'walkin-cooler',    name:'Walk-in Cooler',            type:'refrigerator' },
  { id:'reach-in-1',       name:'Reach-in Refrigerator #1',  type:'refrigerator' },
  { id:'milk-cooler',      name:'Milk Cooler',               type:'refrigerator' },
  { id:'walkin-freezer',   name:'Walk-in Freezer',           type:'freezer' },
  { id:'reach-in-freezer', name:'Reach-in Freezer #1',       type:'freezer' },
];
const HACCP_TABS = [
  { key:'temp',     label:'Temperature Log', icon:'thermo' },
  { key:'sanit',    label:'Sanitizer Log',   icon:'droplet' },
  { key:'machine',  label:'Machine Temp',    icon:'settings' },
  { key:'cooling',  label:'Cooling & Reheat',icon:'snow' },
  { key:'taste',    label:'Taste Panel',     icon:'flame' },
];
const DOW = ['Su','Mo','Tu','We','Th','Fr','Sa'];

/* shared persistence hook */
function useLog(key, initial){
  const [data, setData] = React.useState(()=> window.loadLog(key, null) ?? initial);
  const [saved, setSaved] = React.useState(true);
  const [savedAt, setSavedAt] = React.useState(null);
  const initialRef = React.useRef(initial);
  React.useEffect(()=>{
    setData(window.loadLog(key, null) ?? initialRef.current); setSaved(true);
    let alive=true;
    window.fetchLog(key).then(r=>{ if(alive && r && r.data){ setData(r.data); } });
    return ()=>{ alive=false; };
  // eslint-disable-next-line
  }, [key]);
  const update = (u)=>{ setData(d=> typeof u==='function'? u(d): u); setSaved(false); };
  const save = async (user)=>{ const r= await window.saveLog(key, data, user); setSaved(true); setSavedAt(new Date()); return r; };
  return { data, update, saved, save, savedAt };
}

/* save bar shared by every form */
function SaveBar({ saved, savedAt, onSave, canEdit, connected, note }){
  return (
    <div className="formbar">
      <div className="formbar-l">
        {note}
        {!saved && canEdit && <span className="dirty-chip">{window.I.alert({style:{width:12,height:12}})} Unsaved</span>}
        {saved && savedAt && <span className="saved-chip">{window.I.check({style:{width:12,height:12}})} Saved {savedAt.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</span>}
      </div>
      {canEdit && <button className="btn primary" onClick={onSave} disabled={saved}>
        {window.I.save({style:{width:15,height:15}})} {connected?'Save to Supabase':'Save log'}</button>}
    </div>
  );
}

function MonthNav({ period, setPeriod }){
  const [m,y]=period;
  function shift(d){ let nm=m+d, ny=y; if(nm<0){nm=11;ny--;} if(nm>11){nm=0;ny++;} setPeriod([nm,ny]); }
  return (
    <div className="monthnav">
      <button className="btn" onClick={()=>shift(-1)}>{window.I.chevL({style:{width:15,height:15}})}</button>
      <span className="mn-label">{window.MONTHS[m]} {y}</span>
      <button className="btn" onClick={()=>shift(1)}>{window.I.chevR({style:{width:15,height:15}})}</button>
    </div>
  );
}

function daysInMonth(m,y){ return new Date(y, m+1, 0).getDate(); }

/* ── Temperature Log (refrigerator / freezer) ── */
function TemperatureLog({ user, period, setPeriod, connected, canEdit }){
  const [appId, setAppId] = React.useState(APPLIANCES[0].id);
  const app = APPLIANCES.find(a=>a.id===appId);
  const limit = app.type==='freezer' ? 0 : 41;
  const [m,y]=period;
  const key = `temp:${appId}:${y}-${m}`;
  const ndays = daysInMonth(m,y);
  const blank = ()=>({ rows:{} });
  const { data, update, saved, save, savedAt } = useLog(key, blank());
  const rows = data.rows||{};

  function setCell(day, field, val){
    update(d=>({ ...d, rows:{ ...d.rows, [day]:{ ...(d.rows?.[day]||{}), [field]:val } } }));
  }
  function flag(v){ const n=parseFloat(v); return !isNaN(n) && n>limit; }
  const violations = Object.values(rows).filter(r=>flag(r.am)||flag(r.pm)).length;

  return (
    <div>
      <div className="form-toolbar">
        <div className="ft-l">
          <label className="ft-field">
            <span>Appliance</span>
            <select className="ipt sel" value={appId} onChange={e=>setAppId(e.target.value)}>
              {APPLIANCES.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <span className={'thresh-chip '+(app.type==='freezer'?'frz':'rfg')}>
            {app.type==='freezer'?window.I.snow({style:{width:13,height:13}}):window.I.thermo({style:{width:13,height:13}})}
            {app.type==='freezer'?'Freezer · 0°F or lower':'Refrigerator · 41°F or lower'}
          </span>
        </div>
        <MonthNav period={period} setPeriod={setPeriod}/>
      </div>

      <div className="form-note">
        Record temperatures <b>twice daily (AM / PM)</b> with staff initials. Notify management immediately if a refrigerator is above 41°F or a freezer is above 0°F. Keep on file for one year.
        {violations>0 && <span className="viol-pill">{window.I.alert({style:{width:13,height:13}})} {violations} out-of-range {violations===1?'day':'days'}</span>}
      </div>

      <div className="card" style={{marginBottom:14}}>
        <div className="tbl-wrap">
          <table className="data logtbl">
            <thead>
              <tr>
                <th style={{width:54}}>Day</th>
                <th className="r">Temp AM</th><th style={{width:70}}>Init</th>
                <th className="r">Temp PM</th><th style={{width:70}}>Init</th>
                <th>Action / comment (date reported)</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({length:ndays}, (_,i)=>i+1).map(day=>{
                const r=rows[day]||{};
                const dow=DOW[new Date(y,m,day).getDay()];
                const amBad=flag(r.am), pmBad=flag(r.pm);
                return (
                  <tr key={day} className={(amBad||pmBad)?'row-low':''}>
                    <td className="num daycell"><b>{day}</b> <span className="dow">{dow}</span></td>
                    <td className="r">{tempCell(r.am, v=>setCell(day,'am',v), amBad, canEdit)}</td>
                    <td>{textCell(r.ami, v=>setCell(day,'ami',v), canEdit, 'init')}</td>
                    <td className="r">{tempCell(r.pm, v=>setCell(day,'pm',v), pmBad, canEdit)}</td>
                    <td>{textCell(r.pmi, v=>setCell(day,'pmi',v), canEdit, 'init')}</td>
                    <td>{textCell(r.note, v=>setCell(day,'note',v), canEdit, 'note', amBad||pmBad?'Out-of-compliance — record corrective action':'')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <SaveBar saved={saved} savedAt={savedAt} onSave={()=>save(user.display_name)} canEdit={canEdit} connected={connected}
        note={<span className="formbar-meta">{app.name} · {window.MONTHS[m]} {y}</span>}/>
    </div>
  );
}

/* ── Sanitizer Solution Log ── */
function SanitizerLog({ user, period, setPeriod, connected, canEdit }){
  const [m,y]=period;
  const key=`sanit:${y}-${m}`;
  const ndays=daysInMonth(m,y);
  const { data, update, saved, save, savedAt } = useLog(key, { rows:{}, conc:'Oasis 146' });
  const rows=data.rows||{};
  function setCell(day, field, val){ update(d=>({ ...d, rows:{ ...d.rows, [day]:{ ...(d.rows?.[day]||{}), [field]:val } } })); }
  function flagPpm(v){ if(v==null||v==='')return false; const n=parseFloat(v); return isNaN(n)||n<150||n>400; }
  const viol = Object.values(rows).filter(r=>flagPpm(r.am)||flagPpm(r.pm)).length;

  return (
    <div>
      <div className="form-toolbar">
        <div className="ft-l">
          <span className="thresh-chip rfg">{window.I.droplet({style:{width:13,height:13}})} {data.conc}: 150–400 ppm</span>
        </div>
        <MonthNav period={period} setPeriod={setPeriod}/>
      </div>
      <div className="form-note">
        Complete <b>twice daily</b> (AM / PM) for sample testing — a single prep site (e.g. third-compartment pot sink) is recommended. One form per month.
        {viol>0 && <span className="viol-pill">{window.I.alert({style:{width:13,height:13}})} {viol} out-of-range</span>}
      </div>
      <div className="card" style={{marginBottom:14}}>
        <div className="tbl-wrap">
          <table className="data logtbl">
            <thead>
              <tr><th style={{width:54}}>Date</th><th>Area / corrective action</th>
                <th className="r" style={{width:84}}>AM ppm</th><th style={{width:70}}>Init</th>
                <th className="r" style={{width:84}}>PM ppm</th><th style={{width:70}}>Init</th></tr>
            </thead>
            <tbody>
              {Array.from({length:ndays},(_,i)=>i+1).map(day=>{
                const r=rows[day]||{}; const amBad=flagPpm(r.am), pmBad=flagPpm(r.pm);
                return (
                  <tr key={day} className={(amBad||pmBad)?'row-low':''}>
                    <td className="num"><b>{day}</b></td>
                    <td>{textCell(r.area, v=>setCell(day,'area',v), canEdit, 'note')}</td>
                    <td className="r">{tempCell(r.am, v=>setCell(day,'am',v), amBad, canEdit)}</td>
                    <td>{textCell(r.ami, v=>setCell(day,'ami',v), canEdit, 'init')}</td>
                    <td className="r">{tempCell(r.pm, v=>setCell(day,'pm',v), pmBad, canEdit)}</td>
                    <td>{textCell(r.pmi, v=>setCell(day,'pmi',v), canEdit, 'init')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <SaveBar saved={saved} savedAt={savedAt} onSave={()=>save(user.display_name)} canEdit={canEdit} connected={connected}
        note={<span className="formbar-meta">Sanitizer · {window.MONTHS[m]} {y}</span>}/>
    </div>
  );
}

/* ── Taste Panel + cooking-temp reference ── */
function TastePanel({ user, period, connected, canEdit }){
  const [m,y]=period;
  const today=new Date().toISOString().slice(0,10);
  const key=`taste:${today}`;
  const { data, update, saved, save, savedAt } = useLog(key, { items:[ blankTaste() ] });
  function blankTaste(){ return { id:'t'+Math.random().toString(36).slice(2,7), product:'', temp:'', code:'', notes:'' }; }
  const items=data.items||[];
  function setItem(id, field, val){ update(d=>({ ...d, items:d.items.map(it=>it.id===id?{...it,[field]:val}:it) })); }
  function addItem(){ update(d=>({ ...d, items:[...d.items, blankTaste()] })); }
  function delItem(id){ update(d=>({ ...d, items:d.items.filter(it=>it.id!==id) })); }

  return (
    <div>
      <div className="grid-2" style={{gridTemplateColumns:'1.4fr 1fr',marginBottom:14}}>
        <div className="card">
          <div className="card-head"><h3>Minimum internal cooking temperatures</h3></div>
          <div className="card-body flush tbl-wrap">
            <table className="data">
              <thead><tr><th>Temp</th><th>Hold</th><th>Foods</th></tr></thead>
              <tbody>
                {window.COOKING_TEMPS.map((t,i)=>(
                  <tr key={i}><td className="num" style={{fontWeight:800,color:'var(--red)',whiteSpace:'nowrap'}}>{t.temp}</td>
                  <td className="num" style={{whiteSpace:'nowrap'}}>{t.hold}</td><td style={{fontSize:11.5}}>{t.foods}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h3>Taste panel evaluation codes</h3></div>
          <div className="card-body" style={{display:'flex',flexDirection:'column',gap:9}}>
            {window.TASTE_CODES.map(c=>(
              <div key={c.code} className="tastecode" style={{background:c.bg}}>
                <span className="tc-badge" style={{background:c.tint}}>{c.code}</span>
                <span style={{color:c.tint,fontWeight:700,fontSize:12.5}}>{c.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card" style={{marginBottom:14}}>
        <div className="card-head"><h3>Today’s taste panel — {new Date().toLocaleDateString()}</h3>
          {canEdit && <button className="btn-addrow" onClick={addItem}>{window.I.plus({style:{width:13,height:13}})} Add item</button>}</div>
        <div className="card-body flush tbl-wrap">
          <table className="data logtbl">
            <thead><tr><th>Menu item</th><th className="r" style={{width:96}}>Internal °F</th><th style={{width:120}}>Code</th><th>Notes</th>{canEdit&&<th></th>}</tr></thead>
            <tbody>
              {items.map(it=>(
                <tr key={it.id}>
                  <td>{textCell(it.product, v=>setItem(it.id,'product',v), canEdit, 'note', 'e.g. Baked Chicken')}</td>
                  <td className="r">{tempCell(it.temp, v=>setItem(it.id,'temp',v), false, canEdit)}</td>
                  <td>{canEdit
                    ? <select className="ipt sel sm" value={it.code} onChange={e=>setItem(it.id,'code',e.target.value)}>
                        <option value="">—</option>{window.TASTE_CODES.map(c=><option key={c.code} value={c.code}>{c.code} · {c.label.split(' —')[0]}</option>)}
                      </select>
                    : <span>{it.code}</span>}</td>
                  <td>{textCell(it.notes, v=>setItem(it.id,'notes',v), canEdit, 'note')}</td>
                  {canEdit&&<td><button className="row-del" onClick={()=>delItem(it.id)}>{window.I.del({style:{width:14,height:14}})}</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <SaveBar saved={saved} savedAt={savedAt} onSave={()=>save(user.display_name)} canEdit={canEdit} connected={connected}
        note={<span className="formbar-meta">Taste panel · {new Date().toLocaleDateString()}</span>}/>
    </div>
  );
}

/* ── shared cell renderers ── */
function tempCell(val, onChange, bad, canEdit){
  if(!canEdit) return <span className="num" style={{color:bad?'var(--red)':'inherit',fontWeight:bad?800:400}}>{val||'—'}</span>;
  return <input className={'sheet-inp'+(bad?' bad':'')} style={{width:60}} type="number" step="0.1"
    value={val??''} onChange={e=>onChange(e.target.value)} />;
}
function textCell(val, onChange, canEdit, kind, ph=''){
  const w = kind==='init'?60: undefined;
  if(!canEdit) return <span style={{fontSize:kind==='note'?11.5:12}}>{val||(kind==='init'?'':'—')}</span>;
  return <input className={'sheet-inp txt'+(kind==='init'?' initc':'')} style={w?{width:w}:{width:'100%',minWidth:kind==='note'?160:90}}
    value={val??''} placeholder={ph} onChange={e=>onChange(e.target.value)} />;
}

/* ── Hub wrapper ── */
function ComplianceHub({ user, connected }){
  const lvl = window.ROLE_LEVEL[user.role]||0;
  const canEdit = lvl>=10;             // staff can record logs
  const [tab, setTab] = React.useState('temp');
  const [period, setPeriod] = React.useState(()=>{ const d=new Date(); return [d.getMonth(), d.getFullYear()]; });

  let body;
  const props={ user, period, setPeriod, connected, canEdit };
  if(tab==='temp') body=<TemperatureLog {...props}/>;
  else if(tab==='sanit') body=<SanitizerLog {...props}/>;
  else if(tab==='machine') body=<window.MachineLog {...props}/>;
  else if(tab==='cooling') body=<window.CoolingLog {...props}/>;
  else body=<TastePanel {...props}/>;

  return (
    <div className="fade-in">
      <div className="page-head">
        <div>
          <h2>Compliance &amp; HACCP Logs</h2>
          <div className="ph-sub">Digital temperature, sanitation and food-safety records{connected?' · synced':' · saved on device'}</div>
        </div>
      </div>
      <div className="subtabs">
        {HACCP_TABS.map(t=>(
          <button key={t.key} className="subtab" data-on={tab===t.key} onClick={()=>setTab(t.key)}>
            {window.I[t.icon]({style:{width:15,height:15}})}<span>{t.label}</span>
          </button>
        ))}
      </div>
      {body}
    </div>
  );
}

Object.assign(window, { ComplianceHub, useLog:useLog, SaveBar, MonthNav, daysInMonth, tempCell, textCell });
