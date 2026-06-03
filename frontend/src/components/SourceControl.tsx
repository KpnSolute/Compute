import { useState, useEffect, useCallback } from 'react';
import { I } from '../lib/icons';
import { type User, ROLE_LEVEL, ROLE_LABEL } from '../lib/constants';
import { DS } from '../lib/services';
import { api, type Commit, type StagingEntry, type EntityType } from '../lib/api';

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

function shortSha(sha: string | null | undefined): string {
  return sha ? sha.slice(0, 7) : '';
}

// Map high-level submit type labels → API entity_type
const ENTITY_TYPE_MAP: Record<string, EntityType> = {
  'on-hand update': 'inventory',
  'received counts': 'inventory',
  'invoice upload': 'inventory',
  'menu change': 'menu',
  'user update': 'user',
  'haccp log': 'compliance',
  'event update': 'event',
  'operations log': 'ops',
};

function inferEntityType(submitType: string): EntityType {
  return ENTITY_TYPE_MAP[submitType.toLowerCase()] ?? 'inventory';
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

  const [staged, setStaged] = useState<StagingEntry[]>([]);
  const [commits, setCommits] = useState<Commit[]>([]);
  const [apiLive, setApiLive] = useState(false);
  const [loading, setLoading] = useState(true);

  const [sType, setSType] = useState(() => DS.submitTypes()[0] || 'On-hand update');
  const [sSummary, setSSummary] = useState('');
  const [sItems, setSItems] = useState('');
  const [busy, setBusy] = useState(false);

  const loadData = useCallback(async () => {
    const live = await api.ping();
    setApiLive(live);
    if (live) {
      const [s, c] = await Promise.all([api.getStaging(), api.getCommits()]);
      setStaged(s);
      setCommits(c);
    } else {
      // Demo fallback while backend is being built
      setStaged(
        DS.staged().map((s: any) => ({
          entry_id: s.id,
          entity_type: inferEntityType(s.type || ''),
          entity_id: 'demo',
          field_name: s.type || 'change',
          new_value_text: s.summary,
          change_type: s.type,
          status: 'pending',
          submitted_by: s.username,
          submitter_name: s.author,
          submitter_role: s.role,
          created_at: s.submittedAt,
        } as StagingEntry)),
      );
      setCommits(
        DS.commits().map((c: any) => ({
          commit_id: c.hash,
          message: c.message,
          author_id: c.username || '',
          author_name: c.author,
          status: 'merged',
          branch: 'main',
          created_at: c.when,
          github_sha: c.synced ? c.hash : null,
          github_synced_at: c.synced ? c.when : null,
          change_count: c.files || 1,
        } as Commit)),
      );
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    onCountChange?.(staged.length);
  }, [staged.length, onCountChange]);

  async function submit() {
    if (!sSummary.trim() || busy) return;
    setBusy(true);
    try {
      const body = {
        entity_type: inferEntityType(sType),
        entity_id: 'batch',
        field_name: sType,
        new_value: sSummary.trim(),
        change_type: sType,
        metadata: { items_affected: parseInt(sItems) || 1, summary: sSummary.trim() },
      };

      if (apiLive) {
        const entry = await api.submitStaging(body);
        if (canCommit) {
          const commit = await api.approveCommit({
            staging_ids: [entry.entry_id],
            message: sSummary.trim(),
            author_id: user.id,
          });
          setCommits((cs) => [commit, ...cs]);
          (window as any).toast?.('Committed & synced to data store');
        } else {
          setStaged((s) => [entry, ...s]);
          (window as any).toast?.('Submitted for manager approval');
        }
      } else {
        // Demo mode — local state only
        if (canCommit) {
          setCommits((cs) => [
            {
              commit_id: 'demo-' + Date.now(),
              message: sSummary.trim(),
              author_id: user.id,
              author_name: (user.display_name + ' ' + (user.last_name || '')).trim(),
              status: 'merged',
              branch: 'main',
              created_at: new Date().toISOString(),
              github_sha: null,
              github_synced_at: null,
              change_count: parseInt(sItems) || 1,
            },
            ...cs,
          ]);
          (window as any).toast?.('Committed (demo — API offline)');
        } else {
          setStaged((s) => [
            {
              entry_id: 'demo-' + Date.now(),
              entity_type: inferEntityType(sType),
              entity_id: 'batch',
              field_name: sType,
              new_value_text: sSummary.trim(),
              change_type: sType,
              status: 'pending',
              submitted_by: user.username,
              submitter_name: (user.display_name + ' ' + (user.last_name || '')).trim(),
              submitter_role: user.role,
              created_at: new Date().toISOString(),
            },
            ...s,
          ]);
          (window as any).toast?.('Submitted (demo — API offline)');
        }
      }
      setSSummary('');
      setSItems('');
    } catch (err) {
      (window as any).toast?.('Error: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  }

  async function approve(entry: StagingEntry) {
    if (busy) return;
    setBusy(true);
    try {
      if (apiLive) {
        const commit = await api.approveCommit({
          staging_ids: [entry.entry_id],
          message: entry.new_value_text || entry.field_name,
          author_id: user.id,
        });
        setStaged((s) => s.filter((x) => x.entry_id !== entry.entry_id));
        setCommits((cs) => [commit, ...cs]);
      } else {
        setStaged((s) => s.filter((x) => x.entry_id !== entry.entry_id));
        setCommits((cs) => [
          {
            commit_id: 'demo-' + Date.now(),
            message: entry.new_value_text || entry.field_name,
            author_id: user.id,
            author_name: (user.display_name + ' ' + (user.last_name || '')).trim(),
            status: 'merged',
            branch: 'main',
            created_at: new Date().toISOString(),
            github_sha: null,
            github_synced_at: null,
            change_count: 1,
          },
          ...cs,
        ]);
      }
      (window as any).toast?.('Change committed' + (connected ? ' & synced' : ''));
    } catch (err) {
      (window as any).toast?.('Error: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  }

  async function approveAll() {
    if (!staged.length || busy) return;
    setBusy(true);
    try {
      if (apiLive) {
        const commit = await api.approveCommit({
          staging_ids: staged.map((s) => s.entry_id),
          message: `Batch commit — ${staged.length} staged change${staged.length !== 1 ? 's' : ''}`,
          author_id: user.id,
        });
        setStaged([]);
        setCommits((cs) => [commit, ...cs]);
      } else {
        setStaged([]);
        (window as any).toast?.('Batch committed (demo)');
      }
    } catch (err) {
      (window as any).toast?.('Error: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  }

  async function reject(entry: StagingEntry) {
    if (busy) return;
    setBusy(true);
    try {
      if (apiLive) {
        await api.rejectStaging(entry.entry_id);
      }
      setStaged((s) => s.filter((x) => x.entry_id !== entry.entry_id));
      (window as any).toast?.('Submission returned to author');
    } catch (err) {
      (window as any).toast?.('Error: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  }

  const myStaged = staged.filter((s) => s.submitted_by === user.username || s.submitter_name?.startsWith(user.display_name));
  const visibleStaged = isStaff ? myStaged : staged;
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
            {loading ? '…' : staged.length + ' pending'}
            {!apiLive && !loading && (
              <span className="pill warn" style={{ marginLeft: 8, fontSize: 11 }}>
                demo mode
              </span>
            )}
          </div>
        </div>
        <div className="ph-actions">
          {canReview && staged.length > 0 && (
            <button className="btn primary" onClick={approveAll} disabled={busy}>
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
                {' · last commit '}
                <span className="commit-hash">
                  {shortSha(lastCommit.github_sha) || lastCommit.commit_id.slice(0, 7)}
                </span>
                {' '}
                {relTime(lastCommit.created_at)}
              </>
            )}
          </div>
        </div>
        <span className={'pill ' + (lastCommit?.github_sha ? 'ok' : connected ? 'warn' : 'off')}>
          {lastCommit?.github_sha ? 'Synced' : connected ? 'Pending sync' : 'Offline'}
        </span>
      </div>

      <div className="grid-2">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card">
            <div className="card-head">
              <h3>{canCommit && !isStaff ? 'Commit a change' : 'Submit a change'}</h3>
            </div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr .8fr', gap: 12 }}>
                <label className="ft-field">
                  <span>Change type</span>
                  <select className="ipt sel" value={sType} onChange={(e) => setSType(e.target.value)}>
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
                <button className="btn primary" onClick={submit} disabled={!sSummary.trim() || busy}>
                  {canCommit && !isStaff ? (
                    <>{I.branch({ style: { width: 15, height: 15 } })} Commit &amp; sync</>
                  ) : (
                    <>{I.inbox({ style: { width: 15, height: 15 } })} Submit for review</>
                  )}
                </button>
              </div>
              {isStaff && (
                <div className="form-note" style={{ margin: 0 }}>
                  {I.alert({ style: { width: 13, height: 13 } })}
                  <span>Staff submissions are staged — a manager reviews and commits them to the record.</span>
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h3>{isStaff ? 'My pending submissions' : 'Review queue'}</h3>
              <span className="ch-link">{visibleStaged.length} staged</span>
            </div>
            <div className="card-body flush">
              {loading ? (
                <div style={{ padding: '26px 17px', textAlign: 'center', color: 'var(--faint)', fontSize: 12.5 }}>
                  Loading…
                </div>
              ) : visibleStaged.length === 0 ? (
                <div style={{ padding: '26px 17px', textAlign: 'center', color: 'var(--faint)', fontSize: 12.5 }}>
                  Nothing staged — the working tree is clean.
                </div>
              ) : (
                visibleStaged.map((ch) => (
                  <div className="stage-item" key={ch.entry_id}>
                    <div className="stage-ic">
                      {I.clock({ style: { width: 15, height: 15 } })}
                    </div>
                    <div className="stage-body">
                      <div className="stage-top">
                        <span className="stage-type">{ch.change_type}</span>
                        <span className="stage-items">
                          {(ch.metadata as any)?.items_affected ?? 1} item
                          {((ch.metadata as any)?.items_affected ?? 1) !== 1 ? 's' : ''}
                        </span>
                      </div>
                      <div className="stage-summary">{ch.new_value_text || ch.field_name}</div>
                      <div className="stage-meta">
                        <span className="avatar" style={{ width: 18, height: 18, fontSize: 8, borderRadius: 5 }}>
                          {(ch.submitter_name || ch.submitted_by)[0]?.toUpperCase() || '?'}
                        </span>
                        <b>{ch.submitter_name || ch.submitted_by}</b> · {relTime(ch.created_at)}
                      </div>
                    </div>
                    {canReview ? (
                      <div className="stage-actions">
                        <button
                          className="btn"
                          style={{ padding: '6px 10px' }}
                          onClick={() => reject(ch)}
                          disabled={busy}
                          title="Return to author"
                        >
                          {I.x({ style: { width: 14, height: 14 } })}
                        </button>
                        <button
                          className="btn primary"
                          style={{ padding: '6px 11px' }}
                          onClick={() => approve(ch)}
                          disabled={busy}
                        >
                          {I.check({ style: { width: 14, height: 14 } })} Commit
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
            {commits.map((c, i) => (
              <div className="commit-item" key={c.commit_id + i}>
                <div className="commit-graph">
                  <span className="cg-dot" />
                  {i < commits.length - 1 && <span className="cg-line" />}
                </div>
                <div className="commit-body">
                  <div className="commit-msg">{c.message}</div>
                  <div className="commit-meta">
                    <span className="commit-hash">
                      {shortSha(c.github_sha) || c.commit_id.slice(0, 7)}
                    </span>
                    <b>{c.author_name || c.author_id}</b>
                    {c.submitter_role && (
                      <span className={'pill role-' + c.submitter_role}>
                        {ROLE_LABEL[c.submitter_role as keyof typeof ROLE_LABEL] || c.submitter_role}
                      </span>
                    )}
                    <span>{relTime(c.created_at)}</span>
                    {c.github_sha && (
                      <span className="synced-tag">
                        {I.check({ style: { width: 11, height: 11 } })} synced
                      </span>
                    )}
                  </div>
                  <div className="commit-diff">
                    <span className="diff-files">
                      {c.change_count} field{c.change_count !== 1 ? 's' : ''}
                    </span>
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
