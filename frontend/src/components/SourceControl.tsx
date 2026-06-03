import { useState, useEffect } from 'react';
import { I } from '../lib/icons';
import { type User, ROLE_LEVEL, ROLE_LABEL } from '../lib/constants';
import { DS } from '../lib/services';

function relTime(iso: string) {
  const d = new Date(iso),
    now = new Date();
  const mins = Math.round((now.getTime() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + ' min ago';
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return hrs + ' hr' + (hrs > 1 ? 's' : '') + ' ago';
  const days = Math.round(hrs / 24);
  if (days < 7) return days + ' day' + (days > 1 ? 's' : '') + ' ago';
  return d.toLocaleDateString();
}
function newHash() {
  return Math.random().toString(16).slice(2, 8);
}

export function SourceControl({
  user,
  connected,
  onCountChange,
}: {
  user: User;
  connected: boolean;
  onCountChange?: (n: number) => void;
}) {
  const lvl = ROLE_LEVEL[user.role] || 0;
  const isStaff = lvl < 20;
  const canReview = lvl >= 30;
  const canCommit = lvl >= 20;

  const [staged, setStaged] = useState(() => DS.staged());
  const [commits, setCommits] = useState(() => DS.commits());

  const [sType, setSType] = useState(DS.submitTypes()[0]);
  const [sSummary, setSSummary] = useState('');
  const [sItems, setSItems] = useState('');

  const myStaged = staged.filter((s: any) => s.username === user.username);
  const visibleStaged = isStaff ? myStaged : staged;

  useEffect(() => {
    onCountChange?.(staged.length);
  }, [staged.length, onCountChange]);

  function submit() {
    if (!sSummary.trim()) return;
    const entry = {
      id: 'st' + Date.now(),
      author: (user.display_name + ' ' + (user.last_name || '')).trim(),
      username: user.username,
      role: user.role,
      type: sType,
      summary: sSummary.trim(),
      items: parseInt(sItems) || 1,
      submittedAt: new Date().toISOString(),
      status: 'pending' as const,
    };
    if (canCommit) {
      setCommits((cs: any[]) => [
        {
          hash: newHash(),
          author: entry.author,
          role: user.role,
          message: entry.summary,
          files: entry.items,
          add: entry.items * 4,
          del: 0,
          when: entry.submittedAt,
          synced: connected,
        },
        ...cs,
      ]);
      (window as any).toast?.('Committed & synced to data store');
    } else {
      setStaged((s: any[]) => [entry, ...s]);
      (window as any).toast?.('Submitted for manager approval');
    }
    setSSummary('');
    setSItems('');
  }

  function approve(ch: any) {
    setStaged((s: any[]) => s.filter((x: any) => x.id !== ch.id));
    setCommits((cs: any[]) => [
      {
        hash: newHash(),
        author: ch.author,
        role: ch.role,
        message: ch.summary,
        files: ch.items,
        add: ch.items * 4,
        del: 0,
        when: new Date().toISOString(),
        synced: connected,
      },
      ...cs,
    ]);
    (window as any).toast?.('Change committed' + (connected ? ' & synced' : ''));
  }
  function reject(ch: any) {
    setStaged((s: any[]) => s.filter((x: any) => x.id !== ch.id));
    (window as any).toast?.('Submission returned to author');
  }

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
            {' · '}
            {staged.length} pending
          </div>
        </div>
        <div className="ph-actions">
          {canReview && staged.length > 0 && (
            <button
              className="btn primary"
              onClick={() => {
                staged.forEach(approve);
              }}
            >
              {I.branch()} Commit all ({staged.length})
            </button>
          )}
        </div>
      </div>

      <div className={'sync-card ' + (connected ? 'on' : 'off')}>
        <div className="sync-ic">
          {I.database({ style: { width: 20, height: 20 } })}
        </div>
        <div className="sync-body">
          <div className="sync-title">
            Data store ·{' '}
            <span className="mono">MJCC-Portal/mjcc</span>{' '}
            <span className="sync-branch">main</span>
          </div>
          <div className="sync-sub">
            {connected
              ? 'Live — snapshots push after every commit'
              : 'Demo mode — commits are simulated locally'}
            {lastCommit && (
              <>
                {' '}
                · last commit{' '}
                <span className="commit-hash">{lastCommit.hash}</span>{' '}
                {relTime(lastCommit.when)}
              </>
            )}
          </div>
        </div>
        <span className={'pill ' + (connected ? 'ok' : 'off')}>
          {connected ? 'Synced' : 'Offline'}
        </span>
      </div>

      <div className="grid-2">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card">
            <div className="card-head">
              <h3>
                {canCommit && !isStaff
                  ? 'Commit a change'
                  : 'Submit a change'}
              </h3>
            </div>
            <div
              className="card-body"
              style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1.2fr .8fr',
                  gap: 12,
                }}
              >
                <label className="ft-field">
                  <span>Change type</span>
                  <select
                    className="ipt sel"
                    value={sType}
                    onChange={(e) => setSType(e.target.value)}
                  >
                    {DS.submitTypes().map((t: string) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </label>
                <label className="ft-field">
                  <span>Items affected</span>
                  <input
                    className="ipt sel"
                    type="number"
                    min="1"
                    value={sItems}
                    placeholder="1"
                    onChange={(e) => setSItems(e.target.value)}
                  />
                </label>
              </div>
              <label className="ft-field">
                <span>Summary</span>
                <input
                  className="ipt sel"
                  value={sSummary}
                  placeholder="e.g. Adjusted on-hand counts — Dairy (Week 3)"
                  onChange={(e) => setSSummary(e.target.value)}
                />
              </label>
              <div>
                <button
                  className="btn primary"
                  onClick={submit}
                  disabled={!sSummary.trim()}
                >
                  {canCommit && !isStaff ? (
                    <>
                      {I.branch({ style: { width: 15, height: 15 } })}{' '}
                      Commit &amp; sync
                    </>
                  ) : (
                    <>
                      {I.inbox({ style: { width: 15, height: 15 } })}{' '}
                      Submit for review
                    </>
                  )}
                </button>
              </div>
              {isStaff && (
                <div className="form-note" style={{ margin: 0 }}>
                  {I.alert({ style: { width: 13, height: 13 } })}
                  <span>
                    Staff submissions are staged, not committed directly. A
                    manager reviews and commits them to the record.
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h3>
                {isStaff
                  ? 'My pending submissions'
                  : 'Review queue'}
              </h3>
              <span className="ch-link">
                {visibleStaged.length} staged
              </span>
            </div>
            <div className="card-body flush">
              {visibleStaged.length === 0 ? (
                <div
                  style={{
                    padding: '26px 17px',
                    textAlign: 'center',
                    color: 'var(--faint)',
                    fontSize: 12.5,
                  }}
                >
                  Nothing staged — the working tree is clean.
                </div>
              ) : (
                visibleStaged.map((ch: any) => (
                  <div className="stage-item" key={ch.id}>
                    <div className="stage-ic">
                      {I.clock({ style: { width: 15, height: 15 } })}
                    </div>
                    <div className="stage-body">
                      <div className="stage-top">
                        <span className="stage-type">{ch.type}</span>
                        <span className="stage-items">
                          {ch.items} item{ch.items !== 1 ? 's' : ''}
                        </span>
                      </div>
                      <div className="stage-summary">{ch.summary}</div>
                      <div className="stage-meta">
                        <span
                          className="avatar"
                          style={{
                            width: 18,
                            height: 18,
                            fontSize: 8,
                            borderRadius: 5,
                          }}
                        >
                          {ch.author[0] || '?'}
                        </span>
                        <b>{ch.author}</b> · {relTime(ch.submittedAt)}
                      </div>
                    </div>
                    {canReview ? (
                      <div className="stage-actions">
                        <button
                          className="btn"
                          style={{ padding: '6px 10px' }}
                          onClick={() => reject(ch)}
                          title="Return to author"
                        >
                          {I.x({ style: { width: 14, height: 14 } })}
                        </button>
                        <button
                          className="btn primary"
                          style={{ padding: '6px 11px' }}
                          onClick={() => approve(ch)}
                        >
                          {I.check({ style: { width: 14, height: 14 } })}{' '}
                          Commit
                        </button>
                      </div>
                    ) : (
                      <span className="pill warn">Pending review</span>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="card" style={{ height: 'fit-content' }}>
          <div className="card-head">
            <h3>Commit history</h3>
            <span className="ch-link">{commits.length} commits</span>
          </div>
          <div className="card-body flush">
            {commits.map((c: any, i: number) => (
              <div className="commit-item" key={c.hash + i}>
                <div className="commit-graph">
                  <span className="cg-dot" />
                  {i < commits.length - 1 && (
                    <span className="cg-line" />
                  )}
                </div>
                <div className="commit-body">
                  <div className="commit-msg">{c.message}</div>
                  <div className="commit-meta">
                    <span className="commit-hash">{c.hash}</span>
                    <b>{c.author}</b>
                    <span className={'pill role-' + c.role}>
                      {ROLE_LABEL[c.role as keyof typeof ROLE_LABEL] || c.role}
                    </span>
                    <span>{relTime(c.when)}</span>
                    {c.synced && (
                      <span className="synced-tag">
                        {I.check({ style: { width: 11, height: 11 } })}{' '}
                        synced
                      </span>
                    )}
                  </div>
                  <div className="commit-diff">
                    <span className="diff-files">
                      {c.files} file{c.files !== 1 ? 's' : ''}
                    </span>
                    {c.add > 0 && (
                      <span className="diff-add">+{c.add}</span>
                    )}
                    {c.del > 0 && (
                      <span className="diff-del">−{c.del}</span>
                    )}
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
