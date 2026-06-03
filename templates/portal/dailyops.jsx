/* ══════════════════════════════════════════════════════════════
   Daily Operations — opening checklist, meal-period schedule with
   live status, and the incident log. Persists per day via
   window.useLog (localStorage + optional Supabase).
═══════════════════════════════════════════════════════════════ */

function DailyOps({ user, connected }){
  const lvl = window.ROLE_LEVEL[user.role]||0;
  const canEdit = lvl>=10;
  const [date, setDate] = React.useState(new Date().toISOString().slice(0,10));
  const key = `dailyops:${date}`;
  const { data, update, saved, save, savedAt } = window.useLog(key, {
    checks:{}, cycleDay:'1', notes:'', incidents:[],
  });

  const checklist = window.DS.openingChecklist();
  const checks = data.checks||{};
  const doneCount = checklist.filter((_,i)=>checks[i]).length;
  const pct = Math.round(doneCount/checklist.length*100);

  function toggle(i){ if(!canEdit) return; update(d=>({ ...d, checks:{ ...d.checks, [i]:!d.checks?.[i] } })); }

  // incident composer
  const [iType, setIType] = React.useState(window.DS.incidentTypes()[0]);
  const [iDetail, setIDetail] = React.useState('');
  function addIncident(){
    if(!iDetail.trim()) return;
    const t = new Date().toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'});
    update(d=>({ ...d, incidents:[...(d.incidents||[]), { id:'i'+Date.now(), type:iType, detail:iDetail.trim(), t }] }));
    setIDetail('');
  }
  function delIncident(id){ update(d=>({ ...d, incidents:(d.incidents||[]).filter(x=>x.id!==id) })); }
  const incidents = data.incidents||[];

  // live meal status
  const h = new Date().getHours();
  const isToday = date===new Date().toISOString().slice(0,10);
  function mealStatus(s){
    if(!isToday) return { cls:'off', txt:'—' };
    if(h>=s.open && h<s.close) return { cls:'ok', txt:'Open now' };
    if(h>=s.close) return { cls:'off', txt:'Closed' };
    return { cls:'warn', txt:'Upcoming' };
  }

  return (
    <div className="fade-in">
      <div className="page-head">
        <div>
          <h2>Daily Operations</h2>
          <div className="ph-sub">Opening checklist, meal schedule &amp; incident log{connected?' · synced':' · saved on device'}</div>
        </div>
        <div className="ph-actions">
          <label className="ft-field"><span>Operations date</span>
            <input className="ipt sel" type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>
        </div>
      </div>

      <div className="grid-2">
        <div>
          {/* opening checklist */}
          <div className="card" style={{marginBottom:16}}>
            <div className="card-head">
              <h3>Morning opening checklist</h3>
              <span className="ch-link">{doneCount}/{checklist.length} complete</span>
            </div>
            <div className="card-body flush">
              {checklist.map((item,i)=>(
                <label className={'check-row'+(checks[i]?' on':'')} key={i}>
                  <input type="checkbox" className="mealchk" checked={!!checks[i]} disabled={!canEdit} onChange={()=>toggle(i)}/>
                  <span>{item}</span>
                </label>
              ))}
            </div>
            <div className="card-body" style={{paddingTop:12}}>
              <div className="prog-track"><div className="prog-bar2" style={{width:pct+'%'}}></div></div>
              <div style={{fontSize:11.5,color:'var(--muted)',marginTop:7,fontWeight:600}}>{pct}% of opening tasks complete</div>
            </div>
          </div>

          {/* menu / cycle notes */}
          <div className="card">
            <div className="card-head"><h3>Menu notes — 28-day cycle</h3></div>
            <div className="card-body" style={{display:'flex',flexDirection:'column',gap:12}}>
              <div style={{display:'flex',gap:12,alignItems:'flex-end'}}>
                <label className="ft-field"><span>Cycle day (1–28)</span>
                  <input className="ipt sel" type="number" min="1" max="28" style={{width:96}} value={data.cycleDay||''} disabled={!canEdit}
                    onChange={e=>update(d=>({...d,cycleDay:e.target.value}))}/></label>
              </div>
              <label className="ft-field"><span>Special notes / ethnic menu</span>
                <textarea className="ipt sel" rows="3" style={{resize:'vertical'}} value={data.notes||''} disabled={!canEdit}
                  placeholder="e.g. Hispanic Heritage Month — rice and beans, plantains…"
                  onChange={e=>update(d=>({...d,notes:e.target.value}))}></textarea></label>
            </div>
          </div>
        </div>

        <div>
          {/* meal schedule */}
          <div className="card" style={{marginBottom:16}}>
            <div className="card-head"><h3>Today&rsquo;s meal schedule</h3></div>
            <div className="card-body flush tbl-wrap">
              <table className="data">
                <thead><tr><th>Meal</th><th>Hours</th><th>Lead monitor</th><th>Status</th></tr></thead>
                <tbody>
                  {window.DS.mealSchedule().map(s=>{
                    const st = mealStatus(s);
                    return (
                      <tr key={s.meal}>
                        <td style={{fontWeight:700}}>{s.meal}</td>
                        <td style={{color:'var(--muted)',whiteSpace:'nowrap'}}>{s.hours}</td>
                        <td style={{color:'var(--muted)'}}>{s.monitor}</td>
                        <td><span className={'pill '+st.cls}>{st.txt}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* incident log */}
          <div className="card">
            <div className="card-head">
              <h3>Incident log</h3>
              {incidents.length>0 && <span className="ch-link">{incidents.length} logged</span>}
            </div>
            <div className="card-body" style={{display:'flex',flexDirection:'column',gap:11}}>
              {canEdit && <>
                <label className="ft-field"><span>Type</span>
                  <select className="ipt sel" value={iType} onChange={e=>setIType(e.target.value)}>
                    {window.DS.incidentTypes().map(t=><option key={t}>{t}</option>)}
                  </select></label>
                <label className="ft-field"><span>Details</span>
                  <textarea className="ipt sel" rows="2" style={{resize:'vertical'}} value={iDetail}
                    placeholder="Describe the incident…" onChange={e=>setIDetail(e.target.value)}></textarea></label>
                <div><button className="btn primary" onClick={addIncident} disabled={!iDetail.trim()}>{window.I.plus({style:{width:14,height:14}})} Log incident</button></div>
              </>}
              {incidents.length===0
                ? <div style={{fontSize:12,color:'var(--faint)',padding:'4px 0'}}>No incidents logged for this day.</div>
                : <div className="incident-list">
                    {incidents.map(r=>(
                      <div className="incident-item" key={r.id}>
                        <div className="ii-body">
                          <div className="ii-top"><span className="pill warn">{r.type}</span><span className="ii-time">{r.t}</span></div>
                          <div className="ii-detail">{r.detail}</div>
                        </div>
                        {canEdit && <button className="row-del" onClick={()=>delIncident(r.id)}>{window.I.del({style:{width:14,height:14}})}</button>}
                      </div>
                    ))}
                  </div>}
            </div>
          </div>
        </div>
      </div>

      <window.SaveBar saved={saved} savedAt={savedAt} onSave={()=>save(user.display_name)} canEdit={canEdit} connected={connected}
        note={<span className="formbar-meta">Daily operations · {new Date(date+'T12:00:00').toLocaleDateString()}</span>}/>
    </div>
  );
}

window.DailyOps = DailyOps;
