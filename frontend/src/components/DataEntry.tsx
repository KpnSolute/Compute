import { useState, useCallback, useEffect, useRef } from 'react';
import { I } from '../lib/icons';
import { ROLE_LEVEL, MONTHS, loadAIPrefs } from '../lib/constants';
import { api } from '../lib/api';

type Hint = '' | 'inventory' | 'events' | 'haccp' | 'menu' | 'log';

interface UploadResult {
    batch_id: string;
    staged_count: number;
    operations: Record<string, number>;
    file: string;
    month: number;
    year: number;
    ai_provider?: string;
    ai_model?: string;
}

interface DiffRow {
    status?: string;
    before?: Record<string, any> | null;
    after?: Record<string, any> | null;
    changes?: string[];
    [k: string]: any;
}

interface DiffTable {
    table: string;
    operation?: string;
    summary?: string;
    rows?: DiffRow[];
}

// ── style helpers ─────────────────────────────────────────────────────────────

const LBL: React.CSSProperties = {
    display: 'block', fontSize: 11, fontWeight: 700,
    color: 'var(--muted)', marginBottom: 5,
};
const STEP_LBL: React.CSSProperties = {
    fontSize: 10.5, fontWeight: 800, color: 'var(--faint)',
    textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 10,
};

function Hr() {
    return <div style={{ borderTop: '1px solid var(--line-soft)', margin: '18px -17px' }} />;
}

// ── WinCard (local — matches Portal.tsx WinCard) ──────────────────────────────

function WinCard({
    title, link, onLink, children, dots = false, defaultOpen = true, className = '', style,
}: {
    title: string; link?: string; onLink?: () => void; children: React.ReactNode;
    dots?: boolean; defaultOpen?: boolean; className?: string; style?: React.CSSProperties;
}) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div className={'card' + (!open ? ' win-collapsed' : '') + (className ? ' ' + className : '')} style={style}>
            <div className="card-head">
                {dots && (
                    <div className="win-dots">
                        <span className="win-dot red" /><span className="win-dot yellow" /><span className="win-dot green" />
                    </div>
                )}
                <button className="win-collapse" onClick={() => setOpen(v => !v)}>
                    {I.chevL({ style: { width: 13, height: 13, transform: open ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform .15s' } })}
                </button>
                <h3 style={{ flex: 1, color: 'var(--ink)', fontWeight: 700 }}>{title}</h3>
                {link && onLink && <span className="ch-link" onClick={onLink}>{link}</span>}
            </div>
            {open && <div className="card-body">{children}</div>}
        </div>
    );
}

// ── AI thinking dots ──────────────────────────────────────────────────────────

function ThinkingDots() {
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
            {[0, 1, 2].map(i => (
                <span key={i} className="agent-dot" style={{ animationDelay: `${i * 0.2}s`, background: '#3b82f6' }} />
            ))}
        </span>
    );
}

// ── AI status banner ──────────────────────────────────────────────────────────

const AI_STAGES = [
    'Reading file structure…',
    'Identifying data type…',
    'Extracting fields with AI…',
    'Mapping to MJCC schema…',
    'Staging for review…',
];

function AIStatusBanner({ stage }: { stage: number }) {
    return (
        <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '11px 15px', marginTop: 10,
            background: 'linear-gradient(135deg, #eff5fe 0%, #f0f4ff 100%)',
            border: '1px solid #bfdbfe', borderRadius: 10,
            fontSize: 12.5, color: '#1e3a8a', fontWeight: 600,
        }}>
            <span style={{ fontSize: 16, animation: 'aiSparkFade 2s ease-in-out infinite' }}>✦</span>
            <span style={{ flex: 1 }}>{AI_STAGES[Math.min(stage, AI_STAGES.length - 1)]}</span>
            <ThinkingDots />
        </div>
    );
}

// ── diff row ──────────────────────────────────────────────────────────────────

function DiffRowPreview({ row }: { row: DiffRow }) {
    const sku  = row.after?.sku  || row.before?.sku  || '';
    const desc = row.after?.description || row.before?.description ||
                 row.after?.desc        || row.before?.desc        || '';
    const changes = row.changes || [];

    return (
        <tr>
            <td style={{ width: 72 }}>
                <span className={
                    row.status === 'new' ? 'pill ok' :
                    row.status === 'update' ? 'pill warn' : 'pill off'
                }>
                    {row.status || '—'}
                </span>
            </td>
            <td style={{ width: 110 }}>
                <code style={{ fontSize: 11 }}>{sku || '—'}</code>
            </td>
            <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, color: desc ? 'var(--ink)' : 'var(--faint)' }}>
                {desc || '—'}
            </td>
            <td>
                {changes.length > 0 ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {changes.slice(0, 5).map((field, i) => {
                            const bv = row.before?.[field];
                            const av = row.after?.[field];
                            return (
                                <span key={i} style={{ fontSize: 10.5, background: 'var(--amber-bg)', color: 'var(--amber-ink)', padding: '2px 7px', borderRadius: 5, fontWeight: 600 }}>
                                    {field}{bv !== undefined && bv !== null ? ` ${bv} →` : ':'}{` ${av ?? '—'}`}
                                </span>
                            );
                        })}
                        {changes.length > 5 && <span style={{ fontSize: 10.5, color: 'var(--muted)' }}>+{changes.length - 5} more</span>}
                    </div>
                ) : row.status === 'new' ? (
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>new entry</span>
                ) : '—'}
            </td>
        </tr>
    );
}

// ── file drop zone ────────────────────────────────────────────────────────────

const ACCEPTED = '.csv,.tsv,.xls,.xlsx,.pdf,.txt,.jpg,.jpeg,.png,.webp,.bmp,.gif,.tif,.tiff';
const FILE_TYPES = 'CSV · Excel · PDF · Images · Pull sheets · Invoices';

function FileZone({
    file, uploading, onFile, onClear,
}: {
    file: File | null; uploading: boolean;
    onFile: (f: File) => void; onClear: () => void;
}) {
    const [drag, setDrag] = useState(false);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files[0];
        if (f) onFile(f);
    }, [onFile]);

    return (
        <label
            className={`de-file-zone${uploading ? ' ai-glow-zone' : ''}`}
            onDragOver={e => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={handleDrop}
            style={{
                display: 'flex', alignItems: 'center', gap: 13,
                border: `2px dashed ${file || drag ? 'var(--navy)' : 'var(--line)'}`,
                borderRadius: 12, padding: '16px 18px',
                cursor: 'pointer',
                background: uploading
                    ? 'linear-gradient(135deg, #eff5fe 0%, #f0f4ff 100%)'
                    : file || drag ? 'var(--accent-soft)' : 'var(--surface-2)',
                transition: 'border-color .15s, background .15s',
                position: 'relative', overflow: 'hidden',
                minHeight: 64,
            }}
        >
            <input
                type="file" accept={ACCEPTED} style={{ display: 'none' }}
                onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); }}
            />
            {uploading && (
                <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
                    <div style={{
                        position: 'absolute', left: 0, right: 0, height: 2,
                        background: 'linear-gradient(90deg, transparent, rgba(59,130,246,0.6), transparent)',
                        animation: 'aiScanLine 1.8s linear infinite',
                    }} />
                </div>
            )}
            {I.fileText({ style: { width: 22, height: 22, flexShrink: 0, color: file ? 'var(--navy)' : 'var(--muted)' } })}
            <div style={{ flex: 1, minWidth: 0 }}>
                {uploading ? (
                    <>
                        <div style={{ fontWeight: 700, fontSize: 13, color: '#1e3a8a' }}>✦ MJCC AI is parsing…</div>
                        <div style={{ fontSize: 11, color: '#3b82f6', marginTop: 2 }}>{file?.name}</div>
                    </>
                ) : file ? (
                    <>
                        <div style={{ fontWeight: 700, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                            {file.size < 1024 ? `${file.size} B` : `${(file.size / 1024).toFixed(0)} KB`}
                        </div>
                    </>
                ) : (
                    <>
                        <div style={{ fontWeight: 700, fontSize: 13 }}>{drag ? 'Drop to upload' : 'Tap or drag a file'}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{FILE_TYPES}</div>
                    </>
                )}
            </div>
            {file && !uploading && (
                <button
                    onClick={e => { e.preventDefault(); e.stopPropagation(); onClear(); }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 6, borderRadius: 6, display: 'flex', flexShrink: 0 }}
                    title="Remove file"
                >
                    {I.x({ style: { width: 15, height: 15 } })}
                </button>
            )}
        </label>
    );
}

// ── main component ─────────────────────────────────────────────────────────────

export function DataEntry({ user, onNavigate }: { user: any; onNavigate?: (key: string) => void }) {
    const lvl = ROLE_LEVEL[user.role as keyof typeof ROLE_LEVEL] ?? 0;
    const isSudo = lvl >= 50;
    const now = new Date();

    const aiPrefs = loadAIPrefs(user.id);

    const [file, setFile]           = useState<File | null>(null);
    const [hint, setHint]           = useState<Hint>('');
    const [month, setMonth]         = useState<number>(now.getMonth());
    const [year, setYear]           = useState<number>(now.getFullYear());
    const [week, setWeek]           = useState<number>(0);
    const [direction, setDirection] = useState<'received' | 'issued'>('received');
    const [description, setDescription] = useState('');

    const [uploading, setUploading]     = useState(false);
    const [aiStage, setAiStage]         = useState(0);
    const [uploadErr, setUploadErr]     = useState<string | null>(null);
    const [result, setResult]           = useState<UploadResult | null>(null);

    const [preview, setPreview]           = useState<DiffTable[] | null>(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [previewErr, setPreviewErr]     = useState<string | null>(null);

    const [aiEnabled, setAiEnabled]     = useState(true);
    const [aiCfgLoading, setAiCfgLoading] = useState(true);

    const stageTimer = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => {
        api.getDataEntrySettings().then(cfg => {
            setAiEnabled(cfg?.ai_enabled !== false);
        }).catch(() => {}).finally(() => setAiCfgLoading(false));
    }, []);

    useEffect(() => {
        if (uploading) {
            setAiStage(0);
            stageTimer.current = setInterval(() => {
                setAiStage(s => Math.min(s + 1, AI_STAGES.length - 1));
            }, 1400);
        } else {
            if (stageTimer.current) clearInterval(stageTimer.current);
        }
        return () => { if (stageTimer.current) clearInterval(stageTimer.current); };
    }, [uploading]);

    const loadPreview = useCallback(async (batchId: string) => {
        setPreviewLoading(true);
        setPreviewErr(null);
        try {
            const diffs = await api.getDataEntryPreview(batchId);
            setPreview(diffs as DiffTable[]);
        } catch (e: any) {
            setPreviewErr(e?.message || 'Failed to load preview');
            setPreview(null);
        } finally {
            setPreviewLoading(false);
        }
    }, []);

    const doUpload = useCallback(async () => {
        if (!file) return;
        setUploading(true);
        setUploadErr(null);
        setResult(null);
        setPreview(null);
        try {
            const res = await api.uploadDataEntry(file, hint, month + 1, year, week, direction, description);
            setResult(res);
            window.dispatchEvent(new CustomEvent('mjcc:staging-changed'));
            await loadPreview(res.batch_id);
        } catch (e: any) {
            setUploadErr(e?.message || 'Upload failed');
        } finally {
            setUploading(false);
        }
    }, [file, hint, month, year, week, direction, description, loadPreview]);

    const clearAll = () => {
        setFile(null);
        setResult(null);
        setUploadErr(null);
        setPreview(null);
    };

    const stagedCount = result?.staged_count ?? 0;

    return (
        <div className="fade-in">
            <div className="page-head">
                <div>
                    <h2>Data Entry</h2>
                    <div className="ph-sub">
                        AI-powered parsing — upload any file, AI extracts and routes to Source Control
                    </div>
                </div>
                {!aiCfgLoading && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: 5,
                            fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 8,
                            background: aiEnabled ? '#eff5fe' : '#f3f4f6',
                            color: aiEnabled ? '#1e3a8a' : 'var(--muted)',
                            border: `1px solid ${aiEnabled ? '#bfdbfe' : 'var(--line)'}`,
                        }}>
                            <span>✦</span>
                            AI {aiEnabled ? 'Active' : 'Disabled'}
                        </span>
                        {isSudo && (
                            <button className="btn" style={{ fontSize: 11, padding: '4px 10px' }}
                                onClick={() => onNavigate?.('settings')}>Configure</button>
                        )}
                    </div>
                )}
            </div>

            {/* ── Upload card ─────────────────────────────────────────── */}
            <WinCard
                title="Upload file"
                dots
                link={result ? `✓ ${stagedCount} staged` : undefined}
            >
                <div>
                    <div style={STEP_LBL}>1 — File</div>
                    <div className={aiPrefs.effects && uploading ? 'ai-ring-wrap' : ''} style={{ borderRadius: 12 }}>
                        <FileZone
                            file={file} uploading={uploading}
                            onFile={f => { setFile(f); setResult(null); setUploadErr(null); setPreview(null); }}
                            onClear={clearAll}
                        />
                    </div>
                    {uploading && <AIStatusBanner stage={aiStage} />}
                </div>

                <Hr />

                <div>
                    <div style={STEP_LBL}>2 — Period &amp; target</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                            <div>
                                <label style={LBL}>Month</label>
                                <select className="tb-select" value={month} onChange={e => setMonth(+e.target.value)}>
                                    {MONTHS.map((nm, i) => <option key={i} value={i}>{nm}</option>)}
                                </select>
                            </div>
                            <div>
                                <label style={LBL}>Year</label>
                                <select className="tb-select" value={year} onChange={e => setYear(+e.target.value)}>
                                    {[2024, 2025, 2026].map(yr => <option key={yr} value={yr}>{yr}</option>)}
                                </select>
                            </div>
                            <div>
                                <label style={LBL}>Hint <span style={{ fontWeight: 400, color: 'var(--faint)' }}>(optional)</span></label>
                                <select className="tb-select" value={hint} onChange={e => setHint(e.target.value as Hint)}>
                                    <option value="">✦ AI auto-detect</option>
                                    <option value="inventory">Inventory</option>
                                    <option value="events">Events</option>
                                    <option value="haccp">HACCP</option>
                                    <option value="menu">Menu</option>
                                    <option value="log">Log</option>
                                </select>
                            </div>
                        </div>

                        <div>
                            <label style={LBL}>Invoice week</label>
                            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                {[0, 1, 2, 3, 4].map(w => (
                                    <button key={w} className={week === w ? 'btn primary' : 'btn'}
                                        style={{ padding: '6px 13px', fontSize: 12, fontWeight: 700, minHeight: 36 }}
                                        onClick={() => setWeek(w)}>
                                        {w === 0 ? 'Month' : `W${w}`}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {week > 0 && (
                            <div>
                                <label style={LBL}>Direction</label>
                                <div style={{ display: 'flex', gap: 4 }}>
                                    <button className={direction === 'received' ? 'btn primary' : 'btn'}
                                        style={{ padding: '6px 13px', fontSize: 12, fontWeight: 700, minHeight: 36 }}
                                        onClick={() => setDirection('received')}>↓ Received</button>
                                    <button className={direction === 'issued' ? 'btn accent' : 'btn'}
                                        style={{ padding: '6px 13px', fontSize: 12, fontWeight: 700, minHeight: 36 }}
                                        onClick={() => setDirection('issued')}>↑ Issued</button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {lvl >= 40 && (
                    <>
                        <Hr />
                        <div>
                            <div style={STEP_LBL}>3 — Change description <span style={{ fontWeight: 400, color: 'var(--faint)', textTransform: 'none' }}>(optional · logged with commit)</span></div>
                            <textarea
                                className={`sheet-inp txt${aiPrefs.effects ? ' ai-ring' : ''}`}
                                value={description} rows={2} maxLength={500}
                                placeholder="Describe what this upload contains…"
                                style={{ width: '100%', resize: 'vertical', fontSize: 12.5 }}
                                onChange={e => setDescription(e.target.value)}
                            />
                            <div style={{ fontSize: 10.5, color: 'var(--faint)', marginTop: 4 }}>
                                {description.length}/500 · the AI will use this as context when parsing ambiguous fields
                            </div>
                        </div>
                    </>
                )}

                <Hr />

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                    <div style={{ fontSize: 12, color: 'var(--muted)', minWidth: 0 }}>
                        {file ? (
                            <>
                                <span style={{ fontWeight: 700, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block', maxWidth: 200, verticalAlign: 'bottom' }}>
                                    {file.name}
                                </span>
                                {' → '}{MONTHS[month]} {year}{week > 0 ? ` · W${week} ${direction}` : ''}
                                {hint && ` · ${hint}`}
                            </>
                        ) : 'Select a file to upload'}
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {result && <button className="btn" onClick={clearAll} style={{ fontSize: 12 }}>Upload another</button>}
                        <button className="btn primary" onClick={doUpload} disabled={!file || uploading} style={{ minWidth: 130, minHeight: 40 }}>
                            {I.inbox({ style: { width: 14, height: 14 } })}
                            {uploading ? 'AI parsing…' : 'Upload & Parse'}
                        </button>
                    </div>
                </div>

                {uploadErr && (
                    <div className="banner warn" style={{ marginTop: 12, marginBottom: 0 }}>
                        {I.alert()}<span>{uploadErr}</span>
                    </div>
                )}

                {result && !uploading && (
                    <div style={{
                        marginTop: 12, padding: '14px 16px',
                        background: 'linear-gradient(135deg, #f0fdf4 0%, #eff5fe 100%)',
                        border: '1px solid #86efac', borderRadius: 12,
                    }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                            <div style={{ flex: 1, minWidth: 140 }}>
                                <div style={{ fontWeight: 800, fontSize: 13.5, color: '#15803d', display: 'flex', alignItems: 'center', gap: 6 }}>
                                    {I.checkCircle({ style: { width: 16, height: 16, color: '#15803d', flexShrink: 0 } })}
                                    {result.staged_count} entries staged by AI
                                </div>
                                <div style={{ fontSize: 11.5, color: '#166534', marginTop: 4, opacity: 0.8 }}>
                                    {result.file} · {MONTHS[(result.month ?? 1) - 1] ?? result.month} {result.year}
                                    {result.ai_provider && ` · via ${result.ai_provider}`}
                                    {' · '}batch {result.batch_id?.slice(0, 8)}…
                                </div>
                                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 8 }}>
                                    {Object.entries(result.operations).map(([op, count], i) => (
                                        <span key={i} className="pill ok">{op} × {count}</span>
                                    ))}
                                </div>
                            </div>
                            <button
                                onClick={() => onNavigate?.('sourcectrl')}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 7,
                                    padding: '10px 18px', borderRadius: 10,
                                    background: 'var(--navy)', color: '#fff',
                                    border: 'none', cursor: 'pointer',
                                    fontWeight: 700, fontSize: 13,
                                    flexShrink: 0, minHeight: 44,
                                    boxShadow: '0 2px 8px rgba(30,58,138,0.25)',
                                    transition: 'opacity .15s',
                                }}
                                onMouseEnter={e => (e.currentTarget.style.opacity = '0.88')}
                                onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
                            >
                                {I.branch({ style: { width: 15, height: 15 } })}
                                Review in Source Control
                                <span style={{ fontSize: 11, background: 'rgba(255,255,255,0.2)', padding: '1px 7px', borderRadius: 6 }}>
                                    {result.staged_count}
                                </span>
                            </button>
                        </div>
                    </div>
                )}
            </WinCard>

            {/* ── Diff preview card ──────────────────────────────────── */}
            {(result || previewLoading || previewErr) && (
                <WinCard title="AI Extract Preview" style={{ marginTop: 14 }}
                    link={result ? 'Refresh' : undefined}
                    onLink={result ? () => loadPreview(result.batch_id) : undefined}
                >
                    {previewErr && (
                        <div className="banner warn" style={{ marginBottom: 0 }}>
                            {I.alert()} <span>{previewErr}</span>
                        </div>
                    )}
                    {previewLoading && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ color: '#3b82f6', fontSize: 15 }}>✦</span>
                            <span className="ph-sub">AI computing diff…</span>
                            <ThinkingDots />
                        </div>
                    )}
                    {!previewLoading && preview && preview.map((d, di) => (
                        <div key={di}>
                            <div className="card-head" style={{ background: 'var(--surface-2)', margin: di > 0 ? '0 -17px' : '0 -17px', marginTop: di > 0 ? 1 : -16 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <span className="pill off" style={{ fontSize: 10 }}>{d.operation || d.table}</span>
                                    <span style={{ fontSize: 12.5, fontWeight: 600 }}>{d.table}</span>
                                </div>
                                {d.summary && <span className="ph-sub">{d.summary}</span>}
                            </div>
                            <div className="tbl-wrap" style={{ margin: '0 -17px', padding: '0 17px' }}>
                                <table className="data">
                                    <thead>
                                        <tr><th>Status</th><th>SKU</th><th>Description</th><th>Changes</th></tr>
                                    </thead>
                                    <tbody>
                                        {(d.rows || []).map((row, ri) => <DiffRowPreview key={ri} row={row} />)}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    ))}
                </WinCard>
            )}

            {/* ── AI stack settings (manager+) ───────────────────────── */}
            {lvl >= 30 && <AIStackSettings isSudo={isSudo} />}

            {/* ── AI keys (sudo only) ────────────────────────────────── */}
            {isSudo && <AIKeysPanel />}

            {/* ── AI usage stats (sudo only) ─────────────────────────── */}
            {isSudo && <AIUsagePanel />}
        </div>
    );
}

// ── AI stack settings ─────────────────────────────────────────────────────────

const PROVIDER_LABELS: Record<string, string> = {
    groq:      'Groq',
    anthropic: 'Anthropic (Claude)',
    openai:    'OpenAI',
    mistral:   'Mistral AI',
    ollama:    'Ollama (local)',
    lm_studio: 'LM Studio (local)',
};

const LOCAL_PROVIDERS = new Set(['ollama', 'lm_studio']);

function AIStackSettings({ isSudo }: { isSudo: boolean }) {
    const [loading, setLoading] = useState(true);
    const [err, setErr]         = useState<string | null>(null);
    const [provider, setProvider] = useState('');
    const [model, setModel]       = useState('');
    const [ollamaUrl, setOllamaUrl] = useState('');
    const [modelOptions, setModelOptions] = useState<string[]>([]);
    const [allModels, setAllModels] = useState<Record<string, string[]>>({});
    const [providers, setProviders] = useState<string[]>([]);
    const [saving, setSaving]   = useState(false);
    const [saved, setSaved]     = useState(false);

    useEffect(() => {
        let alive = true;
        (async () => {
            setLoading(true); setErr(null);
            try {
                const cfg = await api.getDataEntrySettings();
                if (!alive) return;
                const cur = cfg?.current || {};
                setProvider(cur.provider || '');
                setModel(cur.model || '');
                setOllamaUrl(cur.ollama_url || '');
                setProviders(cfg?.supported_providers || []);
                const models: Record<string, string[]> = {
                    groq:      cfg?.groq_models      || [],
                    anthropic: cfg?.anthropic_models || [],
                    openai:    cfg?.openai_models    || [],
                    mistral:   cfg?.mistral_models   || [],
                    ollama:    cfg?.ollama_models    || [],
                    lm_studio: cfg?.lm_studio_models || [],
                };
                setAllModels(models);
                setModelOptions(models[cur.provider] || []);
            } catch (e: any) {
                if (alive) setErr(e?.message || 'Failed to load settings');
            } finally {
                if (alive) setLoading(false);
            }
        })();
        return () => { alive = false; };
    }, []);

    // Update model options when provider changes
    const handleProviderChange = (p: string) => {
        setProvider(p);
        const opts = allModels[p] || [];
        setModelOptions(opts);
        setModel(opts[0] || '');
        setSaved(false);
    };

    const save = async () => {
        setSaving(true); setErr(null); setSaved(false);
        try {
            const body: any = { provider, model };
            if (LOCAL_PROVIDERS.has(provider) && ollamaUrl) body.ollama_url = ollamaUrl;
            await api.updateDataEntrySettings(body);
            setSaved(true);
        } catch (e: any) {
            setErr(e?.message || 'Failed to save');
        } finally {
            setSaving(false);
        }
    };

    return (
        <WinCard title="AI stack settings" style={{ marginTop: 14 }} defaultOpen={true}>
            {loading && <div style={{ color: 'var(--muted)', fontSize: 12 }}>Loading…</div>}
            {err && <div className="banner warn" style={{ marginBottom: 10 }}>{I.alert()} <span>{err}</span></div>}
            {!loading && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-end' }}>
                    <div>
                        <label style={LBL}>Provider</label>
                        <select className="tb-select" value={provider} onChange={e => handleProviderChange(e.target.value)}
                            style={{ minWidth: 160 }}>
                            {providers.map(p => (
                                <option key={p} value={p}>{PROVIDER_LABELS[p] || p}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label style={LBL}>Model</label>
                        {modelOptions.length > 0 ? (
                            <select className="tb-select" value={model} onChange={e => { setModel(e.target.value); setSaved(false); }}
                                style={{ minWidth: 240 }}>
                                {modelOptions.map(m => <option key={m} value={m}>{m}</option>)}
                            </select>
                        ) : (
                            <input className="tb-select" value={model} onChange={e => { setModel(e.target.value); setSaved(false); }}
                                placeholder="e.g. llama-3.3-70b-versatile" style={{ minWidth: 240 }} />
                        )}
                    </div>

                    {LOCAL_PROVIDERS.has(provider) && (
                        <div>
                            <label style={LBL}>Server URL</label>
                            <input className="tb-select" value={ollamaUrl}
                                onChange={e => { setOllamaUrl(e.target.value); setSaved(false); }}
                                placeholder="http://localhost:11434" style={{ minWidth: 200 }} />
                        </div>
                    )}

                    <button className="btn primary" onClick={save} disabled={saving} style={{ minHeight: 36 }}>
                        {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save'}
                    </button>

                    {!isSudo && (
                        <div style={{ fontSize: 11, color: 'var(--muted)', alignSelf: 'center' }}>
                            API keys are managed by a sudo administrator.
                        </div>
                    )}
                </div>
            )}
        </WinCard>
    );
}

// ── AI keys panel (sudo only) ─────────────────────────────────────────────────

function AIKeysPanel() {
    const [loading, setLoading] = useState(true);
    const [err, setErr]         = useState<string | null>(null);
    const [keys, setKeys]       = useState<any[]>([]);
    const [editing, setEditing] = useState<Record<string, { key: string; url: string; active: boolean }>>({});
    const [saveBusy, setSaveBusy] = useState<Record<string, boolean>>({});
    const [saveOk, setSaveOk]   = useState<Record<string, boolean>>({});

    const load = useCallback(() => {
        setLoading(true); setErr(null);
        api.getAIKeys()
            .then(data => setKeys(data || []))
            .catch(e => setErr(e?.message || 'Failed to load API keys'))
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => { load(); }, [load]);

    const startEdit = (k: any) =>
        setEditing(p => ({ ...p, [k.provider]: { key: '', url: k.base_url || '', active: k.is_active } }));
    const cancelEdit = (provider: string) =>
        setEditing(p => { const n = { ...p }; delete n[provider]; return n; });

    const saveKey = async (provider: string) => {
        const vals = editing[provider];
        if (!vals) return;
        setSaveBusy(p => ({ ...p, [provider]: true }));
        setSaveOk(p => ({ ...p, [provider]: false }));
        try {
            const body: any = { is_active: vals.active };
            if (vals.key) body.api_key = vals.key;
            if (vals.url !== undefined) body.base_url = vals.url || null;
            await api.updateAIKey(provider, body);
            setSaveOk(p => ({ ...p, [provider]: true }));
            cancelEdit(provider);
            load();
        } catch (e: any) {
            setErr(e?.message || 'Save failed');
        } finally {
            setSaveBusy(p => ({ ...p, [provider]: false }));
        }
    };

    return (
        <WinCard title="API keys" defaultOpen={false} style={{ marginTop: 14 }}>
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 12 }}>
                Keys are stored encrypted in the database — never returned to the frontend. Only one provider can be active at a time.
            </div>
            {loading && <div style={{ color: 'var(--muted)', fontSize: 12 }}>Loading…</div>}
            {err && <div className="banner warn" style={{ marginBottom: 10 }}>{I.alert()} <span>{err}</span></div>}
            {!loading && (
                <table className="data">
                    <thead>
                        <tr><th>Provider</th><th>Key</th><th style={{ width: 80 }}>Active</th><th></th></tr>
                    </thead>
                    <tbody>
                        {keys.map(k => {
                            const isEditing = !!editing[k.provider];
                            const isLocal = LOCAL_PROVIDERS.has(k.provider);
                            return (
                                <tr key={k.provider}>
                                    <td style={{ fontWeight: 700 }}>{PROVIDER_LABELS[k.provider] || k.provider}</td>
                                    <td>
                                        {isEditing ? (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                                {!isLocal && (
                                                    <input
                                                        type="password"
                                                        className="sheet-inp"
                                                        placeholder="Paste new key (leave blank to keep existing)"
                                                        value={editing[k.provider].key}
                                                        onChange={e => setEditing(p => ({ ...p, [k.provider]: { ...p[k.provider], key: e.target.value } }))}
                                                        style={{ minWidth: 260 }}
                                                    />
                                                )}
                                                {(isLocal || k.provider === 'openai') && (
                                                    <input
                                                        className="sheet-inp"
                                                        placeholder="Base URL (optional)"
                                                        value={editing[k.provider].url}
                                                        onChange={e => setEditing(p => ({ ...p, [k.provider]: { ...p[k.provider], url: e.target.value } }))}
                                                        style={{ minWidth: 200 }}
                                                    />
                                                )}
                                            </div>
                                        ) : (
                                            <span style={{ fontSize: 12 }}>
                                                {k.has_key ? (
                                                    <span style={{ color: 'var(--green)', fontWeight: 700 }}>● Key set</span>
                                                ) : (
                                                    <span style={{ color: 'var(--muted)' }}>○ No key</span>
                                                )}
                                                {k.base_url && <span style={{ marginLeft: 8, color: 'var(--faint)', fontFamily: 'monospace', fontSize: 10.5 }}>{k.base_url}</span>}
                                            </span>
                                        )}
                                    </td>
                                    <td>
                                        {isEditing ? (
                                            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12 }}>
                                                <input
                                                    type="checkbox"
                                                    checked={editing[k.provider].active}
                                                    onChange={e => setEditing(p => ({ ...p, [k.provider]: { ...p[k.provider], active: e.target.checked } }))}
                                                />
                                                Active
                                            </label>
                                        ) : (
                                            k.is_active ? (
                                                <span className="pill ok" style={{ fontSize: 10 }}>Active</span>
                                            ) : (
                                                <span className="pill off" style={{ fontSize: 10 }}>Inactive</span>
                                            )
                                        )}
                                    </td>
                                    <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                                        {isEditing ? (
                                            <>
                                                <button className="btn primary" style={{ fontSize: 11, padding: '3px 10px', marginRight: 4 }}
                                                    onClick={() => saveKey(k.provider)} disabled={saveBusy[k.provider]}>
                                                    {saveBusy[k.provider] ? '…' : saveOk[k.provider] ? '✓' : 'Save'}
                                                </button>
                                                <button className="btn" style={{ fontSize: 11, padding: '3px 10px' }} onClick={() => cancelEdit(k.provider)}>
                                                    Cancel
                                                </button>
                                            </>
                                        ) : (
                                            <button className="btn" style={{ fontSize: 11, padding: '3px 10px' }} onClick={() => startEdit(k)}>
                                                {k.has_key ? 'Update key' : 'Set key'}
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            )}
        </WinCard>
    );
}

// ── AI usage stats panel (sudo only) ─────────────────────────────────────────

function AIUsagePanel() {
    const [loading, setLoading] = useState(false);
    const [err, setErr]         = useState<string | null>(null);
    const [data, setData]       = useState<any>(null);
    const [days, setDays]       = useState(30);

    const load = useCallback(() => {
        setLoading(true); setErr(null);
        api.getAIUsage(days, 50)
            .then(d => setData(d))
            .catch(e => setErr(e?.message || 'Failed to load usage'))
            .finally(() => setLoading(false));
    }, [days]);

    // Load when first opened (triggered by defaultOpen=false → lazy load on expand would need state;
    // just load immediately but default collapsed)
    useEffect(() => { load(); }, [load]);

    const fmt = (n: number, dec = 0) => n.toLocaleString('en-US', { maximumFractionDigits: dec });
    const fmtCost = (n: number) => n < 0.001 ? `<$0.001` : `$${n.toFixed(4)}`;

    const summary = data?.summary || {};
    const byProvider = data?.by_provider || {};
    const recent: any[] = data?.recent || [];

    return (
        <WinCard title="AI usage" defaultOpen={false} style={{ marginTop: 14 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
                <label style={{ ...LBL, marginBottom: 0 }}>Window</label>
                {[7, 30, 90].map(d => (
                    <button key={d} className={days === d ? 'btn primary' : 'btn'}
                        style={{ fontSize: 11, padding: '3px 10px' }}
                        onClick={() => setDays(d)}>
                        {d}d
                    </button>
                ))}
                <button className="btn" style={{ fontSize: 11, padding: '3px 10px' }} onClick={load} disabled={loading}>
                    {loading ? '…' : 'Refresh'}
                </button>
            </div>

            {err && <div className="banner warn" style={{ marginBottom: 10 }}>{I.alert()} <span>{err}</span></div>}

            {loading && <div style={{ color: 'var(--muted)', fontSize: 12 }}>Loading…</div>}

            {!loading && data && (
                <>
                    {/* Summary row */}
                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
                        {[
                            { label: 'Total calls', val: fmt(summary.total_calls) },
                            { label: 'Success rate', val: summary.total_calls ? `${Math.round((summary.successful / summary.total_calls) * 100)}%` : '—' },
                            { label: 'Total tokens', val: fmt(summary.total_tokens) },
                            { label: 'Total cost', val: fmtCost(summary.cost_usd || 0) },
                            { label: 'Avg latency', val: `${fmt(summary.avg_duration_ms)}ms` },
                        ].map(s => (
                            <div key={s.label} style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '10px 14px', minWidth: 100 }}>
                                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 4 }}>{s.label}</div>
                                <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--ink)' }}>{s.val}</div>
                            </div>
                        ))}
                    </div>

                    {/* Per-provider */}
                    {Object.keys(byProvider).length > 0 && (
                        <>
                            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 8 }}>By provider</div>
                            <table className="data" style={{ marginBottom: 16 }}>
                                <thead><tr><th>Provider</th><th className="r">Calls</th><th className="r">Tokens in</th><th className="r">Tokens out</th><th className="r">Cost</th></tr></thead>
                                <tbody>
                                    {Object.entries(byProvider).map(([p, s]: [string, any]) => (
                                        <tr key={p}>
                                            <td style={{ fontWeight: 600 }}>{PROVIDER_LABELS[p] || p}</td>
                                            <td className="r num">{fmt(s.calls)}</td>
                                            <td className="r num">{fmt(s.tokens_in)}</td>
                                            <td className="r num">{fmt(s.tokens_out)}</td>
                                            <td className="r num">{fmtCost(s.cost_usd)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </>
                    )}

                    {/* Recent calls */}
                    {recent.length > 0 && (
                        <>
                            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 8 }}>Recent calls</div>
                            <div className="tbl-wrap">
                                <table className="data">
                                    <thead><tr><th>Provider</th><th>Model</th><th>Operation</th><th className="r">Tokens</th><th className="r">Cost</th><th className="r">ms</th><th>Status</th><th>Time</th></tr></thead>
                                    <tbody>
                                        {recent.map((r: any) => (
                                            <tr key={r.id}>
                                                <td style={{ fontWeight: 600, fontSize: 11 }}>{PROVIDER_LABELS[r.provider] || r.provider}</td>
                                                <td style={{ fontFamily: 'monospace', fontSize: 10.5, color: 'var(--muted)', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.model}</td>
                                                <td style={{ fontSize: 11 }}>{r.operation || '—'}</td>
                                                <td className="r num">{fmt((r.tokens_in || 0) + (r.tokens_out || 0))}</td>
                                                <td className="r num">{fmtCost(r.cost_usd || 0)}</td>
                                                <td className="r num">{fmt(r.duration_ms || 0)}</td>
                                                <td>
                                                    <span className={`pill ${r.success ? 'ok' : 'off'}`} style={{ fontSize: 10 }}>
                                                        {r.success ? 'ok' : 'err'}
                                                    </span>
                                                    {!r.success && r.error_msg && (
                                                        <span style={{ fontSize: 10, color: 'var(--red)', marginLeft: 4 }} title={r.error_msg}>⚠</span>
                                                    )}
                                                </td>
                                                <td style={{ fontSize: 10.5, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                                                    {new Date(r.created_at).toLocaleString()}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    )}

                    {summary.total_calls === 0 && (
                        <div style={{ textAlign: 'center', color: 'var(--faint)', fontSize: 12, padding: '20px 0' }}>
                            No AI calls in the last {days} days.
                        </div>
                    )}
                </>
            )}
        </WinCard>
    );
}
