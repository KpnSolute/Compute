/* ══════════════════════════════════════════════════════════════
   Food-service forms — Machine Temp Log, Cooling & Reheating,
   Daily Meal Log, Inspection Sheet, Food Request. All persist via
   window.saveLog/loadLog (localStorage + optional Supabase).
═══════════════════════════════════════════════════════════════ */

const MACHINES = [
  { id:'hobart-am15', name:'Hobart AM-15 (High-Temp)', type:'high' },
  { id:'jackson-low', name:'Jackson Avenger (Low-Temp)', type:'low' },
];
const MEAL_PERIODS = ['B','L','D'];

/* ── Machine (dish/ware-washing) Temperature Log ── */
function MachineLog({ user, period, setPeriod, connected, canEdit }){
  const [mid,setMid]=React.useState(MACHINES[0].id);
  const machine=MACHINES.find(x=>x.id===mid);
  const [m,y]=period;
  const key=`machine:${mid}:${y}-${m}`;
  const { data, update, saved, save, savedAt } = window.useLog(key, { rows:[ blankRow() ] });
  function blankRow(){ return { id:'m'+Math.random().toString(36).slice(2,7), date:'', time:'', meal:'', wash:'', rinse:'', psi:'', final:'', ppm:'', init:'' }; }
  const rows=data.rows||[];
  function setR(id,f,v){ update(d=>({ ...d, rows:d.rows.map(r=>r.id===id?{...r,[f]:v}:r) })); }
  function add(){ update(d=>({ ...d, rows:[...d.rows, blankRow()] })); }
  function del(id){ update(d=>({ ...d, rows:d.rows.filter(r=>r.id!==id) })); }

  return (
    <div>
      <div className="form-toolbar">
        <div className="ft-l">
          <label className="ft-field"><span>Machine</span>
            <select className="ipt sel" value={mid} onChange={e=>setMid(e.target.value)}>
              {MACHINES.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}
            </select></label>
          <span className={'thresh-chip '+(machine.type==='high'?'rfg':'frz')}>
            {machine.type==='high'?'High-temp · see data plate':'Low-temp · chemical sanitizer 50–100 ppm'} · Flow 15–25 psi
          </span>
        </div>
        <window.MonthNav period={period} setPeriod={setPeriod}/>
      </div>
      <div className="form-note">Record temperatures, flow pressure {machine.type==='low'?'and ppm ':''}once during each meal period. Use a separate log per machine; keep on file for one year.</div>
      <div className="card" style={{marginBottom:14}}>
        <div className="tbl-wrap">
          <table className="data logtbl">
            <thead><tr>
              <th style={{width:120}}>Date</th><th style={{width:84}}>Time</th><th>Meal</th>
              <th className="r">Wash °F</th><th className="r">Rinse °F</th><th className="r">PSI</th>
              <th className="r">Final °F</th><th className="r">Sanitizer ppm</th><th style={{width:70}}>Init</th>{canEdit&&<th></th>}
            </tr></thead>
            <tbody>
              {rows.map(r=>(
                <tr key={r.id}>
                  <td>{dateCell(r.date,v=>setR(r.id,'date',v),canEdit)}</td>
                  <td>{timeCell(r.time,v=>setR(r.id,'time',v),canEdit)}</td>
                  <td>{mealToggle(r.meal,v=>setR(r.id,'meal',v),canEdit)}</td>
                  <td className="r">{window.tempCell(r.wash,v=>setR(r.id,'wash',v),false,canEdit)}</td>
                  <td className="r">{window.tempCell(r.rinse,v=>setR(r.id,'rinse',v),false,canEdit)}</td>
                  <td className="r">{window.tempCell(r.psi,v=>setR(r.id,'psi',v),false,canEdit)}</td>
                  <td className="r">{window.tempCell(r.final,v=>setR(r.id,'final',v),false,canEdit)}</td>
                  <td className="r">{machine.type==='low'?window.tempCell(r.ppm,v=>setR(r.id,'ppm',v),false,canEdit):<span style={{color:'var(--faint)'}}>—</span>}</td>
                  <td>{window.textCell(r.init,v=>setR(r.id,'init',v),canEdit,'init')}</td>
                  {canEdit&&<td><button className="row-del" onClick={()=>del(r.id)}>{window.I.del({style:{width:14,height:14}})}</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {canEdit && <div style={{padding:'10px 14px'}}><button className="btn-addrow" onClick={add}>{window.I.plus({style:{width:13,height:13}})} Add reading</button></div>}
      </div>
      <window.SaveBar saved={saved} savedAt={savedAt} onSave={()=>save(user.display_name)} canEdit={canEdit} connected={connected}
        note={<span className="formbar-meta">{machine.name} · {window.MONTHS[m]} {y}</span>}/>
    </div>
  );
}

/* ── Cooling & Reheating Chart ── */
function CoolingLog({ user, period, setPeriod, connected, canEdit }){
  const [m,y]=period;
  const key=`cooling:${y}-${m}`;
  const { data, update, saved, save, savedAt } = window.useLog(key, { rows:[ blankRow() ] });
  function blankRow(){ return { id:'c'+Math.random().toString(36).slice(2,7), date:'', product:'', qty:'', init:'', start:'', t2:'', t6:'', rDate:'', rMeal:'', rStart:'', rFinal:'', rTemp:'' }; }
  const rows=data.rows||[];
  function setR(id,f,v){ update(d=>({ ...d, rows:d.rows.map(r=>r.id===id?{...r,[f]:v}:r) })); }
  function add(){ update(d=>({ ...d, rows:[...d.rows, blankRow()] })); }
  function del(id){ update(d=>({ ...d, rows:d.rows.filter(r=>r.id!==id) })); }

  return (
    <div>
      <div className="form-toolbar"><div className="ft-l"><span className="thresh-chip frz">{window.I.snow({style:{width:13,height:13}})} 140°F → 70°F ≤ 2h → 40°F ≤ 6h total · Reheat to 165°F ≤ 2h</span></div>
        <window.MonthNav period={period} setPeriod={setPeriod}/></div>
      <div className="form-note">Time/temperature log for potentially hazardous foods. Cool from 140°F to 70°F within 2 hours, then to 40°F within an additional 4 hours. Reheat for hot holding rapidly to 165°F for 15 seconds.</div>
      <div className="card" style={{marginBottom:14}}>
        <div className="tbl-wrap">
          <table className="data logtbl">
            <thead>
              <tr>
                <th rowSpan="2" style={{width:120}}>Date</th><th rowSpan="2">Product</th><th rowSpan="2" className="r">Qty</th><th rowSpan="2" style={{width:60}}>Init</th>
                <th colSpan="3" className="grp">Cooling</th>
                <th colSpan="4" className="grp rcv">Reheating</th>{canEdit&&<th rowSpan="2"></th>}
              </tr>
              <tr>
                <th>Start</th><th className="r">Temp @2h</th><th className="r">Final @6h</th>
                <th style={{width:110}}>Date</th><th>Meal</th><th>Start</th><th className="r">Internal °F</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r=>{
                const t6bad = r.t6!=='' && parseFloat(r.t6)>40;
                const t2bad = r.t2!=='' && parseFloat(r.t2)>70;
                return (
                <tr key={r.id}>
                  <td>{dateCell(r.date,v=>setR(r.id,'date',v),canEdit)}</td>
                  <td>{window.textCell(r.product,v=>setR(r.id,'product',v),canEdit,'note','Product')}</td>
                  <td className="r">{window.textCell(r.qty,v=>setR(r.id,'qty',v),canEdit,'init')}</td>
                  <td>{window.textCell(r.init,v=>setR(r.id,'init',v),canEdit,'init')}</td>
                  <td>{timeCell(r.start,v=>setR(r.id,'start',v),canEdit)}</td>
                  <td className="r">{window.tempCell(r.t2,v=>setR(r.id,'t2',v),t2bad,canEdit)}</td>
                  <td className="r rcv-cell">{window.tempCell(r.t6,v=>setR(r.id,'t6',v),t6bad,canEdit)}</td>
                  <td>{dateCell(r.rDate,v=>setR(r.id,'rDate',v),canEdit)}</td>
                  <td>{mealToggle(r.rMeal,v=>setR(r.id,'rMeal',v),canEdit)}</td>
                  <td>{timeCell(r.rStart,v=>setR(r.id,'rStart',v),canEdit)}</td>
                  <td className="r">{window.tempCell(r.rTemp,v=>setR(r.id,'rTemp',v), r.rTemp!==''&&parseFloat(r.rTemp)<165, canEdit)}</td>
                  {canEdit&&<td><button className="row-del" onClick={()=>del(r.id)}>{window.I.del({style:{width:14,height:14}})}</button></td>}
                </tr>
              );})}
            </tbody>
          </table>
        </div>
        {canEdit && <div style={{padding:'10px 14px'}}><button className="btn-addrow" onClick={add}>{window.I.plus({style:{width:13,height:13}})} Add product</button></div>}
      </div>
      <window.SaveBar saved={saved} savedAt={savedAt} onSave={()=>save(user.display_name)} canEdit={canEdit} connected={connected}
        note={<span className="formbar-meta">Cooling &amp; Reheating · {window.MONTHS[m]} {y}</span>}/>
    </div>
  );
}

/* ── Daily Staff / Visitor Meal Log ── */
function MealLog({ user, connected }){
  const lvl=window.ROLE_LEVEL[user.role]||0; const canEdit=lvl>=10;
  const [date,setDate]=React.useState(new Date().toISOString().slice(0,10));
  const key=`meallog:${date}`;
  const { data, update, saved, save, savedAt } = window.useLog(key, { rows:Array.from({length:6},()=>blankRow()), monitors:'', diners:'' });
  function blankRow(){ return { id:'r'+Math.random().toString(36).slice(2,7), name:'', sig:'', type:'Staff', B:false, L:false, D:false, ticket:'' }; }
  const rows=data.rows||[];
  function setR(id,f,v){ update(d=>({ ...d, rows:d.rows.map(r=>r.id===id?{...r,[f]:v}:r) })); }
  function add(){ update(d=>({ ...d, rows:[...d.rows, blankRow()] })); }
  function del(id){ update(d=>({ ...d, rows:d.rows.filter(r=>r.id!==id) })); }
  const counts = window.MEAL_COLS.reduce((a,c)=>{ a[c]=rows.filter(r=>r[c[0]]).length; return a; }, {});
  const mealTypes = window.DS.mealTypes();
  const paidSet = new Set(mealTypes.filter(t=>t.paid).map(t=>t.key));
  const signedRows = rows.filter(r=>r.B||r.L||r.D);
  const paidCount = signedRows.filter(r=>paidSet.has(r.type)).length;
  const compCount = signedRows.length - paidCount;

  return (
    <div className="fade-in">
      <div className="page-head">
        <div><h2>Daily Staff / Visitor Meal Log</h2>
          <div className="ph-sub">All staff and visitors must sign. Dining-hall monitors are not charged for the meal they monitor.</div></div>
        <div className="ph-actions">
          <label className="ft-field"><span>Date</span><input className="ipt sel" type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>
        </div>
      </div>
      <div className="meal-summary">
        {window.MEAL_COLS.map(c=>(<div className="ms-pill" key={c}><span className="ms-n">{counts[c]}</span><span className="ms-l">{c}</span></div>))}
        <div className="ms-pill total"><span className="ms-n">{signedRows.length}</span><span className="ms-l">Signed in</span></div>
        <div className="ms-pill"><span className="ms-n">{paidCount}</span><span className="ms-l">Paid tickets</span></div>
        <div className="ms-pill"><span className="ms-n">{compCount}</span><span className="ms-l">Complimentary</span></div>
      </div>
      <div className="card" style={{marginBottom:14}}>
        <div className="tbl-wrap">
          <table className="data logtbl">
            <thead><tr><th style={{width:34}}>#</th><th>Name (please print)</th><th style={{width:120}}>Signature / initials</th><th style={{width:104}}>Type</th>
              {window.MEAL_COLS.map(c=><th key={c} className="r" style={{width:78}}>{c}</th>)}
              <th style={{width:90}}>Ticket #</th>{canEdit&&<th></th>}</tr></thead>
            <tbody>
              {rows.map((r,i)=>(
                <tr key={r.id}>
                  <td className="num" style={{color:'var(--faint)'}}>{i+1}</td>
                  <td>{window.textCell(r.name,v=>setR(r.id,'name',v),canEdit,'note')}</td>
                  <td>{window.textCell(r.sig,v=>setR(r.id,'sig',v),canEdit,'init')}</td>
                  <td>{canEdit
                    ? <select className="ipt sel sm" style={{width:96}} value={r.type||'Staff'} onChange={e=>setR(r.id,'type',e.target.value)}>
                        {mealTypes.map(t=><option key={t.key} value={t.key}>{t.label}</option>)}
                      </select>
                    : <span className={'type-tag'+(paidSet.has(r.type)?' paid':' comp')}>{r.type||'—'}</span>}</td>
                  {window.MEAL_COLS.map(c=>(<td key={c} className="r">
                    {canEdit?<input type="checkbox" className="mealchk" checked={!!r[c[0]]} onChange={e=>setR(r.id,c[0],e.target.checked)}/>:(r[c[0]]?'✓':'')}
                  </td>))}
                  <td>{window.textCell(r.ticket,v=>setR(r.id,'ticket',v),canEdit,'init')}</td>
                  {canEdit&&<td><button className="row-del" onClick={()=>del(r.id)}>{window.I.del({style:{width:14,height:14}})}</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {canEdit && <div style={{padding:'10px 14px'}}><button className="btn-addrow" onClick={add}>{window.I.plus({style:{width:13,height:13}})} Add line</button></div>}
      </div>
      <div className="card" style={{marginBottom:14}}>
        <div className="card-body monitor-counts">
          <label className="ft-field"><span>Monitors used this meal</span><input className="ipt sel" type="number" min="0" value={data.monitors||''} disabled={!canEdit} onChange={e=>update(d=>({...d,monitors:e.target.value}))}/></label>
          <label className="ft-field"><span>Staff / visitors eating this meal</span><input className="ipt sel" type="number" min="0" value={data.diners||''} disabled={!canEdit} onChange={e=>update(d=>({...d,diners:e.target.value}))}/></label>
          <p className="mc-note">Count actual number of persons — do not count signatures. Monitors &amp; comp guests are recorded in the <b>Type</b> column and are not charged.</p>
        </div>
      </div>
      <window.SaveBar saved={saved} savedAt={savedAt} onSave={()=>save(user.display_name)} canEdit={canEdit} connected={connected}
        note={<span className="formbar-meta">Meal log · {new Date(date).toLocaleDateString()}</span>}/>
    </div>
  );
}

/* ── Food Services Inspection Sheet ── */
function InspectionSheet({ user, connected }){
  const lvl=window.ROLE_LEVEL[user.role]||0; const canEdit=lvl>=20;
  const today=new Date().toISOString().slice(0,10);
  const key=`inspection:${today}:${user.username}`;
  const { data, update, saved, save, savedAt } = window.useLog(key, { staff:(user.display_name+' '+user.last_name).trim(), date:today, meal:'', ratings:{}, comments:'' });
  const ratings=data.ratings||{};
  const RT=['GOOD','FAIR','POOR'];
  function setRating(i,v){ update(d=>({ ...d, ratings:{ ...d.ratings, [i]:v } })); }
  const done=Object.keys(ratings).length, total=window.INSPECTION_Q.length;
  const poor=Object.values(ratings).filter(v=>v==='POOR').length;

  return (
    <div className="fade-in">
      <div className="page-head">
        <div><h2>Food Services Inspection Sheet</h2><div className="ph-sub">Rate each category. Explain any poor rating below.</div></div>
        <div className="ph-actions"><span className="saved-chip">{done}/{total} rated</span>{poor>0&&<span className="viol-pill">{poor} poor</span>}</div>
      </div>
      <div className="card" style={{marginBottom:14}}>
        <div className="card-body insp-head">
          <label className="ft-field grow"><span>Staff name</span><input className="ipt sel" value={data.staff||''} disabled={!canEdit} onChange={e=>update(d=>({...d,staff:e.target.value}))}/></label>
          <label className="ft-field"><span>Date</span><input className="ipt sel" type="date" value={data.date||today} disabled={!canEdit} onChange={e=>update(d=>({...d,date:e.target.value}))}/></label>
          <label className="ft-field"><span>Meal</span>
            <select className="ipt sel" value={data.meal||''} disabled={!canEdit} onChange={e=>update(d=>({...d,meal:e.target.value}))}>
              <option value="">Select…</option>{['Breakfast','Lunch','Brunch','Dinner'].map(x=><option key={x}>{x}</option>)}
            </select></label>
        </div>
      </div>
      <div className="card" style={{marginBottom:14}}>
        <div className="card-body flush">
          {window.INSPECTION_Q.map((q,i)=>(
            <div className="insp-row" key={i}>
              <span className="insp-n">{i+1}</span>
              <span className="insp-q">{q}</span>
              <div className="rate-group">
                {RT.map(r=>(
                  <button key={r} className={'rate-btn r-'+r.toLowerCase()} data-on={ratings[i]===r} disabled={!canEdit} onClick={()=>setRating(i,r)}>{r}</button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="card" style={{marginBottom:14}}>
        <div className="card-head"><h3>Comments &amp; recommendations</h3></div>
        <div className="card-body">
          <textarea className="ipt" rows="4" style={{width:'100%',resize:'vertical'}} placeholder="Explain any poor rating or negative student response; suggestions for improvement…"
            value={data.comments||''} disabled={!canEdit} onChange={e=>update(d=>({...d,comments:e.target.value}))}></textarea>
        </div>
      </div>
      <window.SaveBar saved={saved} savedAt={savedAt} onSave={()=>save(user.display_name)} canEdit={canEdit} connected={connected}
        note={<span className="formbar-meta">Inspection · {new Date(data.date||today).toLocaleDateString()}</span>}/>
    </div>
  );
}

/* ── Food Request form ── */
function FoodRequest({ user, connected }){
  const lvl=window.ROLE_LEVEL[user.role]||0; const canEdit=lvl>=10;
  const id='fr'+Date.now();
  const [submitted,setSubmitted]=React.useState(false);
  const key=`foodreq:draft:${user.username}`;
  const { data, update, saved, save, savedAt } = window.useLog(key, { vals:{}, status:'draft' });
  const vals=data.vals||{};
  function setV(k,v){ update(d=>({ ...d, vals:{ ...d.vals, [k]:v } })); }

  return (
    <div className="fade-in">
      <div className="page-head">
        <div><h2>Food Request</h2><div className="ph-sub">Dining Hall / Culinary Arts support request</div></div>
      </div>
      <div className="banner info" style={{marginBottom:14}}>{window.I.alert()}<span>Submit at least <b>ten (10) days</b> before the event (two days for off-Center sack lunches) due to requisition &amp; procurement lead time.</span></div>
      <div className="card" style={{marginBottom:14}}>
        <div className="card-body">
          <div className="req-grid">
            {window.FOODREQ_FIELDS.map(f=>(
              <div key={f.k} className="req-field" style={{gridColumn:'span '+f.col}}>
                <label>{f.label}</label>
                {f.type==='textarea'
                  ? <textarea className="ipt" rows="2" value={vals[f.k]||''} disabled={!canEdit} onChange={e=>setV(f.k,e.target.value)}></textarea>
                  : <input className="ipt" type={f.type} value={vals[f.k]||''} disabled={!canEdit} onChange={e=>setV(f.k,e.target.value)}/>}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="card" style={{marginBottom:14}}>
        <div className="card-head"><h3>Approvals</h3></div>
        <div className="card-body approvals">
          <div className="appr-slot"><span className="appr-line"></span><span className="appr-lbl">Department Manager / Director</span></div>
          <div className="appr-slot"><span className="appr-line"></span><span className="appr-lbl">F&amp;A Director</span></div>
        </div>
      </div>
      <div className="formbar">
        <div className="formbar-l">
          {submitted ? <span className="saved-chip">{window.I.check({style:{width:12,height:12}})} Request submitted for approval</span>
            : (!saved && <span className="dirty-chip">{window.I.alert({style:{width:12,height:12}})} Unsaved draft</span>)}
          {saved && savedAt && !submitted && <span className="saved-chip">Draft saved {savedAt.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</span>}
        </div>
        {canEdit && <div style={{display:'flex',gap:9}}>
          <button className="btn" onClick={()=>save(user.display_name)} disabled={saved}>{window.I.save({style:{width:15,height:15}})} Save draft</button>
          <button className="btn primary" onClick={()=>{ save(user.display_name); setSubmitted(true); window.toast('Food request submitted'); }}>{window.I.inbox({style:{width:15,height:15}})} Submit request</button>
        </div>}
      </div>
    </div>
  );
}

/* ── small shared cells ── */
function dateCell(val,onChange,canEdit){
  if(!canEdit) return <span style={{fontSize:12}}>{val||'—'}</span>;
  return <input className="sheet-inp txt" type="date" style={{width:118}} value={val||''} onChange={e=>onChange(e.target.value)}/>;
}
function timeCell(val,onChange,canEdit){
  if(!canEdit) return <span style={{fontSize:12}}>{val||'—'}</span>;
  return <input className="sheet-inp txt" type="time" style={{width:84}} value={val||''} onChange={e=>onChange(e.target.value)}/>;
}
function mealToggle(val,onChange,canEdit){
  if(!canEdit) return <span>{val||'—'}</span>;
  return (
    <div className="meal-toggle">
      {MEAL_PERIODS.map(p=>(
        <button key={p} className="mt-btn" data-on={val===p} onClick={()=>onChange(val===p?'':p)}>{p}</button>
      ))}
    </div>
  );
}

Object.assign(window, { MachineLog, CoolingLog, MealLog, InspectionSheet, FoodRequest });
