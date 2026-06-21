import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { ROLE_LEVEL } from '../lib/constants';
import type { User } from '../lib/constants';

// ── shared helpers ─────────────────────────────────────────────────────────────

const ROLE_COLOR: Record<string, string> = {
    staff: '#6b7280', assistant: '#0e7490', manager: '#7c3aed', admin: '#1e3a8a', sudo: '#9f1239',
};
const ROLE_BG: Record<string, string> = {
    staff: '#f3f4f6', assistant: '#ecfeff', manager: '#ede9fe', admin: '#eff5fe', sudo: '#fff1f2',
};

function RoleBadge({ role }: { role: string }) {
    return (
        <span style={{
            fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 8,
            color: ROLE_COLOR[role] || '#374151',
            background: ROLE_BG[role] || '#f3f4f6',
            textTransform: 'uppercase', letterSpacing: '0.04em',
        }}>
            {role}+
        </span>
    );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
    return (
        <div style={{
            fontSize: 10.5, fontWeight: 800, letterSpacing: '0.08em',
            textTransform: 'uppercase', color: 'var(--muted)',
            marginBottom: 10,
        }}>
            {children}
        </div>
    );
}

function StatBox({ label, value, sub, tint = 'var(--navy)' }: {
    label: string; value: string | number; sub?: string; tint?: string;
}) {
    return (
        <div style={{
            background: 'var(--surface)', border: '1px solid var(--line)',
            borderRadius: 10, padding: '14px 18px', flex: '1 1 120px',
        }}>
            <div style={{ fontSize: 10.5, color: 'var(--muted)', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: tint, lineHeight: 1.1 }}>{value}</div>
            {sub && <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 3 }}>{sub}</div>}
        </div>
    );
}

function fmtTime(iso: string) {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
}
function fmtCost(usd: number) {
    return usd < 0.001 ? '<$0.001' : `$${usd.toFixed(4)}`;
}

// ── tool metadata (mirrors backend TOOL_MIN_ROLE + TOOL_DESCRIPTIONS) ──────────

const TOOL_META: Record<string, { label: string; emoji: string; desc: string; minRole: string }> = {
    stage_inventory_save: { label: 'Stage Inventory', emoji: 'SC', desc: 'Stage month-level inventory edits into Source Control for review.', minRole: 'manager' },
    stage_inventory_week_update: { label: 'Stage Weekly Data', emoji: 'SC', desc: 'Stage weekly received or issued quantities and attach them to a pull request.', minRole: 'manager' },
    get_source_control_status: { label: 'Source Status', emoji: 'SC', desc: 'Check pending staged changes and open pull requests.', minRole: 'manager' },
    get_dashboard_stats: { label: 'Dashboard Stats',   emoji: '📊', desc: 'Inventory value, event count, users, and below-par item summary.',                     minRole: 'staff'   },
    get_inventory:       { label: 'Inventory',         emoji: '📦', desc: 'Full inventory list with quantities, par levels, and reorder status.',                   minRole: 'staff'   },
    get_events:          { label: 'Events',            emoji: '📅', desc: 'Upcoming and past events and programs with themes and menu suggestions.',                minRole: 'staff'   },
    get_menu:            { label: 'Menu',              emoji: '🍽️', desc: 'Meal period menu for any day of the week (Mon–Sun).',                                   minRole: 'staff'   },
    get_reorders:        { label: 'Reorders',          emoji: '🔄', desc: 'Items that have fallen below par level and need to be reordered.',                       minRole: 'staff'   },
    get_period_status:   { label: 'Period Status',     emoji: '📆', desc: 'Current inventory period, month/year, and rollover readiness.',                          minRole: 'staff'   },
    get_haccp_logs:      { label: 'HACCP Logs',        emoji: '🌡️', desc: 'Temperature and compliance log entries for a given date range.',                        minRole: 'staff'   },
    get_daily_logs:      { label: 'Daily Ops Logs',    emoji: '✅', desc: 'Daily operations journal entries and shift notes.',                                       minRole: 'staff'   },
    get_users:           { label: 'Users & Roles',     emoji: '👥', desc: 'Active user list with role distribution — manager access required.',                    minRole: 'manager' },
    create_event:        { label: 'Create Event',      emoji: '✨', desc: 'Create a new event or program on the calendar — manager access required.',              minRole: 'manager' },
    get_ai_usage:        { label: 'AI Usage Stats',    emoji: '📈', desc: 'System-wide AI usage, token counts, cost, and per-provider breakdown — admin only.',   minRole: 'admin'   },
};

// ── automation presets ─────────────────────────────────────────────────────────

interface Preset {
    id: string;
    emoji: string;
    label: string;
    desc: string;
    tags: string[];
    prompt: string;
    minRole?: string;
}

const PRESETS: Preset[] = [
    {
        id: 'dashboard-brief',
        emoji: '📊',
        label: 'Dashboard Briefing',
        desc: 'Full operational snapshot — inventory, menu, events, alerts.',
        tags: ['get_dashboard_stats', 'get_events', 'get_menu'],
        prompt: "Give me a full operational briefing: current inventory value and health, today's menu highlights, upcoming events this week, and any items that need immediate attention. Format as a concise executive summary.",
    },
    {
        id: 'inv-health',
        emoji: '📦',
        label: 'Inventory Health Check',
        desc: 'Below-par items, reorder urgency, and total value snapshot.',
        tags: ['get_dashboard_stats', 'get_reorders'],
        prompt: 'Run a full inventory health check: how many items are below par, list the most critical ones, and tell me the current estimated inventory value. Prioritize by severity.',
    },
    {
        id: 'weekly-events',
        emoji: '📅',
        label: 'Weekly Event Preview',
        desc: 'All events coming up in the next 7 days with themes.',
        tags: ['get_events'],
        prompt: 'List all upcoming events for the next 7 days including their themes, dates, and any suggested menu items. Format clearly as a preview schedule.',
    },
    {
        id: 'reorder-report',
        emoji: '🔄',
        label: 'Reorder Report',
        desc: 'Prioritized reorder list with on-hand quantities vs par.',
        tags: ['get_reorders', 'get_inventory'],
        prompt: 'Generate a reorder report. List all items below their par level sorted by urgency (most critical first). For each item include: name, current on-hand quantity, par level, and how much to reorder.',
    },
    {
        id: 'daily-status',
        emoji: '✅',
        label: 'Daily Ops Summary',
        desc: "Today's HACCP and operations status — compliance at a glance.",
        tags: ['get_haccp_logs', 'get_daily_logs'],
        prompt: "Summarize today's operational status: any HACCP temperature logs recorded, daily operations journal entries, and flag any compliance concerns or missing logs that should be completed.",
    },
    {
        id: 'menu-tonight',
        emoji: '🍽️',
        label: "Tonight's Menu",
        desc: "Pull tonight's dinner service in a clean list.",
        tags: ['get_menu'],
        prompt: "What's on the menu tonight? Show me dinner service items for today in a clean, formatted list. If dinner is not available, show the next available meal period.",
    },
];

// ── MY USAGE VIEW ──────────────────────────────────────────────────────────────

export function AIUsageView({ user }: { user: User }) {
    const [history,    setHistory]    = useState<any[]>([]);
    const [config,     setConfig]     = useState<any>(null);
    const [sysUsage,   setSysUsage]   = useState<any>(null);
    const [loading,    setLoading]    = useState(true);
    const [window,     setWindow]     = useState<7 | 30>(7);
    const isAdmin = ROLE_LEVEL[user.role] >= 40;

    useEffect(() => {
        (async () => {
            setLoading(true);
            try {
                const [cfg, hist] = await Promise.all([
                    api.getAgentConfig().catch(() => null),
                    api.getAgentHistory(200).catch(() => []),
                ]);
                setConfig(cfg);
                setHistory(hist || []);
                if (isAdmin) {
                    const usage = await api.getAIUsage(window, 200).catch(() => null);
                    setSysUsage(usage);
                }
            } finally {
                setLoading(false);
            }
        })();
    }, [window, isAdmin]);

    // Derive personal stats from history
    const myTurns = history.filter(t => t.role === 'user');
    const today = new Date().toISOString().slice(0, 10);
    const todayCalls = myTurns.filter(t => t.created_at?.slice(0, 10) === today).length;
    const hourLimit = config?.rate_limit_per_hour?.[user.role] ?? 10;
    const dayLimit  = config?.rate_limit_per_day?.[user.role] ?? 30;

    // Tool usage from tool turns
    const toolTurns = history.filter(t => t.role === 'tool' && t.tool_name);
    const toolCounts: Record<string, number> = {};
    toolTurns.forEach(t => { toolCounts[t.tool_name] = (toolCounts[t.tool_name] || 0) + 1; });
    const topTools = Object.entries(toolCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);

    // Group calls by date for bar chart (last 7 or 30 days)
    const days = Array.from({ length: window }, (_, i) => {
        const d = new Date(); d.setDate(d.getDate() - (window - 1 - i));
        return d.toISOString().slice(0, 10);
    });
    const callsByDay = days.map(d => ({
        day: d,
        label: new Date(d + 'T12:00:00').toLocaleDateString([], { month: 'short', day: 'numeric' }),
        count: myTurns.filter(t => t.created_at?.slice(0, 10) === d).length,
    }));
    const maxDay = Math.max(...callsByDay.map(d => d.count), 1);

    const displayTurns = history.filter(t => t.role === 'user').slice(0, 30);

    if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Loading usage data…</div>;

    return (
        <div style={{ padding: '28px 32px', maxWidth: 900 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 24 }}>
                <h2 style={{ fontSize: 20, fontWeight: 800, color: 'var(--ink)', margin: 0 }}>My AI Usage</h2>
                <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
                    {([7, 30] as const).map(w => (
                        <button key={w} onClick={() => setWindow(w)} style={{
                            fontSize: 11.5, padding: '4px 12px', borderRadius: 8,
                            border: '1px solid var(--line)',
                            background: window === w ? 'var(--navy)' : 'var(--surface)',
                            color: window === w ? '#fff' : 'var(--muted)',
                            cursor: 'pointer', fontWeight: 700,
                        }}>{w}d</button>
                    ))}
                </div>
            </div>

            {/* Stat row */}
            <div className="ai-stat-row" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 24 }}>
                <StatBox label="Today's Calls" value={todayCalls} sub={`of ${dayLimit} daily limit`} />
                <StatBox label="Hour Limit" value={hourLimit} sub="requests / hour" tint="var(--muted)" />
                <StatBox label={`${window}d Conversations`} value={myTurns.length} sub="messages sent" tint="#7c3aed" />
                <StatBox label="Tools Used" value={toolTurns.length} sub={`${window}d total calls`} tint="#0e7490" />
            </div>

            {/* Activity bar chart */}
            <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, padding: '18px 20px', marginBottom: 20 }}>
                <SectionLabel>Activity — last {window} days</SectionLabel>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 72 }}>
                    {callsByDay.map(d => (
                        <div key={d.day} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                            <div title={`${d.count} calls`} style={{
                                width: '100%', height: d.count ? Math.max(6, Math.round((d.count / maxDay) * 56)) : 4,
                                background: d.day === today ? 'var(--navy)' : d.count ? '#93c5fd' : 'var(--line)',
                                borderRadius: 3, transition: 'height .2s',
                            }} />
                            {window <= 14 && (
                                <div style={{ fontSize: 9, color: 'var(--faint)', transform: 'rotate(-35deg)', whiteSpace: 'nowrap' }}>
                                    {d.label}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
                {/* Recent conversations */}
                <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, padding: '18px 20px' }}>
                    <SectionLabel>Recent Conversations</SectionLabel>
                    {displayTurns.length === 0 ? (
                        <div style={{ fontSize: 12.5, color: 'var(--faint)', padding: '16px 0' }}>No conversations yet — try asking MJCC AI something!</div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                            {displayTurns.slice(0, 12).map((t, i) => (
                                <div key={t.id || i} style={{
                                    padding: '9px 0',
                                    borderBottom: i < displayTurns.length - 1 ? '1px solid var(--line)' : 'none',
                                    display: 'flex', flexDirection: 'column', gap: 2,
                                }}>
                                    <div style={{ fontSize: 12.5, color: 'var(--ink)', lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {t.content}
                                    </div>
                                    <div style={{ fontSize: 10.5, color: 'var(--faint)' }}>
                                        {t.created_at ? `${fmtDate(t.created_at)} · ${fmtTime(t.created_at)}` : ''}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Top tools */}
                <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, padding: '18px 20px' }}>
                    <SectionLabel>Top Tools Used</SectionLabel>
                    {topTools.length === 0 ? (
                        <div style={{ fontSize: 12.5, color: 'var(--faint)', padding: '16px 0' }}>No tool calls yet.</div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                            {topTools.map(([name, count]) => {
                                const meta = TOOL_META[name];
                                const pct = Math.round((count / toolTurns.length) * 100);
                                return (
                                    <div key={name}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                                            <span style={{ fontSize: 12, color: 'var(--ink)', fontWeight: 600 }}>
                                                {meta?.emoji} {meta?.label || name}
                                            </span>
                                            <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>{count}×</span>
                                        </div>
                                        <div style={{ height: 4, background: 'var(--line)', borderRadius: 2 }}>
                                            <div style={{ height: '100%', width: `${pct}%`, background: 'var(--navy)', borderRadius: 2 }} />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>

            {/* System-wide usage (admin+) */}
            {isAdmin && sysUsage && (
                <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, padding: '18px 20px' }}>
                    <SectionLabel>System-Wide Usage (Admin View)</SectionLabel>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
                        <StatBox label="Total Calls" value={sysUsage.summary?.total_calls ?? '—'} sub={`last ${window}d`} />
                        <StatBox label="Tokens In" value={sysUsage.summary ? `${((sysUsage.summary.total_tokens_in || 0) / 1000).toFixed(1)}K` : '—'} tint="#0e7490" />
                        <StatBox label="Tokens Out" value={sysUsage.summary ? `${((sysUsage.summary.total_tokens_out || 0) / 1000).toFixed(1)}K` : '—'} tint="#7c3aed" />
                        <StatBox label="Est. Cost" value={sysUsage.summary ? fmtCost(sysUsage.summary.total_cost_usd || 0) : '—'} tint="#d97706" />
                    </div>
                    {sysUsage.recent_calls && sysUsage.recent_calls.length > 0 && (
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                                <thead>
                                    <tr style={{ color: 'var(--muted)', fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase' }}>
                                        {['Time', 'Provider', 'Model', 'Operation', 'Tokens', 'Cost', 'ms', 'Status'].map(h => (
                                            <th key={h} style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--line)' }}>{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {sysUsage.recent_calls.slice(0, 20).map((r: any, i: number) => (
                                        <tr key={i} style={{ borderBottom: '1px solid var(--line)' }}>
                                            <td style={{ padding: '6px 8px', color: 'var(--faint)' }}>{r.created_at ? fmtTime(r.created_at) : ''}</td>
                                            <td style={{ padding: '6px 8px', fontWeight: 700 }}>{r.provider}</td>
                                            <td style={{ padding: '6px 8px', color: 'var(--muted)', fontSize: 11 }}>{r.model}</td>
                                            <td style={{ padding: '6px 8px', color: 'var(--muted)' }}>{r.operation}</td>
                                            <td style={{ padding: '6px 8px', fontFamily: 'monospace' }}>{(r.tokens_in || 0) + (r.tokens_out || 0)}</td>
                                            <td style={{ padding: '6px 8px', fontFamily: 'monospace', color: '#d97706' }}>{fmtCost(r.cost_usd || 0)}</td>
                                            <td style={{ padding: '6px 8px', fontFamily: 'monospace', color: 'var(--muted)' }}>{r.duration_ms}</td>
                                            <td style={{ padding: '6px 8px' }}>
                                                <span style={{
                                                    fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 8,
                                                    background: r.success ? '#dcfce7' : '#fee2e2',
                                                    color: r.success ? '#15803d' : '#dc2626',
                                                }}>
                                                    {r.success ? 'ok' : 'fail'}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ── TOOLS VIEW ─────────────────────────────────────────────────────────────────

export function AIToolsView({ user }: { user: User }) {
    const [config, setConfig] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const userLevel = ROLE_LEVEL[user.role];

    useEffect(() => {
        api.getAgentConfig().then(setConfig).catch(() => null).finally(() => setLoading(false));
    }, []);

    const allowedTools: string[] = config?.allowed_tools || [];

    if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Loading tools…</div>;

    return (
        <div style={{ padding: '28px 32px', maxWidth: 900 }}>
            <div style={{ marginBottom: 24 }}>
                <h2 style={{ fontSize: 20, fontWeight: 800, color: 'var(--ink)', margin: '0 0 6px' }}>Available Tools</h2>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>
                    MJCC AI can perform these actions on your behalf. Green = enabled for your role.
                    {userLevel >= 50 && ' Configure which tools are active in Settings → AI Studio → Agent tab.'}
                </p>
            </div>

            <div className="ai-studio-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
                {Object.entries(TOOL_META).map(([key, meta]) => {
                    const minLevel   = ROLE_LEVEL[meta.minRole as keyof typeof ROLE_LEVEL] ?? 0;
                    const roleOk     = userLevel >= minLevel;
                    const configOk   = allowedTools.includes(key);
                    const available  = roleOk && configOk;

                    return (
                        <div key={key} style={{
                            background: 'var(--surface)',
                            border: `1px solid ${available ? 'var(--line)' : 'var(--line)'}`,
                            borderRadius: 10,
                            padding: '16px 18px',
                            opacity: available ? 1 : 0.5,
                            position: 'relative',
                            overflow: 'hidden',
                        }}>
                            {available && (
                                <div style={{
                                    position: 'absolute', top: 0, left: 0, right: 0, height: 3,
                                    background: 'var(--navy)', borderRadius: '10px 10px 0 0',
                                }} />
                            )}
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
                                <span style={{ fontSize: 22, lineHeight: 1, flexShrink: 0 }}>{meta.emoji}</span>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--ink)', marginBottom: 2 }}>{meta.label}</div>
                                    <RoleBadge role={meta.minRole} />
                                </div>
                                <div style={{
                                    width: 8, height: 8, borderRadius: '50%', flexShrink: 0, marginTop: 4,
                                    background: available ? '#22c55e' : '#d1d5db',
                                }} title={available ? 'Enabled' : (roleOk ? 'Disabled in config' : 'Role too low')} />
                            </div>
                            <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>{meta.desc}</p>
                            {!roleOk && (
                                <div style={{ marginTop: 8, fontSize: 11, color: '#d97706', fontWeight: 600 }}>
                                    Requires {meta.minRole} role
                                </div>
                            )}
                            {roleOk && !configOk && (
                                <div style={{ marginTop: 8, fontSize: 11, color: 'var(--faint)' }}>
                                    Disabled by admin
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            <div style={{
                marginTop: 24, padding: '14px 18px',
                background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 10,
                fontSize: 12, color: 'var(--muted)', lineHeight: 1.6,
            }}>
                <strong style={{ color: 'var(--ink)' }}>Tip:</strong> Tools are executed automatically when MJCC AI determines they're needed — you don't call them directly.
                Just ask naturally: <em>"What items need reordering?"</em> or <em>"Create an event for next Friday."</em>
            </div>
        </div>
    );
}

// ── AUTOMATION PRESETS VIEW ────────────────────────────────────────────────────

interface PresetResult {
    response: string;
    tool_calls: Array<{ name: string; result_summary: string }>;
    ts: Date;
}

function PresetCard({ preset, user }: { preset: Preset; user: User }) {
    const [running, setRunning] = useState(false);
    const [result,  setResult]  = useState<PresetResult | null>(null);
    const [error,   setError]   = useState<string | null>(null);
    const [open,    setOpen]    = useState(false);

    const lastRunKey = `mjcc_preset_last_${preset.id}`;
    const lastRun = localStorage.getItem(lastRunKey);

    const run = useCallback(async () => {
        setRunning(true);
        setError(null);
        setOpen(true);
        try {
            const res = await api.sendAgentMessage(preset.prompt);
            setResult({ response: res.response, tool_calls: res.tool_calls || [], ts: new Date() });
            localStorage.setItem(lastRunKey, new Date().toISOString());
        } catch (e: any) {
            setError(e?.message || 'Unknown error');
        } finally {
            setRunning(false);
        }
    }, [preset.prompt, lastRunKey]);

    const minLevel = ROLE_LEVEL[preset.minRole as keyof typeof ROLE_LEVEL || 'staff'] ?? 10;
    const canRun = ROLE_LEVEL[user.role] >= minLevel;

    return (
        <div style={{
            background: 'var(--surface)', border: '1px solid var(--line)',
            borderRadius: 12, overflow: 'hidden',
        }}>
            {/* Card header */}
            <div style={{ padding: '18px 20px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 8 }}>
                    <span style={{ fontSize: 28, lineHeight: 1, flexShrink: 0 }}>{preset.emoji}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--ink)', marginBottom: 3 }}>{preset.label}</div>
                        <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.45 }}>{preset.desc}</div>
                    </div>
                    <button
                        onClick={run}
                        disabled={running || !canRun}
                        style={{
                            flexShrink: 0,
                            padding: '7px 16px',
                            borderRadius: 8,
                            border: 'none',
                            background: running ? 'var(--line)' : canRun ? 'var(--navy)' : 'var(--line)',
                            color: running || !canRun ? 'var(--muted)' : '#fff',
                            fontWeight: 700, fontSize: 12.5,
                            cursor: running || !canRun ? 'default' : 'pointer',
                            display: 'flex', alignItems: 'center', gap: 5,
                        }}
                    >
                        {running ? (
                            <><span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⟳</span> Running…</>
                        ) : '▶ Run'}
                    </button>
                </div>

                {/* Tool tags */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {preset.tags.map(t => {
                        const meta = TOOL_META[t];
                        return (
                            <span key={t} style={{
                                fontSize: 10.5, padding: '2px 8px', borderRadius: 8,
                                background: 'var(--surface-2)', border: '1px solid var(--line)',
                                color: 'var(--muted)', fontWeight: 600,
                            }}>
                                {meta?.emoji} {meta?.label || t}
                            </span>
                        );
                    })}
                </div>

                {lastRun && !result && (
                    <div style={{ fontSize: 10.5, color: 'var(--faint)', marginTop: 6 }}>
                        Last run: {fmtDate(lastRun)} at {fmtTime(lastRun)}
                    </div>
                )}
            </div>

            {/* Result panel */}
            {(open && (running || result || error)) && (
                <div style={{
                    borderTop: '1px solid var(--line)',
                    background: 'var(--surface-2)',
                    padding: '16px 20px',
                }}>
                    {running && (
                        <div style={{ fontSize: 13, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span>✦</span> MJCC AI is thinking…
                        </div>
                    )}
                    {error && (
                        <div style={{ fontSize: 12.5, color: '#dc2626' }}>Error: {error}</div>
                    )}
                    {result && (
                        <>
                            {result.tool_calls.length > 0 && (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 12 }}>
                                    {result.tool_calls.map((tc, i) => {
                                        const meta = TOOL_META[tc.name];
                                        return (
                                            <span key={i} style={{
                                                fontSize: 10.5, padding: '2px 8px', borderRadius: 8,
                                                background: '#dcfce7', color: '#15803d',
                                                border: '1px solid #bbf7d0', fontWeight: 600,
                                            }}>
                                                {meta?.emoji} {meta?.label || tc.name}
                                            </span>
                                        );
                                    })}
                                </div>
                            )}
                            <div style={{
                                fontSize: 13, color: 'var(--ink)', lineHeight: 1.65,
                                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                            }}>
                                {result.response}
                            </div>
                            <div style={{ fontSize: 10.5, color: 'var(--faint)', marginTop: 10 }}>
                                {fmtDate(result.ts.toISOString())} at {fmtTime(result.ts.toISOString())}
                                {' · '}
                                <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--faint)', cursor: 'pointer', fontSize: 10.5, padding: 0 }}>
                                    dismiss
                                </button>
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}

// ── custom automation builder ─────────────────────────────────────────────────

interface Automation {
    id: string;
    name: string;
    goal: string;      // natural language description of what to do
    schedule: string;  // human-readable e.g. "Every Monday at 8am"
    cron: string;      // cron expression for Render
    enabled: boolean;
    last_run?: string;
    last_result?: string;
}

const SCHEDULE_OPTIONS = [
    { label: 'Every weekday morning (8am)', cron: '0 8 * * 1-5' },
    { label: 'Every Monday (weekly digest)', cron: '0 8 * * 1' },
    { label: 'First of the month', cron: '0 6 1 * *' },
    { label: 'Daily at 6am', cron: '0 6 * * *' },
    { label: 'Every Friday (end of week)', cron: '0 16 * * 5' },
];

function AutomationCard({ auto, onRun, onDelete, onToggle }: {
    auto: Automation;
    onRun: (a: Automation) => void;
    onDelete: (id: string) => void;
    onToggle: (id: string) => void;
}) {
    const [running, setRunning] = useState(false);
    const [result, setResult]   = useState<string | null>(auto.last_result || null);
    const [expanded, setExpanded] = useState(false);

    const run = async () => {
        setRunning(true);
        setResult(null);
        try {
            const res = await api.runAutomation(auto.goal);
            setResult(res.response);
            onRun({ ...auto, last_run: new Date().toISOString(), last_result: res.response });
        } catch (e: any) {
            setResult(`Error: ${e?.message || 'Unknown error'}`);
        } finally { setRunning(false); }
    };

    return (
        <div style={{
            background: 'var(--surface)', border: `1.5px solid ${auto.enabled ? 'var(--accent)' : 'var(--line)'}`,
            borderRadius: 12, overflow: 'hidden',
            opacity: auto.enabled ? 1 : 0.65,
        }}>
            <div style={{ padding: '16px 18px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                            <span style={{ fontWeight: 800, fontSize: 13.5, color: 'var(--ink)' }}>{auto.name}</span>
                            <span style={{ fontSize: 10.5, color: 'var(--faint)', background: 'var(--surface-2)', padding: '2px 7px', borderRadius: 6 }}>
                                {auto.schedule}
                            </span>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.45 }}>{auto.goal}</div>
                        {auto.last_run && (
                            <div style={{ fontSize: 10.5, color: 'var(--faint)', marginTop: 5 }}>
                                Last run: {new Date(auto.last_run).toLocaleString()}
                            </div>
                        )}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
                        {/* enabled toggle */}
                        <div onClick={() => onToggle(auto.id)} style={{
                            width: 34, height: 18, borderRadius: 9, cursor: 'pointer',
                            background: auto.enabled ? 'var(--accent)' : 'var(--line)',
                            position: 'relative', transition: 'background .15s',
                        }}>
                            <div style={{
                                position: 'absolute', top: 3, left: auto.enabled ? 17 : 3,
                                width: 12, height: 12, borderRadius: '50%', background: '#fff',
                                transition: 'left .15s',
                            }} />
                        </div>
                        <button onClick={run} disabled={running} style={{
                            padding: '5px 13px', borderRadius: 7, border: 'none',
                            background: running ? 'var(--line)' : 'var(--navy)', color: running ? 'var(--muted)' : '#fff',
                            fontWeight: 700, fontSize: 12, cursor: running ? 'default' : 'pointer',
                        }}>
                            {running ? '…' : '▶ Run'}
                        </button>
                        <button onClick={() => setExpanded(x => !x)} style={{
                            padding: '5px 8px', borderRadius: 7, border: '1px solid var(--line)',
                            background: 'var(--surface-2)', cursor: 'pointer', fontSize: 11,
                        }}>
                            {expanded ? '▲' : '▼'}
                        </button>
                        <button onClick={() => onDelete(auto.id)} style={{
                            padding: '5px 8px', borderRadius: 7, border: '1px solid var(--line)',
                            background: 'var(--surface-2)', cursor: 'pointer', fontSize: 11,
                            color: 'var(--red)',
                        }}>✕</button>
                    </div>
                </div>
                {expanded && result && (
                    <div style={{
                        marginTop: 12, padding: '10px 14px', borderRadius: 8,
                        background: 'var(--surface-2)', border: '1px solid var(--line)',
                        fontSize: 12, color: 'var(--ink)', lineHeight: 1.6, whiteSpace: 'pre-wrap',
                    }}>
                        {result}
                    </div>
                )}
            </div>
        </div>
    );
}

const BLANK_AUTO: Omit<Automation, 'id'> = {
    name: '', goal: '', schedule: SCHEDULE_OPTIONS[0].label, cron: SCHEDULE_OPTIONS[0].cron,
    enabled: true,
};

export function AIPresetsView({ user }: { user: User }) {
    const [customs, setCustoms]   = useState<Automation[]>([]);
    const [loading, setLoading]   = useState(true);
    const [saving,  setSaving]    = useState(false);
    const [form,    setForm]      = useState<typeof BLANK_AUTO>({ ...BLANK_AUTO });
    const [adding,  setAdding]    = useState(false);

    useEffect(() => {
        api.getAutomations().then(a => setCustoms(a as Automation[])).catch(() => {}).finally(() => setLoading(false));
    }, []);

    const persist = async (next: Automation[]) => {
        setSaving(true);
        try { await api.saveAutomations(next); } catch { /* non-fatal */ }
        finally { setSaving(false); }
    };

    const addAuto = () => {
        if (!form.name.trim() || !form.goal.trim()) return;
        const next: Automation = {
            ...form, id: `auto_${Date.now()}`, enabled: true,
        };
        const updated = [...customs, next];
        setCustoms(updated);
        persist(updated);
        setForm({ ...BLANK_AUTO });
        setAdding(false);
    };

    const handleRun = (updated: Automation) => {
        const next = customs.map(a => a.id === updated.id ? updated : a);
        setCustoms(next);
        persist(next);
    };

    const handleDelete = (id: string) => {
        const next = customs.filter(a => a.id !== id);
        setCustoms(next);
        persist(next);
    };

    const handleToggle = (id: string) => {
        const next = customs.map(a => a.id === id ? { ...a, enabled: !a.enabled } : a);
        setCustoms(next);
        persist(next);
    };

    const LBL: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--muted)', marginBottom: 5 };

    return (
        <div style={{ padding: '28px 32px', maxWidth: 900 }}>

            {/* Header */}
            <div style={{ marginBottom: 24 }}>
                <h2 style={{ fontSize: 20, fontWeight: 800, color: 'var(--ink)', margin: '0 0 6px' }}>
                    ✦ AI Automations
                </h2>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>
                    Build custom AI workflows in plain English. MJCC AI handles the rest — pulling live data, reasoning through it, and delivering actionable results.
                </p>
            </div>

            {/* Quick-run presets */}
            <div style={{ marginBottom: 28 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 12 }}>
                    Quick Automations
                </div>
                <div className="ai-preset-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
                    {PRESETS.map(p => <PresetCard key={p.id} preset={p} user={user} />)}
                </div>
            </div>

            {/* Custom automations */}
            <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.07em' }}>
                        My Automations {saving && <span style={{ fontWeight: 400, color: 'var(--faint)' }}>· saving…</span>}
                    </div>
                    <button className="btn primary" style={{ fontSize: 12, padding: '5px 14px' }} onClick={() => setAdding(a => !a)}>
                        {adding ? '✕ Cancel' : '+ New Automation'}
                    </button>
                </div>

                {/* Builder form */}
                {adding && (
                    <div style={{
                        padding: '18px 20px', marginBottom: 14, borderRadius: 12,
                        background: 'var(--accent-soft)', border: '1.5px solid var(--accent)',
                    }}>
                        <div style={{ fontWeight: 800, fontSize: 13.5, color: 'var(--navy)', marginBottom: 14 }}>
                            ✦ Describe your automation
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                            <div>
                                <label style={LBL}>Name</label>
                                <input className="sheet-inp txt" style={{ width: '100%' }}
                                    placeholder="e.g. Weekly Inventory Digest"
                                    value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
                            </div>
                            <div>
                                <label style={LBL}>Schedule</label>
                                <select className="tb-select" style={{ width: '100%' }}
                                    value={form.schedule}
                                    onChange={e => {
                                        const opt = SCHEDULE_OPTIONS.find(o => o.label === e.target.value);
                                        setForm(f => ({ ...f, schedule: e.target.value, cron: opt?.cron || '0 8 * * 1' }));
                                    }}>
                                    {SCHEDULE_OPTIONS.map(o => <option key={o.cron} value={o.label}>{o.label}</option>)}
                                </select>
                            </div>
                        </div>
                        <div style={{ marginBottom: 14 }}>
                            <label style={LBL}>What should AI do? <span style={{ fontWeight: 400, color: 'var(--faint)' }}>(plain English)</span></label>
                            <textarea className="sheet-inp txt" rows={3} style={{ width: '100%', resize: 'vertical', fontSize: 12.5 }}
                                placeholder={'e.g. "Check inventory for items below par level, then summarize what needs to be reordered this week with estimated quantities"\n\nor: "Get the dashboard stats and send me a morning briefing with any alerts"'}
                                value={form.goal}
                                onChange={e => setForm(f => ({ ...f, goal: e.target.value }))} />
                        </div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <button className="btn primary" onClick={addAuto} disabled={!form.name.trim() || !form.goal.trim()}>
                                Save Automation
                            </button>
                            <span style={{ fontSize: 11, color: 'var(--faint)' }}>
                                Cron: <code style={{ fontFamily: 'var(--mono)' }}>{form.cron}</code>
                            </span>
                        </div>
                    </div>
                )}

                {loading ? (
                    <div style={{ color: 'var(--muted)', fontSize: 12, padding: '20px 0' }}>Loading automations…</div>
                ) : customs.length === 0 ? (
                    <div style={{
                        padding: '28px', textAlign: 'center', borderRadius: 12,
                        background: 'var(--surface-2)', border: '1px dashed var(--line)',
                    }}>
                        <div style={{ fontSize: 28, marginBottom: 10 }}>🤖</div>
                        <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)', marginBottom: 6 }}>No automations yet</div>
                        <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
                            Build your first automation above — describe what you want in plain English and MJCC AI will execute it on schedule.
                        </div>
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {customs.map(a => (
                            <AutomationCard key={a.id} auto={a}
                                onRun={handleRun} onDelete={handleDelete} onToggle={handleToggle} />
                        ))}
                    </div>
                )}
            </div>

            {/* Cron scheduling note */}
            <div style={{
                marginTop: 24, padding: '14px 18px',
                background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10,
                fontSize: 12, color: 'var(--muted)', lineHeight: 1.6,
            }}>
                <strong style={{ color: 'var(--ink)' }}>Scheduled execution:</strong> For fully automated runs, connect a Render Cron Service to <code style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>POST /api/agent/chat</code> with the automation prompt. Hit <strong>▶ Run</strong> above for on-demand execution now.
            </div>
        </div>
    );
}
