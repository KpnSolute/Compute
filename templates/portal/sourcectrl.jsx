/* ══════════════════════════════════════════════════════════════
   Source Control — staging pipeline, commit history & data-store sync.
   Role-aware (mirrors the repo role model):
   • staff (10)      → own "My Submissions" route; changes go to staging
                       and require manager/admin approval (no auto-commit)
   • assistant (20)  → can commit directly + review staging
   • manager/admin   → full review queue, commit, revert, GitHub sync
   Changes are held in session state (seeded from window.STAGED_CHANGES /
   window.COMMITS) so approvals/commits update live.
═══════════════════════════════════════════════════════════════ */

function relTime(iso){
  const d = new Date(iso), now = new Date();
  const mins = Math.round((now-d)/60000);
  if(mins<1) return 'just now';
  if(mins<60) return mins+' min ago';
  const hrs = Math.round(mins/60);
  if(hrs<24) return hrs+' hr'+(hrs>1?'s':'')+' ago';
  const days = Math.round(hrs/24);
  if(days<7) return days+' day'+(days>1?'s':'')+' ago';
  return d.toLocaleDateString();
}
function newHash(){ return Math.random().toString(16).slice(2,8); }

function SourceControl({ user, connected, onCountChange }){
  const lvl = window.ROLE_LEVEL[user.role]||0;
  const isStaff = lvl<20;          // staff submit only
  const canReview = lvl>=30;       // manager/admin approve/commit others' work
  const canCommit = lvl>=20;       // assistant+ commit own work directly

  const [staged, setStaged] = React.useState(()=> window.DS.staged());
  const [commits, setCommits] = React.useState(()=> window.DS.commits());

  // submission composer
  const [sType, setSType] = React.useState(window.DS.submitTypes()[0]);
  const [sSummary, setSSummary] = React.useState('');
  const [sItems, setSItems] = React.useState('');

  const myStaged = staged.filter(s=>s.username===user.username);
  const visibleStaged = isStaff ? myStaged : staged;

  React.useEffect(()=>{ onCountChange && onCountChange(staged.length); }, [staged.length]);

  function submit(){
    if(!sSummary.trim()) return;
    const entry = {
      id:'st'+Date.now(), author:(user.display_name+' '+(user.last_name||'')).trim(),
      username:user.username, role:user.role, type:sType, summary:sSummary.trim(),
      items:parseInt(sItems)||1, submittedAt:new Date().toISOString(), status:'pending',
    };
    if(canCommit){
      // assistant+ auto-commit
      setCommits(cs=>[{ hash:newHash(), author:entry.author, role:user.role, message:entry.summary,
        files:entry.items, add:entry.items*4, del:0, when:entry.submittedAt, synced:connected }, ...cs]);
      window.toast && window.toast('Committed & synced to data store');
    }else{
      setStaged(s=>[entry, ...s]);
      window.toast && window.toast('Submitted for manager approval');
    }
    setSSummary(''); setSItems('');
  }

  function approve(ch){
    setStaged(s=>s.filter(x=>x.id!==ch.id));
    setCommits(cs=>[{ hash:newHash(), author:ch.author, role:ch.role, message:ch.summary,
      files:ch.items, add:ch.items*4, del:0, when:new Date().toISOString(), synced:connected }, ...cs]);
    window.toast && window.toast('Change committed' + (connected?' & synced':''));
  }
  function reject(ch){ setStaged(s=>s.filter(x=>x.id!==ch.id)); window.toast && window.toast('Submission returned to author'); }

  const lastCommit = commits[0];

  return (
    <div className="fade-in">
      <div className="page-head">
        <div>
          <h2>{isStaff ? 'My Submissions' : 'Source Control'}</h2>
          <div className="ph-sub">
            {isStaff
              ? 'Submit inventory changes for review — manager approval commits them to the record'
              : 'Staging pipeline, commit history & data-store sync'}
            {' · '}{staged.length} pending
          </div>
        </div>
        <div className="ph-actions">
          {canReview && staged.length>0 && <button className="btn primary" onClick={()=>{ staged.forEach(approve); }}>{window.I.branch()} Commit all ({staged.length})</button>}
        </div>
      </div>

      {/* data-store sync banner */}
      <div className={'sync-card '+(connected?'on':'off')}>
        <div className="sync-ic">{window.I.database({style:{width:20,height:20}})}</div>
        <div className="sync-body">
          <div className="sync-title">Data store · <span className="mono">MJCC-Portal/mjcc</span> <span className="sync-branch">main</span></div>
          <div className="sync-sub">
            {connected ? 'Live — snapshots push after every commit' : 'Demo mode — commits are simulated locally'}
            {lastCommit && <> · last commit <span className="commit-hash">{lastCommit.hash}</span> {relTime(lastCommit.when)}</>}
          </div>
        </div>
        <span className={'pill '+(connected?'ok':'off')}>{connected?'Synced':'Offline'}</span>
      </div>

      <div className="grid-2">
        {/* LEFT — submit + staging queue */}
        <div style={{display:'flex',flexDirection:'column',gap:16}}>
          {/* submission composer */}
          <div className="card">
            <div className="card-head"><h3>{canCommit && !isStaff ? 'Commit a change' : 'Submit a change'}</h3></div>
            <div className="card-body" style={{display:'flex',flexDirection:'column',gap:12}}>
              <div style={{display:'grid',gridTemplateColumns:'1.2fr .8fr',gap:12}}>
                <label className="ft-field"><span>Change type</span>
                  <select className="ipt sel" value={sType} onChange={e=>setSType(e.target.value)}>
                    {window.DS.submitTypes().map(t=><option key={t}>{t}</option>)}
                  </select></label>
                <label className="ft-field"><span>Items affected</span>
                  <input className="ipt sel" type="number" min="1" value={sItems} placeholder="1" onChange={e=>setSItems(e.target.value)}/></label>
              </div>
              <label className="ft-field"><span>Summary</span>
                <input className="ipt sel" value={sSummary} placeholder="e.g. Adjusted on-hand counts — Dairy (Week 3)" onChange={e=>setSSummary(e.target.value)}/></label>
              <div>
                <button className="btn primary" onClick={submit} disabled={!sSummary.trim()}>
                  {canCommit && !isStaff ? <>{window.I.branch({style:{width:15,height:15}})} Commit &amp; sync</> : <>{window.I.inbox({style:{width:15,height:15}})} Submit for review</>}
                </button>
              </div>
              {isStaff && <div className="form-note" style={{margin:0}}>{window.I.alert({style:{width:13,height:13}})}<span>Staff submissions are staged, not committed directly. A manager reviews and commits them to the record.</span></div>}
            </div>
          </div>

          {/* staging queue */}
          <div className="card">
            <div className="card-head">
              <h3>{isStaff ? 'My pending submissions' : 'Review queue'}</h3>
              <span className="ch-link">{visibleStaged.length} staged</span>
            </div>
            <div className="card-body flush">
              {visibleStaged.length===0
                ? <div style={{padding:'26px 17px',textAlign:'center',color:'var(--faint)',fontSize:12.5}}>Nothing staged — the working tree is clean.</div>
                : visibleStaged.map(ch=>(
                  <div className="stage-item" key={ch.id}>
                    <div className="stage-ic">{window.I.clock({style:{width:15,height:15}})}</div>
                    <div className="stage-body">
                      <div className="stage-top">
                        <span className="stage-type">{ch.type}</span>
                        <span className="stage-items">{ch.items} item{ch.items!==1?'s':''}</span>
                      </div>
                      <div className="stage-summary">{ch.summary}</div>
                      <div className="stage-meta">
                        <span className="avatar" style={{width:18,height:18,fontSize:8,borderRadius:5}}>{(ch.author[0]||'?')}</span>
                        <b>{ch.author}</b> · {relTime(ch.submittedAt)}
                      </div>
                    </div>
                    {canReview
                      ? <div className="stage-actions">
                          <button className="btn" style={{padding:'6px 10px'}} onClick={()=>reject(ch)} title="Return to author">{window.I.x({style:{width:14,height:14}})}</button>
                          <button className="btn primary" style={{padding:'6px 11px'}} onClick={()=>approve(ch)}>{window.I.check({style:{width:14,height:14}})} Commit</button>
                        </div>
                      : <span className="pill warn">Pending review</span>}
                  </div>
                ))}
            </div>
          </div>
        </div>

        {/* RIGHT — commit history */}
        <div className="card" style={{height:'fit-content'}}>
          <div className="card-head">
            <h3>Commit history</h3>
            <span className="ch-link">{commits.length} commits</span>
          </div>
          <div className="card-body flush">
            {commits.map((c,i)=>(
              <div className="commit-item" key={c.hash+i}>
                <div className="commit-graph"><span className="cg-dot"></span>{i<commits.length-1 && <span className="cg-line"></span>}</div>
                <div className="commit-body">
                  <div className="commit-msg">{c.message}</div>
                  <div className="commit-meta">
                    <span className="commit-hash">{c.hash}</span>
                    <b>{c.author}</b>
                    <span className={'pill role-'+c.role}>{window.ROLE_LABEL[c.role]||c.role}</span>
                    <span>{relTime(c.when)}</span>
                    {c.synced && <span className="synced-tag">{window.I.check({style:{width:11,height:11}})} synced</span>}
                  </div>
                  <div className="commit-diff">
                    <span className="diff-files">{c.files} file{c.files!==1?'s':''}</span>
                    {c.add>0 && <span className="diff-add">+{c.add}</span>}
                    {c.del>0 && <span className="diff-del">−{c.del}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

window.SourceControl = SourceControl;
