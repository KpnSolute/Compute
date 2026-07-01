import { useState, useEffect } from 'react';
import { I } from '../lib/icons';
import { api } from '../lib/api';
import { type ThemePref, getThemePref, saveThemePref } from '../lib/theme';
import { type AIPrefs, loadAIPrefs, saveAIPrefs } from '../lib/constants';

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
    const [uploadingAvatar, setUploadingAvatar] = useState(false);
    const [saved, setSaved] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    useEffect(() => {
        setForm({
            display_name: user.display_name || '',
            last_name: user.last_name || '',
            phone: user.phone || '',
            job_title: user.job_title || '',
            bio: user.bio || '',
            avatar_url: user.avatar_url || '',
        });
    }, [user.avatar_url, user.bio, user.display_name, user.job_title, user.last_name, user.phone]);

    const avatarInitials = (form.display_name || user.username || '?').charAt(0).toUpperCase();
    const hasAvatar = Boolean(form.avatar_url);
    const emitProfileUpdated = (updated: any) => {
        window.dispatchEvent(new CustomEvent('mjcc:user-profile-updated', { detail: { user: updated } }));
    };

    const save = async () => {
        if (!form.display_name.trim()) { setErr('Display name is required'); return; }
        setSaving(true); setErr(null); setSaved(false);
        try {
            const updated = await api.updateMyProfile({
                display_name: form.display_name.trim(),
                last_name: form.last_name.trim(),
                phone: form.phone.trim(),
                job_title: form.job_title.trim(),
                bio: form.bio.trim(),
                avatar_url: form.avatar_url.trim(),
            });
            emitProfileUpdated(updated);
            setSaved(true);
            setTimeout(() => setSaved(false), 2500);
        } catch (e: any) {
            setErr(e?.message || 'Failed to save');
        } finally {
            setSaving(false);
        }
    };

    const uploadAvatar = async (file?: File) => {
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            setErr('Choose an image file');
            return;
        }
        setUploadingAvatar(true);
        setErr(null);
        setSaved(false);
        try {
            const updated = await api.uploadMyAvatar(file);
            setForm((f) => ({ ...f, avatar_url: updated.avatar_url || f.avatar_url }));
            emitProfileUpdated(updated);
            setSaved(true);
            setTimeout(() => setSaved(false), 2500);
        } catch (e: any) {
            setErr(e?.message || 'Avatar upload failed');
        } finally {
            setUploadingAvatar(false);
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
                    <label className="btn" style={{ marginLeft: 'auto', cursor: uploadingAvatar ? 'wait' : 'pointer' }}>
                        {uploadingAvatar ? 'Uploading...' : 'Upload photo'}
                        <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp,image/gif"
                            style={{ display: 'none' }}
                            disabled={uploadingAvatar}
                            onChange={(e) => {
                                void uploadAvatar(e.target.files?.[0]);
                                e.currentTarget.value = '';
                            }}
                        />
                    </label>
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

// ── AI Preferences panel (all users) ─────────────────────────────────────────

const AI_PREF_ITEMS: Array<{ key: keyof AIPrefs; label: string; desc: string }> = [
    { key: 'effects',  label: 'AI visual effects',   desc: 'Apple Intelligence border glow on inventory inputs, upload animations, and scan-line effects' },
    { key: 'bubble',   label: 'AI agent bubble',      desc: 'Floating chat bubble in the bottom-right corner — ask the AI anything about operations' },
    { key: 'autoAI',   label: 'Auto-detect in Data Entry', desc: 'AI automatically identifies file type and routes data — uncheck to always choose manually' },
];

function AIPrefsPanel({ user }: { user: any }) {
    const [prefs, setPrefs] = useState<AIPrefs>(() => loadAIPrefs(user.id));
    const [saved, setSaved] = useState(false);

    const toggle = (key: keyof AIPrefs) => {
        const next = { ...prefs, [key]: !prefs[key] };
        setPrefs(next);
        saveAIPrefs(user.id, next);
        setSaved(true);
        setTimeout(() => setSaved(false), 1800);
    };

    return (
        <div className="card" style={{ marginTop: 14 }}>
            <div className="card-head">
                <div>
                    <h3>AI Preferences</h3>
                    <span className="ph-sub">your personal AI experience — changes apply instantly</span>
                </div>
                {saved && <span className="pill ok">Saved</span>}
            </div>
            <div className="card-body">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {AI_PREF_ITEMS.map(({ key, label, desc }) => {
                        const on = prefs[key];
                        return (
                            <label key={key} style={{
                                display: 'flex', alignItems: 'flex-start', gap: 12,
                                padding: '12px 14px', borderRadius: 10, cursor: 'pointer',
                                background: on ? 'var(--accent-soft)' : 'var(--surface-2)',
                                border: `1.5px solid ${on ? 'var(--accent)' : 'var(--line)'}`,
                                transition: 'border-color .12s, background .12s',
                            }}>
                                {/* iOS-style toggle */}
                                <div onClick={() => toggle(key)} style={{
                                    marginTop: 2, width: 40, height: 22, borderRadius: 11, flexShrink: 0,
                                    background: on ? 'var(--accent)' : 'var(--line)',
                                    position: 'relative', transition: 'background .15s', cursor: 'pointer',
                                }}>
                                    <div style={{
                                        position: 'absolute', top: 3, left: on ? 21 : 3,
                                        width: 16, height: 16, borderRadius: '50%', background: '#fff',
                                        transition: 'left .15s', boxShadow: '0 1px 4px rgba(0,0,0,.2)',
                                    }} />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--ink)' }}>{label}</div>
                                    <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 2 }}>{desc}</div>
                                </div>
                            </label>
                        );
                    })}
                </div>
                <div style={{ marginTop: 12, fontSize: 11, color: 'var(--faint)' }}>
                    These preferences are stored locally on this device. They do not affect how other users experience the system.
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
    const [loading, setLoading]   = useState(true);
    const [err, setErr]           = useState<string | null>(null);
    const [settings, setSettings] = useState<any>(null);

    // Active stack form state
    const [stackProvider, setStackProvider] = useState('');
    const [stackKeyId,    setStackKeyId]    = useState('');
    const [stackModel,    setStackModel]    = useState('');
    const [stackVision,   setStackVision]   = useState(false);
    const [models,        setModels]        = useState<Array<{ id: string; label: string; vision: boolean }>>([]);
    const [modelsLoading, setModelsLoading] = useState(false);
    const [stackSaving,   setStackSaving]   = useState(false);
    const [stackSaved,    setStackSaved]    = useState(false);

    // Per-key add/edit form state
    const [addOpen,    setAddOpen]    = useState<Record<string, boolean>>({});
    const [addForm,    setAddForm]    = useState<Record<string, { label: string; key: string; url: string; model_override: string }>>({});
    const [addBusy,    setAddBusy]    = useState<Record<string, boolean>>({});
    const [editOpen,   setEditOpen]   = useState<Record<string, boolean>>({});
    const [editForm,   setEditForm]   = useState<Record<string, { label: string; key: string; url: string; model_override: string }>>({});
    const [editBusy,   setEditBusy]   = useState<Record<string, boolean>>({});
    const [keyErr,     setKeyErr]     = useState<string | null>(null);

    const reload = async () => {
        setLoading(true); setErr(null);
        try {
            const s = await api.getDataEntrySettings();
            setSettings(s);
            const cur = s?.current || {};
            setStackProvider(cur.provider || '');
            setStackKeyId(cur.key_id || '');
            setStackModel(cur.model || '');
            setStackVision(cur.is_vision || false);
            // Init add forms
            const af: Record<string, any> = {};
            (s?.providers || []).forEach((p: any) => { af[p.provider] = { label: '', key: '', url: '', model_override: '' }; });
            setAddForm(af);
        } catch (e: any) {
            setErr(e?.message || 'Failed to load');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { reload(); }, []);

    const fetchModels = async (provider: string) => {
        if (!provider) return;
        setModelsLoading(true);
        try {
            const r = await api.getAIModels(provider);
            setModels(r.models || []);
        } catch {
            setModels([]);
        } finally {
            setModelsLoading(false);
        }
    };

    const handleStackProviderChange = (p: string) => {
        setStackProvider(p);
        setStackKeyId('');
        setStackModel('');
        setStackSaved(false);
        fetchModels(p);
    };

    useEffect(() => {
        if (stackProvider) fetchModels(stackProvider);
    }, []); // fetch once on mount for current provider

    const keysForProvider = (provider: string) =>
        (settings?.keys || []).filter((k: any) => k.provider === provider);

    const activateStack = async () => {
        if (!stackProvider || !stackKeyId || !stackModel) return;
        setStackSaving(true); setStackSaved(false); setErr(null);
        try {
            await api.setAIStack({ provider: stackProvider, key_id: stackKeyId, model: stackModel, vision_capable: stackVision });
            window.dispatchEvent(new CustomEvent('mjcc:ai-config-changed'));
            window.dispatchEvent(new CustomEvent('mjcc:settings-changed'));
            setStackSaved(true);
            setTimeout(() => setStackSaved(false), 2500);
            await reload();
        } catch (e: any) {
            setErr(e?.message || 'Failed to activate stack');
        } finally {
            setStackSaving(false);
        }
    };

    const addKey = async (provider: string) => {
        const form = addForm[provider] || {};
        if (!form.label.trim()) { setKeyErr('Key label is required'); return; }
        setAddBusy(b => ({ ...b, [provider]: true })); setKeyErr(null);
        try {
            await api.createAIKey({
                provider,
                label:          form.label.trim(),
                api_key:        form.key || undefined,
                base_url:       form.url || undefined,
                model_override: form.model_override || undefined,
            });
            window.dispatchEvent(new CustomEvent('mjcc:ai-config-changed'));
            window.dispatchEvent(new CustomEvent('mjcc:settings-changed'));
            setAddOpen(o => ({ ...o, [provider]: false }));
            setAddForm(f => ({ ...f, [provider]: { label: '', key: '', url: '', model_override: '' } }));
            await reload();
        } catch (e: any) {
            setKeyErr(e?.message || 'Failed to add key');
        } finally {
            setAddBusy(b => ({ ...b, [provider]: false }));
        }
    };

    const startEdit = (k: any) => {
        setEditOpen(o => ({ ...o, [k.id]: true }));
        setEditForm(f => ({ ...f, [k.id]: { label: k.label || '', key: '', url: k.base_url || '', model_override: k.model_override || '' } }));
    };

    const saveEdit = async (k: any) => {
        const form = editForm[k.id] || {};
        setEditBusy(b => ({ ...b, [k.id]: true })); setKeyErr(null);
        try {
            const body: any = {};
            if (form.label !== k.label)         body.label = form.label;
            if (form.key)                        body.api_key = form.key;
            if (form.url !== (k.base_url || '')) body.base_url = form.url || null;
            if (form.model_override !== (k.model_override || '')) body.model_override = form.model_override || null;
            await api.updateAIKeyById(k.id, body);
            window.dispatchEvent(new CustomEvent('mjcc:ai-config-changed'));
            window.dispatchEvent(new CustomEvent('mjcc:settings-changed'));
            setEditOpen(o => ({ ...o, [k.id]: false }));
            await reload();
        } catch (e: any) {
            setKeyErr(e?.message || 'Save failed');
        } finally {
            setEditBusy(b => ({ ...b, [k.id]: false }));
        }
    };

    const activateKey = async (k: any) => {
        setKeyErr(null);
        try {
            await api.updateAIKeyById(k.id, { is_active: true });
            window.dispatchEvent(new CustomEvent('mjcc:ai-config-changed'));
            window.dispatchEvent(new CustomEvent('mjcc:settings-changed'));
            await reload();
        } catch (e: any) {
            setKeyErr(e?.message || 'Failed to activate');
        }
    };

    const deleteKey = async (k: any) => {
        if (!window.confirm(`Delete key "${k.label}"? This cannot be undone.`)) return;
        setKeyErr(null);
        try {
            await api.deleteAIKey(k.id);
            await reload();
        } catch (e: any) {
            setKeyErr(e?.message || e?.detail || 'Delete failed');
        }
    };

    if (loading) return <div className="ph-sub">Loading providers...</div>;

    const providers: any[] = settings?.providers || [];
    const visionSet = new Set<string>(settings?.vision_models || []);

    // Determine active stack status label
    const cur = settings?.current || {};
    const activeLabel = cur.provider
        ? `${cur.provider.charAt(0).toUpperCase() + cur.provider.slice(1)} · ${cur.model || '(no model)'}${cur.is_vision ? ' ✶ Vision' : ''}`
        : null;

    const visionModels  = models.filter(m => m.vision);
    const textModels    = models.filter(m => !m.vision);
    const stackKeys     = keysForProvider(stackProvider);

    return (
        <>
            {err    && <div className="banner warn"  style={{ marginBottom: 12 }}>{I.alert()} <span>{err}</span></div>}
            {keyErr && <div className="banner warn"  style={{ marginBottom: 12 }}>{I.alert()} <span>{keyErr}</span></div>}

            {/* Active stack status */}
            <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 10,
                background: activeLabel ? 'var(--accent-soft)' : 'var(--amber-bg)',
                border: `1.5px solid ${activeLabel ? 'var(--accent)' : 'var(--amber-ink)'}` }}>
                {activeLabel
                    ? <span style={{ fontWeight: 700, fontSize: 13 }}>Active: {activeLabel}</span>
                    : <span style={{ color: 'var(--amber-ink)', fontWeight: 700, fontSize: 13 }}>No provider configured - activate one below.</span>
                }
            </div>

            {/* Provider cards */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {providers.map((prov: any) => {
                    const provKeys = keysForProvider(prov.provider);
                    const isAddOpen = addOpen[prov.provider];
                    const addF = addForm[prov.provider] || { label: '', key: '', url: '', model_override: '' };
                    const localProvider = !prov.has_key; // ollama, lm_studio

                    return (
                        <div key={prov.provider} style={{
                            border: '1.5px solid var(--line)', borderRadius: 12,
                            background: 'var(--surface-2)', overflow: 'hidden',
                        }}>
                            {/* Card header */}
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                padding: '12px 14px', borderBottom: provKeys.length || isAddOpen ? '1px solid var(--line-soft)' : 'none' }}>
                                <div>
                                    <span style={{ fontWeight: 700, fontSize: 13 }}>{prov.label}</span>
                                    <span style={{ fontSize: 10.5, color: 'var(--faint)', marginLeft: 8 }}>{prov.description}</span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    {provKeys.length > 0 && (
                                        <span className="pill off" style={{ fontSize: 10 }}>{provKeys.length} key{provKeys.length !== 1 ? 's' : ''}</span>
                                    )}
                                    <button className="btn" style={{ fontSize: 11, padding: '4px 10px' }}
                                        onClick={() => setAddOpen(o => ({ ...o, [prov.provider]: !o[prov.provider] }))}>
                                        + Add key
                                    </button>
                                </div>
                            </div>

                            {/* Named key list */}
                            {provKeys.map((k: any) => {
                                const isEdit = editOpen[k.id];
                                const ef = editForm[k.id] || {};
                                return (
                                    <div key={k.id} style={{
                                        display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap',
                                        padding: '10px 14px', borderBottom: '1px solid var(--line-soft)',
                                        background: k.is_active ? 'var(--accent-soft)' : 'transparent',
                                    }}>
                                        <div style={{ flex: 1, minWidth: 160 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                <span style={{ fontWeight: 700, fontSize: 12 }}>{k.label || '(unnamed)'}</span>
                                                {k.is_active && <span className="pill ok" style={{ fontSize: 9 }}>active</span>}
                                                {k.is_default && <span className="pill off" style={{ fontSize: 9 }}>default</span>}
                                            </div>
                                            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                                                {k.has_key ? '●●●●●●●● key saved' : '(no key)'}
                                                {k.base_url && <span style={{ marginLeft: 8, fontFamily: 'monospace', fontSize: 10 }}>{k.base_url}</span>}
                                                {k.model_override && <span style={{ marginLeft: 8, color: 'var(--faint)' }}>model: {k.model_override}</span>}
                                            </div>
                                        </div>

                                        {!isEdit ? (
                                            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0, flexWrap: 'wrap' }}>
                                                {!k.is_active && (
                                                    <button className="btn" style={{ fontSize: 11, padding: '4px 10px' }}
                                                        onClick={() => activateKey(k)}>Set active</button>
                                                )}
                                                <button className="btn" style={{ fontSize: 11, padding: '4px 10px' }}
                                                    onClick={() => startEdit(k)}>Edit</button>
                                                <button className="btn" style={{ fontSize: 11, padding: '4px 10px', color: 'var(--red, #dc2626)' }}
                                                    onClick={() => deleteKey(k)}>Delete</button>
                                            </div>
                                        ) : (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%', marginTop: 8 }}>
                                                <input className="sheet-inp txt" placeholder="Label" value={ef.label || ''}
                                                    onChange={e => setEditForm(f => ({ ...f, [k.id]: { ...f[k.id], label: e.target.value } }))} />
                                                {!localProvider && (
                                                    <input type="password" className="sheet-inp txt" placeholder="New key (leave blank to keep existing)"
                                                        value={ef.key || ''}
                                                        onChange={e => setEditForm(f => ({ ...f, [k.id]: { ...f[k.id], key: e.target.value } }))} />
                                                )}
                                                <input className="sheet-inp txt" placeholder="Base URL (optional)"
                                                    value={ef.url || ''}
                                                    onChange={e => setEditForm(f => ({ ...f, [k.id]: { ...f[k.id], url: e.target.value } }))} />
                                                <input className="sheet-inp txt" placeholder="Model override (optional)"
                                                    value={ef.model_override || ''}
                                                    onChange={e => setEditForm(f => ({ ...f, [k.id]: { ...f[k.id], model_override: e.target.value } }))} />
                                                <div style={{ display: 'flex', gap: 6 }}>
                                                    <button className="btn primary" onClick={() => saveEdit(k)} disabled={editBusy[k.id]}>
                                                        {editBusy[k.id] ? 'Saving...' : 'Save'}
                                                    </button>
                                                    <button className="btn" onClick={() => setEditOpen(o => ({ ...o, [k.id]: false }))}>Cancel</button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}

                            {/* Add key form */}
                            {isAddOpen && (
                                <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', marginBottom: 4 }}>Add new key</div>
                                    <input className="sheet-inp txt" placeholder="Key label (e.g. Production key)" value={addF.label}
                                        onChange={e => setAddForm(f => ({ ...f, [prov.provider]: { ...f[prov.provider], label: e.target.value } }))} />
                                    {prov.has_key && (
                                        <input type="password" className="sheet-inp txt" placeholder={`API key (e.g. ${PROVIDER_META[prov.provider]?.placeholder || 'key...'})`}
                                            value={addF.key}
                                            onChange={e => setAddForm(f => ({ ...f, [prov.provider]: { ...f[prov.provider], key: e.target.value } }))} />
                                    )}
                                    {(!prov.has_key || prov.provider === 'openai') && (
                                        <input className="sheet-inp txt" placeholder={`Base URL (${prov.default_url || 'optional'})`}
                                            value={addF.url}
                                            onChange={e => setAddForm(f => ({ ...f, [prov.provider]: { ...f[prov.provider], url: e.target.value } }))} />
                                    )}
                                    <input className="sheet-inp txt" placeholder="Model override (optional)"
                                        value={addF.model_override}
                                        onChange={e => setAddForm(f => ({ ...f, [prov.provider]: { ...f[prov.provider], model_override: e.target.value } }))} />
                                    <div style={{ display: 'flex', gap: 6 }}>
                                        <button className="btn primary" onClick={() => addKey(prov.provider)} disabled={addBusy[prov.provider]}>
                                            {addBusy[prov.provider] ? 'Adding...' : 'Add key'}
                                        </button>
                                        <button className="btn" onClick={() => setAddOpen(o => ({ ...o, [prov.provider]: false }))}>Cancel</button>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Active stack section */}
            <div style={{ marginTop: 20, border: '1.5px solid var(--line)', borderRadius: 12, padding: '16px 14px', background: 'var(--surface-2)' }}>
                <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 12 }}>Activate stack</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
                    {/* Provider selector */}
                    <div>
                        <label style={LBL}>Provider</label>
                        <select className="tb-select" value={stackProvider} style={{ minWidth: 160 }}
                            onChange={e => handleStackProviderChange(e.target.value)}>
                            <option value="">-- select --</option>
                            {providers.map((p: any) => (
                                <option key={p.provider} value={p.provider}>{p.label}</option>
                            ))}
                        </select>
                    </div>

                    {/* Key selector */}
                    {stackProvider && (
                        <div>
                            <label style={LBL}>Key</label>
                            <select className="tb-select" value={stackKeyId} style={{ minWidth: 180 }}
                                onChange={e => setStackKeyId(e.target.value)}>
                                <option value="">-- select key --</option>
                                {stackKeys.map((k: any) => (
                                    <option key={k.id} value={k.id}>{k.label || k.id.slice(0, 8)}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    {/* Smart model picker */}
                    {stackProvider && (
                        <div>
                            <label style={LBL}>
                                Model
                                {stackVision && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 800,
                                    background: '#eff5fe', color: '#1e3a8a',
                                    padding: '2px 7px', borderRadius: 5, border: '1px solid #bfdbfe' }}>✶ Vision</span>}
                            </label>
                            {modelsLoading ? (
                                <div style={{ fontSize: 12, color: 'var(--muted)', padding: '6px 0' }}>Loading models...</div>
                            ) : (
                                <select className="tb-select" value={stackModel} style={{ minWidth: 260 }}
                                    onChange={e => {
                                        const m = e.target.value;
                                        setStackModel(m);
                                        setStackVision(visionSet.has(m));
                                    }}>
                                    <option value="">-- select model --</option>
                                    {visionModels.length > 0 && (
                                        <optgroup label="Vision capable ✶">
                                            {visionModels.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                                        </optgroup>
                                    )}
                                    {textModels.length > 0 && (
                                        <optgroup label="Text only">
                                            {textModels.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                                        </optgroup>
                                    )}
                                    {models.length === 0 && <option value={stackModel}>{stackModel || '(enter model name)'}</option>}
                                </select>
                            )}
                        </div>
                    )}

                    {/* Activate button */}
                    <button className="btn primary" style={{ alignSelf: 'flex-end' }}
                        disabled={!stackProvider || !stackKeyId || !stackModel || stackSaving}
                        onClick={activateStack}>
                        {stackSaving ? 'Activating...' : 'Activate'}
                    </button>
                    {stackSaved && <span className="pill ok" style={{ alignSelf: 'flex-end' }}>Activated</span>}
                </div>
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

            {/* ── AI Preferences — all users ────────────────────────────────── */}
            <AIPrefsPanel user={user} />

            {/* ── AI Management — sudo only ─────────────────────────────────── */}
            {user.role === 'sudo' && <AIManagementPanel />}

            {/* ── Developer info — always ──────────────────────────────────── */}
            <DevPanel user={user} />
        </div>
    );
}
