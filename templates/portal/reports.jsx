/* ══════════════════════════════════════════════════════════════
   Reports — every report across the system in one place. Managers
   preview, print, and download (CSV) any report. All rows are pulled
   live through window.DS (seed providers + the real log store), never
   from hardcoded values, so each export reflects actual data.
═══════════════════════════════════════════════════════════════ */

function buildReports(period, invState){
  const inv = invState && invState.inv;
  const periodLbl = window.MONTHS[period[0]] + ' ' + period[1];
  const meals = m => [m.B&&'B', m.L&&'L', m.D&&'D'].filter(Boolean).join('/');

  return [
    /* ── Inventory ── */
    { id:'inventory', name:'Inventory Snapshot', group:'Inventory', icon:'box', period:periodLbl,
      columns:[
        {key:'sku',label:'SKU'},{key:'desc',label:'Description'},{key:'cat',label:'Category'},
        {key:'price',label:'Unit Price',get:r=>'$'+(r.price||0).toFixed(2)},
        {key:'onHand',label:'On Hand'},{key:'par',label:'Par'},
        {key:'value',label:'Value',get:r=>'$'+(window.iTotal?window.iTotal(r):0).toFixed(2)},
      ],
      build:()=> window.DS.inventoryList(inv, period) },

    { id:'moninv', name:'Monthly Inventory Roll-up', group:'Inventory', icon:'fileText', period:periodLbl,
      columns:[
        {key:'item',label:'Item'},{key:'cat',label:'Category'},
        {key:'opening',label:'Opening'},{key:'received',label:'Received'},{key:'issued',label:'Issued'},
        {key:'closing',label:'Closing',get:r=>Math.max(0,(r.opening||0)+(r.received||0)-(r.issued||0))},
        {key:'value',label:'Value',get:r=>'$'+(Math.max(0,(r.opening||0)+(r.received||0)-(r.issued||0))*r.price).toFixed(2)},
      ],
      build:()=> window.DS.monthlyRollup(inv, period) },

    { id:'invoices', name:'Invoice Register', group:'Inventory', icon:'inbox', period:periodLbl,
      columns:[
        {key:'vendor',label:'Vendor'},{key:'number',label:'Invoice #'},{key:'date',label:'Date'},
        {key:'items',label:'Items'},{key:'total',label:'Total',get:r=>'$'+(r.total||0).toFixed(2)},
      ],
      build:()=> window.DS.invoices(period) },

    /* ── Compliance / logs (real entered records) ── */
    { id:'meallog', name:'Meal Logs', group:'Compliance', icon:'users', period:'all dates',
      columns:[{key:'date',label:'Date'},{key:'name',label:'Name'},{key:'type',label:'Type'},{key:'meals',label:'Meals'},{key:'paid',label:'Paid'},{key:'ticket',label:'Ticket #'}],
      build:()=> window.DS.logs('meallog:').flatMap(({key,data})=>{
        const date = key.split(':')[1]||'';
        const paidSet = new Set(window.DS.mealTypes().filter(t=>t.paid).map(t=>t.key));
        return (data.rows||[]).filter(r=>r.name).map(r=>({ date, name:r.name, type:r.type||'Staff', meals:meals(r), paid:paidSet.has(r.type||'Staff')?'Yes':'No', ticket:r.ticket||'' }));
      }) },

    { id:'temp', name:'HACCP Temperature Logs', group:'Compliance', icon:'thermo', period:'all dates',
      columns:[{key:'app',label:'Appliance'},{key:'month',label:'Month'},{key:'day',label:'Day'},{key:'am',label:'AM °F'},{key:'pm',label:'PM °F'},{key:'note',label:'Corrective action'}],
      build:()=> window.DS.logs('temp:').flatMap(({key,data})=>{
        const p = key.split(':'); const app=p[1]||'', month=p[2]||''; const rows=data.rows||{};
        return Object.keys(rows).map(day=>({ app, month, day, am:rows[day].am||'', pm:rows[day].pm||'', note:rows[day].note||'' }));
      }) },

    { id:'sanit', name:'Sanitizer Logs', group:'Compliance', icon:'droplet', period:'all dates',
      columns:[{key:'month',label:'Month'},{key:'day',label:'Day'},{key:'am',label:'AM ppm'},{key:'pm',label:'PM ppm'},{key:'area',label:'Area / action'}],
      build:()=> window.DS.logs('sanit:').flatMap(({key,data})=>{
        const month=key.split(':')[1]||''; const rows=data.rows||{};
        return Object.keys(rows).map(day=>({ month, day, am:rows[day].am||'', pm:rows[day].pm||'', area:rows[day].area||'' }));
      }) },

    { id:'inspection', name:'Inspection Sheets', group:'Compliance', icon:'clipboard', period:'all dates',
      columns:[{key:'date',label:'Date'},{key:'staff',label:'Staff'},{key:'meal',label:'Meal'},{key:'rated',label:'Rated'},{key:'poor',label:'Poor'},{key:'comments',label:'Comments'}],
      build:()=> window.DS.logs('inspection:').map(({data})=>{
        const r = Object.values(data.ratings||{});
        return { date:data.date||'', staff:data.staff||'', meal:data.meal||'', rated:r.length, poor:r.filter(v=>v==='POOR').length, comments:data.comments||'' };
      }) },

    { id:'dailyops', name:'Daily Operations', group:'Compliance', icon:'checkSquare', period:'all dates',
      columns:[{key:'date',label:'Date'},{key:'checks',label:'Checklist done'},{key:'cycleDay',label:'Cycle day'},{key:'incidents',label:'Incidents'},{key:'notes',label:'Notes'}],
      build:()=> window.DS.logs('dailyops:').map(({key,data})=>({
        date:key.split(':')[1]||'', checks:Object.values(data.checks||{}).filter(Boolean).length,
        cycleDay:data.cycleDay||'', incidents:(data.incidents||[]).length, notes:data.notes||'' })) },

    { id:'snackbar', name:'Snack Bar Reconciliation', group:'Compliance', icon:'coffee', period:'all dates',
      columns:[{key:'date',label:'Date'},{key:'open',label:'Opening $'},{key:'sales',label:'Sales $'},{key:'close',label:'Closing $'},
        {key:'var',label:'Variance $',get:r=>{ const v=(parseFloat(r.close)||0)-((parseFloat(r.open)||0)+(parseFloat(r.sales)||0)); return (v>0?'+':'')+v.toFixed(2); }}],
      build:()=> window.DS.logs('snackbar:').map(({key,data})=>({
        date:key.split(':')[1]||'', open:data.open||'', sales:data.sales||'', close:data.close||'' })) },

    /* ── Programs / records ── */
    { id:'events', name:'Events & Programs', group:'Programs', icon:'calCheck', period:'2026',
      columns:[{key:'date',label:'Date'},{key:'title',label:'Title'},{key:'cat',label:'Category',get:r=>(window.DS.catMeta()[r.cat]||{}).label||r.cat},{key:'theme',label:'Theme'},{key:'status',label:'Status'}],
      build:()=> window.DS.events().slice().sort((a,b)=>a.date.localeCompare(b.date)) },

    { id:'servsafe', name:'ServSafe Certifications', group:'Programs', icon:'award', period:'current',
      columns:[{key:'name',label:'Staff'},{key:'cert',label:'Certification'},{key:'expiry',label:'Expiry'},{key:'proctor',label:'Proctor',get:r=>r.proctor?'Yes':'No'}],
      build:()=> window.DS.servsafe() },

    { id:'commits', name:'Commit History', group:'Programs', icon:'branch', period:'all',
      columns:[{key:'hash',label:'Hash'},{key:'author',label:'Author'},{key:'role',label:'Role'},{key:'message',label:'Message'},{key:'files',label:'Files'},{key:'when',label:'Date',get:r=>new Date(r.when).toLocaleString()}],
      build:()=> window.DS.commits() },
  ];
}

function Reports({ user, period, connected, invState }){
  const reports = React.useMemo(()=>buildReports(period, invState), [period, invState]);
  const [tab, setTab] = React.useState('catalogue');
  const [sel, setSel] = React.useState(reports[0].id);
  const active = reports.find(r=>r.id===sel) || reports[0];
  const rows = active.build();

  const groups = ['Inventory','Compliance','Programs'];
  const fileName = (rep)=> 'MJCC_'+rep.id+'_'+new Date().toISOString().slice(0,10)+'.csv';

  function downloadOne(rep){
    const data = rep.build();
    window.DS.download(fileName(rep), window.DS.toCSV(rep.columns, data));
  }
  function printOne(rep){
    const data = rep.build();
    const th = rep.columns.map(c=>'<th>'+c.label+'</th>').join('');
    const tr = data.map(r=>'<tr>'+rep.columns.map(c=>'<td>'+((typeof c.get==='function'?c.get(r):r[c.key])??'')+'</td>').join('')+'</tr>').join('');
    const w = window.open('', '_blank');
    if(!w){ window.toast && window.toast('Allow pop-ups to print'); return; }
    w.document.write('<html><head><title>'+rep.name+'</title><style>body{font-family:Segoe UI,Arial,sans-serif;color:#1E293B;padding:28px}h1{font-size:18px;margin:0 0 2px}.sub{color:#64748B;font-size:12px;margin-bottom:16px}table{width:100%;border-collapse:collapse;font-size:11px}th{background:#0E2148;color:#fff;text-align:left;padding:6px 8px;font-size:10px;text-transform:uppercase;letter-spacing:.4px}td{padding:5px 8px;border-bottom:.5px solid #E2E8F0}tr:nth-child(even) td{background:#F8FAFC}</style></head><body><h1>'+rep.name+'</h1><div class="sub">Miami Job Corps Cafeteria · '+rep.period+' · '+data.length+' records · generated '+new Date().toLocaleString()+'</div><table><thead><tr>'+th+'</tr></thead><tbody>'+tr+'</tbody></table></body></html>');
    w.document.close(); setTimeout(()=>w.print(), 250);
  }

  return (
    <div className="fade-in">
      <div className="page-head">
        <div>
          <h2>Reports</h2>
          <div className="ph-sub">Download or print any report or blank template across the system · {window.DS.source()==='live'?'live data':'demo data'}</div>
        </div>
        <div className="ph-actions">
          {tab==='catalogue' && <>
            <button className="btn" onClick={()=>printOne(active)}>{window.I.printer()} Print</button>
            <button className="btn primary" onClick={()=>downloadOne(active)}>{window.I.download()} Download CSV</button>
          </>}
        </div>
      </div>

      <div className="subtabs">
        <button className="subtab" data-on={tab==='catalogue'} onClick={()=>setTab('catalogue')}>{window.I.fileText({style:{width:15,height:15}})}<span>Report catalogue</span></button>
        <button className="subtab" data-on={tab==='templates'} onClick={()=>setTab('templates')}>{window.I.printer({style:{width:15,height:15}})}<span>Blank templates</span></button>
      </div>

      {tab==='templates' ? <window.TemplatesPanel/> : (
      <div className="grid-2">
        {/* report catalogue */}
        <div style={{display:'flex',flexDirection:'column',gap:16}}>
          {groups.map(g=>{
            const items = reports.filter(r=>r.group===g);
            return (
              <div className="card" key={g}>
                <div className="card-head"><h3>{g}</h3><span className="ch-link">{items.length}</span></div>
                <div className="card-body flush">
                  {items.map(rep=>{
                    const n = rep.build().length;
                    return (
                      <div key={rep.id} className={'report-row'+(sel===rep.id?' on':'')} onClick={()=>setSel(rep.id)}>
                        <div className="rr-ic">{window.I[rep.icon]({style:{width:16,height:16}})}</div>
                        <div className="rr-body">
                          <div className="rr-name">{rep.name}</div>
                          <div className="rr-meta">{rep.period} · {n} record{n!==1?'s':''}</div>
                        </div>
                        <div className="rr-actions">
                          <button className="btn" style={{padding:'5px 9px'}} title="Print" onClick={e=>{e.stopPropagation();printOne(rep);}}>{window.I.printer({style:{width:14,height:14}})}</button>
                          <button className="btn" style={{padding:'5px 9px'}} title="Download CSV" onClick={e=>{e.stopPropagation();downloadOne(rep);}}>{window.I.download({style:{width:14,height:14}})}</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* preview */}
        <div className="card" style={{height:'fit-content'}}>
          <div className="card-head">
            <h3>{active.name}</h3>
            <span className="ch-link">{rows.length} record{rows.length!==1?'s':''}</span>
          </div>
          {rows.length===0
            ? <div style={{padding:'40px 17px',textAlign:'center',color:'var(--faint)',fontSize:12.5}}>
                {window.I.fileText({style:{width:26,height:26,margin:'0 auto 10px',display:'block',color:'var(--line)'}})}
                No records yet. This report fills in as data is entered or synced from the backend.
              </div>
            : <div className="card-body flush tbl-wrap" style={{maxHeight:520,overflowY:'auto'}}>
                <table className="data">
                  <thead><tr>{active.columns.map(c=><th key={c.key}>{c.label}</th>)}</tr></thead>
                  <tbody>
                    {rows.slice(0,60).map((r,i)=>(
                      <tr key={i}>{active.columns.map(c=><td key={c.key}>{(typeof c.get==='function'?c.get(r):r[c.key])??''}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
                {rows.length>60 && <div style={{padding:'10px 14px',fontSize:11.5,color:'var(--faint)',borderTop:'1px solid var(--line-soft)'}}>Showing 60 of {rows.length} — download the CSV for the full report.</div>}
              </div>}
        </div>
      </div>
      )}
    </div>
  );
}

window.Reports = Reports;
