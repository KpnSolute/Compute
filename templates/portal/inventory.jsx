/* ══════════════════════════════════════════════════════════════
   Inventory — dynamic spreadsheet, patterned off the offline
   inventory dashboard: category sections, weekly Issued/Received
   columns, inline editing, par highlighting, row + category totals,
   add/remove rows, and push-back to Supabase.
═══════════════════════════════════════════════════════════════ */

function _num(v){ const n=parseFloat(v); return isNaN(n)?0:Math.max(0,n); }
const WEEKS = [1,2,3,4];
function InvLoading({ label='Loading live data…' }){
  return <div className="load-wrap"><div className="spinner"></div><div>{label}</div></div>;
}
function InvBanner({ onOpen }){
  return (
    <div className="banner info">
      {window.I.cloud()}
      <span>Showing demo data. Connect your Supabase project to see live inventory.</span>
      <span className="bx" onClick={onOpen}>Connect →</span>
    </div>
  );
}

function InventorySheet({ user, period, connected, invState, onSync, onOpenSetup }){
  const lvl = window.ROLE_LEVEL[user.role]||0;
  const canEdit = lvl>=30;                    // manager + admin
  const source = (connected && invState.inv) ? invState.inv : (connected? null : window.demoInvFor(period[0],period[1]));

  const [inv, setInv]   = useState(()=> source ? structuredClone(source) : null);
  const [open, setOpen] = useState(()=> new Set(source?Object.keys(source).slice(0,2):[]));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState('');

  // re-seed working copy when the live source changes (and no unsaved edits)
  const srcKey = connected ? (invState.syncedAt||'live') : ('demo:'+period[0]+'-'+period[1]);
  useEffect(()=>{
    if(source && !dirty){
      setInv(structuredClone(source));
      setOpen(o=> o.size? o : new Set(Object.keys(source).slice(0,2)));
    }
  // eslint-disable-next-line
  }, [srcKey, connected]);

  if(connected && invState.loading) return wrap(<InvLoading/>);
  if(connected && invState.error && invState.error!=='empty')
    return wrap(<div className="banner warn">{window.I.alert()}<span>Couldn’t load live data: {invState.error}</span><span className="bx" onClick={onSync}>Retry</span></div>);
  if(connected && invState.error==='empty')
    return wrap(<div className="banner info">{window.I.cloud()}<span>Connected, but no inventory has been pushed yet.</span></div>);
  if(!inv) return wrap(<InvLoading/>);

  function wrap(inner){
    return (
      <div className="fade-in">
        <Head/>
        {!connected && <InvBanner onOpen={onOpenSetup}/>}
        {inner}
      </div>
    );
  }

  const cats = Object.keys(inv);
  const allItems = cats.flatMap(c=>inv[c].map(it=>({ ...it, cat:c })));
  const grand = allItems.reduce((s,i)=>s+window.iTotal(i),0);
  const lowN = allItems.filter(i=>(i.onHand||0)<(i.par||0)&&(i.par||0)>0).length;

  function toggle(cat){ setOpen(o=>{ const n=new Set(o); n.has(cat)?n.delete(cat):n.add(cat); return n; }); }
  function upd(cat,id,field,value){
    setInv(prev=>({ ...prev, [cat]: prev[cat].map(it=> it.id===id
      ? { ...it, [field]: (field==='sku'||field==='desc')? value : _num(value) } : it) }));
    setDirty(true);
  }
  function addRow(cat){
    setInv(prev=>({ ...prev, [cat]: [...prev[cat], { id:'n'+Date.now()+Math.random().toString(36).slice(2,5),
      sku:'', desc:'NEW ITEM', price:0, onHand:0, par:0, w1i:0,w2i:0,w3i:0,w4i:0, w1r:0,w2r:0,w3r:0,w4r:0 }] }));
    setOpen(o=>new Set(o).add(cat)); setDirty(true);
  }
  function delRow(cat,id){
    setInv(prev=>({ ...prev, [cat]: prev[cat].filter(it=>it.id!==id) })); setDirty(true);
  }
  async function save(){
    if(!connected){ setDirty(false); window.toast('Saved locally (demo mode)'); return; }
    setSaving(true);
    const res = await window.pushInventory(inv, (user.display_name||'portal'));
    setSaving(false);
    if(res.ok){ setDirty(false); window.toast('☁ Pushed to Supabase'); onSync && onSync(); }
    else window.toast('Push failed: '+res.error);
  }
  function discard(){ setInv(structuredClone(source)); setDirty(false); window.toast('Changes discarded'); }

  function Head(){
    return (
      <div className="page-head">
        <div>
          <h2>Inventory</h2>
          <div className="ph-sub">
            {window.MONTHS[period[0]]} {period[1]} · {allItems.length} items · {cats.length} categories{connected?' · live':' · demo'}
            {connected && invState.syncedAt && <> · synced {new Date(invState.syncedAt).toLocaleString()}</>}
          </div>
        </div>
        <div className="ph-actions">
          {connected && <button className="btn" onClick={onSync}>{window.I.refresh()} Refresh</button>}
          {dirty && <button className="btn" onClick={discard}>Discard</button>}
          {canEdit && <button className="btn primary" onClick={save} disabled={saving || !dirty}>
            {window.I.cloud({style:{width:15,height:15}})} {saving?'Saving…':(connected?'Push to Supabase':'Save')}</button>}
        </div>
      </div>
    );
  }

  return (
    <div className="fade-in">
      <Head/>
      {!connected && <InvBanner onOpen={onOpenSetup}/>}

      {/* summary strip */}
      <div className="sheet-summary">
        <div className="ss-item"><span className="ss-lbl">On-Hand Value</span><span className="ss-val">{window.fmtMoneyFull(grand)}</span></div>
        <div className="ss-item"><span className="ss-lbl">Line Items</span><span className="ss-val">{allItems.length}</span></div>
        <div className="ss-item"><span className="ss-lbl">Below Par</span><span className="ss-val" style={{color:lowN?'var(--amber)':'var(--green)'}}>{lowN}</span></div>
        <div className="ss-spacer"></div>
        <div style={{position:'relative',minWidth:200}}>
          <span style={{position:'absolute',left:11,top:9,color:'var(--faint)'}}>{window.I.search({style:{width:15,height:15}})}</span>
          <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Filter items…"
            style={{width:'100%',padding:'8px 12px 8px 33px',border:'1px solid var(--line)',borderRadius:8,fontSize:12.5}}/>
        </div>
        {dirty && <span className="dirty-chip">{window.I.alert({style:{width:13,height:13}})} Unsaved changes</span>}
      </div>

      {cats.map(cat=>{
        const items = inv[cat].filter(it=> !q || (it.desc||'').toLowerCase().includes(q.toLowerCase()) || String(it.sku||'').includes(q));
        if(q && !items.length) return null;
        const isOpen = open.has(cat);
        const ctot = inv[cat].reduce((s,i)=>s+window.iTotal(i),0);
        const rcvd = inv[cat].filter(i=>(i.w1r||0)>0).length;
        return (
          <div className="sheet-sec" key={cat}>
            <div className="sheet-sec-head" onClick={()=>toggle(cat)}>
              <div className="ssh-l">
                <span className="ssh-dot" style={{background:window.catColor(cat)}}></span>
                <span className="ssh-name">{cat}</span>
                <span className="ssh-cnt">{inv[cat].length} items</span>
                {rcvd>0 && <span className="ssh-badge">{window.I.download({style:{width:11,height:11}})} {rcvd} rcvd Wk1</span>}
              </div>
              <div className="ssh-r">
                <span className="ssh-tot">{window.fmtMoneyFull(ctot)}</span>
                <span className="ssh-arr">{isOpen?'▲':'▼'}</span>
              </div>
            </div>
            {isOpen && (
              <div className="tbl-wrap">
                <table className="data sheet">
                  <thead>
                    <tr>
                      <th style={{minWidth:220}}>Description</th>
                      <th style={{minWidth:88}}>SKU</th>
                      <th className="r">On Hand</th>
                      <th className="r">Price</th>
                      <th className="r">Par</th>
                      {WEEKS.map(w=>[
                        <th key={'i'+w} className="r wk">W{w} Iss</th>,
                        <th key={'r'+w} className="r wk rcv">W{w} Rcv</th>,
                      ])}
                      <th className="r">Total</th>
                      {canEdit && <th></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(it=>{
                      const low=(it.onHand||0)<(it.par||0)&&(it.par||0)>0;
                      const tot=window.iTotal(it);
                      return (
                        <tr key={it.id} className={low?'row-low':''}>
                          <td>{cell(cat,it,'desc','text',{minWidth:210})}</td>
                          <td>{cell(cat,it,'sku','text',{width:80})}</td>
                          <td className="r">{cell(cat,it,'onHand','num',{width:56},low)}</td>
                          <td className="r">{cell(cat,it,'price','money',{width:74})}</td>
                          <td className="r">{cell(cat,it,'par','num',{width:48})}</td>
                          {WEEKS.map(w=>[
                            <td key={'i'+w} className="r">{cell(cat,it,'w'+w+'i','num',{width:46})}</td>,
                            <td key={'r'+w} className="r rcv-cell">{cell(cat,it,'w'+w+'r','num',{width:46})}</td>,
                          ])}
                          <td className="r num" style={{fontWeight:700}}>{window.fmtMoneyFull(tot)}</td>
                          {canEdit && <td><button className="row-del" onClick={()=>delRow(cat,it.id)} title="Remove">{window.I.del({style:{width:14,height:14}})}</button></td>}
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={canEdit?2:1}>
                        {canEdit && <button className="btn-addrow" onClick={()=>addRow(cat)}>{window.I.plus({style:{width:13,height:13}})} Add item</button>}
                      </td>
                      <td colSpan={canEdit?12:12} className="r" style={{fontWeight:800,paddingRight:14}}>Category total</td>
                      <td className="r num" style={{fontWeight:800}}>{window.fmtMoneyFull(ctot)}</td>
                      {canEdit && <td></td>}
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  // inline editable / read-only cell
  function cell(cat,it,field,kind,style={},flag){
    const val = it[field];
    if(!canEdit){
      let disp = val;
      if(kind==='money') disp = '$'+(val||0).toFixed(2);
      return <span className="num" style={{color:flag?'var(--amber)':'inherit',fontWeight:flag?700:400}}>{kind==='text'?val:disp}</span>;
    }
    return (
      <input
        className={'sheet-inp'+(kind==='text'?' txt':'')+(flag?' flag':'')}
        style={style}
        type={kind==='text'?'text':'number'}
        step={kind==='money'?'0.01':'1'} min={kind==='text'?undefined:'0'}
        value={val}
        onChange={e=>upd(cat,it.id,field,e.target.value)}
      />
    );
  }
}

window.InventorySheet = InventorySheet;
