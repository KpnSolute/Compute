import { useState, useCallback } from 'react';
import { I } from '../lib/icons';
import { ROLE_LEVEL, MONTHS } from '../lib/constants';
import { api } from '../lib/api';
import { useEffect } from 'react';

type Hint = '' | 'inventory' | 'events' | 'haccp' | 'menu' | 'log';

interface UploadResult {
    batch_id: string;
    staged_count: number;
    operations: Record<string, number>;
    file: string;
    month: number;
    year: number;
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

// ── style constants ────────────────────────────────────────────────────────────

const LBL: React.CSSProperties = {
    display: 'block',
    fontSize: 11,
    fontWeight: 700,
    color: 'var(--muted)',
    marginBottom: 5,
};

const STEP_LBL: React.CSSProperties = {
    fontSize: 10.5,
    fontWeight: 800,
    color: 'var(--faint)',
    textTransform: 'uppercase',
    letterSpacing: '.07em',
    marginBottom: 10,
};

function Hr() {
    return (
        <div style={{ borderTop: '1px solid var(--line-soft)', margin: '18px -17px' }} />
    );
}

// ── diff row ───────────────────────────────────────────────────────────────────

function DiffRowPreview({ row }: { row: DiffRow }) {
    const sku =
        row.after?.sku || row.before?.sku || '';
    const desc =
        row.after?.description || row.before?.description ||
        row.after?.desc || row.before?.desc || '';
    const changes = row.changes || [];

    return (
        <tr>
            <td style={{ width: 72 }}>
                <span
                    className={
                        row.status === 'new'
                            ? 'pill ok'
                            : row.status === 'update'
                              ? 'pill warn'
                              : 'pill off'
                    }
                >
                    {row.status || '—'}
                </span>
            </td>
            <td style={{ width: 110 }}>
                <code style={{ fontSize: 11 }}>{sku || '—'}</code>
            </td>
            <td
                style={{
                    maxWidth: 200,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontSize: 12,
                    color: desc ? 'var(--ink)' : 'var(--faint)',
                }}
            >
                {desc || '—'}
            </td>
            <td>
                {changes.length > 0 ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {changes.slice(0, 5).map((field, i) => {
                            const bv = row.before?.[field];
                            const av = row.after?.[field];
                            return (
                                <span
                                    key={i}
                                    style={{
                                        fontSize: 10.5,
                                        background: 'var(--amber-bg)',
                                        color: 'var(--amber-ink)',
                                        padding: '2px 7px',
                                        borderRadius: 5,
                                        fontWeight: 600,
                                    }}
                                >
                                    {field}
                                    {bv !== undefined && bv !== null
                                        ? ` ${bv} →`
                                        : ':'}
                                    {` ${av ?? '—'}`}
                                </span>
                            );
                        })}
                        {changes.length > 5 && (
                            <span style={{ fontSize: 10.5, color: 'var(--muted)' }}>
                                +{changes.length - 5} more
                            </span>
                        )}
                    </div>
                ) : row.status === 'new' ? (
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>new entry</span>
                ) : (
                    '—'
                )}
            </td>
        </tr>
    );
}

// ── main component ─────────────────────────────────────────────────────────────

export function DataEntry({ user }: { user: any }) {
    const lvl = ROLE_LEVEL[user.role as keyof typeof ROLE_LEVEL] ?? 0;
    const now = new Date();

    const [file, setFile] = useState<File | null>(null);
    const [hint, setHint] = useState<Hint>('');
    const [month, setMonth] = useState<number>(now.getMonth());
    const [year, setYear] = useState<number>(now.getFullYear());
    const [week, setWeek] = useState<number>(0);
    const [direction, setDirection] = useState<'received' | 'issued'>('received');

    const [uploading, setUploading] = useState(false);
    const [uploadErr, setUploadErr] = useState<string | null>(null);
    const [result, setResult] = useState<UploadResult | null>(null);

    const [preview, setPreview] = useState<DiffTable[] | null>(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [previewErr, setPreviewErr] = useState<string | null>(null);

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
            const res = await api.uploadDataEntry(
                file, hint, month + 1, year, week, direction,
            );
            setResult(res);
            await loadPreview(res.batch_id);
        } catch (e: any) {
            setUploadErr(e?.message || 'Upload failed');
        } finally {
            setUploading(false);
        }
    }, [file, hint, month, year, week, direction, loadPreview]);

    const clearFile = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setFile(null);
        setResult(null);
        setUploadErr(null);
        setPreview(null);
    };

    const targetLine = [
        `${MONTHS[month]} ${year}`,
        week > 0 ? `W${week} ${direction}` : 'whole month',
        hint || null,
    ]
        .filter(Boolean)
        .join(' · ');

    return (
        <div className="fade-in">
            <div className="page-head">
                <div>
                    <h2>Data Entry</h2>
                    <div className="ph-sub">
                        Upload invoices &amp; files — extract, stage, review in Source Control
                    </div>
                </div>
            </div>

            {/* ── Upload card ─────────────────────────────────────────────── */}
            <div className="card">
                <div className="card-head">
                    <h3>Upload file</h3>
                </div>
                <div className="card-body">

                    {/* Step 1 — File */}
                    <div>
                        <div style={STEP_LBL}>1 — File</div>
                        <label
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 13,
                                border: `2px dashed ${file ? 'var(--accent)' : 'var(--line)'}`,
                                borderRadius: 10,
                                padding: '13px 15px',
                                cursor: 'pointer',
                                background: file ? 'var(--accent-soft)' : 'var(--surface-2)',
                                transition: 'border-color .15s, background .15s',
                            }}
                        >
                            <input
                                type="file"
                                accept=".csv,.tsv,.xls,.xlsx,.pdf,.txt,.jpg,.jpeg,.png,.webp,.bmp,.gif,.tif,.tiff"
                                style={{ display: 'none' }}
                                onChange={(e) => {
                                    setFile(e.target.files?.[0] ?? null);
                                    setResult(null);
                                    setUploadErr(null);
                                    setPreview(null);
                                }}
                            />
                            {I.fileText({
                                style: {
                                    width: 20,
                                    height: 20,
                                    flexShrink: 0,
                                    color: file ? 'var(--accent)' : 'var(--muted)',
                                },
                            })}
                            <div style={{ flex: 1, minWidth: 0 }}>
                                {file ? (
                                    <>
                                        <div
                                            style={{
                                                fontWeight: 700,
                                                fontSize: 13,
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                whiteSpace: 'nowrap',
                                            }}
                                        >
                                            {file.name}
                                        </div>
                                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                                            {file.size < 1024
                                                ? `${file.size} B`
                                                : `${(file.size / 1024).toFixed(0)} KB`}
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <div style={{ fontWeight: 700, fontSize: 13 }}>
                                            Click to browse
                                        </div>
                                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                                            CSV, Excel, PDF, images (jpg, png, webp…)
                                        </div>
                                    </>
                                )}
                            </div>
                            {file && (
                                <button
                                    onClick={clearFile}
                                    style={{
                                        background: 'none',
                                        border: 'none',
                                        cursor: 'pointer',
                                        color: 'var(--muted)',
                                        padding: 4,
                                        borderRadius: 6,
                                        display: 'flex',
                                        flexShrink: 0,
                                    }}
                                    title="Remove file"
                                >
                                    {I.x({ style: { width: 15, height: 15 } })}
                                </button>
                            )}
                        </label>
                    </div>

                    <Hr />

                    {/* Step 2 — Target */}
                    <div>
                        <div style={STEP_LBL}>2 — Target period &amp; type</div>
                        <div
                            style={{
                                display: 'flex',
                                flexWrap: 'wrap',
                                gap: 20,
                                alignItems: 'flex-start',
                            }}
                        >
                            {/* Period + hint */}
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                                <div>
                                    <label style={LBL}>Month</label>
                                    <select
                                        className="tb-select"
                                        value={month}
                                        onChange={(e) => setMonth(+e.target.value)}
                                    >
                                        {MONTHS.map((nm, i) => (
                                            <option key={i} value={i}>{nm}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label style={LBL}>Year</label>
                                    <select
                                        className="tb-select"
                                        value={year}
                                        onChange={(e) => setYear(+e.target.value)}
                                    >
                                        {[2024, 2025, 2026].map((yr) => (
                                            <option key={yr} value={yr}>{yr}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label style={LBL}>Type hint</label>
                                    <select
                                        className="tb-select"
                                        value={hint}
                                        onChange={(e) => setHint(e.target.value as Hint)}
                                    >
                                        <option value="">Auto-detect</option>
                                        <option value="inventory">Inventory</option>
                                        <option value="events">Events</option>
                                        <option value="haccp">HACCP</option>
                                        <option value="menu">Menu</option>
                                        <option value="log">Log</option>
                                    </select>
                                </div>
                            </div>

                            {/* Invoice week — segmented buttons */}
                            <div>
                                <label style={LBL}>Invoice week</label>
                                <div style={{ display: 'flex', gap: 4 }}>
                                    {[0, 1, 2, 3, 4].map((w) => (
                                        <button
                                            key={w}
                                            className={week === w ? 'btn primary' : 'btn'}
                                            style={{
                                                padding: '5px 11px',
                                                fontSize: 12,
                                                fontWeight: 700,
                                            }}
                                            onClick={() => setWeek(w)}
                                        >
                                            {w === 0 ? 'Month' : `W${w}`}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Direction — visible only when a week is selected */}
                            {week > 0 && (
                                <div>
                                    <label style={LBL}>Direction</label>
                                    <div style={{ display: 'flex', gap: 4 }}>
                                        <button
                                            className={direction === 'received' ? 'btn primary' : 'btn'}
                                            style={{ padding: '5px 11px', fontSize: 12, fontWeight: 700 }}
                                            onClick={() => setDirection('received')}
                                        >
                                            ↓ Received
                                        </button>
                                        <button
                                            className={direction === 'issued' ? 'btn accent' : 'btn'}
                                            style={{ padding: '5px 11px', fontSize: 12, fontWeight: 700 }}
                                            onClick={() => setDirection('issued')}
                                        >
                                            ↑ Issued
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    <Hr />

                    {/* Action row */}
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            flexWrap: 'wrap',
                            gap: 10,
                        }}
                    >
                        <div style={{ fontSize: 12, color: 'var(--muted)', minWidth: 0 }}>
                            {file ? (
                                <>
                                    <span
                                        style={{
                                            fontWeight: 700,
                                            color: 'var(--ink)',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap',
                                            display: 'inline-block',
                                            maxWidth: 200,
                                            verticalAlign: 'bottom',
                                        }}
                                    >
                                        {file.name}
                                    </span>
                                    {' → '}
                                    {targetLine}
                                </>
                            ) : (
                                'Select a file to upload'
                            )}
                        </div>
                        <button
                            className="btn primary"
                            onClick={doUpload}
                            disabled={!file || uploading}
                            style={{ minWidth: 130 }}
                        >
                            {I.inbox({ style: { width: 14, height: 14 } })}
                            {uploading ? 'Uploading…' : 'Upload'}
                        </button>
                    </div>

                    {/* Error */}
                    {uploadErr && (
                        <div className="banner warn" style={{ marginTop: 12, marginBottom: 0 }}>
                            {I.alert()}
                            <span>{uploadErr}</span>
                        </div>
                    )}

                    {/* Success */}
                    {result && !uploading && (
                        <div
                            style={{
                                marginTop: 12,
                                padding: '12px 15px',
                                background: 'var(--green-chip)',
                                borderRadius: 10,
                                display: 'flex',
                                alignItems: 'flex-start',
                                gap: 12,
                                flexWrap: 'wrap',
                            }}
                        >
                            {I.checkCircle({
                                style: { width: 17, height: 17, color: 'var(--green-ink)', flexShrink: 0, marginTop: 1 },
                            })}
                            <div style={{ flex: 1, minWidth: 140 }}>
                                <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--green-ink)' }}>
                                    {result.staged_count} entries staged
                                </div>
                                <div
                                    style={{
                                        fontSize: 11,
                                        color: 'var(--green-ink)',
                                        opacity: 0.75,
                                        marginTop: 2,
                                    }}
                                >
                                    {result.file} · {MONTHS[result.month - 1] ?? result.month}{' '}
                                    {result.year} · batch {result.batch_id.slice(0, 8)}…
                                </div>
                            </div>
                            <div
                                style={{
                                    display: 'flex',
                                    gap: 5,
                                    flexWrap: 'wrap',
                                    alignItems: 'center',
                                }}
                            >
                                {Object.entries(result.operations).map(([op, count], i) => (
                                    <span key={i} className="pill ok">
                                        {op} × {count}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* ── Preview / diff card ─────────────────────────────────────── */}
            {(result || previewLoading || previewErr) && (
                <div className="card" style={{ marginTop: 14 }}>
                    <div className="card-head">
                        <h3>Preview &amp; diff</h3>
                        {result && (
                            <span
                                className="ch-link"
                                style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                                onClick={() => loadPreview(result.batch_id)}
                            >
                                {I.refresh({ style: { width: 11, height: 11 } })} Refresh
                            </span>
                        )}
                    </div>

                    {previewErr && (
                        <div className="card-body">
                            <div className="banner warn" style={{ marginBottom: 0 }}>
                                {I.alert()} <span>{previewErr}</span>
                            </div>
                        </div>
                    )}

                    {previewLoading && (
                        <div className="card-body">
                            <div className="ph-sub">Computing diff…</div>
                        </div>
                    )}

                    {!previewLoading &&
                        preview &&
                        preview.map((d, di) => (
                            <div key={di}>
                                <div
                                    className="card-head"
                                    style={{ background: 'var(--surface-2)' }}
                                >
                                    <div
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 8,
                                        }}
                                    >
                                        <span className="pill off" style={{ fontSize: 10 }}>
                                            {d.operation || d.table}
                                        </span>
                                        <span style={{ fontSize: 12.5, fontWeight: 600 }}>
                                            {d.table}
                                        </span>
                                    </div>
                                    {d.summary && (
                                        <span className="ph-sub">{d.summary}</span>
                                    )}
                                </div>
                                <div className="card-body flush tbl-wrap">
                                    <table className="data">
                                        <thead>
                                            <tr>
                                                <th>Status</th>
                                                <th>SKU</th>
                                                <th>Description</th>
                                                <th>Changes</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {(d.rows || []).map((row, ri) => (
                                                <DiffRowPreview key={ri} row={row} />
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        ))}
                </div>
            )}

            {/* ── AI settings — manager+ only (lvl ≥ 30) ─────────────────── */}
            {lvl >= 30 && <DataEntrySettings />}
        </div>
    );
}

// ── AI settings panel ──────────────────────────────────────────────────────────

function DataEntrySettings() {
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);
    const [provider, setProvider] = useState('');
    const [model, setModel] = useState('');
    const [providers, setProviders] = useState<string[]>([]);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        let alive = true;
        (async () => {
            setLoading(true);
            setErr(null);
            try {
                const cfg = await api.getDataEntrySettings();
                if (!alive) return;
                setProvider(cfg?.current?.provider || '');
                setModel(cfg?.current?.model || '');
                setProviders(cfg?.supported_providers || []);
            } catch (e: any) {
                if (!alive) return;
                setErr(e?.message || 'Failed to load settings');
            } finally {
                if (alive) setLoading(false);
            }
        })();
        return () => { alive = false; };
    }, []);

    const save = async () => {
        setSaving(true);
        setErr(null);
        setSaved(false);
        try {
            await api.updateDataEntrySettings({ provider, model });
            setSaved(true);
        } catch (e: any) {
            setErr(e?.message || 'Failed to save settings');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="card" style={{ marginTop: 14 }}>
            <div className="card-head">
                <h3>AI stack settings</h3>
                <span className="ph-sub">manager and above</span>
            </div>
            <div className="card-body">
                {loading && <div className="ph-sub">Loading…</div>}
                {err && (
                    <div className="banner warn" style={{ marginBottom: 0 }}>
                        {I.alert()} <span>{err}</span>
                    </div>
                )}
                {!loading && (
                    <div
                        style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: 12,
                            alignItems: 'flex-end',
                        }}
                    >
                        <div>
                            <label style={LBL}>Provider</label>
                            {providers.length > 0 ? (
                                <select
                                    className="tb-select"
                                    value={provider}
                                    onChange={(e) => setProvider(e.target.value)}
                                >
                                    {providers.map((p) => (
                                        <option key={p} value={p}>{p}</option>
                                    ))}
                                </select>
                            ) : (
                                <input
                                    className="sheet-inp txt"
                                    value={provider}
                                    style={{ width: 90 }}
                                    onChange={(e) => setProvider(e.target.value)}
                                />
                            )}
                        </div>
                        <div style={{ flex: '1 1 200px' }}>
                            <label style={LBL}>Model</label>
                            <input
                                className="sheet-inp txt"
                                value={model}
                                style={{ width: '100%' }}
                                onChange={(e) => setModel(e.target.value)}
                            />
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <button className="btn primary" onClick={save} disabled={saving}>
                                {saving ? 'Saving…' : 'Save'}
                            </button>
                            {saved && <span className="pill ok">Saved</span>}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
