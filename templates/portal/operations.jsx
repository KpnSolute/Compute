/* ══════════════════════════════════════════════════════════════
   Snack Bar + Monthly Inventory modules.
   - SnackBar: daily cash reconciliation, operating hours, rates.
   - MonthlyInventory: opening → received → issued → closing roll-up
     with editable counts, value summary, and invoice register.
   Both persist via window.useLog.
═══════════════════════════════════════════════════════════════ */

/* ── Snack Bar ── */
function SnackBar({ user, connected }){
  const lvl = window.ROLE_LEVEL[user.role]||0;
  const canEdit = lvl>=10;
  const [date, setDate] = React.useState(new Date().toISOString().slice(0,10));
  const key = `snackbar:${date}`;
  const { data, update, saved, save, savedAt } = window.useLog(key, { open:'', sales:'', close:'' });

  const o = parseFloat(data.open), s = parseFloat(data.sales), c = parseFloat(data.close);
  const ready = !isNaN(o)&&!isNaN(s)&&!isNaN(c);
  const variance = ready ? (c - (o + s)) : null;
  const vClass = variance===null ? '' : (Math.abs(variance)<0.005 ? 'ok' : (variance<0 ? 'neg' : 'pos'));

  function setF(k,v){ update(d=>({ ...d, [k]:v })); }

  return (
    <div className="fade-in">
      <div className="page-head">
        <div>
          <h2>Snack Bar</h2>
          <div className="ph-sub">Daily cash reconciliation &amp; operating reference{connected?' · synced':' · saved on device'}</div>
        </div>
        <div className="ph-actions">
          <label className="ft-field"><span>Business date</span>
            <input className="ipt sel" type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>
        </div>
      </div>

      <div className="grid-2">
        {/* reconciliation */}
        <div className="card" style={{height:'fit-content'}}>
          <div className="card-head"><h3>Daily sales reconciliation</h3></div>
          <div className="card-body" style={{display:'flex',flexDirection:'column',gap:13}}>
            <label className="ft-field"><span>Opening cash in register ($)</span>
              <input className="ipt sel" type="number" step="0.01" value={data.open||''} disabled={!canEdit} placeholder="0.00"
                onChange={e=>setF('open',e.target.value)}/></label>
            <label className="ft-field"><span>Total register sales ($)</span>
              <input className="ipt sel" type="number" step="0.01" value={data.sales||''} disabled={!canEdit} placeholder="0.00"
                onChange={e=>setF('sales',e.target.value)}/></label>
            <label className="ft-field"><span>Closing cash counted ($)</span>
              <input className="ipt sel" type="number" step="0.01" value={data.close||''} disabled={!canEdit} placeholder="0.00"
                onChange={e=>setF('close',e.target.value)}/></label>

            <div className={'variance-box '+vClass}>
              <span className="vb-lbl">Variance (counted − expected)</span>
              <span className="vb-val">{variance===null ? '—' : (variance>0?'+':'')+'$'+variance.toFixed(2)}</span>
              {variance!==null && <span className="vb-note">{Math.abs(variance)<0.005?'Balanced — drawer reconciles.':(variance<0?'Short — recount & note shortage.':'Over — recount & note overage.')}</span>}
            </div>
            <div className="banner info" style={{margin:0}}>{window.I.shield({style:{width:16,height:16}})}
              <span>Escort cash to Finance with Safety &amp; Security staff. Never transport receipts alone.</span></div>
          </div>
        </div>

        {/* reference */}
        <div>
          <div className="card" style={{marginBottom:16}}>
            <div className="card-head"><h3>Operating hours</h3></div>
            <div className="card-body flush tbl-wrap">
              <table className="data">
                <thead><tr><th>Day</th><th>Lunch</th><th>Evening</th></tr></thead>
                <tbody>
                  {window.DS.snackHours().map((r,i)=>(
                    <tr key={i}>
                      <td style={{fontWeight:700,whiteSpace:'nowrap'}}>{r.day}</td>
                      {r.eve==='' ? <td colSpan="2" style={{color:'var(--muted)'}}>{r.lunch}</td>
                        : <><td style={{color:'var(--muted)',whiteSpace:'nowrap'}}>{r.lunch}</td><td style={{color:'var(--muted)'}}>{r.eve}</td></>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="card">
            <div className="card-head"><h3>Meal ticket rates</h3></div>
            <div className="card-body flush tbl-wrap">
              <table className="data">
                <thead><tr><th>Meal</th><th className="r">Rate</th></tr></thead>
                <tbody>
                  {window.DS.mealRates().map((r,i)=>(
                    <tr key={i}><td>{r.meal}</td><td className="r num">{r.rate}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <window.SaveBar saved={saved} savedAt={savedAt} onSave={()=>save(user.display_name)} canEdit={canEdit} connected={connected}
        note={<span className="formbar-meta">Snack bar · {new Date(date+'T12:00:00').toLocaleDateString()}</span>}/>
    </div>
  );
}

/* ── Monthly Inventory ── */
function MonthlyInventory({ user, period, connected }){
  const lvl = window.ROLE_LEVEL[user.role]||0;
  const canEdit = lvl>=20;
  const [m,y] = period;
  const key = `moninv:${y}-${m}`;
  const { data, update, saved, save, savedAt } = window.useLog(key, { rows:window.DS.monthlyRollup(null, period), invoices:window.DS.invoices(period) });
  const [q, setQ] = React.useState('');
  const rows = data.rows||[];
  const invoices = data.invoices||[];

  function setR(id,f,v){ update(d=>({ ...d, rows:d.rows.map(r=>r.id===id?{...r,[f]:(parseFloat(v)||0)}:r) })); }
  const closing = r => Math.max(0, (r.opening||0)+(r.received||0)-(r.issued||0));

  const sum = rows.reduce((a,r)=>{
    a.open += (r.opening||0)*r.price; a.recv += (r.received||0)*r.price;
    a.iss += (r.issued||0)*r.price; a.close += closing(r)*r.price; return a;
  }, { open:0, recv:0, iss:0, close:0 });

  const filtered = q ? rows.filter(r=>r.item.toLowerCase().includes(q.toLowerCase())) : rows;
  const SUM = [
    { lbl:'Opening value', val:sum.open, tint:'#1B3A6B', bg:'#EEF2F8' },
    { lbl:'Received', val:sum.recv, tint:'#059669', bg:'#F0FDF4' },
    { lbl:'Issued / used', val:sum.iss, tint:'#D97706', bg:'#FEF3C7' },
    { lbl:'Closing value', val:sum.close, tint:'#1E73E8', bg:'#EFF5FE' },
  ];

  return (
    <div className="fade-in">
      <div className="page-head">
        <div>
          <h2>Monthly Inventory</h2>
          <div className="ph-sub">{window.MONTHS[m]} {y} · opening → received → issued → closing · {rows.length} items</div>
        </div>
        <div className="ph-actions">
          <button className="btn">{window.I.printer()} Print report</button>
          {canEdit && <button className="btn primary">{window.I.plus()} Add item</button>}
        </div>
      </div>

      <div className="stat-grid">
        {SUM.map((s,i)=>(
          <div className="stat-card" key={i}>
            <div className="sc-top"><div className="sc-ic" style={{background:s.bg,color:s.tint}}>{window.I.fileText()}</div></div>
            <div className="sc-lbl">{s.lbl}</div>
            <div className="sc-val">{window.fmtMoney(s.val)}</div>
          </div>
        ))}
      </div>

      <div className="card" style={{marginBottom:16}}>
        <div className="card-head" style={{gap:10,flexWrap:'wrap'}}>
          <h3>Inventory roll-up</h3>
          <div style={{position:'relative',minWidth:220}}>
            <span style={{position:'absolute',left:11,top:8,color:'var(--faint)'}}>{window.I.search({style:{width:15,height:15}})}</span>
            <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search items…"
              style={{width:'100%',padding:'7px 12px 7px 33px',border:'1px solid var(--line)',borderRadius:8,fontSize:12}}/>
          </div>
        </div>
        <div className="card-body flush tbl-wrap">
          <table className="data logtbl">
            <thead>
              <tr>
                <th>Item</th><th>Category</th><th className="r">Unit $</th>
                <th className="r">Opening</th><th className="r">Received</th><th className="r">Issued</th>
                <th className="r">Closing</th><th className="r">Value</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r=>(
                <tr key={r.id}>
                  <td style={{fontWeight:600,minWidth:200}}>{r.item}</td>
                  <td><span style={{display:'inline-flex',alignItems:'center',gap:6}}>
                    <span style={{width:8,height:8,borderRadius:2,background:window.catColor(r.cat)}}></span>{r.cat}</span></td>
                  <td className="r num">${(r.price||0).toFixed(2)}</td>
                  <td className="r">{cell(r.opening, v=>setR(r.id,'opening',v), canEdit)}</td>
                  <td className="r rcv-cell">{cell(r.received, v=>setR(r.id,'received',v), canEdit)}</td>
                  <td className="r">{cell(r.issued, v=>setR(r.id,'issued',v), canEdit)}</td>
                  <td className="r num" style={{fontWeight:800}}>{closing(r)}</td>
                  <td className="r num">{window.fmtMoneyFull(closing(r)*r.price)}</td>
                </tr>
              ))}
              {filtered.length===0 && <tr><td colSpan="8" style={{textAlign:'center',padding:26,color:'var(--faint)'}}>No items match.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{marginBottom:16}}>
        <div className="card-head">
          <h3>Invoice register — {window.MONTHS[m]} {y}</h3>
          <span className="ch-link">{invoices.length} invoices · {window.fmtMoney(invoices.reduce((s,i)=>s+i.total,0))}</span>
        </div>
        <div className="card-body flush tbl-wrap">
          <table className="data">
            <thead><tr><th>Vendor</th><th>Invoice #</th><th>Date</th><th className="r">Items</th><th className="r">Total</th></tr></thead>
            <tbody>
              {invoices.map(iv=>(
                <tr key={iv.id}>
                  <td style={{fontWeight:700}}>{iv.vendor}</td>
                  <td className="num" style={{color:'var(--muted)'}}>{iv.number}</td>
                  <td style={{color:'var(--muted)'}}>{new Date(iv.date+'T12:00:00').toLocaleDateString()}</td>
                  <td className="r num">{iv.items}</td>
                  <td className="r num">{window.fmtMoneyFull(iv.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <window.SaveBar saved={saved} savedAt={savedAt} onSave={()=>save(user.display_name)} canEdit={canEdit} connected={connected}
        note={<span className="formbar-meta">Monthly inventory · {window.MONTHS[m]} {y}</span>}/>
    </div>
  );
}

function cell(val, onChange, canEdit){
  if(!canEdit) return <span className="num">{val||0}</span>;
  return <input className="sheet-inp" type="number" step="0.5" style={{width:54}} value={val??0} onChange={e=>onChange(e.target.value)}/>;
}

Object.assign(window, { SnackBar, MonthlyInventory });
