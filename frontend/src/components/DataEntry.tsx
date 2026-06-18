import { useState, useCallback, useEffect, useRef } from 'react';
import { I } from '../lib/icons';
import { ROLE_LEVEL, MONTHS, loadAIPrefs } from '../lib/constants';
import { api } from '../lib/api';

type Hint = '' | 'inventory' | 'events' | 'haccp' | 'menu' | 'log';

interface ReconciliationStats {
    computed_subtotal: number;
    stated_subtotal: number;
    vizient_discount: number;
    fuel_surcharge: number;
    net_total: number;
    discount_factor: number;
    adjusted_total: number;
    delta: number;
    delta_pct: number;
    reconciled: boolean;
    item_count: number;
}

interface UploadResult {
    batch_id: string;
    staged_count: number;
    sku_queued?: number;
    invoice_id?: string;
    is_reimport?: boolean;
    reconciliation?: ReconciliationStats;
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
    'Reading file structure...',
    'Identifying data type...',
    'Extracting fields with AI...',
    'Mapping to MJCC schema...',
    'Staging for review...',
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
                    {row.status || '-'}
                </span>
            </td>
            <td style={{ width: 110 }}>
                <code style={{ fontSize: 11 }}>{sku || '-'}</code>
            </td>
            <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, color: desc ? 'var(--ink)' : 'var(--faint)' }}>
                {desc || '-'}
            </td>
            <td>
                {changes.length > 0 ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {changes.slice(0, 5).map((field, i) => {
                            const bv = row.before?.[field];
                            const av = row.after?.[field];
                            return (
                                <span key={i} style={{ fontSize: 10.5, background: 'var(--amber-bg)', color: 'var(--amber-ink)', padding: '2px 7px', borderRadius: 5, fontWeight: 600 }}>
                                    {field}{bv !== undefined && bv !== null ? ` ${bv} ->` : ':'}{` ${av ?? '-'}`}
                                </span>
                            );
                        })}
                        {changes.length > 5 && <span style={{ fontSize: 10.5, color: 'var(--muted)' }}>+{changes.length - 5} more</span>}
                    </div>
                ) : row.status === 'new' ? (
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>new entry</span>
                ) : '-'}
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
                        <div style={{ fontWeight: 700, fontSize: 13, color: '#1e3a8a' }}>✦ MJCC AI is parsing...</div>
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
    const [aiStatus, setAiStatus]       = useState<{ provider: string; model: string; is_vision: boolean } | null>(null);

    const stageTimer = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => {
        api.getDataEntrySettings().then(cfg => {
            setAiEnabled(cfg?.ai_enabled !== false);
            if (cfg?.current?.provider) setAiStatus(cfg.current);
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

            {/* ── AI status bar ────────────────────────────── */}
            <div style={{
                display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12,
                padding: '8px 14px', borderRadius: 10,
                background: aiStatus ? 'var(--accent-soft)' : 'var(--amber-bg)',
                border: `1px solid ${aiStatus ? 'var(--accent)' : 'var(--amber-ink)'}`,
                fontSize: 12,
            }}>
                {aiStatus ? (
                    <>
                        <span style={{ color: '#3b82f6', fontSize: 14 }}>✶</span>
                        <span style={{ fontWeight: 700 }}>
                            {aiStatus.provider.charAt(0).toUpperCase() + aiStatus.provider.slice(1)}
                            {' · '}
                            {aiStatus.model}
                            {aiStatus.is_vision && ' ✶ Vision'}
                        </span>
                    </>
                ) : (
                    <span style={{ color: 'var(--amber-ink)', fontWeight: 700 }}>
                        No AI provider configured
                    </span>
                )}
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 700, cursor: 'default' }}>Settings</span>
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
                                        onClick={() => setDirection('received')}>Down Received</button>
                                    <button className={direction === 'issued' ? 'btn accent' : 'btn'}
                                        style={{ padding: '6px 13px', fontSize: 12, fontWeight: 700, minHeight: 36 }}
                                        onClick={() => setDirection('issued')}>Up Issued</button>
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
                                placeholder="Describe what this upload contains..."
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
                                {' -> '}{MONTHS[month]} {year}{week > 0 ? ` · W${week} ${direction}` : ''}
                                {hint && ` · ${hint}`}
                            </>
                        ) : 'Select a file to upload'}
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {result && <button className="btn" onClick={clearAll} style={{ fontSize: 12 }}>Upload another</button>}
                        <button className="btn primary" onClick={doUpload} disabled={!file || uploading} style={{ minWidth: 130, minHeight: 40 }}>
                            {I.inbox({ style: { width: 14, height: 14 } })}
                            {uploading ? 'AI parsing...' : 'Upload & Parse'}
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
                                    {result.staged_count} entries staged
                                    {result.is_reimport && (
                                        <span style={{ fontSize: 11, fontWeight: 600, color: '#92400e', background: '#fef3c7', border: '1px solid #f59e0b', padding: '1px 7px', borderRadius: 6 }}>
                                            re-import — will overwrite W{result.operations['inventory_week_update'] ? '' : '?'} values
                                        </span>
                                    )}
                                </div>
                                <div style={{ fontSize: 11.5, color: '#166534', marginTop: 4, opacity: 0.8 }}>
                                    {result.file} · {MONTHS[(result.month ?? 1) - 1] ?? result.month} {result.year}
                                    {result.ai_provider && ` · via ${result.ai_provider}`}
                                    {' · '}batch {result.batch_id?.slice(0, 8)}...
                                </div>
                                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 8 }}>
                                    {Object.entries(result.operations).map(([op, count], i) => (
                                        <span key={i} className="pill ok">{op} x {count}</span>
                                    ))}
                                    {(result.sku_queued ?? 0) > 0 && (
                                        <span
                                            className="pill warn"
                                            title="Unknown vendor SKUs sent to manager review queue"
                                            style={{ cursor: 'pointer' }}
                                            onClick={() => onNavigate?.('sourcectrl')}
                                        >
                                            {result.sku_queued} SKU{result.sku_queued !== 1 ? 's' : ''} queued for review
                                        </span>
                                    )}
                                </div>
                                {result.reconciliation && (
                                    <div style={{
                                        marginTop: 10, padding: '9px 12px',
                                        borderRadius: 8, fontSize: 12,
                                        background: result.reconciliation.reconciled ? '#f0fdf4' : '#fff7ed',
                                        border: `1px solid ${result.reconciliation.reconciled ? '#86efac' : '#fdba74'}`,
                                        color: result.reconciliation.reconciled ? '#166534' : '#9a3412',
                                    }}>
                                        <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
                                            {result.reconciliation.reconciled
                                                ? <>{I.checkCircle({ style: { width: 13, height: 13 } })} Invoice total reconciled</>
                                                : <>{I.alert({ style: { width: 13, height: 13 } })} Total mismatch — review before merging</>
                                            }
                                        </div>
                                        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 11.5, opacity: 0.85 }}>
                                            <span>Line items: <b>${result.reconciliation.computed_subtotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b></span>
                                            {result.reconciliation.vizient_discount > 0 && (
                                                <span>Vizient: <b>−${result.reconciliation.vizient_discount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b></span>
                                            )}
                                            {result.reconciliation.fuel_surcharge > 0 && (
                                                <span>Fuel: <b>+${result.reconciliation.fuel_surcharge.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b></span>
                                            )}
                                            <span style={{ fontWeight: 700 }}>
                                                Invoice TOTAL: ${result.reconciliation.net_total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                            </span>
                                            {!result.reconciliation.reconciled && (
                                                <span style={{ color: '#dc2626', fontWeight: 700 }}>
                                                    Δ ${result.reconciliation.delta.toFixed(2)} ({result.reconciliation.delta_pct.toFixed(2)}%)
                                                </span>
                                            )}
                                        </div>
                                        <div style={{ marginTop: 4, fontSize: 11, opacity: 0.7 }}>
                                            Stored prices adjusted by ×{result.reconciliation.discount_factor.toFixed(4)} — inventory value = ${result.reconciliation.adjusted_total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </div>
                                    </div>
                                )}
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
                            <span className="ph-sub">AI computing diff...</span>
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

        </div>
    );
}
