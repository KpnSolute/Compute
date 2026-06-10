import { useState, useEffect } from 'react';
import { I } from '../lib/icons';
import { ROLE_LEVEL } from '../lib/constants';
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

// ── AI engine panel (manager+) ────────────────────────────────────────────────

function AIEnginePanel() {
    const [loading, setLoading] = useState(true);
    const [cfg, setCfg] = useState({ provider: '', model: '' });
    const [providers, setProviders] = useState<string[]>([]);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    useEffect(() => {
        (async () => {
            try {
                const data = await api.getDataEntrySettings();
                setCfg({
                    provider: data?.current?.provider || '',
                    model: data?.current?.model || '',
                });
                setProviders(data?.supported_providers || []);
            } catch (e: any) {
                setErr(e?.message || 'Failed to load');
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    const save = async () => {
        setSaving(true);
        setErr(null);
        setSaved(false);
        try {
            await api.updateDataEntrySettings(cfg);
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
                <h3>AI Engine</h3>
                <span className="ph-sub">manager and above · used for all data-entry uploads</span>
            </div>
            <div className="card-body">
                {loading && <div className="ph-sub">Loading…</div>}
                {err && (
                    <div className="banner warn" style={{ marginBottom: 12 }}>
                        {I.alert()} <span>{err}</span>
                    </div>
                )}
                {!loading && (
                    <>
                        <div
                            style={{
                                display: 'flex',
                                gap: 12,
                                flexWrap: 'wrap',
                                alignItems: 'flex-end',
                                marginBottom: 14,
                            }}
                        >
                            <div>
                                <label style={LBL}>Provider</label>
                                <select
                                    className="tb-select"
                                    value={cfg.provider}
                                    onChange={(e) =>
                                        setCfg((c) => ({ ...c, provider: e.target.value }))
                                    }
                                >
                                    {providers.map((p) => (
                                        <option key={p} value={p}>
                                            {p}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div style={{ flex: '1 1 200px' }}>
                                <label style={LBL}>Model</label>
                                <input
                                    className="sheet-inp txt"
                                    value={cfg.model}
                                    style={{ width: '100%' }}
                                    onChange={(e) =>
                                        setCfg((c) => ({ ...c, model: e.target.value }))
                                    }
                                    placeholder="e.g. llama-3.3-70b-versatile"
                                />
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <button
                                    className="btn primary"
                                    onClick={save}
                                    disabled={saving}
                                >
                                    {saving ? 'Saving…' : 'Save'}
                                </button>
                                {saved && <span className="pill ok">Saved</span>}
                            </div>
                        </div>
                        <div
                            className="banner info"
                            style={{ marginBottom: 0 }}
                        >
                            {I.alert()}
                            <span>
                                PDF invoices and image receipts skip AI entirely (deterministic
                                parser). AI is only used as fallback for unrecognized CSV / text
                                formats.
                            </span>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

// ── main Settings component ────────────────────────────────────────────────────

export function Settings({ user }: { user: any }) {
    const lvl = ROLE_LEVEL[user.role as keyof typeof ROLE_LEVEL] ?? 0;

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

            {/* ── Account ─────────────────────────────────────────────────── */}
            <div className="card" style={{ marginTop: 14 }}>
                <div className="card-head">
                    <h3>Account</h3>
                </div>
                <div className="card-body">
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 14,
                            marginBottom: 16,
                        }}
                    >
                        {/* Avatar */}
                        <div
                            style={{
                                width: 46,
                                height: 46,
                                borderRadius: '50%',
                                background: 'var(--navy)',
                                color: '#fff',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 18,
                                fontWeight: 800,
                                flexShrink: 0,
                                letterSpacing: '-.5px',
                            }}
                        >
                            {(user.display_name || user.username || '?')
                                .charAt(0)
                                .toUpperCase()}
                        </div>
                        <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 800, fontSize: 15 }}>
                                {user.display_name || user.username}
                            </div>
                            <div
                                style={{
                                    fontSize: 12,
                                    color: 'var(--muted)',
                                    marginTop: 2,
                                }}
                            >
                                @{user.username}
                            </div>
                        </div>
                        <span className={`pill role-${user.role}`}>{user.role}</span>
                    </div>

                    <div
                        style={{
                            display: 'flex',
                            gap: 20,
                            flexWrap: 'wrap',
                        }}
                    >
                        <AccountField
                            label="Email"
                            value={user.email || '—'}
                        />
                        <AccountField
                            label="User ID"
                            value={(user.id || '').slice(0, 12) + '…'}
                            mono
                        />
                        <AccountField
                            label="Member since"
                            value={
                                user.created_at
                                    ? new Date(user.created_at).toLocaleDateString()
                                    : '—'
                            }
                        />
                        {user.last_name && (
                            <AccountField
                                label="Last name"
                                value={user.last_name}
                            />
                        )}
                    </div>
                </div>
            </div>

            {/* ── AI Engine — manager+ ─────────────────────────────────────── */}
            {lvl >= 30 && <AIEnginePanel />}

            {/* ── Developer info — always ──────────────────────────────────── */}
            <DevPanel user={user} />
        </div>
    );
}
