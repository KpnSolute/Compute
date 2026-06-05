import { useState, useEffect, useCallback } from 'react';
import { I } from '../lib/icons';
import { ROLE_LEVEL, MONTHS } from '../lib/constants';
import { api } from '../lib/api';

type Hint = '' | 'inventory' | 'events' | 'haccp' | 'menu' | 'log';

interface UploadResult {
    batch_id: string;
    staged_count: number;
    operations: string[];
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

export function DataEntry({ user }: { user: any }) {
    const lvl = ROLE_LEVEL[user.role as keyof typeof ROLE_LEVEL] ?? 0;
    const now = new Date();

    const [file, setFile] = useState<File | null>(null);
    const [hint, setHint] = useState<Hint>('');
    const [month, setMonth] = useState<number>(now.getMonth());
    const [year, setYear] = useState<number>(now.getFullYear());

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
            const res = await api.uploadDataEntry(file, hint, month + 1, year);
            setResult(res);
            await loadPreview(res.batch_id);
        } catch (e: any) {
            setUploadErr(e?.message || 'Upload failed');
        } finally {
            setUploading(false);
        }
    }, [file, hint, month, year, loadPreview]);

    return (
        <div className="fade-in">
            <div className="page-head">
                <div>
                    <h2>Data Entry</h2>
                    <div className="ph-sub">
                        AI file ingestion &middot; parse &rarr; extract &rarr; stage &rarr; review diff
                    </div>
                </div>
            </div>

            {/* Upload panel */}
            <div className="card">
                <div className="card-head">
                    <h3>Upload file</h3>
                </div>
                <div className="card-body">
                    <div
                        style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: 12,
                            alignItems: 'flex-end',
                        }}
                    >
                        <div style={{ flex: '1 1 240px' }}>
                            <label className="sc-lbl">File (CSV / Excel / PDF / TSV)</label>
                            <input
                                type="file"
                                accept=".csv,.tsv,.xls,.xlsx,.pdf,.txt"
                                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                            />
                        </div>
                        <div>
                            <label className="sc-lbl">Hint</label>
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
                        <div>
                            <label className="sc-lbl">Month</label>
                            <select
                                className="tb-select"
                                value={month}
                                onChange={(e) => setMonth(+e.target.value)}
                            >
                                {MONTHS.map((nm, i) => (
                                    <option key={i} value={i}>
                                        {nm}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="sc-lbl">Year</label>
                            <select
                                className="tb-select"
                                value={year}
                                onChange={(e) => setYear(+e.target.value)}
                            >
                                {[2024, 2025, 2026].map((yr) => (
                                    <option key={yr} value={yr}>
                                        {yr}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <button
                                className="btn primary"
                                onClick={doUpload}
                                disabled={!file || uploading}
                            >
                                {I.inbox({ style: { width: 14, height: 14 } })}{' '}
                                {uploading ? 'Uploading…' : 'Upload'}
                            </button>
                        </div>
                    </div>

                    {uploadErr && (
                        <div className="banner warn" style={{ marginTop: 12 }}>
                            {I.alert()}
                            <span>{uploadErr}</span>
                        </div>
                    )}

                    {result && (
                        <div style={{ marginTop: 12 }}>
                            <div className="ph-sub">
                                Batch <b>{result.batch_id}</b> &middot;{' '}
                                {result.staged_count} entries staged from{' '}
                                <b>{result.file}</b> &middot; {MONTHS[result.month - 1] ?? result.month}{' '}
                                {result.year}
                            </div>
                            {result.operations?.length > 0 && (
                                <div style={{ marginTop: 6 }}>
                                    {result.operations.map((op, i) => (
                                        <span key={i} className="pill ok" style={{ marginRight: 6 }}>
                                            {op}
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Preview panel */}
            {(result || previewLoading || previewErr) && (
                <div className="card" style={{ marginTop: 16 }}>
                    <div className="card-head">
                        <h3>Preview &amp; diff</h3>
                        {result && (
                            <span
                                className="ch-link"
                                onClick={() => loadPreview(result.batch_id)}
                            >
                                Refresh
                            </span>
                        )}
                    </div>
                    {previewErr && (
                        <div className="card-body">
                            <div className="banner warn">
                                {I.alert()}
                                <span>{previewErr}</span>
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
                                <div className="card-head">
                                    <h3>
                                        {d.table}
                                        {d.operation ? ` · ${d.operation}` : ''}
                                    </h3>
                                    {d.summary && <span className="ph-sub">{d.summary}</span>}
                                </div>
                                <div className="card-body flush tbl-wrap">
                                    <table className="data">
                                        <thead>
                                            <tr>
                                                <th>Status</th>
                                                <th>Before</th>
                                                <th>After</th>
                                                <th>Changes</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {(d.rows || []).map((row, ri) => (
                                                <tr key={ri}>
                                                    <td>
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
                                                    <td>
                                                        <code style={{ fontSize: 11 }}>
                                                            {row.before
                                                                ? JSON.stringify(row.before)
                                                                : '—'}
                                                        </code>
                                                    </td>
                                                    <td>
                                                        <code style={{ fontSize: 11 }}>
                                                            {row.after
                                                                ? JSON.stringify(row.after)
                                                                : '—'}
                                                        </code>
                                                    </td>
                                                    <td>
                                                        {(row.changes || []).join(', ') || '—'}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        ))}
                </div>
            )}

            {/* Settings sub-panel — manager+ only (lvl >= 30) */}
            {lvl >= 30 && <DataEntrySettings />}
        </div>
    );
}

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
        return () => {
            alive = false;
        };
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
        <div className="card" style={{ marginTop: 16 }}>
            <div className="card-head">
                <h3>AI stack settings</h3>
                <span className="ph-sub">Manager and above</span>
            </div>
            <div className="card-body">
                {loading && <div className="ph-sub">Loading settings…</div>}
                {err && (
                    <div className="banner warn">
                        {I.alert()}
                        <span>{err}</span>
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
                            <label className="sc-lbl">Provider</label>
                            {providers.length > 0 ? (
                                <select
                                    className="tb-select"
                                    value={provider}
                                    onChange={(e) => setProvider(e.target.value)}
                                >
                                    {providers.map((p) => (
                                        <option key={p} value={p}>
                                            {p}
                                        </option>
                                    ))}
                                </select>
                            ) : (
                                <input
                                    className="sheet-inp"
                                    value={provider}
                                    onChange={(e) => setProvider(e.target.value)}
                                />
                            )}
                        </div>
                        <div style={{ flex: '1 1 220px' }}>
                            <label className="sc-lbl">Model</label>
                            <input
                                className="sheet-inp"
                                value={model}
                                onChange={(e) => setModel(e.target.value)}
                            />
                        </div>
                        <div>
                            <button className="btn primary" onClick={save} disabled={saving}>
                                {saving ? 'Saving…' : 'Save'}
                            </button>
                        </div>
                        {saved && (
                            <span className="pill ok" style={{ marginBottom: 6 }}>
                                Saved
                            </span>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
