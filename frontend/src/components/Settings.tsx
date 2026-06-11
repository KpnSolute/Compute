import { useState, useEffect } from 'react';
import { I } from '../lib/icons';
import { api } from '../lib/api';
import { type ThemePref, getThemePref, saveThemePref } from '../lib/theme';

// ── shared label style ────────────────────────────────────────────────────────

const LBL: React.CSSProperties = {
    display: 'block',
    fontSize: 11,
    fontWeight: 700,
    color: 'var(--muted)',
    marginBottom: 5,
};

// ── mini theme previews ───────────────────────────────────────────────────────

function MiniPreview({ pref }: { pref: ThemePref }) {
    if (pref === 'auto') {
        return (
            <div style={{ height: 52, borderRadius: 6, overflow: 'hidden' }}>
                <div style={{ display: 'flex', height: '100%' }}>
                    {/* Light half */}
                    <div style={{ flex: 1, background: '#f8fafc', padding: 4, display: 'flex', gap: 2 }}>
                        <div style={{ width: 8, background: '#1e3a5f', borderRadius: 2, opacity: .9 }} />
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <div style={{ height: 5, background: '#fff', borderRadius: 2, width: '75%' }} />
                            <div style={{ height: 3, background: '#94a3b8', borderRadius: 2, width: '50%', opacity: .6 }} />
                            <div style={{ flex: 1, background: '#fff', borderRadius: 2, marginTop: 1 }} />
                        </div>
                    </div>
                    {/* divider */}
                    <div style={{ width: 1, background: 'rgba(128,128,128,.25)' }} />
                    {/* Dark half */}
                    <div style={{ flex: 1, background: '#0f1117', padding: 4, display: 'flex', gap: 2 }}>
                        <div style={{ width: 8, background: '#2d5986', borderRadius: 2, opacity: .9 }} />
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <div style={{ height: 5, background: '#1c2128', borderRadius: 2, width: '75%' }} />
                            <div style={{ height: 3, background: '#8b949e', borderRadius: 2, width: '50%', opacity: .6 }} />
                            <div style={{ flex: 1, background: '#1c2128', borderRadius: 2, marginTop: 1 }} />
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    const dark = pref === 'dark';
    const bg = dark ? '#0f1117' : '#f1f5f9';
    const sidebar = dark ? '#161b22' : '#1e3a5f';
    const card = dark ? '#1c2128' : '#ffffff';
    const muted = dark ? '#8b949e' : '#94a3b8';
    const accent = dark ? '#58a6ff' : '#3b82f6';

    return (
        <div style={{ height: 52, borderRadius: 6, overflow: 'hidden', background: bg, padding: 5, display: 'flex', gap: 3 }}>
            <div style={{ width: 10, background: sidebar, borderRadius: 2, opacity: .95 }} />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                {/* topbar strip */}
                <div style={{ height: 5, background: card, borderRadius: 2, display: 'flex', alignItems: 'center', paddingLeft: 3 }}>
                    <div style={{ width: 12, height: 2, background: accent, borderRadius: 1, opacity: .7 }} />
                </div>
                {/* content rows */}
                <div style={{ height: 4, background: card, borderRadius: 2, width: '80%' }} />
                <div style={{ height: 3, background: muted, borderRadius: 2, width: '55%', opacity: .5 }} />
                <div style={{ flex: 1, background: card, borderRadius: 2, opacity: .8 }} />
            </div>
        </div>
    );
}

const THEME_META: Record<ThemePref, { label: string; desc: string }> = {
    light: { label: 'Light', desc: 'Default' },
    auto: { label: 'Auto', desc: 'Follow OS' },
    dark: { label: 'Dark', desc: 'Dark mode' },
};

function ThemeCard({
    pref,
    active,
    onClick,
}: {
    pref: ThemePref;
    active: boolean;
    onClick: () => void;
}) {
    const { label, desc } = THEME_META[pref];
    return (
        <button
            onClick={onClick}
            style={{
                flex: '1 1 110px',
                maxWidth: 160,
                background: active ? 'var(--accent-soft)' : 'var(--surface-2)',
                border: `2px solid ${active ? 'var(--accent)' : 'var(--line)'}`,
                borderRadius: 10,
                padding: '10px 10px 10px',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'border-color .14s, background .14s',
            }}
        >
            <MiniPreview pref={pref} />
            <div
                style={{
                    marginTop: 8,
                    fontWeight: 800,
                    fontSize: 13,
                    color: 'var(--ink)',
                }}
            >
                {label}
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>{desc}</div>
            {active && (
                <div
                    style={{
                        marginTop: 5,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 3,
                    }}
                >
                    {I.check({
                        style: { width: 11, height: 11, color: 'var(--accent)' },
                    })}
                    <span
                        style={{
                            fontSize: 10.5,
                            fontWeight: 800,
                            color: 'var(--accent)',
                        }}
                    >
                        Active
                    </span>
                </div>
            )}
        </button>
    );
}

// ── account field ─────────────────────────────────────────────────────────────

function AccountField({
    label,
    value,
    mono,
}: {
    label: string;
    value: string;
    mono?: boolean;
}) {
    return (
        <div>
            <div
                style={{
                    fontSize: 10,
                    fontWeight: 800,
                    color: 'var(--faint)',
                    textTransform: 'uppercase',
                    letterSpacing: '.07em',
                    marginBottom: 3,
                }}
            >
                {label}
            </div>
            <div
                style={{
                    fontSize: 13,
                    fontWeight: 600,
                    fontFamily: mono ? 'var(--mono)' : undefined,
                    color: 'var(--ink)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                }}
            >
                {value}
            </div>
        </div>
    );
}

// ── developer info panel ──────────────────────────────────────────────────────

function DevField({ label, value }: { label: string; value: string }) {
    return (
        <div
            style={{
                background: 'var(--surface-2)',
                border: '1px solid var(--line-soft)',
                borderRadius: 7,
                padding: '8px 10px',
            }}
        >
            <div
                style={{
                    fontSize: 9.5,
                    fontWeight: 800,
                    color: 'var(--faint)',
                    textTransform: 'uppercase',
                    letterSpacing: '.07em',
                    marginBottom: 4,
                }}
            >
                {label}
            </div>
            <div
                style={{
                    fontSize: 11.5,
                    fontFamily: 'var(--mono)',
                    fontWeight: 600,
                    color: 'var(--navy-2)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                }}
            >
                {value}
            </div>
        </div>
    );
}

function DevPanel({ user }: { user: any }) {
    return (
        <div className="card" style={{ marginTop: 14 }}>
            <div className="card-head">
                <h3>Developer</h3>
                <span className="ph-sub">environment &amp; build info</span>
            </div>
            <div className="card-body">
                <div
                    style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                        gap: 10,
                    }}
                >
                    <DevField label="API host" value="mjcc-managements.onrender.com" />
                    <DevField label="Database" value="MJCCv1 (Supabase)" />
                    <DevField label="Auth method" value={user.pin ? 'PIN' : 'Supabase JWT'} />
                    <DevField label="Role" value={user.role} />
                    <DevField label="User ID" value={(user.id || '').slice(0, 12) + '…'} />
                    <DevField label="Branch" value="main" />
                </div>
            </div>
        </div>
    );
}

// ── profile edit form ─────────────────────────────────────────────────────────

function ProfileEditPanel({ user }: { user: any }) {
    const [form, setForm] = useState({
        display_name: user.display_name || '',
        last_name: user.last_name || '',
        phone: user.phone || '',
        job_title: user.job_title || '',
        bio: user.bio || '',
        avatar_url: user.avatar_url || '',
    });
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    const avatarInitials = (form.display_name || user.username || '?').charAt(0).toUpperCase();
    const hasAvatar = Boolean(form.avatar_url);

    const save = async () => {
        if (!form.display_name.trim()) { setErr('Display name is required'); return; }
        setSaving(true); setErr(null); setSaved(false);
        try {
            await api.updateMyProfile({
                display_name: form.display_name.trim(),
                last_name: form.last_name.trim(),
                phone: form.phone.trim(),
                job_title: form.job_title.trim(),
                bio: form.bio.trim(),
                avatar_url: form.avatar_url.trim(),
            });
            setSaved(true);
            setTimeout(() => setSaved(false), 2500);
        } catch (e: any) {
            setErr(e?.message || 'Failed to save');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="card" style={{ marginTop: 14 }}>
            <div className="card-head">
                <h3>Account</h3>
                <span className="ph-sub">edit your profile</span>
            </div>
            <div className="card-body">
                {/* Avatar + read-only pills */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
                    <div style={{ width: 52, height: 52, borderRadius: '50%', flexShrink: 0, overflow: 'hidden', background: 'var(--navy)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {hasAvatar
                            ? <img src={form.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                            : <span style={{ color: '#fff', fontSize: 20, fontWeight: 800 }}>{avatarInitials}</span>
                        }
                    </div>
                    <div>
                        <div style={{ fontWeight: 800, fontSize: 15 }}>{form.display_name || user.username}</div>
                        <div style={{ display: 'flex', gap: 6, marginTop: 5, flexWrap: 'wrap' }}>
                            <span className="pill" style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>@{user.username}</span>
                            <span className={`pill role-${user.role}`}>{user.role}</span>
                        </div>
                    </div>
                </div>

                {err && <div className="banner warn" style={{ marginBottom: 12 }}>{I.alert()} <span>{err}</span></div>}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                        <label style={LBL}>First Name *</label>
                        <input className="sheet-inp txt" value={form.display_name} style={{ width: '100%' }} onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))} />
                    </div>
                    <div>
                        <label style={LBL}>Last Name</label>
                        <input className="sheet-inp txt" value={form.last_name} style={{ width: '100%' }} onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))} />
                    </div>
                    <div>
                        <label style={LBL}>Job Title</label>
                        <input className="sheet-inp txt" value={form.job_title} style={{ width: '100%' }} placeholder="e.g. Cafeteria Manager" onChange={e => setForm(f => ({ ...f, job_title: e.target.value }))} />
                    </div>
                    <div>
                        <label style={LBL}>Phone</label>
                        <input className="sheet-inp txt" value={form.phone} style={{ width: '100%' }} placeholder="e.g. 305-555-0100" onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
                    </div>
                    <div style={{ gridColumn: '1 / -1' }}>
                        <label style={LBL}>Avatar URL</label>
                        <input className="sheet-inp txt" value={form.avatar_url} style={{ width: '100%' }} placeholder="https://…" onChange={e => setForm(f => ({ ...f, avatar_url: e.target.value }))} />
                    </div>
                    <div style={{ gridColumn: '1 / -1' }}>
                        <label style={{ ...LBL, display: 'flex', justifyContent: 'space-between' }}>
                            <span>Bio</span>
                            <span style={{ fontWeight: 400, color: form.bio.length > 450 ? 'var(--red)' : 'var(--faint)' }}>{form.bio.length}/500</span>
                        </label>
                        <textarea
                            className="sheet-inp txt"
                            value={form.bio}
                            maxLength={500}
                            rows={3}
                            style={{ width: '100%', resize: 'vertical' }}
                            onChange={e => setForm(f => ({ ...f, bio: e.target.value }))}
                        />
                    </div>
                </div>

                <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 14 }}>
                    <button className="btn primary" onClick={save} disabled={saving}>
                        {saving ? 'Saving…' : 'Save changes'}
                    </button>
                    {saved && <span className="pill ok">Saved</span>}
                </div>

                {/* Read-only account info */}
                <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--line-soft)' }}>
                    <AccountField label="Email" value={user.email || '—'} />
                    <AccountField label="User ID" value={(user.id || '').slice(0, 12) + '…'} mono />
                    <AccountField label="Member since" value={user.created_at ? new Date(user.created_at).toLocaleDateString() : '—'} />
                </div>
            </div>
        </div>
    );
}

// ── AI management panel (sudo only) ──────────────────────────────────────────

const PROVIDER_META: Record<string, { label: string; desc: string; placeholder: string; hasKey: boolean; defaultUrl?: string }> = {
    groq:      { label: 'Groq',              desc: 'Cloud · fast llama/gemma/qwen',              placeholder: 'gsk_…',     hasKey: true },
    anthropic: { label: 'Anthropic (Claude)', desc: 'Cloud · claude-sonnet / haiku / opus',       placeholder: 'sk-ant-…',  hasKey: true },
    openai:    { label: 'OpenAI',            desc: 'Cloud · gpt-4o-mini / gpt-4o',               placeholder: 'sk-…',      hasKey: true },
    mistral:   { label: 'Mistral AI',        desc: 'Cloud · mistral-small / large',               placeholder: 'Bearer key…', hasKey: true },
    ollama:    { label: 'Ollama',            desc: 'Local server — any model (llama, mistral…)', placeholder: 'http://localhost:11434', hasKey: false, defaultUrl: 'http://localhost:11434' },
    lm_studio: { label: 'LM Studio',         desc: 'Local GUI — OpenAI-compatible, GGUF models', placeholder: 'http://localhost:1234', hasKey: false, defaultUrl: 'http://localhost:1234' },
};

// ── sub-panels ────────────────────────────────────────────────────────────────

function ProvidersTab() {
    const [loading, setLoading] = useState(true);
    const [keys, setKeys] = useState<any[]>([]);
    const [model, setModel] = useState('');
    const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
    const [urlInputs, setUrlInputs] = useState<Record<string, string>>({});
    const [saving, setSaving] = useState<Record<string, boolean>>({});
    const [saved, setSaved] = useState<Record<string, boolean>>({});
    const [err, setErr] = useState<string | null>(null);

    useEffect(() => {
        (async () => {
            try {
                const [keyData, settingsData] = await Promise.all([api.getAIKeys(), api.getDataEntrySettings()]);
                setKeys(keyData);
                setModel(settingsData?.current?.model || '');
                const urlMap: Record<string, string> = {};
                keyData.forEach((k: any) => { if (k.base_url) urlMap[k.provider] = k.base_url; });
                setUrlInputs(urlMap);
            } catch (e: any) {
                setErr(e?.message || 'Failed to load');
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    const noActiveKey = !keys.some(k => k.is_active && (k.has_key || !PROVIDER_META[k.provider]?.hasKey));

    const saveProvider = async (provider: string, setActive: boolean) => {
        setSaving(s => ({ ...s, [provider]: true }));
        setSaved(s => ({ ...s, [provider]: false }));
        try {
            const body: any = {};
            if (setActive) body.is_active = true;
            const meta = PROVIDER_META[provider];
            if (meta?.hasKey && keyInputs[provider]) body.api_key = keyInputs[provider];
            if (!meta?.hasKey && urlInputs[provider]) body.base_url = urlInputs[provider];
            const row = await api.updateAIKey(provider, body);
            setKeys(prev => prev.map(k =>
                k.provider === provider ? { ...k, ...row, has_key: row.has_key } :
                setActive ? { ...k, is_active: false } : k
            ));
            setKeyInputs(i => ({ ...i, [provider]: '' }));
            setSaved(s => ({ ...s, [provider]: true }));
            setTimeout(() => setSaved(s => ({ ...s, [provider]: false })), 2500);
        } catch (e: any) { setErr(e?.message || 'Save failed'); }
        finally { setSaving(s => ({ ...s, [provider]: false })); }
    };

    const saveModel = async () => {
        try { await api.updateDataEntrySettings({ model }); } catch { /* non-fatal */ }
    };

    const providerOrder = ['groq', 'anthropic', 'openai', 'mistral', 'ollama', 'lm_studio'];

    if (loading) return <div className="ph-sub">Loading providers…</div>;

    return (
        <>
            {err && <div className="banner warn" style={{ marginBottom: 12 }}>{I.alert()} <span>{err}</span></div>}
            {noActiveKey && (
                <div className="banner warn" style={{ marginBottom: 14 }}>
                    {I.alert()} <span>No active provider — AI data-entry uploads will fail until one is activated.</span>
                </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {providerOrder.map(provider => {
                    const meta = PROVIDER_META[provider];
                    if (!meta) return null;
                    const row = keys.find(k => k.provider === provider) || { is_active: false, has_key: false, base_url: null };
                    const isActive = row.is_active;
                    const keyVal = keyInputs[provider] || '';
                    const urlVal = urlInputs[provider] || '';

                    return (
                        <div key={provider} style={{
                            display: 'grid',
                            gridTemplateColumns: '180px 1fr auto',
                            gap: 10,
                            alignItems: 'center',
                            padding: '12px 14px',
                            background: isActive ? 'var(--accent-soft)' : 'var(--surface-2)',
                            border: `1.5px solid ${isActive ? 'var(--accent)' : 'var(--line)'}`,
                            borderRadius: 10,
                        }}>
                            {/* label + radio */}
                            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                                <input type="radio" name="active_provider" checked={isActive}
                                    onChange={() => saveProvider(provider, true)} />
                                <div>
                                    <div style={{ fontWeight: 700, fontSize: 13 }}>{meta.label}</div>
                                    <div style={{ fontSize: 10.5, color: 'var(--faint)', marginTop: 1 }}>{meta.desc}</div>
                                </div>
                            </label>

                            {/* key / URL input */}
                            {meta.hasKey ? (
                                <input type="password" className="sheet-inp txt"
                                    value={keyVal}
                                    placeholder={row.has_key ? '●●●●●●●● key saved' : meta.placeholder}
                                    onChange={e => setKeyInputs(i => ({ ...i, [provider]: e.target.value }))} />
                            ) : (
                                <input className="sheet-inp txt"
                                    value={urlVal}
                                    placeholder={row.base_url || meta.defaultUrl}
                                    onChange={e => setUrlInputs(i => ({ ...i, [provider]: e.target.value }))} />
                            )}

                            {/* save + badges */}
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                <button className="btn" style={{ whiteSpace: 'nowrap' }}
                                    disabled={saving[provider]}
                                    onClick={() => saveProvider(provider, isActive)}>
                                    {saving[provider] ? 'Saving…' : 'Save'}
                                </button>
                                {saved[provider] && <span className="pill ok">Saved</span>}
                                {row.has_key && !keyVal && meta.hasKey &&
                                    <span className="pill ok" style={{ fontSize: 10 }}>key ✓</span>}
                            </div>
                        </div>
                    );
                })}
            </div>

            <div style={{ marginTop: 14, display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 220px' }}>
                    <label style={LBL}>Model override (leave blank to use provider default)</label>
                    <input className="sheet-inp txt" value={model} style={{ width: '100%' }}
                        placeholder="e.g. claude-sonnet-4-20250514 or llama-3.3-70b-versatile"
                        onChange={e => setModel(e.target.value)} onBlur={saveModel} />
                </div>
            </div>
            <div className="banner info" style={{ marginTop: 12 }}>
                {I.alert()} <span>PDF / image receipts use the deterministic parser — no AI tokens consumed. AI processes unrecognized CSV / text formats only.</span>
            </div>
        </>
    );
}

const TOOL_DEFS: Array<{ key: string; label: string; desc: string }> = [
    { key: 'inventory',   label: 'Inventory',          desc: 'Parse CSV/text uploads into inventory items and weekly counts' },
    { key: 'events',      label: 'Events & Programs',  desc: 'Extract event records from uploaded files' },
    { key: 'menu',        label: '28-Day Menu',         desc: 'Parse meal plans and menu data from uploads' },
    { key: 'haccp',       label: 'HACCP / Compliance', desc: 'Extract temperature logs and compliance records' },
    { key: 'daily_ops',   label: 'Daily Operations',   desc: 'Parse daily ops logs and incident reports' },
    { key: 'source_ctrl', label: 'Source Control',     desc: 'AI-assisted commit summaries (future)' },
    { key: 'reports',     label: 'Report Generation',  desc: 'AI-generated monthly reports and summaries (future)' },
    { key: 'suggestions', label: 'Suggestions',        desc: 'Reorder recommendations and inventory insights (future)' },
];

function ToolsTab() {
    const [loading, setLoading] = useState(true);
    const [tools, setTools] = useState<Record<string, boolean>>({});
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    useEffect(() => {
        (async () => {
            try { setTools(await api.getAITools()); }
            catch (e: any) { setErr(e?.message || 'Failed to load'); }
            finally { setLoading(false); }
        })();
    }, []);

    const toggle = (key: string) => setTools(t => ({ ...t, [key]: !t[key] }));

    const save = async () => {
        setSaving(true); setSaved(false); setErr(null);
        try {
            const updated = await api.updateAITools(tools);
            setTools(updated);
            setSaved(true);
            setTimeout(() => setSaved(false), 2500);
        } catch (e: any) { setErr(e?.message || 'Save failed'); }
        finally { setSaving(false); }
    };

    if (loading) return <div className="ph-sub">Loading tools…</div>;

    return (
        <>
            {err && <div className="banner warn" style={{ marginBottom: 12 }}>{I.alert()} <span>{err}</span></div>}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
                {TOOL_DEFS.map(({ key, label, desc }) => {
                    const enabled = tools[key] ?? false;
                    return (
                        <button key={key} onClick={() => toggle(key)} style={{
                            display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 14px',
                            background: enabled ? 'var(--accent-soft)' : 'var(--surface-2)',
                            border: `1.5px solid ${enabled ? 'var(--accent)' : 'var(--line)'}`,
                            borderRadius: 10, cursor: 'pointer', textAlign: 'left',
                            transition: 'border-color .12s, background .12s',
                        }}>
                            {/* toggle pill */}
                            <div style={{
                                marginTop: 2, width: 32, height: 18, borderRadius: 9, flexShrink: 0,
                                background: enabled ? 'var(--accent)' : 'var(--line)',
                                position: 'relative', transition: 'background .12s',
                            }}>
                                <div style={{
                                    position: 'absolute', top: 3, left: enabled ? 16 : 3,
                                    width: 12, height: 12, borderRadius: '50%', background: '#fff',
                                    transition: 'left .12s',
                                }} />
                            </div>
                            <div>
                                <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--ink)' }}>{label}</div>
                                <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 2 }}>{desc}</div>
                            </div>
                        </button>
                    );
                })}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 14 }}>
                <button className="btn primary" onClick={save} disabled={saving}>
                    {saving ? 'Saving…' : 'Save tool config'}
                </button>
                {saved && <span className="pill ok">Saved</span>}
                <span style={{ fontSize: 11, color: 'var(--faint)', marginLeft: 4 }}>
                    Disabled tools reject uploads at the server before any AI tokens are consumed.
                </span>
            </div>
        </>
    );
}

function UsageTab() {
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState<any>(null);
    const [days, setDays] = useState(30);
    const [err, setErr] = useState<string | null>(null);

    const load = async (d: number) => {
        setLoading(true); setErr(null);
        try { setData(await api.getAIUsage(d, 50)); }
        catch (e: any) { setErr(e?.message || 'Failed to load'); }
        finally { setLoading(false); }
    };

    useEffect(() => { load(days); }, []);

    const fmt$ = (v: number) => v < 0.001 ? '<$0.001' : `$${v.toFixed(4)}`;
    const fmtN = (v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v);

    const summary = data?.summary || {};
    const byProvider: Record<string, any> = data?.by_provider || {};
    const byOp: Record<string, number> = data?.by_operation || {};
    const recent: any[] = data?.recent || [];

    return (
        <>
            {err && <div className="banner warn" style={{ marginBottom: 12 }}>{I.alert()} <span>{err}</span></div>}

            {/* window selector */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 16, alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>Window:</span>
                {[7, 30, 90].map(d => (
                    <button key={d} className={`btn${days === d ? ' primary' : ''}`}
                        style={{ padding: '3px 10px', fontSize: 11 }}
                        onClick={() => { setDays(d); load(d); }}>
                        {d}d
                    </button>
                ))}
            </div>

            {loading ? <div className="ph-sub">Loading usage data…</div> : (
                <>
                    {/* summary stat boxes */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 8, marginBottom: 16 }}>
                        {[
                            { label: 'Total Calls',   value: String(summary.total_calls ?? 0) },
                            { label: 'Successful',    value: String(summary.successful ?? 0) },
                            { label: 'Failed',        value: String(summary.failed ?? 0) },
                            { label: 'Tokens In',     value: fmtN(summary.tokens_in ?? 0) },
                            { label: 'Tokens Out',    value: fmtN(summary.tokens_out ?? 0) },
                            { label: 'Est. Cost',     value: fmt$(summary.cost_usd ?? 0) },
                            { label: 'Avg Latency',   value: `${summary.avg_duration_ms ?? 0}ms` },
                        ].map(({ label, value }) => (
                            <div key={label} style={{ background: 'var(--surface-2)', border: '1px solid var(--line-soft)', borderRadius: 8, padding: '10px 12px' }}>
                                <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--faint)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{label}</div>
                                <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--ink)', marginTop: 4 }}>{value}</div>
                            </div>
                        ))}
                    </div>

                    {/* per-provider breakdown */}
                    {Object.keys(byProvider).length > 0 && (
                        <div style={{ marginBottom: 16 }}>
                            <div style={{ ...LBL, marginBottom: 8 }}>By Provider</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                {Object.entries(byProvider).map(([p, v]) => (
                                    <div key={p} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 12 }}>
                                        <span style={{ fontWeight: 700, minWidth: 120 }}>{PROVIDER_META[p]?.label || p}</span>
                                        <span style={{ color: 'var(--muted)' }}>{v.calls} calls</span>
                                        <span style={{ color: 'var(--muted)' }}>{fmtN(v.tokens_in + v.tokens_out)} tokens</span>
                                        <span style={{ color: 'var(--muted)' }}>{fmt$(v.cost_usd)}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* per-operation breakdown */}
                    {Object.keys(byOp).length > 0 && (
                        <div style={{ marginBottom: 16 }}>
                            <div style={{ ...LBL, marginBottom: 8 }}>By Operation</div>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                {Object.entries(byOp).map(([op, n]) => (
                                    <span key={op} className="pill" style={{ fontSize: 11 }}>{op || 'unknown'} · {n}</span>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* recent calls table */}
                    {recent.length > 0 && (
                        <>
                            <div style={{ ...LBL, marginBottom: 8 }}>Recent Calls</div>
                            <div className="tbl-wrap" style={{ maxHeight: 280, overflowY: 'auto' }}>
                                <table className="data" style={{ fontSize: 11 }}>
                                    <thead>
                                        <tr>
                                            <th>Time</th><th>Provider</th><th>Model</th>
                                            <th>Operation</th><th>Tokens</th><th>Cost</th>
                                            <th>ms</th><th>Status</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {recent.map((r: any) => (
                                            <tr key={r.id}>
                                                <td style={{ color: 'var(--faint)', whiteSpace: 'nowrap' }}>
                                                    {new Date(r.created_at).toLocaleString()}
                                                </td>
                                                <td>{PROVIDER_META[r.provider]?.label || r.provider}</td>
                                                <td style={{ color: 'var(--muted)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.model}</td>
                                                <td>{r.operation || '—'}</td>
                                                <td className="num">{fmtN((r.tokens_in || 0) + (r.tokens_out || 0))}</td>
                                                <td className="num">{fmt$(r.cost_usd || 0)}</td>
                                                <td className="num">{r.duration_ms}</td>
                                                <td>
                                                    {r.success
                                                        ? <span className="pill ok" style={{ fontSize: 10 }}>ok</span>
                                                        : <span className="pill off" style={{ fontSize: 10 }} title={r.error_msg}>fail</span>}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    )}

                    {!recent.length && !summary.total_calls && (
                        <div style={{ color: 'var(--faint)', fontSize: 12, textAlign: 'center', padding: '24px 0' }}>
                            No AI calls recorded in the past {days} days.
                        </div>
                    )}
                </>
            )}
        </>
    );
}

const AGENT_TOOL_DEFS = [
    { key: 'get_dashboard_stats', label: 'Dashboard Stats',    min_role: 'staff' },
    { key: 'get_inventory',       label: 'Inventory',          min_role: 'staff' },
    { key: 'get_events',          label: 'Events',             min_role: 'staff' },
    { key: 'get_menu',            label: 'Menu',               min_role: 'staff' },
    { key: 'get_reorders',        label: 'Reorders',           min_role: 'staff' },
    { key: 'get_period_status',   label: 'Period Status',      min_role: 'staff' },
    { key: 'get_users',           label: 'Users List',         min_role: 'manager' },
    { key: 'get_haccp_logs',      label: 'HACCP Logs',         min_role: 'manager' },
    { key: 'get_daily_logs',      label: 'Daily Logs',         min_role: 'manager' },
    { key: 'create_event',        label: 'Create Event',       min_role: 'manager' },
    { key: 'get_ai_usage',        label: 'AI Usage Stats',     min_role: 'admin' },
];

const ROLES_ORDER = ['staff', 'assistant', 'manager', 'admin', 'sudo'] as const;

function AgentTab() {
    const [loading, setLoading]     = useState(true);
    const [saving,  setSaving]      = useState(false);
    const [saved,   setSaved]       = useState(false);
    const [err,     setErr]         = useState<string | null>(null);
    const [cfg,     setCfg]         = useState<any>({
        enabled:  true,
        min_role: 'staff',
        allowed_tools: ['get_dashboard_stats','get_inventory','get_events','get_menu','get_reorders','get_period_status'],
        max_turns: 20,
        rate_limit_per_hour: { staff:10, assistant:15, manager:30, admin:60, sudo:9999 },
        rate_limit_per_day:  { staff:30, assistant:60, manager:150, admin:300, sudo:9999 },
        provider: '',
        model:    '',
    });

    useEffect(() => {
        (async () => {
            try { setCfg(await api.getAgentConfig()); }
            catch (e: any) { setErr(e?.message || 'Failed to load'); }
            finally { setLoading(false); }
        })();
    }, []);

    const toggleTool = (key: string) => setCfg((c: any) => {
        const current: string[] = c.allowed_tools || [];
        const next = current.includes(key) ? current.filter((k: string) => k !== key) : [...current, key];
        return { ...c, allowed_tools: next };
    });

    const save = async () => {
        setSaving(true); setSaved(false); setErr(null);
        try {
            const payload: any = {
                enabled:    cfg.enabled,
                min_role:   cfg.min_role,
                allowed_tools: cfg.allowed_tools,
                max_turns:  Number(cfg.max_turns) || 20,
                rate_limit_per_hour: cfg.rate_limit_per_hour,
                rate_limit_per_day:  cfg.rate_limit_per_day,
            };
            if (cfg.provider) payload.provider = cfg.provider;
            if (cfg.model)    payload.model    = cfg.model;
            await api.updateAgentConfig(payload);
            setSaved(true);
            setTimeout(() => setSaved(false), 2500);
        } catch (e: any) { setErr(e?.message || 'Save failed'); }
        finally { setSaving(false); }
    };

    if (loading) return <div className="ph-sub">Loading agent config…</div>;

    return (
        <>
            {err && <div className="banner warn" style={{ marginBottom: 12 }}>{I.alert()} <span>{err}</span></div>}

            {/* Enable toggle */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, cursor: 'pointer' }}>
                <div onClick={() => setCfg((c: any) => ({ ...c, enabled: !c.enabled }))} style={{
                    width: 40, height: 22, borderRadius: 11, flexShrink: 0,
                    background: cfg.enabled ? 'var(--accent)' : 'var(--line)',
                    position: 'relative', cursor: 'pointer', transition: 'background .15s',
                }}>
                    <div style={{
                        position: 'absolute', top: 3, left: cfg.enabled ? 21 : 3,
                        width: 16, height: 16, borderRadius: '50%', background: '#fff',
                        transition: 'left .15s',
                    }} />
                </div>
                <div>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>Enable MJCC AI Agent</div>
                    <div style={{ fontSize: 11, color: 'var(--faint)' }}>Show the floating agent bubble to eligible users</div>
                </div>
            </label>

            {/* Min role */}
            <div style={{ marginBottom: 16 }}>
                <label style={LBL}>Minimum role to access agent</label>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                    {ROLES_ORDER.map(r => (
                        <label key={r} style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 12, fontWeight: cfg.min_role === r ? 800 : 400 }}>
                            <input type="radio" name="min_role" value={r} checked={cfg.min_role === r}
                                onChange={() => setCfg((c: any) => ({ ...c, min_role: r }))} />
                            {r.charAt(0).toUpperCase() + r.slice(1)}
                        </label>
                    ))}
                </div>
            </div>

            {/* Rate limits */}
            <div style={{ marginBottom: 16 }}>
                <label style={LBL}>Rate limits (requests per hour / per day)</label>
                <div style={{ marginTop: 8, overflowX: 'auto' }}>
                    <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
                        <thead>
                            <tr>
                                {['Role', 'Per Hour', 'Per Day'].map(h => (
                                    <th key={h} style={{ textAlign: 'left', padding: '4px 10px', fontWeight: 800, color: 'var(--muted)', fontSize: 11 }}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {ROLES_ORDER.map(role => (
                                <tr key={role}>
                                    <td style={{ padding: '4px 10px', fontWeight: 700 }}>{role.charAt(0).toUpperCase() + role.slice(1)}</td>
                                    <td style={{ padding: '4px 10px' }}>
                                        <input type="number" min={0} max={9999} className="sheet-inp txt"
                                            style={{ width: 70 }}
                                            value={cfg.rate_limit_per_hour?.[role] ?? 0}
                                            onChange={e => setCfg((c: any) => ({ ...c, rate_limit_per_hour: { ...c.rate_limit_per_hour, [role]: Number(e.target.value) } }))} />
                                    </td>
                                    <td style={{ padding: '4px 10px' }}>
                                        <input type="number" min={0} max={99999} className="sheet-inp txt"
                                            style={{ width: 80 }}
                                            value={cfg.rate_limit_per_day?.[role] ?? 0}
                                            onChange={e => setCfg((c: any) => ({ ...c, rate_limit_per_day: { ...c.rate_limit_per_day, [role]: Number(e.target.value) } }))} />
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Tool toggles */}
            <div style={{ marginBottom: 16 }}>
                <label style={LBL}>Available tools</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px,1fr))', gap: 8, marginTop: 8 }}>
                    {AGENT_TOOL_DEFS.map(({ key, label, min_role }) => {
                        const on = (cfg.allowed_tools || []).includes(key);
                        return (
                            <button key={key} onClick={() => toggleTool(key)} style={{
                                display: 'flex', alignItems: 'center', gap: 8,
                                padding: '8px 12px', borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                                background: on ? 'var(--accent-soft)' : 'var(--surface-2)',
                                border: `1.5px solid ${on ? 'var(--accent)' : 'var(--line)'}`,
                                transition: 'border-color .12s, background .12s',
                            }}>
                                <div style={{ width: 10, height: 10, borderRadius: '50%', background: on ? 'var(--accent)' : 'var(--line)', flexShrink: 0 }} />
                                <div>
                                    <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--ink)' }}>{label}</div>
                                    <div style={{ fontSize: 10, color: 'var(--faint)' }}>{min_role}+</div>
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Provider override */}
            <div style={{ marginBottom: 16, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 160px' }}>
                    <label style={LBL}>Provider override (blank = use data-entry default)</label>
                    <input className="sheet-inp txt" value={cfg.provider || ''} style={{ width: '100%' }}
                        placeholder="groq / anthropic / openai / mistral / ollama / lm_studio"
                        onChange={e => setCfg((c: any) => ({ ...c, provider: e.target.value }))} />
                </div>
                <div style={{ flex: '1 1 140px' }}>
                    <label style={LBL}>Model override</label>
                    <input className="sheet-inp txt" value={cfg.model || ''} style={{ width: '100%' }}
                        placeholder="e.g. llama-3.3-70b-versatile"
                        onChange={e => setCfg((c: any) => ({ ...c, model: e.target.value }))} />
                </div>
                <div>
                    <label style={LBL}>Max turns in context</label>
                    <input type="number" className="sheet-inp txt" value={cfg.max_turns || 20} min={5} max={50} style={{ width: 70 }}
                        onChange={e => setCfg((c: any) => ({ ...c, max_turns: Number(e.target.value) }))} />
                </div>
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button className="btn primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save agent config'}</button>
                {saved && <span className="pill ok">Saved</span>}
            </div>
        </>
    );
}

type AITab = 'providers' | 'tools' | 'usage' | 'agent';

function AIManagementPanel() {
    const [tab, setTab] = useState<AITab>('providers');

    const TAB_BTN: React.CSSProperties = {
        padding: '5px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
        borderRadius: 6, border: '1px solid var(--line)',
    };

    const TABS: AITab[] = ['providers', 'tools', 'usage', 'agent'];

    return (
        <div className="card" style={{ marginTop: 14 }}>
            <div className="card-head">
                <div>
                    <h3>AI Management</h3>
                    <span className="ph-sub">sudo only · providers, tool gates, usage analytics, agent control</span>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {TABS.map(t => (
                        <button key={t} style={{
                            ...TAB_BTN,
                            background: tab === t ? 'var(--navy)' : 'var(--surface-2)',
                            color: tab === t ? '#fff' : 'var(--ink)',
                            borderColor: tab === t ? 'var(--navy)' : 'var(--line)',
                        }} onClick={() => setTab(t)}>
                            {t.charAt(0).toUpperCase() + t.slice(1)}
                        </button>
                    ))}
                </div>
            </div>
            <div className="card-body">
                {tab === 'providers' && <ProvidersTab />}
                {tab === 'tools'     && <ToolsTab />}
                {tab === 'usage'     && <UsageTab />}
                {tab === 'agent'     && <AgentTab />}
            </div>
        </div>
    );
}

// ── AI engine panel (manager+, legacy model selector) ────────────────────────



// ── main Settings component ────────────────────────────────────────────────────

export function Settings({ user }: { user: any }) {
    const [theme, setThemeState] = useState<ThemePref>(() =>
        getThemePref(user.id),
    );
    const [themeSaving, setThemeSaving] = useState(false);
    const [themeSaved, setThemeSaved] = useState(false);

    // Sync backend preference on mount (covers multi-device scenario)
    useEffect(() => {
        (async () => {
            try {
                const prefs = await api.getUserPreferences();
                if (prefs?.theme) {
                    const t = prefs.theme as ThemePref;
                    saveThemePref(user.id, t);
                    setThemeState(t);
                }
            } catch {
                // non-fatal — local pref already applied
            }
        })();
    }, [user.id]);

    const handleTheme = async (pref: ThemePref) => {
        saveThemePref(user.id, pref);
        setThemeState(pref);
        setThemeSaving(true);
        setThemeSaved(false);
        try {
            await api.updateUserPreferences({ theme: pref });
            setThemeSaved(true);
            setTimeout(() => setThemeSaved(false), 2000);
        } catch {
            // theme is already applied locally even if save fails
        } finally {
            setThemeSaving(false);
        }
    };

    return (
        <div className="fade-in">
            <div className="page-head">
                <div>
                    <h2>Settings</h2>
                    <div className="ph-sub">
                        Appearance, account info, AI engine configuration
                    </div>
                </div>
            </div>

            {/* ── Appearance ──────────────────────────────────────────────── */}
            <div className="card">
                <div className="card-head">
                    <h3>Appearance</h3>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {themeSaving && (
                            <span className="ph-sub">Saving…</span>
                        )}
                        {themeSaved && (
                            <span className="pill ok">Saved</span>
                        )}
                    </div>
                </div>
                <div className="card-body">
                    <div
                        style={{
                            fontSize: 11,
                            fontWeight: 700,
                            color: 'var(--muted)',
                            textTransform: 'uppercase',
                            letterSpacing: '.06em',
                            marginBottom: 12,
                        }}
                    >
                        Theme
                    </div>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        {(['light', 'auto', 'dark'] as ThemePref[]).map((pref) => (
                            <ThemeCard
                                key={pref}
                                pref={pref}
                                active={theme === pref}
                                onClick={() => handleTheme(pref)}
                            />
                        ))}
                    </div>
                    <div
                        style={{
                            marginTop: 14,
                            fontSize: 11,
                            color: 'var(--muted)',
                        }}
                    >
                        <b>Auto</b> follows your operating system preference (
                        <code style={{ fontSize: 10.5 }}>prefers-color-scheme</code>). Your
                        choice is saved to your account and syncs across devices.
                    </div>
                </div>
            </div>

            {/* ── Account / Profile Edit ──────────────────────────────────── */}
            <ProfileEditPanel user={user} />

            {/* ── AI Management — sudo only ─────────────────────────────────── */}
            {user.role === 'sudo' && <AIManagementPanel />}

            {/* ── Developer info — always ──────────────────────────────────── */}
            <DevPanel user={user} />
        </div>
    );
}
