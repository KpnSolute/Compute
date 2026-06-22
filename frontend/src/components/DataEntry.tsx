import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { I } from '../lib/icons';
import { ROLE_LEVEL, MONTHS, loadAIPrefs } from '../lib/constants';
import { api } from '../lib/api';

type Hint = '' | 'inventory' | 'events' | 'haccp' | 'menu' | 'log';
type Direction = 'received' | 'issued' | 'both';

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
    staging_ids?: string[];
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
    pr_id?: string | null;
    pr_number?: number | null;
    overwrite?: boolean;
    overwrite_scope?: {
        kind: string;
        label: string;
        month: number;
        year: number;
        week?: number;
        direction?: string;
    };
}

interface OverwritePrompt {
    message: string;
    month: number;
    year: number;
    week: number;
    direction: Direction;
    scope: string;
    scope_label: string;
    existing_rows: number;
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

interface PreviewResponse {
    batch_id: string;
    staged_count: number;
    tables_affected: string[];
    summary: { new_rows: number; updated_rows: number };
    staging_ids: string[];
    diff: DiffTable[];
}

interface PeriodSettings {
    floor_year: number;
    floor_month: number;
    max_year: number;
    max_month: number;
    operational_week_count: number;
}

// ── style helpers ─────────────────────────────────────────────────────────────

const safeUploadMessage = (value: unknown): string => {
    const raw = value instanceof Error ? value.message : String(value || 'Upload failed');
    let msg = raw.replace(/\s+/g, ' ').trim();
    if (msg.includes('No JSON found in AI response') || msg.includes('AI response did not contain')) {
        msg = 'AI returned an incomplete JSON response. The file was not staged.';
    }
    if (msg.length > 360) msg = `${msg.slice(0, 357).trim()}...`;
    return msg || 'Upload failed';
};

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

// ── Pipeline stages ───────────────────────────────────────────────────────────
// Durations are realistic estimates; the timer advances through them so the
// bar stays synced to what the backend is actually doing.

const PIPELINE: { label: string; detail: string; durationMs: number; color: string }[] = [
    { label: 'Fetching',    detail: 'Uploading file to backend',             durationMs: 2500,  color: '#6366f1' },
    { label: 'Extracting',  detail: 'Parser reading PDF structure',           durationMs: 4000,  color: '#3b82f6' },
    { label: 'Processing',  detail: 'Reconciling totals · resolving SKUs',    durationMs: 3000,  color: '#0891b2' },
    { label: 'Routing',     detail: 'Writing to correct week cells',          durationMs: 2500,  color: '#059669' },
    { label: 'Staging',     detail: 'Queuing for your review',               durationMs: 1500,  color: '#d97706' },
];

function PipelineBar({ stage }: { stage: number }) {
    const current = PIPELINE[Math.min(stage, PIPELINE.length - 1)];
    const pct = Math.round(((stage + 1) / PIPELINE.length) * 100);

    return (
        <div style={{ marginTop: 10 }}>
            {/* Step indicators */}
            <div style={{ display: 'flex', gap: 0, marginBottom: 8 }}>
                {PIPELINE.map((s, i) => {
                    const done   = i < stage;
                    const active = i === stage;
                    return (
                        <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                            {/* connector line left */}
                            <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                                <div style={{ flex: 1, height: 2, background: i === 0 ? 'transparent' : (done || active ? s.color : 'var(--line, #e2e8f0)'), transition: 'background .4s' }} />
                                <div style={{
                                    width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontSize: 11, fontWeight: 800,
                                    background: done ? '#10b981' : active ? s.color : 'var(--surface-2, #f1f5f9)',
                                    color: (done || active) ? '#fff' : 'var(--muted, #94a3b8)',
                                    border: `2px solid ${done ? '#10b981' : active ? s.color : 'var(--line, #e2e8f0)'}`,
                                    boxShadow: active ? `0 0 0 3px ${s.color}30` : 'none',
                                    transition: 'all .4s',
                                }}>
                                    {done ? '✓' : i + 1}
                                </div>
                                <div style={{ flex: 1, height: 2, background: i === PIPELINE.length - 1 ? 'transparent' : (done ? s.color : 'var(--line, #e2e8f0)'), transition: 'background .4s' }} />
                            </div>
                            <span style={{
                                fontSize: 10, fontWeight: active ? 700 : 500,
                                color: done ? '#10b981' : active ? s.color : 'var(--muted, #94a3b8)',
                                transition: 'color .4s', textAlign: 'center',
                            }}>{s.label}</span>
                        </div>
                    );
                })}
            </div>

            {/* Progress fill bar */}
            <div style={{ height: 4, borderRadius: 4, background: 'var(--line, #e2e8f0)', overflow: 'hidden', margin: '2px 0 8px' }}>
                <div style={{
                    height: '100%', borderRadius: 4,
                    width: `${pct}%`,
                    background: `linear-gradient(90deg, #6366f1, ${current.color})`,
                    transition: 'width 0.6s cubic-bezier(.4,0,.2,1)',
                }} />
            </div>

            {/* Current stage detail */}
            <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '9px 13px',
                background: `${current.color}12`,
                border: `1px solid ${current.color}40`,
                borderRadius: 8, fontSize: 12, color: current.color, fontWeight: 600,
            }}>
                <span style={{ animation: 'aiSparkFade 1.6s ease-in-out infinite', fontSize: 13 }}>✦</span>
                <span style={{ flex: 1 }}>{current.detail}</span>
                <ThinkingDots />
            </div>
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

function weeksInMonth(monthIndex: number, year: number) {
    return new Date(year, monthIndex + 1, 0).getDate() > 28 ? 5 : 4;
}

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
                        background: '#3b82f6',
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

export function DataEntry({ user, onNavigate }: { user: any; onNavigate?: (key: string, opts?: { prId?: string }) => void }) {
    const lvl = ROLE_LEVEL[user.role as keyof typeof ROLE_LEVEL] ?? 0;
    const isSudo = lvl >= 50;
    const now = new Date();

    const aiPrefs = loadAIPrefs(user.id);

    const [file, setFile]           = useState<File | null>(null);
    const [hint, setHint]           = useState<Hint>('');
    const [month, setMonth]         = useState<number>(now.getMonth());
    const [year, setYear]           = useState<number>(now.getFullYear());
    const [week, setWeek]           = useState<number>(0);
    const [direction, setDirection] = useState<Direction>('received');
    const [description, setDescription] = useState('');
    const [overwritePrompt, setOverwritePrompt] = useState<OverwritePrompt | null>(null);

    const [uploading, setUploading]     = useState(false);
    const [aiStage, setAiStage]         = useState(0);
    const [uploadErr, setUploadErr]     = useState<string | null>(null);
    const [result, setResult]           = useState<UploadResult | null>(null);

    const [preview, setPreview]           = useState<DiffTable[] | null>(null);
    const [stagingIds, setStagingIds]     = useState<string[]>([]);
    const [commitBusy, setCommitBusy]     = useState(false);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [previewErr, setPreviewErr]     = useState<string | null>(null);

    const [aiCfgLoading, setAiCfgLoading] = useState(true);
    const [aiStatus, setAiStatus]       = useState<{ provider: string; model: string; is_vision: boolean; key_id?: string } | null>(null);
    const [aiKeys, setAiKeys]           = useState<Array<{ id: string; provider: string; label: string; has_key: boolean; model_override?: string }>>([]);
    const [pickerOpen, setPickerOpen]   = useState(false);
    const [pickerKeyId, setPickerKeyId] = useState('');
    const [pickerModel, setPickerModel] = useState('');
    const [pickerModels, setPickerModels] = useState<Array<{ id: string; vision: boolean }>>([]);
    const [pickerModelsLoading, setPickerModelsLoading] = useState(false);
    const [pickerSaving, setPickerSaving] = useState(false);
    const [periodSettings, setPeriodSettings] = useState<PeriodSettings>({
        floor_year: 2026,
        floor_month: 3,
        max_year: now.getFullYear(),
        max_month: Math.min(now.getMonth() + 1, 11),
        operational_week_count: 4,
    });

    const stageTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
    const abortRef = useRef<AbortController | null>(null);
    const cancelledRef = useRef(false);
    const calendarWeekCount = weeksInMonth(month, year);
    const weekCount = Math.min(calendarWeekCount, Number(periodSettings.operational_week_count || 4));
    const allowedYears = useMemo(() => {
        const years: number[] = [];
        for (let yr = periodSettings.floor_year; yr <= periodSettings.max_year; yr += 1) years.push(yr);
        return years.length ? years : [periodSettings.floor_year];
    }, [periodSettings.floor_year, periodSettings.max_year]);
    const allowedMonths = useMemo(() => {
        const start = year === periodSettings.floor_year ? periodSettings.floor_month : 0;
        const end = year === periodSettings.max_year ? periodSettings.max_month : 11;
        const months: number[] = [];
        for (let idx = Math.max(0, start); idx <= Math.min(11, end); idx += 1) months.push(idx);
        return months.length ? months : [Math.max(0, Math.min(11, start))];
    }, [periodSettings.floor_month, periodSettings.floor_year, periodSettings.max_month, periodSettings.max_year, year]);

    useEffect(() => {
        if (week > weekCount) setWeek(0);
    }, [week, weekCount]);
    useEffect(() => {
        if (week > 0 && direction === 'both') setDirection('received');
    }, [direction, week]);
    useEffect(() => {
        if (!allowedYears.includes(year)) {
            setYear(allowedYears[allowedYears.length - 1]);
            return;
        }
        if (!allowedMonths.includes(month)) {
            setMonth(allowedMonths[0]);
        }
    }, [allowedMonths, allowedYears, month, year]);
    const [elapsed, setElapsed] = useState(0);
    const elapsedTimer = useRef<ReturnType<typeof setInterval> | null>(null);

    const refreshDataEntrySettings = useCallback(async () => {
        const cfg = await api.getDataEntrySettings();
        if (cfg?.current?.provider) setAiStatus(cfg.current);
        setAiKeys((cfg?.keys || []).filter((k: any) => k.has_key));
        if (cfg?.period) {
            setPeriodSettings(p => ({
                ...p,
                ...cfg.period,
                floor_year: Number(cfg.period.floor_year ?? p.floor_year),
                floor_month: Number(cfg.period.floor_month ?? p.floor_month),
                max_year: Number(cfg.period.max_year ?? p.max_year),
                max_month: Number(cfg.period.max_month ?? p.max_month),
                operational_week_count: Number(cfg.period.operational_week_count ?? p.operational_week_count ?? 4),
            }));
        }
    }, [setAiKeys, setAiStatus, setPeriodSettings]);

    useEffect(() => {
        refreshDataEntrySettings().catch(() => {}).finally(() => setAiCfgLoading(false));
    }, [refreshDataEntrySettings]);

    useEffect(() => {
        const refresh = () => { refreshDataEntrySettings().catch(() => {}); };
        window.addEventListener('mjcc:settings-changed', refresh);
        window.addEventListener('mjcc:ai-config-changed', refresh);
        window.addEventListener('focus', refresh);
        return () => {
            window.removeEventListener('mjcc:settings-changed', refresh);
            window.removeEventListener('mjcc:ai-config-changed', refresh);
            window.removeEventListener('focus', refresh);
        };
    }, [refreshDataEntrySettings]);

    // Load live model list whenever the picker's selected key changes
    useEffect(() => {
        if (!pickerKeyId) { setPickerModels([]); return; }
        const key = aiKeys.find(k => k.id === pickerKeyId);
        if (!key) return;
        setPickerModelsLoading(true);
        api.getAIModels(key.provider)
            .then(r => setPickerModels(r?.models || []))
            .catch(() => setPickerModels([]))
            .finally(() => setPickerModelsLoading(false));
    }, [pickerKeyId, aiKeys]);

    const openPicker = () => {
        const key = aiKeys.find(k => k.id === aiStatus?.key_id) || aiKeys[0];
        setPickerKeyId(key?.id || '');
        setPickerModel(aiStatus?.model || key?.model_override || '');
        setPickerOpen(true);
    };

    const saveAiStack = async () => {
        const key = aiKeys.find(k => k.id === pickerKeyId);
        if (!key || !pickerModel) return;
        setPickerSaving(true);
        try {
            const visionModel = pickerModels.find(m => m.id === pickerModel);
            await api.setAIStack({
                provider: key.provider,
                key_id: key.id,
                model: pickerModel,
                vision_capable: !!visionModel?.vision,
            });
            setAiStatus({ provider: key.provider, model: pickerModel, is_vision: !!visionModel?.vision, key_id: key.id });
            window.dispatchEvent(new CustomEvent('mjcc:ai-config-changed'));
            window.dispatchEvent(new CustomEvent('mjcc:settings-changed'));
            setPickerOpen(false);
        } catch (e: any) {
            setUploadErr(e?.message || 'Failed to switch AI model');
        } finally {
            setPickerSaving(false);
        }
    };

    useEffect(() => {
        if (uploading) {
            setAiStage(0);
            setElapsed(0);
            let cumulative = 0;
            const handles: ReturnType<typeof setTimeout>[] = [];
            PIPELINE.forEach((s, i) => {
                cumulative += s.durationMs;
                if (i < PIPELINE.length - 1) {
                    handles.push(setTimeout(() => setAiStage(i + 1), cumulative));
                }
            });
            stageTimers.current = handles;
            // Fire "AI connected" toast once we're past the file-upload stage
            handles.push(setTimeout(() => {
                (window as any).toast?.('AI provider connected — processing document');
                window.dispatchEvent(new CustomEvent('mjcc:ai-connected'));
            }, 3500));
            // Track elapsed time after pipeline animation would have completed
            elapsedTimer.current = setInterval(() => {
                setElapsed(p => p + 1);
            }, 1000);
        } else {
            stageTimers.current.forEach(h => clearTimeout(h));
            stageTimers.current = [];
            if (elapsedTimer.current) {
                clearInterval(elapsedTimer.current);
                elapsedTimer.current = null;
            }
        }
        return () => {
            stageTimers.current.forEach(h => clearTimeout(h));
            if (elapsedTimer.current) { clearInterval(elapsedTimer.current); elapsedTimer.current = null; }
        };
    }, [uploading]);

    const loadPreview = useCallback(async (batchId: string) => {
        setPreviewLoading(true);
        setPreviewErr(null);
        try {
            const res = await api.getDataEntryPreview(batchId) as unknown as PreviewResponse;
            setPreview(res.diff as DiffTable[]);
            setStagingIds(res.staging_ids || []);
        } catch (e: any) {
            setPreviewErr(e?.message || 'Failed to load preview');
            setPreview(null);
            setStagingIds([]);
        } finally {
            setPreviewLoading(false);
        }
    }, [setPreview, setPreviewErr, setPreviewLoading, setStagingIds]);

    const cancelUpload = useCallback(() => {
        cancelledRef.current = true;
        abortRef.current?.abort();
    }, []);

    const doUpload = useCallback(async (confirmedOverwrite = false) => {
        if (!file) return;
        cancelledRef.current = false;
        abortRef.current?.abort();
        abortRef.current = new AbortController();
        setUploading(true);
        setUploadErr(null);
        setOverwritePrompt(null);
        setResult(null);
        setPreview(null);
        const timeoutId = setTimeout(() => abortRef.current?.abort(), 120_000);
        try {
            const res = await api.uploadDataEntry(file, hint, month + 1, year, week, direction, description, abortRef.current?.signal, confirmedOverwrite);
            clearTimeout(timeoutId);
            setResult(res);
            setStagingIds(res.staging_ids || []);
            window.dispatchEvent(new CustomEvent('mjcc:staging-changed'));
            window.dispatchEvent(new CustomEvent('mjcc:open-sc'));
            (window as any).toast?.(`AI parsing complete — ${res.staged_count} entries staged`);
            await loadPreview(res.batch_id);
        } catch (e: any) {
            clearTimeout(timeoutId);
            const userCancelled = cancelledRef.current;
            const msg = e?.name === 'AbortError'
                ? (userCancelled ? 'Cancelled by user' : 'Request timed out — AI provider did not respond within 120s')
                : safeUploadMessage(e);
            const detail = e?.detail;
            if (!userCancelled && e?.status === 409 && detail?.error === 'overwrite_required') {
                setOverwritePrompt(detail as OverwritePrompt);
                setUploadErr(null);
                (window as any).toast?.('Overwrite confirmation required');
                return;
            }
            setUploadErr(msg);
            (window as any).toast?.(`AI parsing failed: ${msg}`);
            if (!userCancelled) {
                window.dispatchEvent(new CustomEvent('mjcc:open-agent', {
                    detail: {
                        prompt: `Data Entry could not parse ${file.name} for ${MONTHS[month]} ${year}${week > 0 ? ` W${week} ${direction}` : ' full month'}. Error: ${msg}. What information do you need from me to map this upload correctly?`,
                    },
                }));
            }
        } finally {
            setUploading(false);
            abortRef.current = null;
        }
    }, [
        file,
        hint,
        month,
        year,
        week,
        direction,
        description,
        loadPreview,
        setPreview,
        setResult,
        setStagingIds,
        setOverwritePrompt,
        setUploadErr,
        setUploading,
    ]);

    const doCommitBatch = useCallback(async () => {
        if (!stagingIds.length || !result) return;
        setCommitBusy(true);
        try {
            // Route through the PR this upload created (ensure_pr_for_entries on
            // the backend), not a direct approveCommit -- Source Control is the
            // single gate for everything entering the system, including AI imports.
            if (result.pr_id) {
                await api.mergePull(result.pr_id);
            } else {
                // Fallback for older uploads with no PR attached
                const msg = `AI batch: ${result.file} — ${result.staged_count} entries (${MONTHS[(result.month ?? 1) - 1] ?? result.month} ${result.year})`;
                await api.approveCommit({ staging_ids: stagingIds, message: msg, author_id: user.id });
            }
            const mergedPrId = result.pr_id || undefined;
            setResult(null);
            setPreview(null);
            setStagingIds([]);
            window.dispatchEvent(new CustomEvent('mjcc:committed'));
            onNavigate?.('sourcectrl', { prId: mergedPrId });
        } catch (e: any) {
            setUploadErr(e?.message || 'Commit failed');
        } finally {
            setCommitBusy(false);
        }
    }, [
        stagingIds,
        result,
        user.id,
        onNavigate,
        setCommitBusy,
        setPreview,
        setResult,
        setStagingIds,
        setUploadErr,
    ]);

    const clearAll = () => {
        setFile(null);
        setResult(null);
        setUploadErr(null);
        setOverwritePrompt(null);
        setPreview(null);
        setStagingIds([]);
    };

    const stagedCount = result?.staged_count ?? 0;

    return (
        <div className="fade-in">
            <div className="page-head">
                <div>
                    <h2>Data Entry</h2>
                    <div className="ph-sub">
                        Import spreadsheets, invoices, PDFs, and images — deterministic parsing first, AI assist when enabled
                    </div>
                </div>
                {!aiCfgLoading && isSudo && (
                    <button className="btn" style={{ fontSize: 11, padding: '4px 10px' }}
                        onClick={() => onNavigate?.('settings')}>Configure</button>
                )}
            </div>

            {/* ── AI status bar / inline model picker ────────────────────────────── */}
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
                {aiKeys.length > 0 && (
                    <button
                        className="btn"
                        style={{ fontSize: 11, padding: '3px 9px' }}
                        onClick={openPicker}
                    >
                        Switch model
                    </button>
                )}
                {isSudo && (
                    <button
                        className="btn"
                        style={{ fontSize: 11, padding: '3px 9px' }}
                        onClick={() => onNavigate?.('settings')}
                    >
                        Settings
                    </button>
                )}
            </div>

            {pickerOpen && (
                <div className="overlay" onClick={() => !pickerSaving && setPickerOpen(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 420 }}>
                        <div className="modal-head">
                            <h3>Switch AI model</h3>
                            <button className="modal-x" onClick={() => setPickerOpen(false)} disabled={pickerSaving}>
                                {I.x()}
                            </button>
                        </div>
                        <div className="form-grid" style={{ padding: '4px 20px 8px' }}>
                            <label className="full">
                                <span>Configured key</span>
                                <select
                                    value={pickerKeyId}
                                    onChange={e => { setPickerKeyId(e.target.value); setPickerModel(''); }}
                                >
                                    {aiKeys.map(k => (
                                        <option key={k.id} value={k.id}>
                                            {k.provider.charAt(0).toUpperCase() + k.provider.slice(1)} · {k.label}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className="full">
                                <span>Model</span>
                                <select
                                    value={pickerModel}
                                    onChange={e => setPickerModel(e.target.value)}
                                    disabled={pickerModelsLoading}
                                >
                                    <option value="">{pickerModelsLoading ? 'Loading models…' : 'Select a model'}</option>
                                    {pickerModels.filter(m => m.vision).length > 0 && (
                                        <optgroup label="Vision capable">
                                            {pickerModels.filter(m => m.vision).map(m => (
                                                <option key={m.id} value={m.id}>✶ {m.id}</option>
                                            ))}
                                        </optgroup>
                                    )}
                                    {pickerModels.filter(m => !m.vision).length > 0 && (
                                        <optgroup label="Text only">
                                            {pickerModels.filter(m => !m.vision).map(m => (
                                                <option key={m.id} value={m.id}>{m.id}</option>
                                            ))}
                                        </optgroup>
                                    )}
                                </select>
                            </label>
                        </div>
                        <div className="modal-foot">
                            <button className="btn" onClick={() => setPickerOpen(false)} disabled={pickerSaving}>
                                Cancel
                            </button>
                            <button className="btn primary" onClick={saveAiStack} disabled={pickerSaving || !pickerKeyId || !pickerModel}>
                                {pickerSaving ? 'Saving…' : 'Activate'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Upload card ─────────────────────────────────────────── */}
            {overwritePrompt && (
                <div className="overlay" onClick={() => !uploading && setOverwritePrompt(null)}>
                    <div className="modal" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
                        <div className="modal-head">
                            <h3>{I.alert()} Replace existing inventory data?</h3>
                            <button className="modal-x" onClick={() => setOverwritePrompt(null)} disabled={uploading}>
                                {I.x()}
                            </button>
                        </div>
                        <div className="modal-body">
                            <div className="banner warn" style={{ marginBottom: 12 }}>
                                {I.alert()}<span>{overwritePrompt.message}</span>
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
                                This replacement will be staged through Source Control. When the pull request is merged,
                                MJCC will clear the current {overwritePrompt.scope_label} values for{' '}
                                {MONTHS[overwritePrompt.month - 1]} {overwritePrompt.year} and then apply the parsed upload.
                            </div>
                            <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                <span className="pill warn">
                                    {overwritePrompt.existing_rows} existing row{overwritePrompt.existing_rows === 1 ? '' : 's'}
                                </span>
                                <span className="pill off">{overwritePrompt.scope_label}</span>
                            </div>
                        </div>
                        <div className="modal-foot">
                            <button className="btn" onClick={() => setOverwritePrompt(null)} disabled={uploading}>
                                Cancel
                            </button>
                            <button className="btn danger" onClick={() => doUpload(true)} disabled={uploading}>
                                {uploading ? 'Replacing...' : 'Overwrite & Parse'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <WinCard
                title="Upload file"
                dots
                className="de-upload-card"
                link={result ? `✓ ${stagedCount} staged` : undefined}
            >
                <div>
                    <div style={STEP_LBL}>1 — File</div>
                    <div className={aiPrefs.effects && uploading ? 'ai-ring-wrap' : ''} style={{ borderRadius: 12 }}>
                        <FileZone
                            file={file} uploading={uploading}
                            onFile={f => { setFile(f); setResult(null); setUploadErr(null); setOverwritePrompt(null); setPreview(null); }}
                            onClear={clearAll}
                        />
                    </div>
                    {uploading && (
                        <>
                            <PipelineBar stage={aiStage} />
                            {aiStage >= PIPELINE.length - 1 && (
                                <div style={{
                                    marginTop: 8, padding: '8px 13px', borderRadius: 8,
                                    background: 'var(--amber-bg)', border: '1px solid var(--amber-ink)',
                                    display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--amber-ink)',
                                }}>
                                    <span style={{ fontSize: 14, animation: 'aiSparkFade 1.2s ease-in-out infinite' }}>⟳</span>
                                    <span style={{ flex: 1, fontWeight: 600 }}>
                                        Parsing file — {elapsed >= 60 ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s` : `${elapsed}s`} elapsed
                                    </span>
                                    <button
                                        onClick={cancelUpload}
                                        style={{
                                            background: 'var(--red)', color: '#fff', border: 'none', borderRadius: 6,
                                            padding: '4px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer',
                                            display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap',
                                        }}
                                        title="Cancel upload"
                                    >
                                        {I.x({ style: { width: 12, height: 12 } })}
                                        Stop
                                    </button>
                                </div>
                            )}
                        </>
                    )}
                </div>

                <Hr />

                <div>
                    <div style={STEP_LBL}>2 — Period &amp; target</div>
                    <div className="de-target-grid" style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
                        <div className="de-period-controls" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                            <div>
                                <label style={LBL}>Month</label>
                                <select className="ipt sel" value={month} onChange={e => setMonth(+e.target.value)}>
                                    {allowedMonths.map(i => <option key={i} value={i}>{MONTHS[i]}</option>)}
                                </select>
                            </div>
                            <div>
                                <label style={LBL}>Year</label>
                                <select className="ipt sel" value={year} onChange={e => setYear(+e.target.value)}>
                                    {allowedYears.map(yr => <option key={yr} value={yr}>{yr}</option>)}
                                </select>
                            </div>
                            <div>
                                <label style={LBL}>Hint <span style={{ fontWeight: 400, color: 'var(--faint)' }}>(optional)</span></label>
                                <select className="ipt sel" value={hint} onChange={e => setHint(e.target.value as Hint)}>
                                    <option value="">Auto-detect</option>
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
                                {[0, ...Array.from({ length: weekCount }, (_, i) => i + 1)].map(w => (
                                    <button key={w} className={week === w ? 'btn primary' : 'btn'}
                                        style={{ padding: '6px 13px', fontSize: 12, fontWeight: 700, minHeight: 36 }}
                                        onClick={() => setWeek(w)}>
                                        {w === 0 ? 'Month' : `W${w}`}
                                    </button>
                                ))}
                            </div>
                            <div style={{ fontSize: 10.5, color: 'var(--faint)', marginTop: 5 }}>
                                {calendarWeekCount > weekCount
                                    ? `${MONTHS[month]} ${year} uses W1-W${weekCount}; days after the 28th roll into the next month's W1.`
                                    : `${MONTHS[month]} ${year} uses W1-W${weekCount}`}
                            </div>
                        </div>

                        <div>
                            <label style={LBL}>Direction</label>
                            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                <button className={direction === 'received' ? 'btn primary' : 'btn'}
                                    style={{ padding: '6px 13px', fontSize: 12, fontWeight: 700, minHeight: 36 }}
                                    onClick={() => setDirection('received')}>Received</button>
                                <button className={direction === 'issued' ? 'btn accent' : 'btn'}
                                    style={{ padding: '6px 13px', fontSize: 12, fontWeight: 700, minHeight: 36 }}
                                    onClick={() => setDirection('issued')}>Pulled / Issued</button>
                                {week === 0 && (
                                    <button className={direction === 'both' ? 'btn primary' : 'btn'}
                                        style={{ padding: '6px 13px', fontSize: 12, fontWeight: 700, minHeight: 36 }}
                                        onClick={() => setDirection('both')}>Both</button>
                                )}
                            </div>
                            <div style={{ fontSize: 10.5, color: 'var(--faint)', marginTop: 5 }}>
                                {week === 0
                                    ? 'Full-month uploads can include received and pulled/issued columns.'
                                    : 'Weekly uploads post into one direction at a time.'}
                            </div>
                        </div>
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

                <div className="de-submit-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                    <div className="de-file-summary" style={{ fontSize: 12, color: 'var(--muted)', minWidth: 0 }}>
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
                    <div className="de-submit-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {result && <button className="btn" onClick={clearAll} style={{ fontSize: 12 }}>Upload another</button>}
                        <button className="btn primary" onClick={() => doUpload()} disabled={!file || uploading} style={{ minWidth: 130, minHeight: 40 }}>
                            {I.inbox({ style: { width: 14, height: 14 } })}
                            {uploading ? 'Parsing...' : 'Upload & Parse'}
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
                                onClick={() => onNavigate?.('sourcectrl', { prId: result.pr_id || undefined })}
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
                            {stagingIds.length > 0 && (
                                <button
                                    onClick={doCommitBatch}
                                    disabled={commitBusy}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: 7,
                                        padding: '10px 18px', borderRadius: 10,
                                        background: '#059669', color: '#fff',
                                        border: 'none', cursor: 'pointer',
                                        fontWeight: 700, fontSize: 13,
                                        flexShrink: 0, minHeight: 44,
                                        boxShadow: '0 2px 8px rgba(5,150,105,0.25)',
                                        transition: 'opacity .15s',
                                        opacity: commitBusy ? 0.7 : 1,
                                    }}
                                    onMouseEnter={e => (e.currentTarget.style.opacity = '0.88')}
                                    onMouseLeave={e => (e.currentTarget.style.opacity = commitBusy ? '0.7' : '1')}
                                >
                                    {commitBusy
                                        ? <><div className="spinner" style={{ width: 14, height: 14, borderColor: '#fff transparent transparent' }} />&nbsp;Committing…</>
                                        : <>{I.checkCircle({ style: { width: 15, height: 15 } })} Commit AI batch</>
                                    }
                                </button>
                            )}
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
