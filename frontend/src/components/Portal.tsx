import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { I, KpnMark } from "../lib/icons";
import {
    type User,
    type Role,
    ROLE_LEVEL,
    ROLE_LABEL,
    MONTHS,
    NAV,
    DOW_FULL,
} from "../lib/constants";
import { useEscapeClose } from "../lib/useEscapeClose";
import * as draftsLib from "../lib/drafts";

// Compact-table cell handlers — module-level so they're not recreated per render
const cinpFocus = (e: React.FocusEvent<HTMLInputElement>) => e.currentTarget.select();
const cinpKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        const all = Array.from(document.querySelectorAll<HTMLInputElement>('.cinp:not([disabled])'));
        const idx = all.indexOf(e.currentTarget);
        if (idx >= 0 && idx < all.length - 1) all[idx + 1].focus();
    }
};

const VIEW_LABELS: Record<string, string> = Object.fromEntries(
    NAV.flatMap((g) => g.items.map((i) => [i.key, i.label])),
);
import {
    realLogout,
    loadLog,
    fetchInventory,
    invToList,
    reorders,
    fmtMoney,
    fmtMoneyFull,
    catColor,
    getBackendToken,
} from "../lib/supabase";
import { api, type NotificationItem, type PublicMenuToday, type PublicMenuCycleSlot, type PublicMealPeriod } from "../lib/api";
import { ComplianceHub } from "./ComplianceHub";
import { DataEntry } from "./DataEntry";
import { DailyOps } from "./DailyOps";
import { EventsCalendar } from "./EventsCalendar";
import { MealLog, InspectionSheet, FoodRequest } from "./Forms";
import { CycleMenu, PERIOD_ORDER, mealSummary, shortSideLabel } from "./CycleMenu";
import { SnackBar, MonthlyInventory } from "./Operations";
import { SourceControlPanel, SourceControlPage } from "./SourceControl";
import { SaveBar } from "./ui/ActionBars";
import { StatusPill } from "./ui/StatusPill";
import { ItemInspector } from "./ui/ItemInspector";
import { Reports } from "./Reports";
import { PullSheet } from "./PullSheet";
import { Settings } from "./Settings";
import { AgentBubble } from "./AgentBubble";
import { AIUsageView, AIToolsView, AIPresetsView } from "./AIStudio";
import { FlowPanel } from "./FlowPanel";
import { CostManager } from "./CostManager";
import { FileVault } from "./FileVault";
import { getThemePref, applyThemePref } from "../lib/theme";

let toastTimer: ReturnType<typeof setTimeout>;
function toast(msg: string) {
    let t = document.getElementById("toast");
    if (!t) {
        t = document.createElement("div");
        t.id = "toast";
        document.body.appendChild(t);
    }
    t.innerHTML = "";
    const span = document.createElement("span");
    span.textContent = msg;
    t.appendChild(span);
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}
(window as any).toast = toast;

const initials = (u: Partial<User>) =>
    ((u.display_name?.[0] || "") + (u.last_name?.[0] || "")).toUpperCase() ||
    (u.username || "?").slice(0, 2).toUpperCase();

function Avatar({ user, className = "" }: { user: Partial<User>; className?: string }) {
    return (
        <div className={["avatar", className].filter(Boolean).join(" ")}>
            {user.avatar_url ? (
                <img src={user.avatar_url} alt="" onError={(e) => { (e.currentTarget.style.display = "none"); }} />
            ) : (
                initials(user)
            )}
        </div>
    );
}

const AUTO_REFRESH_MS = 60_000; // re-fetch from DB every 60 s

function num(v: any): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

function invoiceTotalFromMeta(metadata: any): number | null {
    const totals = metadata?.weekly_invoice_totals;
    if (!totals) return null;
    const explicit = Number(totals.total);
    if (Number.isFinite(explicit) && explicit > 0) return explicit;
    const weeks = totals.weeks && typeof totals.weeks === "object" ? totals.weeks : {};
    const value = Object.values(weeks).reduce((sum: number, wk: any) => sum + num(wk), 0);
    return value > 0 ? value : null;
}

function moneyTotalsFromMeta(metadata: any) {
    const invoiceReceived = invoiceTotalFromMeta(metadata);
    return {
        open: num(metadata?.opening_value),
        recv: invoiceReceived ?? num(metadata?.received_value),
        iss: num(metadata?.pulled_value),
        close: num(metadata?.closing_value),
    };
}

function categoryRowsFromMeta(metadata: any) {
    const raw = metadata?.category_totals;
    if (!raw || typeof raw !== "object") return [];
    return Object.entries(raw)
        .map(([name, value]) => ({
            name,
            color: catColor(name),
            val: num(value),
            count: 0,
        }))
        .sort((a, b) => b.val - a.val);
}

function useInventory(period: [number, number]): [any, () => Promise<void>] {
    const [state, setState] = useState({
        loading: false,
        inv: null as any,
        metadata: null as any,
        syncedBy: null as string | null,
        syncedAt: null as string | null,
        error: null as string | null,
    });
    const [m, y] = period;
    const load = useCallback(async () => {
        setState((s) => ({ ...s, loading: true, error: null }));
        const res = await fetchInventory(m + 1, y); // 1-indexed API
        if (res.ok)
            setState({
                loading: false,
                inv: res.inv,
                metadata: (res as any).metadata ?? null,
                syncedBy: (res as any).syncedBy ?? null,
                syncedAt: new Date().toISOString(), // timestamp of this fetch, not row created_at
                error: res.inv && Object.keys(res.inv as object).length > 0 ? null : "empty",
            });
        else
            setState({
                loading: false,
                inv: null,
                metadata: null,
                syncedBy: null,
                syncedAt: null,
                error: (res as any).error ?? 'Load failed',
            });
    }, [m, y]);
    // Load on mount/period change + auto-refresh + reload on tab-focus
    useEffect(() => {
        load();
        const timer = setInterval(load, AUTO_REFRESH_MS);
        const onVisible = () => { if (document.visibilityState === 'visible') load(); };
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            clearInterval(timer);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, [load]);
    return [state, load];
}

function DropSelect({ value, onChange, options, label }: {
    value: number;
    onChange: (v: number) => void;
    options: { value: number; label: string }[];
    label?: string;
}) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
        document.addEventListener('mousedown', h);
        return () => document.removeEventListener('mousedown', h);
    }, [open]);

    useEffect(() => {
        if (!open) return;
        const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        window.addEventListener('keydown', h);
        return () => window.removeEventListener('keydown', h);
    }, [open]);

    const selected = options.find(o => o.value === value);
    return (
        <div className="tb-drop" ref={ref}>
            <button className="tb-drop-btn" onClick={() => setOpen(v => !v)} aria-label={label} aria-expanded={open} aria-haspopup="listbox">
                {selected?.label}
                {I.down({ style: { width: 11, height: 11, marginLeft: 2, opacity: 0.7 } })}
            </button>
            {open && (
                <div className="tb-drop-list" role="listbox" aria-label={label}>
                    {options.map(o => (
                        <button
                            key={o.value}
                            role="option"
                            aria-selected={o.value === value}
                            className={"tb-drop-opt" + (o.value === value ? " active" : "")}
                            onClick={() => { onChange(o.value); setOpen(false); }}
                        >
                            {o.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

function Topbar({
    user,
    period,
    setPeriod,
    sidebarOpen,
    toggleSidebar,
    scOpen,
    onToggleSC,
    scCount,
    active,
    periodPublished,
    apiStatus = 'live',
    lastFetch,
    onRefresh,
    onNav,
}: {
    user: User;
    period: [number, number];
    setPeriod: (p: [number, number]) => void;
    sidebarOpen?: boolean;
    toggleSidebar?: () => void;
    scOpen?: boolean;
    onToggleSC?: () => void;
    scCount?: number;
    active?: string;
    periodPublished?: boolean | null;
    apiStatus?: 'live' | 'syncing' | 'error';
    lastFetch?: string | null;
    onRefresh?: () => void;
    onNav?: (k: string) => void;
}) {
    const [menu, setMenu] = useState(false);
    const [notificationsOpen, setNotificationsOpen] = useState(false);
    const [notificationData, setNotificationData] = useState<{
        items: NotificationItem[];
        unreadKeys: string[];
        categories: string[];
        feedErrors: string[];
        version: string;
    }>({ items: [], unreadKeys: [], categories: [], feedErrors: [], version: '' });
    const [notificationsLoading, setNotificationsLoading] = useState(false);
    const [reassigningSku, setReassigningSku] = useState<string | null>(null);
    const [stagedReassignments, setStagedReassignments] = useState<Record<string, string>>({});
    const loadNotifications = useCallback(async (markRead = false) => {
        setNotificationsLoading(true);
        try {
            const [notificationResult, categoryResult] = await Promise.allSettled([
                api.getNotifications(),
                api.getInventoryCategories(),
            ]);
            if (notificationResult.status !== 'fulfilled') throw notificationResult.reason;
            const response = notificationResult.value;
            setNotificationData({
                items: response.items || [],
                unreadKeys: response.unread_keys || [],
                feedErrors: response.feed_errors || [],
                version: response.version || '',
                categories: categoryResult.status === 'fulfilled'
                    ? (categoryResult.value || []).map((category: any) => category.name).filter(Boolean)
                    : [],
            });
            if (markRead && response.unread_keys?.length) {
                await api.markNotificationsRead(response.unread_keys);
                setNotificationData((previous) => ({ ...previous, unreadKeys: [] }));
            }
        } catch {
            // The main panel remains usable; the tray keeps its last good state.
        } finally {
            setNotificationsLoading(false);
        }
    }, []);
    const reassignNewItem = useCallback(async (item: any, category: string) => {
        const sku = String(item.sku || '');
        if (!sku || !category || category === 'New Items') return;
        setReassigningSku(sku);
        try {
            await api.stageChange(
                'item_update',
                'inventory',
                sku,
                { sku, desc: item.description || sku, category },
                `Reassign New Item · ${item.description || sku} → ${category}`,
            );
            setStagedReassignments((previous) => ({ ...previous, [sku]: category }));
            window.dispatchEvent(new CustomEvent('mjcc:staging-changed'));
            (window as any).toast?.(`Staged ${item.description || sku} → ${category}`);
        } catch (error: any) {
            (window as any).toast?.(`Reassignment failed: ${error?.message || 'Unknown error'}`);
        } finally {
            setReassigningSku(null);
        }
    }, []);
    useEffect(() => {
        void loadNotifications(notificationsOpen);
    }, [notificationsOpen, loadNotifications]);
    useEffect(() => {
        const close = () => setMenu(false);
        if (menu) {
            window.addEventListener("click", close);
            return () => window.removeEventListener("click", close);
        }
    }, [menu]);
    useEffect(() => {
        const close = () => setNotificationsOpen(false);
        if (notificationsOpen) {
            window.addEventListener("click", close);
            return () => window.removeEventListener("click", close);
        }
    }, [notificationsOpen]);
    const [flowPanel, setFlowPanel] = useState(false);
    useEffect(() => {
        const close = () => setFlowPanel(false);
        if (flowPanel) {
            window.addEventListener("click", close);
            return () => window.removeEventListener("click", close);
        }
    }, [flowPanel]);
    const [m, y] = period;

    return (
        <header className="topbar">
            <div className="tb-left">
                {toggleSidebar && (
                    <button
                        className="hamburger"
                        onClick={toggleSidebar}
                        aria-label="Toggle navigation"
                        aria-expanded={sidebarOpen}
                    >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                            <line x1="4" y1="6" x2="20" y2="6" />
                            <line x1="4" y1="12" x2="20" y2="12" />
                            <line x1="4" y1="18" x2="20" y2="18" />
                        </svg>
                    </button>
                )}
                <span style={{ display: "flex" }}>
                    <KpnMark size={26} />
                </span>
                <div>
                    <div className="tb-title">KpnCompute · MJCC</div>
                    <div className="tb-sub">
                        {active && VIEW_LABELS[active] ? VIEW_LABELS[active] : 'Portal'}
                    </div>
                </div>
            </div>
            <div className="tb-right">
                <span
                    className={`inv-badge${apiStatus === 'error' ? ' err' : apiStatus === 'syncing' ? ' syncing' : ''}`}
                    title={lastFetch ? `Last fetched: ${new Date(lastFetch).toLocaleTimeString()}` : 'Connecting…'}
                    onClick={() => onRefresh?.()}
                >
                    <span className="rt"></span>
                    {apiStatus === 'error' ? 'API Error' : apiStatus === 'syncing' ? 'Syncing…' : 'LIVE'}
                </span>
                <DropSelect
                    label="Period month"
                    value={m}
                    onChange={(v) => setPeriod([v, y])}
                    options={MONTHS.map((nm, i) => ({ value: i, label: nm }))}
                />
                <DropSelect
                    label="Period year"
                    value={y}
                    onChange={(v) => setPeriod([m, v])}
                    options={[2024, 2025, 2026].map(yr => ({ value: yr, label: String(yr) }))}
                />
                {periodPublished !== null && periodPublished !== undefined && (
                    <span className={`period-status-pill${periodPublished ? ' published' : ' open'}`}>
                        <span className="psp-dot" />
                        {periodPublished ? 'Published' : 'Open'}
                    </span>
                )}
                {onToggleSC && (
                    <button
                        className={"tb-sc-btn" + (scOpen ? " active" : "")}
                        onClick={onToggleSC}
                        title="Source Control"
                        aria-label="Toggle Source Control panel"
                    >
                        {I.branch({ style: { width: 16, height: 16 } })}
                        {(scCount ?? 0) > 0 && (
                            <span className="nb">{scCount}</span>
                        )}
                    </button>
                )}
                <div className="tb-notify-wrap">
                    <button
                        className={"tb-notify-btn" + (notificationsOpen ? " active" : "")}
                        onClick={(e) => { e.stopPropagation(); setNotificationsOpen((v) => !v); }}
                        title="Notifications"
                        aria-label="Open notifications"
                        aria-expanded={notificationsOpen}
                    >
                        {I.bell({ style: { width: 16, height: 16 } })}
                        {notificationData.unreadKeys.length > 0 && (
                            <span className="tb-notify-count">
                                {Math.min(99, notificationData.unreadKeys.length)}
                            </span>
                        )}
                    </button>
                    {notificationsOpen && (
                        <div className="tb-notify-panel" onClick={(e) => e.stopPropagation()}>
                            <div className="tb-notify-head">
                                <span><b>Updates</b>{notificationData.version && <small className="tb-notify-version">{notificationData.version}</small>}</span>
                                <button className="tb-notify-refresh" onClick={() => loadNotifications(false)} disabled={notificationsLoading}>
                                    {notificationsLoading ? 'Refreshing…' : 'Refresh'}
                                </button>
                            </div>
                            {notificationData.feedErrors.length > 0 && <div className="tb-notify-warning">Some feeds are temporarily unavailable. Refresh to retry.</div>}
                            <div className="tb-notify-section">
                                <div className="tb-notify-label">Reorders <span>{notificationData.items.filter((item) => item.kind === 'reorder').length}</span></div>
                                {notificationData.items.filter((item) => item.kind === 'reorder').length === 0 ? <div className="tb-notify-empty">No reorder alerts.</div> : notificationData.items.filter((item) => item.kind === 'reorder').slice(0, 4).map((item) => (
                                    <button key={item.key} className="tb-notify-item" onClick={() => { onNav?.('inventory'); setNotificationsOpen(false); }}>
                                        <span className="tb-notify-dot warn" />
                                        <span><b>{item.title}</b><small>{item.body}</small></span>
                                    </button>
                                ))}
                            </div>
                            <div className="tb-notify-section">
                                <div className="tb-notify-label">New Items <span>{notificationData.items.filter((item) => item.kind === 'new_item').length}</span></div>
                                {notificationData.items.filter((item) => item.kind === 'new_item').length === 0 ? <div className="tb-notify-empty">No items awaiting review.</div> : notificationData.items.filter((item) => item.kind === 'new_item').slice(0, 8).map((notification) => {
                                    const item = notification.item || {};
                                    return <div key={notification.key} className="tb-notify-item tb-notify-item-editable">
                                        <span className="tb-notify-dot info" />
                                        <span className="tb-notify-item-copy" onClick={() => { onNav?.('inventory'); setNotificationsOpen(false); }}><b>{notification.title}</b><small>{notification.body}</small></span>
                                        {ROLE_LEVEL[user.role] >= 30 && (
                                            <select
                                                className="tb-notify-category"
                                                value={stagedReassignments[item.sku] || 'New Items'}
                                                disabled={reassigningSku === item.sku || Boolean(stagedReassignments[item.sku])}
                                                aria-label={`Reassign ${notification.title}`}
                                                onChange={(event) => reassignNewItem(item, event.target.value)}
                                                onClick={(event) => event.stopPropagation()}
                                            >
                                                <option value="New Items">Reassign…</option>
                                                {notificationData.categories.filter((category) => category !== 'New Items').map((category) => (
                                                    <option key={category} value={category}>{category}</option>
                                                ))}
                                            </select>
                                        )}
                                    </div>;
                                })}
                            </div>
                            <div className="tb-notify-section">
                                <div className="tb-notify-label">Recent pushes <span>{notificationData.items.filter((item) => item.kind === 'push').length}</span></div>
                                {notificationData.items.filter((item) => item.kind === 'push').length === 0 ? <div className="tb-notify-empty">No recent pushes.</div> : notificationData.items.filter((item) => item.kind === 'push').slice(0, 4).map((item) => (
                                    <button key={item.key} className="tb-notify-item" onClick={() => { onNav?.('sourcectrl'); setNotificationsOpen(false); }}>
                                        <span className="tb-notify-dot ok" />
                                        <span><b>{item.title}</b><small>{item.body}</small></span>
                                    </button>
                                ))}
                            </div>
                            <div className="tb-notify-section">
                                <div className="tb-notify-label">Temps <span>{notificationData.items.filter((item) => item.kind === 'temp_alert').length}</span></div>
                                {notificationData.items.filter((item) => item.kind === 'temp_alert').length === 0 ? <div className="tb-notify-empty">No temperature alerts.</div> : notificationData.items.filter((item) => item.kind === 'temp_alert').slice(0, 8).map((item) => (
                                    <button key={item.key} className="tb-notify-item" onClick={() => { onNav?.('haccp'); setNotificationsOpen(false); }}>
                                        <span className="tb-notify-dot warn" />
                                        <span><b>{item.title}</b><small>{item.body}</small></span>
                                    </button>
                                ))}
                            </div>
                            {notificationData.items.filter((item) => item.kind === 'app_update').map((item) => (
                                <div key={item.key} className="tb-notify-section tb-notify-release">
                                    <div className="tb-notify-label">Site update</div>
                                    <div className="tb-notify-release-copy"><b>{item.title}</b><small>{item.body}</small></div>
                                    {(item.item?.key_updates || []).slice(1).map((update: string) => <small key={update}>• {update}</small>)}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
                {onNav && (
                    <div style={{ position: 'relative' }}>
                        <button
                            className={"tb-flow-btn" + (flowPanel ? " active" : "")}
                            onClick={(e) => { e.stopPropagation(); setFlowPanel((v) => !v); }}
                            title="Flow"
                            aria-label="Open Flow panel"
                        >
                            {I.checkSquare({ style: { width: 16, height: 16 } })}
                        </button>
                        {flowPanel && (
                            <FlowPanel user={user} onNav={onNav} onClose={() => setFlowPanel(false)} />
                        )}
                    </div>
                )}
                <div
                    className="tb-user"
                    onClick={(e) => {
                        e.stopPropagation();
                        setMenu((v) => !v);
                    }}
                >
                    <Avatar user={user} />
                    <div className="hide-sm">
                        <div className="nm">
                            {user.display_name} {user.last_name}
                        </div>
                        <div className="rl">{ROLE_LABEL[user.role]}</div>
                    </div>
                    {menu && (
                        <div
                            className="usermenu"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="um-head">
                                <div className="nm">
                                    {user.display_name} {user.last_name}
                                </div>
                                <div className="em">
                                    {user.username}@mjc-cafeteria.com
                                </div>
                            </div>
                            <button className="um-item" onClick={() => { onNav?.('settings'); setMenu(false); }}>
                                {I.user()} My profile
                            </button>
                            <button
                                className="um-item danger"
                                onClick={() => {
                                    realLogout();
                                    (window as any).__logout?.();
                                }}
                            >
                                {I.logout()} Sign out
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </header>
    );
}

function Sidebar({
    user,
    active,
    setActive,
    reorderCount,
    stagedCount,
    skuReviewCount,
    allowedScopes,
}: {
    user: User;
    active: string;
    setActive: (k: string) => void;
    reorderCount: number;
    stagedCount: number;
    skuReviewCount: number;
    allowedScopes?: string[] | null;
}) {
    const lvl = ROLE_LEVEL[user.role];
    return (
        <nav className="sidebar">
            <div className="explorer-title">Explorer</div>
            {NAV.map((group) => {
                // Page visibility is governed by the Role Scopes grid (Users & Access), not the
                // fixed role level — sudo can grant any page to any role there.
                const items = group.items.filter((it) => !allowedScopes || allowedScopes.includes(it.key));
                if (!items.length) return null;
                return (
                    <div key={group.group}>
                        <div className="nav-group-lbl">{group.group}</div>
                        {items.map((it) => (
                            <button
                                key={it.key}
                                className="nav-item"
                                data-active={active === it.key}
                                onClick={() => setActive(it.key)}
                            >
                                {I[it.icon]()}
                                <span>
                                    {it.label === "Source Control" && lvl < 20
                                        ? "My Submissions"
                                        : it.label}
                                </span>
                                {it.key === "inventory" && reorderCount > 0 && (
                                    <span className="nb">{reorderCount}</span>
                                )}
                                {it.key === "sourcectrl" && (stagedCount > 0 || skuReviewCount > 0) && (
                                    <span className="nb">{stagedCount + skuReviewCount}</span>
                                )}
                                {it.key === "sourcectrl" && skuReviewCount > 0 && lvl >= 30 && (
                                    <span className="nb warn" title={`${skuReviewCount} SKU${skuReviewCount !== 1 ? 's' : ''} need review`}>
                                        {I.alert({ style: { width: 11, height: 11 } })}
                                    </span>
                                )}
                            </button>
                        ))}
                    </div>
                );
            })}
            <div className="sidebar-foot">
                Signed in as <b>{ROLE_LABEL[user.role]}</b>
                <br />
                <span style={{ fontFamily: "BlinkMacSystemFont" }}>
                    KpnCompute · v3.0
                </span>
            </div>
        </nav>
    );
}

function ActivityBar({
    user,
    active,
    explorerOpen,
    onToggleExplorer,
    onToggleSC,
    scOpen,
    scCount,
    goTo,
    allowedScopes,
}: {
    user: User;
    active: string;
    explorerOpen: boolean;
    onToggleExplorer: () => void;
    onToggleSC: () => void;
    scOpen: boolean;
    scCount: number;
    goTo: (k: string) => void;
    allowedScopes?: string[] | null;
}) {
    const lvl = ROLE_LEVEL[user.role];
    const [toolsOpen, setToolsOpen] = useState(false);
    useEffect(() => {
        if (!toolsOpen) return;
        const close = () => setToolsOpen(false);
        window.addEventListener("click", close);
        return () => window.removeEventListener("click", close);
    }, [toolsOpen]);

    const inGroup = (keys: string[]) => keys.some((k) => active === k);
    const hasScope = (key: string) => !allowedScopes || allowedScopes.includes(key);
    const aiKeys = ["ai-usage", "ai-tools", "ai-presets"];
    const firstAllowedAiKey = aiKeys.find(hasScope) ?? "ai-usage";

    return (
        <div className="activity-bar">
            <div className="ab-top">
                <button
                    className={"ab-btn" + (explorerOpen ? " active" : "")}
                    onClick={onToggleExplorer}
                    title="Explorer"
                >
                    {I.grid({})}
                </button>
                {hasScope("inventory") && (
                    <button
                        className={"ab-btn" + (inGroup(["inventory", "moninv", "pullsheet"]) ? " active" : "")}
                        onClick={() => goTo("inventory")}
                        title="Inventory"
                    >
                        {I.box({})}
                    </button>
                )}
                {hasScope("sourcectrl") && (
                    <button
                        className={"ab-btn" + (active === "sourcectrl" || scOpen ? " active" : "")}
                        onClick={() => active === "sourcectrl" ? onToggleSC() : goTo("sourcectrl")}
                        title="Source Control"
                    >
                        {I.branch({})}
                        {scCount > 0 && <span className="ab-badge">{scCount > 9 ? "9+" : scCount}</span>}
                    </button>
                )}
                {hasScope("dataentry") && (
                    <button
                        className={"ab-btn" + (active === "dataentry" ? " active" : "")}
                        onClick={() => goTo("dataentry")}
                        title="Data Entry"
                    >
                        {I.inbox({})}
                    </button>
                )}
                {(hasScope("events") || hasScope("menu")) && (
                    <button
                        className={"ab-btn" + (inGroup(["events", "menu"]) ? " active" : "")}
                        onClick={() => goTo("events")}
                        title="Events & Menu"
                    >
                        {I.calCheck({})}
                    </button>
                )}
                {aiKeys.some(hasScope) && (
                    <button
                        className={"ab-btn" + (active.startsWith("ai-") ? " active" : "")}
                        onClick={() => goTo(firstAllowedAiKey)}
                        title="AI Studio"
                    >
                        {I.flame({})}
                    </button>
                )}
                {lvl >= 30 && hasScope("reports") && (
                    <button
                        className={"ab-btn" + (active === "reports" ? " active" : "")}
                        onClick={() => goTo("reports")}
                        title="Reports"
                    >
                        {I.download({})}
                    </button>
                )}
            </div>
            <div className="ab-bottom">
                {lvl >= 40 && (hasScope("settings") || hasScope("users")) && (
                    <button
                        className={"ab-btn" + (inGroup(["settings", "users"]) ? " active" : "")}
                        onClick={() => goTo(hasScope("settings") ? "settings" : "users")}
                        title="Settings"
                    >
                        {I.settings({})}
                    </button>
                )}
                {lvl >= 40 && (
                    <a
                        className="ab-btn"
                        href={`${import.meta.env.VITE_API_BASE}/portal/logs?token=${encodeURIComponent(getBackendToken() ?? '')}`}
                        target="_blank"
                        rel="noreferrer"
                        title="Live server logs"
                    >
                        {I.terminal({})}
                    </a>
                )}
                <div
                    className={"ab-btn ab-tools-btn" + (toolsOpen ? " active" : "")}
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); setToolsOpen((v) => !v); }}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setToolsOpen((v) => !v); } }}
                    title="External Tools"
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ width: 20, height: 20 }}>
                        <line x1="4" y1="6" x2="20" y2="6" />
                        <line x1="4" y1="12" x2="20" y2="12" />
                        <line x1="4" y1="18" x2="20" y2="18" />
                    </svg>
                    {toolsOpen && (
                        <div
                            className="usermenu ab-usermenu"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="um-head">
                                <div className="nm">External Tools</div>
                            </div>
                            {hasScope("lioncafe") && (
                                <button className="um-item" onClick={() => { goTo("lioncafe"); setToolsOpen(false); }}>
                                    LunchVoice — Menu Review
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

function StatusBar({
    user,
    period,
    stagedCount,
    onOpenSC,
    active,
    onNav,
}: {
    user: User;
    period: [number, number];
    stagedCount: number;
    onOpenSC: () => void;
    active?: string;
    onNav?: (k: string) => void;
}) {
    const [m, y] = period;
    const activeGrp = NAV.find(g => g.items.some(i => i.key === active));
    const activeItem = activeGrp?.items.find(i => i.key === active);
    const crumbs: { label: string; key?: string }[] = [{ label: 'Portal', key: 'dashboard' }];
    if (activeGrp && activeGrp.group !== 'Overview') {
        const firstKey = activeGrp.items[0]?.key;
        crumbs.push({ label: activeGrp.group, key: firstKey });
    }
    if (activeItem) {
        crumbs.push({ label: activeItem.label });
    }
    return (
        <div className="status-bar">
            <div className="sb-left">
                <span className="sb-pill">
                    {I.branch({ style: { width: 11, height: 11 } })}
                    <span>main</span>
                </span>
                <span className="sb-sep">|</span>
                <span>{MONTHS[m]} {y}</span>
                {stagedCount > 0 && (
                    <button className="sb-pill" onClick={onOpenSC} style={{ cursor: "pointer" }}>
                        {I.branch({ style: { width: 11, height: 11 } })}
                        <span className="sb-staged-count">{stagedCount} staged</span>
                    </button>
                )}
            </div>
            <div className="sb-breadcrumb">
                {crumbs.flatMap((c, i) => [
                    i > 0 ? <span key={`sep-${i}`} className="sb-bc-sep">›</span> : null,
                    <span
                        key={c.label}
                        className={"sb-bc-seg" + (i === crumbs.length - 1 ? " current" : "")}
                        onClick={() => c.key && onNav?.(c.key)}
                    >
                        {c.label}
                    </span>,
                ])}
            </div>
            <div className="sb-right">
                <span>{ROLE_LABEL[user.role]}</span>
                <span className="sb-sep">|</span>
                <span className="sb-api">
                    <span className="rt" />
                    API
                </span>
            </div>
        </div>
    );
}

function WinCard({
    title,
    link,
    onLink,
    children,
    dots = false,
    defaultOpen = true,
    className = "",
    style,
}: {
    title: string;
    link?: string;
    onLink?: () => void;
    children: React.ReactNode;
    dots?: boolean;
    defaultOpen?: boolean;
    className?: string;
    style?: React.CSSProperties;
}) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div className={"card" + (!open ? " win-collapsed" : "") + (className ? " " + className : "")} style={style}>
            <div className="card-head">
                {dots && (
                    <div className="win-dots">
                        <span className="win-dot red" />
                        <span className="win-dot yellow" />
                        <span className="win-dot green" />
                    </div>
                )}
                <button className="win-collapse" onClick={() => setOpen((v) => !v)} aria-label="Toggle panel">
                    {I.chevL({ style: { transform: open ? "rotate(-90deg)" : "rotate(0deg)", transition: "transform .15s" } })}
                </button>
                <h3 style={{ flex: 1, color: "var(--ink)", fontWeight: 700 }}>{title}</h3>
                {link && onLink && (
                    <span className="ch-link" onClick={onLink}>{link}</span>
                )}
            </div>
            {open && <div className="card-body">{children}</div>}
        </div>
    );
}

function Loading({ label = "Loading live data…" }) {
    return (
        <div className="load-wrap">
            <div className="spinner"></div>
            <div>{label}</div>
        </div>
    );
}

function StudentMenuModal({
    day,
    meal,
    service,
    nextService,
    onClose,
}: {
    day: PublicMenuToday;
    meal: { period: string; items: PublicMenuCycleSlot[]; summary: ReturnType<typeof mealSummary> } | null;
    service: PublicMealPeriod | null;
    nextService: PublicMealPeriod | null;
    onClose: () => void;
}) {
    const title = service?.label || meal?.period || "Today's menu";
    const serviceHours = service?.open_hour != null && service?.close_hour != null
        ? `${service.open_hour}:00-${service.close_hour}:00`
        : null;
    const nextOpens = nextService?.open_hour != null ? `${nextService.open_hour}:00` : null;
    return createPortal(
        <div className="overlay student-menu-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="student-menu-modal" role="dialog" aria-modal="true" aria-label="Student menu">
                <div className="student-menu-hero">
                    <div>
                        <p>{day.day_of_week} - Cycle Day {day.cycle_day}</p>
                        <h2>{title}</h2>
                        <span>
                            {service
                                ? `Serving now${serviceHours ? `, ${serviceHours}` : ""}`
                                : nextService
                                    ? `${nextService.label} opens${nextOpens ? ` at ${nextOpens}` : ""}`
                                    : "No service window is open right now"}
                        </span>
                    </div>
                    <button className="modal-x" onClick={onClose} aria-label="Close student menu">{I.x()}</button>
                </div>
                <div className="student-menu-body">
                    {!meal ? (
                        <div className="student-menu-empty">No menu items are listed for this service yet.</div>
                    ) : (
                        <>
                            <div className="student-menu-feature">
                                {meal.summary.primary && <strong>{meal.summary.primary}</strong>}
                                {meal.summary.secondary && <span>{meal.summary.secondary}</span>}
                                {meal.summary.remaining > 0 && <em>+{meal.summary.remaining} more items</em>}
                            </div>
                            <div className="student-menu-list">
                                {meal.items.map(item => (
                                    <div className="student-menu-row" key={`${item.slot_name}-${item.item_name}`}>
                                        <span>{item.slot_name}</span>
                                        <strong>{item.item_name}</strong>
                                    </div>
                                ))}
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>,
        document.body,
    );
}

function Dashboard({
    user,
    period,
    invState,
    onSync,
    go,
}: {
    user: User;
    period: [number, number];
    invState: any;
    onSync: () => void;
    go: (k: string) => void;
}) {
    const lvl = ROLE_LEVEL[user.role];
    const live = invState.inv;
    const invMeta = invState.metadata || {};
    const todayISO = new Date().toISOString().slice(0, 10);

    const [menuToday, setMenuToday] = useState<PublicMenuToday | null>(null);
    const [menuLoading, setMenuLoading] = useState(true);
    const [studentMenuOpen, setStudentMenuOpen] = useState(false);
    const [events, setEvents] = useState<any[]>([]);
    const [eventsLoading, setEventsLoading] = useState(true);

    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                setMenuLoading(true);
                const res = await api.getPublicMenuToday();
                if (alive) {
                    setMenuToday(res);
                    setMenuLoading(false);
                }
            } catch (e: any) {
                // 401s etc. are handled centrally in api.ts (clears token + dispatches mjc:session-expired).
                // Swallow here to avoid uncaught promise spam in console; UI will tear down to login or show empty state.
                if (alive) setMenuLoading(false);
            }
        })();
        return () => {
            alive = false;
        };
    }, []);

    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                setEventsLoading(true);
                const data = await api.getEvents();
                if (alive) {
                    setEvents(Array.isArray(data) ? data : (data as any)?.events ?? []);
                    setEventsLoading(false);
                }
            } catch (e: any) {
                if (alive) setEventsLoading(false);
            }
        })();
        return () => {
            alive = false;
        };
    }, []);

    let gt = 0,
        reorderList: any[] = [],
        catRows: any[] = [],
        itemCount = 0;
    if (live) {
        const metaTotals = moneyTotalsFromMeta(invMeta);
        gt = metaTotals.close;
        reorderList = Array.from({ length: Math.max(0, Math.round(num(invMeta.reorder_count))) });
        if (!reorderList.length) reorderList = reorders(live);
        const ct = categoryRowsFromMeta(invMeta);
        const maxCat = ct.length ? ct[0].val : 1;
        itemCount = Math.round(num(invMeta.item_count)) || invToList(live).length;
        catRows = ct.slice(0, 7).map((c: any) => ({
            name: c.name,
            color: c.color,
            val: fmtMoney(c.val),
            pct: maxCat ? Math.max(4, Math.round((c.val / maxCat) * 100)) : 0,
        }));
    }

    const miSum = moneyTotalsFromMeta(invMeta);

    const menuMeals = (() => {
        if (!menuToday?.meals) return [] as Array<{ period: string; items: PublicMenuCycleSlot[]; summary: ReturnType<typeof mealSummary> }>;
        const keys = Object.keys(menuToday.meals);
        const order = PERIOD_ORDER.filter(p => keys.includes(p));
        const rest = keys.filter(p => !PERIOD_ORDER.includes(p));
        return [...order, ...rest].map(period => {
            const items = menuToday.meals[period] || [];
            return { period, items, summary: mealSummary(items) };
        });
    })();
    const serviceStatus = menuToday?.service_status || null;
    const currentServiceMeal = serviceStatus?.current_period?.meal || null;
    const currentMenuMeal = currentServiceMeal
        ? menuMeals.find(m => m.period === currentServiceMeal)
        : null;
    const studentModalMeal = currentMenuMeal || menuMeals[0] || null;
    const serviceLabel = serviceStatus?.current_period?.label || studentModalMeal?.period || "Today's menu";

    const ml = loadLog("meallog:" + todayISO, null);
    const mlRows = (ml && ml.rows) || [];
    const mlCount = (m: string) => mlRows.filter((r: any) => r[m[0]]).length;
    const mlTotals = {
        B: mlCount("B"),
        L: mlCount("L"),
        D: mlCount("D"),
        T: mlRows.filter(
            (r: any) =>
                r.ticket && !String(r.ticket).toUpperCase().includes("COMP"),
        ).length,
    };

    const upcoming = events
        .filter((e: any) => e.date >= todayISO)
        .sort((a: any, b: any) => a.date.localeCompare(b.date));
    const nextEvent = upcoming[0];

    const fmtShort = (iso: string) =>
        new Date(iso + "T12:00:00").toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
        });

    const ALL_KPIS = [
        {
            key: "val",
            label: "Inventory Value",
            icon: "dollar",
            tint: "#1E73E8",
            bg: "#EFF5FE",
            val: fmtMoney(gt),
            sub: itemCount + " line items",
            to: "inventory",
        },
        {
            key: "low",
            label: "Below Par",
            icon: "alert",
            tint: "#D97706",
            bg: "#FEF3C7",
            val: String(reorderList.length),
            sub: "flagged for reorder",
            to: "inventory",
        },
        {
            key: "meals",
            label: "Meals Logged",
            icon: "users",
            tint: "#1B3A6B",
            bg: "#EEF2F8",
            val: String(mlTotals.B + mlTotals.L + mlTotals.D),
            sub: "today",
            to: "mballot",
        },
        {
            key: "mi",
            label: "Closing Value",
            icon: "fileText",
            tint: "#0E7490",
            bg: "#ECFEFF",
            val: fmtMoney(miSum.close),
            sub: "monthly inventory",
            to: "moninv",
        },
        {
            key: "evt",
            label: "Next Event",
            icon: "calCheck",
            tint: "#6D28D9",
            bg: "#EDE9FE",
            val: nextEvent ? fmtShort(nextEvent.date) : "—",
            sub: nextEvent ? nextEvent.title : "none scheduled",
            to: "events",
            small: true,
        },
    ];
    const KPIS = lvl < 20
        ? ALL_KPIS.filter(k => ['low', 'meals', 'evt'].includes(k.key))
        : ALL_KPIS;

    const QUICK = [
        { label: "Log HACCP reading", icon: "thermo", to: "haccp", min: 20 },
        { label: "Log staff meal", icon: "users", to: "mballot", min: 10 },
        { label: "Food request form", icon: "inbox", to: "foodreq", min: 10 },
        {
            label: "Run inspection",
            icon: "clipboard",
            to: "inspection",
            min: 20,
        },
        {
            label: "Flow",
            icon: "checkSquare",
            to: "dailyops",
            min: 20,
        },
        { label: "Monthly inventory", icon: "fileText", to: "moninv", min: 20 },
        { label: "Pull sheet", icon: "clipboard", to: "pullsheet", min: 30 },
    ].filter((q) => lvl >= q.min);

    return (
        <div className="fade-in">
            <div className="page-head">
                <div>
                    <h2>Welcome back, {user.display_name || user.username}</h2>
                    <div className="ph-sub">
                        Operations overview ·{" "}
                        {new Date().toLocaleDateString("en-US", {
                            weekday: "long",
                            month: "long",
                            day: "numeric",
                        })}

                    </div>
                </div>
                <div className="ph-actions">
                    <button className="btn" onClick={onSync}>
                        {I.refresh()} Refresh
                    </button>
                    {lvl >= 20 && (
                        <button
                            className="btn primary"
                            onClick={() => go("moninv")}
                        >
                            {I.plus()} New entry
                        </button>
                    )}
                </div>
            </div>

            {invState.loading && <Loading />}
            {invState.error && invState.error !== "empty" && (
                <div className="banner warn">
                    {I.alert()}
                    <span>Couldn't load live data: {invState.error}</span>
                    {/token|authorization|expired/i.test(invState.error) ? (
                        <span className="bx" onClick={() => { realLogout(); (window as any).__logout?.(); }}>
                            Sign out
                        </span>
                    ) : (
                        <span className="bx" onClick={onSync}>
                            Retry
                        </span>
                    )}
                </div>
            )}

            <div className="stat-grid kpi5">
                {KPIS.map((s) => (
                    <div
                        className="stat-card kpi-card"
                        key={s.key}
                        onClick={() => go(s.to)}
                    >
                        <div className="sc-top">
                            <div
                                className="sc-ic"
                                style={{ background: s.bg, color: s.tint }}
                            >
                                {I[s.icon]()}
                            </div>
                        </div>
                        <div className="sc-lbl">{s.label}</div>
                        <div
                            className="sc-val"
                            style={
                                s.small
                                    ? {
                                          fontSize: 16,
                                          fontFamily: "var(--font)",
                                      }
                                    : undefined
                            }
                        >
                            {s.val}
                        </div>
                        <div
                            className="sc-delta eq"
                            style={{
                                marginTop: 4,
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                            }}
                        >
                            {s.sub}
                        </div>
                    </div>
                ))}
            </div>

            <div className="grid-2">
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 16,
                    }}
                >
                    <WinCard
                        title={`Today's menu · ${menuToday?.day_of_week || DOW_FULL[new Date().getDay()]}${menuToday?.cycle_day ? ` · Day ${menuToday.cycle_day}` : ""}`}
                        link="Full menu →"
                        onLink={() => go("menu")}
                    >
                        <button
                            className="student-menu-trigger"
                            onClick={() => setStudentMenuOpen(true)}
                            disabled={menuLoading || menuMeals.length === 0}
                        >
                            <div className="student-menu-trigger-head">
                                <span>{serviceStatus?.current_period ? `${serviceLabel} is being served now` : "Tap to view today's menu"}</span>
                                <strong>{serviceStatus?.current_period ? "Open now" : serviceStatus?.next_period ? `${serviceStatus.next_period.label} next` : "Menu"}</strong>
                            </div>
                            {menuLoading ? (
                                <div style={{ fontSize: 12, color: "var(--muted)" }}>Loading menu…</div>
                            ) : menuMeals.length === 0 ? (
                                <div style={{ fontSize: 12, color: "var(--muted)" }}>No menu for today.</div>
                            ) : (
                                menuMeals.map(({ period, summary }) => (
                                    <div key={period} className="dash-meal">
                                        <div className="dm-head">{period}</div>
                                        <div className="dm-items">
                                            {summary.primary && <strong>{summary.primary}</strong>}
                                            {summary.secondary && <span style={{ color: "var(--muted)" }}> · {summary.secondary}</span>}
                                            {summary.remaining > 0 && (
                                                <span style={{ color: "var(--faint)", fontSize: 11 }}> +{summary.remaining} more</span>
                                            )}
                                        </div>
                                        {summary.sides.length > 0 && (
                                            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 2 }}>
                                                {summary.sides.map((s: any) => (
                                                    <span key={s.record_id || s.slot_name + s.item_name} className="cm-side-chip" title={s.slot_name}>
                                                        <span className="cm-side-kind">{shortSideLabel(s.slot_name)}</span>
                                                        {s.item_name}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                ))
                            )}
                        </button>
                    </WinCard>

                    {lvl >= 20 && (
                        <WinCard title="Inventory value by category" link="Live →" onLink={() => go("inventory")}>
                            <div className="card-body flush" style={{ margin: "-16px -17px" }}>
                                {catRows.map((c: any) => (
                                    <div className="cat-row" key={c.name}>
                                        <span className="cat-dot" style={{ background: c.color }} />
                                        <span className="cat-nm">{c.name}</span>
                                        <span className="cat-bar">
                                            <span className="cat-fill" style={{ width: c.pct + "%", background: c.color }} />
                                        </span>
                                        <span className="cat-val">{c.val}</span>
                                    </div>
                                ))}
                            </div>
                        </WinCard>
                    )}

                    {lvl >= 20 && (
                        <WinCard title="Inventory alerts">
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: reorderList.length ? 10 : 0 }}>
                                <StatusPill warn={reorderList.length > 0} style={{ margin: 0 }}>
                                    {I.alert({ style: { width: 13, height: 13 } })} {reorderList.length} below par
                                </StatusPill>
                            </div>
                            {reorderList.length === 0 ? (
                                <div style={{ fontSize: 12, color: "var(--muted)" }}>All items at or above par level.</div>
                            ) : (
                                <div className="alert-chips">
                                    {reorderList.slice(0, 12).map((r: any, i: number) => (
                                        <span className="alert-chip" key={i}>
                                            {r.desc}<b>{r.onHand || 0}/{r.par}</b>
                                        </span>
                                    ))}
                                    {reorderList.length > 12 && (
                                        <span className="alert-more" onClick={() => go("inventory")}>
                                            +{reorderList.length - 12} more →
                                        </span>
                                    )}
                                </div>
                            )}
                        </WinCard>
                    )}
                </div>

                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 16,
                    }}
                >
                    <WinCard title="Meal log · today" link="Full log →" onLink={() => go("mballot")}>
                        <div className="dash-meal-counts">
                            {(["Breakfast", "Lunch", "Dinner", "Tickets"] as const).map((l) => (
                                <div className="dmc" key={l}>
                                    <span className="dmc-n">{mlTotals[l[0] as keyof typeof mlTotals] ?? 0}</span>
                                    <span className="dmc-l">{l}</span>
                                </div>
                            ))}
                        </div>
                    </WinCard>

                    {lvl >= 20 && (
                        <WinCard title={`Monthly inventory · ${MONTHS[period[0]]}`} link="Manage →" onLink={() => go("moninv")}>
                            <div className="mi-mini">
                                <div className="mim mim-opening">
                                    <span className="mim-l">Opening</span>
                                    <span className="mim-v">{fmtMoney(miSum.open)}</span>
                                </div>
                                <div className="mim mim-received">
                                    <span className="mim-l">Received</span>
                                    <span className="mim-v">{fmtMoney(miSum.recv)}</span>
                                </div>
                                <div className="mim mim-issued">
                                    <span className="mim-l">Issued</span>
                                    <span className="mim-v">{fmtMoney(miSum.iss)}</span>
                                </div>
                                <div className="mim mim-closing">
                                    <span className="mim-l">Closing</span>
                                    <span className="mim-v">{fmtMoney(miSum.close)}</span>
                                </div>
                            </div>
                        </WinCard>
                    )}

                    <WinCard title="Upcoming events" link="Calendar →" onLink={() => go("events")}>
                        <div className="card-body flush" style={{ margin: "-16px -17px" }}>
                            {eventsLoading ? (
                                <div style={{ padding: 12, fontSize: 12, color: "var(--muted)" }}>Loading events…</div>
                            ) : upcoming.slice(0, 4).length === 0 ? (
                                <div style={{ padding: 12, fontSize: 12, color: "var(--muted)" }}>No upcoming events.</div>
                            ) : (
                                upcoming.slice(0, 4).map((e: any) => (
                                    <div className="up-ev" key={e.id} onClick={() => go("events")}>
                                        <span className="up-dot" style={{ background: "#64748B" }} />
                                        <span className="up-title">{e.title}</span>
                                        <span className="up-date">{fmtShort(e.date)}</span>
                                    </div>
                                ))
                            )}
                        </div>
                    </WinCard>

                    <WinCard title="Quick actions">
                        <div className="qa-grid">
                            {QUICK.map((q) => (
                                <button className="qa-btn" key={q.to} onClick={() => go(q.to)}>
                                    {I[q.icon]({ style: { width: 15, height: 15 } })}
                                    <span>{q.label}</span>
                                </button>
                            ))}
                        </div>
                    </WinCard>
                </div>
            </div>
            {studentMenuOpen && menuToday && (
                <StudentMenuModal
                    day={menuToday}
                    meal={studentModalMeal}
                    service={serviceStatus?.current_period || null}
                    nextService={serviceStatus?.next_period || null}
                    onClose={() => setStudentMenuOpen(false)}
                />
            )}
        </div>
    );
}

// Canonical inventory category taxonomy — used as a last-resort fallback when
// both the API call and inventory-derived category lists are empty (e.g. a new
// period with no items yet, or an API 500 on /api/inventory-categories).
const FALLBACK_CATS = [
    "Dairy", "Cereal", "Beverages", "Snacks", "Meats",
    "Frozen Food", "Dry Goods", "Produce", "Disposables", "New Items",
];

function InventoryView({
    user,
    period,
    invState,
    onSync,
    openSC,
    go,
    onPullSheet,
}: {
    user: User;
    period: [number, number];
    invState: any;
    onSync: () => void;
    openSC?: () => void;
    go?: (key: string) => void;
    onPullSheet?: () => void;
}) {
    const lvl = ROLE_LEVEL[user.role];
    const canStage = lvl >= 10;
    const canEditPar = lvl >= 30;
    const [q, setQ] = useState("");
    const [cat, setCat] = useState("");
    const [draft, setDraft] = useState<
        Record<string, { onHand: number; par: number; price?: number }>
    >({});
    // Holds the last-staged values per SKU so inputs keep showing the staged
    // value after draft is cleared (staging queues via SC, not direct DB write).
    const [stagedValues, setStagedValues] = useState<
        Record<string, { onHand: number; par: number }>
    >({});
    const [_stagingBusy, setStagingBusy] = useState<Record<string, boolean>>({});
    const [viewMode, setViewMode] = useState<
        "regular" | "grouped" | "compact"
    >("grouped");
    const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
    const savedCollapsedRef = useRef<Record<string, boolean>>({});
    const handlePrint = () => {
        if (viewMode !== "grouped") setViewMode("grouped");
        savedCollapsedRef.current = { ...collapsed };
        setCollapsed({});
        setTimeout(() => {
            window.print();
            setCollapsed(savedCollapsedRef.current);
        }, 80);
    };
    const toggleCat = (c: string) =>
        setCollapsed((p) => ({ ...p, [c]: !p[c] }));

    // Add-item modal (creates a new inventory_items row via the inventory_save
    // staging path — a new SKU upserts as a new item on approval).
    const [showAddItem, setShowAddItem] = useState(false);
    const [addBusy, setAddBusy] = useState(false);
    useEscapeClose(showAddItem, () => setShowAddItem(false), addBusy);
    const blankItem = {
        desc: "",
        sku: "",
        category: "",
        price: "",
        par: "",
        onHand: "",
    };
    const [newItem, setNewItem] = useState(blankItem);

    // Edit-item modal (edit / reassign category / soft-delete ANY item, keyed by
    // SKU). Reassigning out of "New Items" is the manager's review action.
    const [editTarget, setEditTarget] = useState<any | null>(null);
    const [editForm, setEditForm] = useState({
        desc: "",
        category: "",
        price: "",
        par: "",
        sku: "",
        unit: "",
        active: true,
    });
    const [editBusy, setEditBusy] = useState(false);
    useEscapeClose(!!editTarget, () => setEditTarget(null), editBusy);
    const [triageFilter, setTriageFilter] = useState(false);
    const [mergeDialog, setMergeDialog] = useState<{
        keepId: string; removeId: string;
        keepSku: string; removeSku: string; removeDesc: string;
    } | null>(null);
    const [mergeBusy, setMergeBusy] = useState(false);
    useEscapeClose(!!mergeDialog, () => setMergeDialog(null), mergeBusy);

    // Roster-style floating inspector: click any item row to open a per-item
    // toolbar (receive ↑ / pull ↓ by week, on-hand / par / price). Staging
    // routes through the same Source Control ops the inline editors use.
    const [inspectTarget, setInspectTarget] = useState<any | null>(null);
    const [selectedSkus, setSelectedSkus] = useState<Set<string>>(new Set());

    // Week lock status: keyed by week number (1-3), value = 'open'|'locked'|'published'
    const [weekLockStatus, setWeekLockStatus] = useState<Record<number, string>>({});
    const [weekLockBusy, setWeekLockBusy] = useState(false);
    const reloadWeekStatus = useCallback(() => {
        api.getWeekStatus(period[0] + 1, period[1])
            .then((rows) => {
                const map: Record<number, string> = {};
                rows.forEach((r) => { map[r.week] = r.status; });
                setWeekLockStatus(map);
            })
            .catch(() => {});
    }, [period[0], period[1]]);
    useEffect(() => { reloadWeekStatus(); }, [reloadWeekStatus]);

    // Pending drafts banner: count of the current user's unsubmitted staging entries
    const [pendingDraftsCount, setPendingDraftsCount] = useState(0);
    useEffect(() => {
        api.getMyStagingEntries()
            .then(({ count }) => setPendingDraftsCount(count))
            .catch(() => {});
        const handler = () => {
            api.getMyStagingEntries()
                .then(({ count }) => setPendingDraftsCount(count))
                .catch(() => {});
        };
        window.addEventListener('mjcc:staging-changed', handler);
        window.addEventListener('mjcc:committed', handler);
        return () => {
            window.removeEventListener('mjcc:staging-changed', handler);
            window.removeEventListener('mjcc:committed', handler);
        };
    }, [period[0], period[1]]);

    // Rollover modal
    const [showRollover, setShowRollover] = useState(false);
    const [rolloverBusy, setRolloverBusy] = useState(false);
    useEscapeClose(showRollover, () => setShowRollover(false), rolloverBusy);
    const doRollover = async () => {
        setRolloverBusy(true);
        try {
            await api.performRollover(`Published ${MONTHS[period[0]]} ${period[1]} and rolled forward`);
            toast(`${MONTHS[period[0]]} published — next period created.`);
            setShowRollover(false);
            onSync();
        } catch (e: any) {
            toast(`Rollover failed: ${e?.message || 'Unknown error'}`);
        } finally {
            setRolloverBusy(false);
        }
    };

    const openEdit = (row: any) => {
        setEditTarget(row);
        setEditForm({
            desc: row.desc || "",
            category: row.cat || "",
            price: String(row.price ?? ""),
            par: String(row.par ?? ""),
            sku: row.sku || "",
            unit: row.unit || "",
            active: row.active !== false,
        });
        // For a New-Items row, fetch the parser's advisory category guess and
        // pre-fill the dropdown so confirming is one click (non-blocking).
        if ((row.cat || "") === "New Items" && row.sku) {
            api.getInventoryItems({ sku: String(row.sku) })
                .then((res) => {
                    const suggested = res?.[0]?.suggested_category || "";
                    if (!suggested) return;
                    setEditTarget((prev: any) =>
                        prev && prev.sku === row.sku
                            ? { ...prev, suggested_category: suggested }
                            : prev,
                    );
                    setEditForm((p) =>
                        p.category === "New Items"
                            ? { ...p, category: suggested }
                            : p,
                    );
                })
                .catch(() => {});
        }
    };

    // Authoritative category list from the API (includes empty categories like
    // "New Items"), so the add/edit dropdowns can target a bucket even when no
    // item is in it yet. Falls back to FALLBACK_CATS (module-level const) if
    // both the API call and the inventory-derived list are empty.
    const [apiCatNames, setApiCatNames] = useState<string[]>([]);
    const reloadCatNames = useCallback(() => {
        api.getInventoryCategories()
            .then((rows: any[]) => {
                if (Array.isArray(rows) && rows.length > 0)
                    setApiCatNames(rows.map((c: any) => c.name).filter(Boolean));
            })
            .catch((err: any) => {
                if (import.meta.env.DEV)
                    console.warn("[InventoryView] Failed to load categories from API:", err?.message || err);
            });
    }, []);
    useEffect(() => { reloadCatNames(); }, [reloadCatNames]);

    // Weekly pulled (issued, ↓) / received (↑) columns — mirrors the offline
    // template's compact sheet. Edits live in local `wkDraft` and are persisted
    // via the "Stage weekly changes" batch action (stageCompactChanges), which
    // routes through Source Control like the Monthly Inventory view.
    const PULLED = ["w1p", "w2p", "w3p"] as const; // pulled ↓
    const RECEIVED = ["w1r", "w2r", "w3r"] as const; // delivered ↑
    type WeeklyField = (typeof PULLED)[number] | (typeof RECEIVED)[number];
    const [wkDraft, setWkDraft] = useState<
        Record<string, Partial<Record<WeeklyField, number>>>
    >({});

    // Invoice mode selectors: which week (1-3) and direction this staging batch
    // represents. 0 = whole-month save (inventory_save). When week>0, the batch
    // is routed as inventory_week_update for that specific column only.
    const maxWeeks = (invState.metadata?.weeks_in_period as number) ?? 3;
    const [compactWeek, setCompactWeek] = useState<0 | 1 | 2 | 3>(
        () => Math.min(3, Math.ceil(new Date().getDate() / 7)) as 1 | 2 | 3
    );
    // compactDir removed — both issued AND received are staged when they have edits.
    const setWeeklyField = (sku: string, field: WeeklyField, value: string) => {
        const num = Number.isFinite(parseFloat(value))
            ? Math.max(0, parseFloat(value))
            : 0;
        setWkDraft((prev) => ({
            ...prev,
            [sku]: { ...prev[sku], [field]: num },
        }));
    };

    const setDraftField = (
        sku: string,
        field: "onHand" | "par",
        value: string,
        onHandFallback: number,
        parFallback: number,
    ) => {
        const parsed = parseFloat(value);
        const valid = Number.isFinite(parsed);
        // New user edit overrides any pending-staged snapshot for this SKU.
        setStagedValues((prev) => { const c = { ...prev }; delete c[sku]; return c; });
        setDraft((prev) => {
            const cur = prev[sku];
            // When the user clears/invalidates the field, preserve the existing
            // draft value rather than snapping back to the DB fallback mid-input.
            const num = valid
                ? Math.max(0, parsed)
                : field === "onHand"
                    ? (cur?.onHand ?? onHandFallback)
                    : (cur?.par ?? parFallback);
            return {
                ...prev,
                [sku]: {
                    onHand: cur?.onHand ?? onHandFallback,
                    par: cur?.par ?? parFallback,
                    [field]: num,
                },
            };
        });
    };

    const setPriceField = (sku: string, value: string, priceFallback: number) => {
        const parsed = parseFloat(value);
        const num = Number.isFinite(parsed) ? Math.max(0, parsed) : priceFallback;
        setDraft((prev) => {
            const cur = prev[sku];
            return {
                ...prev,
                [sku]: { onHand: cur?.onHand ?? 0, par: cur?.par ?? 0, price: num },
            };
        });
    };

    // Emit draft state to SC panel whenever draft changes
    useEffect(() => {
        const flatRows = invToList(invState.inv || {});
        window.dispatchEvent(new CustomEvent("mjcc:draft-changed", {
            detail: Object.entries(draft).map(([sku, vals]) => {
                const row = flatRows.find((r: any) => String(r.sku) === sku);
                return { sku, desc: row?.desc ?? sku, onHand: vals.onHand, par: vals.par };
            }),
        }));
    }, [draft, invState.inv]);

    // Draft persistence (draft-only localStorage policy: namespaced by
    // user + feature + period, 24h expiry, restored visibly). The old key was
    // write-only — it saved a draft nothing ever read back, so "Draft saved
    // locally" was a dead end.
    const invDraftScope = `inv_${user.id}_${period[0]}_${period[1]}`;
    const saveDraftLocally = () => {
        draftsLib.saveDraft(invDraftScope, { draft, wkDraft });
        toast("Draft saved on this device (expires in 24h) — stage or commit to persist");
    };
    useEffect(() => {
        // Restore an unexpired draft for this period; legacy key migrates once.
        draftsLib.migrateLegacyDraft<{ draft: any; wkDraft: any }>(
            `mjcc_inv_draft_${period[0]}_${period[1]}`,
            invDraftScope,
            (p) => (p && (p.draft || p.wkDraft) ? p : null),
        );
        const restored = draftsLib.restoreDraft<{ draft: any; wkDraft: any }>(invDraftScope);
        if (restored?.data) {
            if (restored.data.draft && Object.keys(restored.data.draft).length) {
                setDraft(restored.data.draft);
            }
            if (restored.data.wkDraft && Object.keys(restored.data.wkDraft).length) {
                setWkDraft(restored.data.wkDraft);
            }
            if (
                Object.keys(restored.data.draft || {}).length ||
                Object.keys(restored.data.wkDraft || {}).length
            ) {
                toast(`Unsaved draft from ${new Date(restored.savedAt).toLocaleString()} restored — stage or commit to persist`);
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [invDraftScope]);

    const stageInventoryRow = async (row: any) => {
        if (!canStage || !row.sku) return;
        const sku = String(row.sku);
        const next = draft[sku] ?? { onHand: row.onHand, par: row.par };
        const payload = {
            month: period[0] + 1,
            year: period[1],
            notes: `Inventory edit · ${MONTHS[period[0]]} ${period[1]}`,
            items: [
                {
                    sku,
                    desc: row.desc,
                    onHand: next.onHand,
                    par: next.par,
                    price: row.price,
                    category: row.cat,
                },
            ],
        };

        setStagingBusy((prev) => ({ ...prev, [sku]: true }));
        try {
            await api.stageChange(
                "inventory_save",
                "inventory",
                `${sku}-${period[0] + 1}-${period[1]}`,
                payload,
                `Inventory update · ${row.desc}`,
            );
            toast(`Staged inventory update for ${row.desc}`);
            openSC?.();
            // Preserve the staged value so the input keeps showing it until rows reload.
            setStagedValues((prev) => ({ ...prev, [sku]: { onHand: next.onHand, par: next.par } }));
            setDraft((prev) => {
                const copy = { ...prev };
                delete copy[sku];
                return copy;
            });
        } catch (e: any) {
            toast(
                `Failed to stage ${row.desc}: ${e?.message || "Unknown error"}`,
            );
        } finally {
            setStagingBusy((prev) => ({ ...prev, [sku]: false }));
        }
    };

    const live = invState.inv;
    const rows: any[] = live
        ? invToList(invState.inv).map((it: any) => ({
            id: it.id,
            sku: it.sku,
            desc: it.desc,
            cat: it.cat,
            price: it.price || 0,
            onHand: it.onHand || 0,
            par: it.par || 0,
            unit: it.unit || "",
            active: it.active !== false,
            w1p: it.w1p || 0,
            w2p: it.w2p || 0,
            w3p: it.w3p || 0,
            w1r: it.w1r || 0,
            w2r: it.w2r || 0,
            w3r: it.w3r || 0,
            totalReceived: it.totalReceived,
            totalPulled: it.totalPulled,
            closingQty: it.closingQty,
            openingValue: it.openingValue,
            receivedValue: it.receivedValue,
            pulledValue: it.pulledValue,
            endingValue: it.endingValue,
            value: typeof it.value === "number" ? it.value : (typeof it.endingValue === "number" ? it.endingValue : 0),
            sku_pending: it.sku_pending ?? String(it.sku || "").startsWith("MJC-"),
            needs_attention: it.needs_attention ?? it.sku_pending ?? String(it.sku || "").startsWith("MJC-"),
            status:
                ((typeof it.closingQty === "number" ? it.closingQty : it.onHand || 0) < (it.par || 0)) && (it.par || 0) > 0
                    ? "low"
                    : "ok",
        }))
        : [];
    const cats: string[] = live ? [...new Set(rows.map((r: any) => r.cat))] : [];
    const rowDisplayValue = (r: any) => {
        const sku = String(r.sku || "");
        const hasDraft = Boolean(draft[sku] || stagedValues[sku] || wkDraft[sku]);
        if (!hasDraft && typeof r.value === "number") return r.value;
        const onHand = draft[sku]?.onHand ?? stagedValues[sku]?.onHand ?? r.onHand;
        const price = draft[sku]?.price ?? r.price ?? 0;
        const received = RECEIVED.reduce((sum, key) => sum + (wkDraft[sku]?.[key] ?? r[key] ?? 0), 0);
        const pulled = PULLED.reduce((sum, key) => sum + (wkDraft[sku]?.[key] ?? r[key] ?? 0), 0);
        return Math.max(0, onHand + received - pulled) * price;
    };

    // Compact view: batch-stage all rows with unsaved weekly (received/issued)
    // and/or on-hand/par edits into ONE staging entry (mirrors the Monthly
    // Inventory view's batch payload). Each item carries its REAL current
    // on-hand/par merged over any drafts, so we never stage par:0.
    const compactDirtyRows = () =>
        (rows || []).filter((r: any) => {
            const sku = String(r.sku || "");
            return sku && (wkDraft[sku] || draft[sku]);
        });

    const stageCompactChanges = async () => {
        if (!canStage) return;
        const dirty = compactDirtyRows();
        if (!dirty.length) {
            toast("No changes to stage");
            return;
        }
        const month1 = period[0] + 1;
        const yr = period[1];
        const n = dirty.length;
        setStagingBusy((prev) => ({ ...prev, __compact__: true }));
        try {
            if (compactWeek > 0) {
                // Invoice mode: stage BOTH directions independently when they have edits.
                // Each direction that has any edits gets its own inventory_week_update op.
                const rcvKey = `w${compactWeek}r` as WeeklyField;
                const issKey = `w${compactWeek}p` as WeeklyField;

                const rcvItems = dirty
                    .filter((r: any) => wkDraft[String(r.sku || "")]?.[rcvKey] !== undefined)
                    .map((r: any) => {
                        const sku = String(r.sku);
                        return { sku, desc: r.desc, category: r.cat, price: draft[sku]?.price ?? r.price, par: draft[sku]?.par ?? r.par, qty: wkDraft[sku]![rcvKey]! };
                    });

                const issItems = dirty
                    .filter((r: any) => wkDraft[String(r.sku || "")]?.[issKey] !== undefined)
                    .map((r: any) => {
                        const sku = String(r.sku);
                        return { sku, desc: r.desc, category: r.cat, price: draft[sku]?.price ?? r.price, par: draft[sku]?.par ?? r.par, qty: wkDraft[sku]![issKey]! };
                    });

                // Rows with on_hand/par/price edits stage as inventory_save.
                const monthItems = dirty
                    .filter((r: any) => Boolean(draft[String(r.sku || "")]))
                    .map((r: any) => {
                        const sku = String(r.sku);
                        const d = draft[sku];
                        return { sku, desc: r.desc, category: r.cat, price: d?.price ?? r.price, onHand: d?.onHand ?? r.onHand, par: d?.par ?? r.par };
                    });

                const ops: Promise<any>[] = [];
                if (rcvItems.length) {
                    ops.push(api.stageChange(
                        "inventory_week_update", "inventory",
                        `W${compactWeek}-received-${month1}-${yr}`,
                        { month: month1, year: yr, week: compactWeek, direction: "received", review_new: true, items: rcvItems },
                        `W${compactWeek} received · ${rcvItems.length} item${rcvItems.length !== 1 ? "s" : ""}`,
                    ));
                }
                if (issItems.length && lvl >= 30) {
                    ops.push(api.stageChange(
                        "inventory_week_update", "inventory",
                        `W${compactWeek}-issued-${month1}-${yr}`,
                        { month: month1, year: yr, week: compactWeek, direction: "issued", review_new: true, items: issItems },
                        `W${compactWeek} issued · ${issItems.length} item${issItems.length !== 1 ? "s" : ""}`,
                    ));
                }
                if (monthItems.length) {
                    ops.push(api.stageChange(
                        "inventory_save", "inventory",
                        `batch-compact-${month1}-${yr}`,
                        { month: month1, year: yr, notes: `On-hand update · ${MONTHS[period[0]]} ${yr}`, items: monthItems },
                        `On-hand update · ${monthItems.length} item${monthItems.length !== 1 ? "s" : ""}`,
                    ));
                }
                await Promise.all(ops);
                const parts = [
                    rcvItems.length ? `${rcvItems.length} received` : "",
                    issItems.length ? `${issItems.length} issued` : "",
                    monthItems.length ? `${monthItems.length} on-hand` : "",
                ].filter(Boolean).join(" · ");
                toast(`Staged W${compactWeek} — ${parts || n + " item" + (n !== 1 ? "s" : "")}`);
                openSC?.();
            } else {
                // Whole-month save: on_hand/par + any explicitly-edited weekly columns.
                // Only w* keys present in wkDraft are included, so unedited weeks are preserved.
                const items = dirty.map((r: any) => {
                    const sku = String(r.sku);
                    const d = draft[sku];
                    const w = wkDraft[sku] || {};
                    const base: any = {
                        sku, desc: r.desc, category: r.cat, price: d?.price ?? r.price,
                        onHand: d?.onHand ?? r.onHand,
                        par: d?.par ?? r.par,
                    };
                    // Spread only explicitly-edited weekly fields
                    for (const k of ["w1r","w2r","w3r","w1p","w2p","w3p"] as WeeklyField[]) {
                        if (k in w) base[k] = w[k];
                    }
                    return base;
                });
                await api.stageChange(
                    "inventory_save",
                    "inventory",
                    `batch-compact-${month1}-${yr}`,
                    { month: month1, year: yr, notes: `Inventory update · ${MONTHS[period[0]]} ${yr}`, items },
                    `Inventory update · ${n} item${n !== 1 ? "s" : ""}`,
                );
                toast(`Staged inventory changes for ${n} item${n !== 1 ? "s" : ""}`);
                openSC?.();
            }
            // Preserve staged values so inputs keep showing them until rows reload.
            setStagedValues((prev) => {
                const next = { ...prev };
                for (const r of dirty) {
                    const sku = String((r as any).sku || "");
                    const d = draft[sku];
                    next[sku] = { onHand: d?.onHand ?? (r as any).onHand, par: d?.par ?? (r as any).par };
                }
                return next;
            });
            setWkDraft({});
            setDraft((prev) => {
                const copy = { ...prev };
                for (const r of dirty) delete copy[String((r as any).sku || "")];
                return copy;
            });
        } catch (e: any) {
            toast(`Failed to stage: ${e?.message || "Unknown error"}`);
        } finally {
            setStagingBusy((prev) => ({ ...prev, __compact__: false }));
        }
    };

    // SC panel → InventoryView: stage one item, stage all, or discard
    useEffect(() => {
        const handleStageAll = () => { void stageCompactChanges(); };
        const handleStageDraft = (e: Event) => {
            const sku = (e as CustomEvent<{sku: string}>).detail?.sku;
            if (!sku) return;
            const row = invToList(invState.inv || {}).find((r: any) => String(r.sku) === sku);
            if (row) void stageInventoryRow({ ...row, ...(draft[sku] || {}) });
        };
        const handleDiscardDraft = (e: Event) => {
            const sku = (e as CustomEvent<{sku: string}>).detail?.sku;
            if (!sku) return;
            setDraft((prev) => { const c = { ...prev }; delete c[sku]; return c; });
            setStagedValues((prev) => { const c = { ...prev }; delete c[sku]; return c; });
        };
        window.addEventListener("mjcc:stage-all-draft", handleStageAll);
        window.addEventListener("mjcc:stage-draft-item", handleStageDraft);
        window.addEventListener("mjcc:discard-draft-item", handleDiscardDraft);
        return () => {
            window.removeEventListener("mjcc:stage-all-draft", handleStageAll);
            window.removeEventListener("mjcc:stage-draft-item", handleStageDraft);
            window.removeEventListener("mjcc:discard-draft-item", handleDiscardDraft);
        };
    }, [draft, invState.inv]);

    const submitNewItem = async () => {
        const desc = newItem.desc.trim();
        if (!desc) {
            toast("Item description is required");
            return;
        }
        if (!newItem.category) {
            toast("Pick a category");
            return;
        }
        // Generate a SKU when the manager has no vendor SKU, so new rows don't
        // collide on the empty-string SKU upsert key (the backend keys on sku).
        const sku =
            newItem.sku.trim() || `MJC-${Date.now().toString(36).toUpperCase()}`;
        const numOr0 = (v: string) => Math.max(0, parseFloat(v) || 0);
        const payload = {
            month: period[0] + 1,
            year: period[1],
            notes: `New item · ${MONTHS[period[0]]} ${period[1]}`,
            items: [
                {
                    sku,
                    desc,
                    category: newItem.category,
                    onHand: numOr0(newItem.onHand),
                    par: numOr0(newItem.par),
                    price: numOr0(newItem.price),
                },
            ],
        };
        setAddBusy(true);
        try {
            await api.stageChange(
                "inventory_save",
                "inventory",
                sku,
                payload,
                `New item · ${desc}`,
            );
            toast(`Staged new item: ${desc}`);
            openSC?.();
            setShowAddItem(false);
            setNewItem(blankItem);
        } catch (e: any) {
            toast(`Failed to add item: ${e?.message || "Unknown error"}`);
        } finally {
            setAddBusy(false);
        }
    };

    const submitEditItem = async () => {
        if (!editTarget) return;
        const sku = String(editTarget.sku);
        const desc = editForm.desc.trim() || editTarget.desc;
        const numOrNull = (v: string) =>
            v === "" || v == null ? null : Math.max(0, parseFloat(v) || 0);
        const payload: any = { sku, desc };
        if (editForm.category) payload.category = editForm.category;
        const price = numOrNull(editForm.price);
        if (price !== null) payload.price = price;
        const par = numOrNull(editForm.par);
        if (par !== null) payload.par = par;

        if (lvl >= 40) {
            const newSku = editForm.sku.trim().toUpperCase();
            if (newSku && newSku !== sku) payload.new_sku = newSku;
            if (editForm.unit.trim()) payload.unit = editForm.unit.trim();
            payload.active = editForm.active;
        }

        setEditBusy(true);
        try {
            // Admin SKU rename: pre-check for conflicts before staging
            if (payload.new_sku) {
                const existing = await api.getInventoryItems({ sku: payload.new_sku });
                const conflict = existing.find((x: any) => x.id !== editTarget.id);
                if (conflict) {
                    setMergeDialog({
                        keepId: editTarget.id,
                        removeId: conflict.id,
                        keepSku: sku,
                        removeSku: payload.new_sku,
                        removeDesc: conflict.description || payload.new_sku,
                    });
                    return;
                }
            }
            await api.stageChange(
                "item_update",
                "inventory",
                sku,
                payload,
                `Edit item · ${desc}`,
            );
            toast(`Staged edit for ${desc}`);
            openSC?.();
            setEditTarget(null);
        } catch (e: any) {
            toast(`Failed to edit: ${e?.message || "Unknown error"}`);
        } finally {
            setEditBusy(false);
        }
    };

    const deleteEditItem = async () => {
        if (!editTarget) return;
        const sku = String(editTarget.sku);
        setEditBusy(true);
        try {
            await api.stageChange(
                "item_delete",
                "inventory",
                sku,
                { sku },
                `Delete item · ${editTarget.desc}`,
            );
            toast(`Staged delete for ${editTarget.desc}`);
            openSC?.();
            setEditTarget(null);
        } catch (e: any) {
            toast(`Failed to delete: ${e?.message || "Unknown error"}`);
        } finally {
            setEditBusy(false);
        }
    };

    // Dropdown options: API categories first (authoritative + ordered, includes
    // empty buckets like "New Items"), then any item-only categories not in it.
    // If both sources are empty (e.g. new period with no items, API error),
    // fall back to the canonical FALLBACK_CATS list so the dropdown is never blank.
    const catOptions = apiCatNames.length
        ? Array.from(new Set([...apiCatNames, ...cats]))
        : cats.length
            ? cats
            : FALLBACK_CATS;
    const filtered = rows.filter(
        (r: any) =>
            (!cat || r.cat === cat) &&
            (!q ||
                (r.desc || "").toLowerCase().includes(q.toLowerCase()) ||
                String(r.sku || "").includes(q)) &&
            (!triageFilter || r.needs_attention === true),
    );

    // Click a row body (but not its inline inputs/buttons) to open the
    // roster-style floating inspector for that item.
    const rowClick = (r: any) => (e: React.MouseEvent) => {
        if (!canStage) return;
        const t = e.target as HTMLElement;
        if (t.closest("input, button, select, a, label, textarea")) return;
        const sku = String(r.sku || "");
        setSelectedSkus((prev) => {
            const next = new Set(prev);
            if (next.has(sku)) next.delete(sku); else next.add(sku);
            return next;
        });
    };

    const stageDeleteSelected = async () => {
        const toDelete = rows.filter((r: any) => selectedSkus.has(String(r.sku)));
        await Promise.all(toDelete.map(async (row: any) => {
            const sku = String(row.sku);
            try {
                await api.stageChange("item_delete", "inventory", sku, { sku }, `Delete item · ${row.desc}`);
            } catch { /* silent per-item; toast at end */ }
        }));
        toast(`Staged delete for ${toDelete.length} item${toDelete.length !== 1 ? "s" : ""}`);
        setSelectedSkus(new Set());
        openSC?.();
    };

    const duplicateItem = async (row: any) => {
        const sku = `MJC-${Date.now().toString(36).toUpperCase()}`;
        const payload = {
            month: period[0] + 1, year: period[1],
            notes: `Duplicate · ${row.desc}`,
            items: [{ sku, desc: `${row.desc} (copy)`, category: row.cat, onHand: row.onHand, par: row.par, price: row.price }],
        };
        try {
            await api.stageChange("inventory_save", "inventory", sku, payload, `Duplicate · ${row.desc}`);
            toast(`Staged duplicate of ${row.desc}`);
            openSC?.();
        } catch (e: any) {
            toast(`Failed: ${e?.message || "Unknown error"}`);
        }
        setSelectedSkus(new Set());
    };

    const stageSelectedItems = async () => {
        const dirty = rows.filter((r: any) => draft[String(r.sku)] && selectedSkus.has(String(r.sku)));
        await Promise.all(dirty.map((r: any) => stageInventoryRow(r)));
        setSelectedSkus(new Set());
    };

    return (
        <div className="fade-in">
            <div className="page-head">
                <div>
                    <h2>Inventory</h2>
                    <div className="ph-sub">
                        {MONTHS[period[0]]} {period[1]} · {filtered.length} of{" "}
                        {rows.length} items
                    </div>
                </div>
                <div className="ph-actions">
                    <div className="view-toggle" role="tablist" aria-label="Inventory view">
                        <button
                            className={"vt-btn" + (viewMode === "regular" ? " active" : "")}
                            onClick={() => setViewMode("regular")}
                            role="tab"
                            aria-selected={viewMode === "regular"}
                        >
                            Regular
                        </button>
                        <button
                            className={"vt-btn" + (viewMode === "grouped" ? " active" : "")}
                            onClick={() => setViewMode("grouped")}
                            role="tab"
                            aria-selected={viewMode === "grouped"}
                        >
                            Grouped
                        </button>
                        <button
                            className={"vt-btn" + (viewMode === "compact" ? " active" : "")}
                            onClick={() => setViewMode("compact")}
                            role="tab"
                            aria-selected={viewMode === "compact"}
                        >
                            Compact
                        </button>
                    </div>
                    <button className="btn no-print" onClick={handlePrint}>
                        {I.printer({})} Print
                    </button>
                    <button className="btn no-print" onClick={onSync}>
                        {I.refresh()} Refresh
                    </button>
                    {lvl >= 30 && onPullSheet && (
                        <button className="btn" onClick={onPullSheet}>
                            {I.clipboard()} Pull Sheet
                        </button>
                    )}
                    {lvl >= 30 && (
                        <button
                            className="btn primary"
                            onClick={() => {
                                setNewItem(blankItem);
                                setShowAddItem(true);
                            }}
                        >
                            {I.plus()} Add item
                        </button>
                    )}
                </div>
            </div>

            {invState.loading && <Loading />}
            {invState.error && invState.error !== "empty" && (
                <div className="banner warn">
                    {I.alert()}
                    <span>Couldn't load live data: {invState.error}</span>
                    {/token|authorization|expired/i.test(invState.error) ? (
                        <span className="bx" onClick={() => { realLogout(); (window as any).__logout?.(); }}>
                            Sign out
                        </span>
                    ) : (
                        <span className="bx" onClick={onSync}>
                            Retry
                        </span>
                    )}
                </div>
            )}

            {invState.error === "empty" && !invState.loading && (
                <div className="card" style={{ marginBottom: 14 }}>
                    <div className="card-head">
                        <h3>{I.database()} Inventory needs a starting month</h3>
                        <span className="pill warn">No inventory data</span>
                    </div>
                    <div className="card-body">
                        <p style={{ margin: '0 0 12px', color: 'var(--muted)', lineHeight: 1.5 }}>
                            The live inventory is clean. Start by importing your {MONTHS[period[0]]} {period[1]} baseline or approved
                            full-month spreadsheet through Data Entry. The upload will stage changes in Source Control
                            for review before anything becomes inventory history.
                        </p>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <button className="btn primary" onClick={() => go?.('dataentry')}>
                                {I.inbox()} Open Data Entry
                            </button>
                            <button className="btn" onClick={() => openSC?.()}>
                                {I.branch()} Open Source Control
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {pendingDraftsCount > 0 && lvl < 30 && (
                <div className="banner warn" style={{ background: '#FEF3C7', borderColor: '#D97706', color: '#92400E' }}>
                    {I.alert()}
                    <span>
                        You have <strong>{pendingDraftsCount}</strong> staged change{pendingDraftsCount !== 1 ? 's' : ''} — submit for review when ready.
                    </span>
                    <span className="bx" onClick={() => openSC?.()}>
                        Open Source Control
                    </span>
                </div>
            )}

            {/* Rollover confirmation modal */}
            {showRollover && (
                <div className="overlay" onClick={() => !rolloverBusy && setShowRollover(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
                        <div className="modal-head">
                            <h3>{I.archive()} Publish Month &amp; Roll Forward</h3>
                            <div className="sub">Cannot be undone. Weekly data will be locked.</div>
                            <button className="modal-x" onClick={() => setShowRollover(false)} disabled={rolloverBusy} aria-label="Close">
                                {I.x()}
                            </button>
                        </div>
                        <div className="modal-body" style={{ padding: '16px 20px' }}>
                            <p style={{ margin: '0 0 12px', lineHeight: 1.5 }}>
                                This will <strong>publish {MONTHS[period[0]]} {period[1]}</strong> and create the opening balance for {MONTHS[(period[0] + 1) % 12]} {period[0] === 11 ? period[1] + 1 : period[1]}.
                            </p>
                            <p style={{ margin: 0, color: 'var(--muted)', fontSize: 12 }}>
                                This cannot be undone. All weekly data for this period will be locked permanently.
                            </p>
                        </div>
                        <div className="modal-foot" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '12px 20px' }}>
                            <button className="btn" onClick={() => setShowRollover(false)} disabled={rolloverBusy}>Cancel</button>
                            <button className="btn primary" onClick={doRollover} disabled={rolloverBusy}>
                                {rolloverBusy ? 'Publishing…' : 'Confirm Publish'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {invState.inv && (
                <div className="card">
                    <div
                        className="card-head"
                        style={{ gap: 10, flexWrap: "wrap" }}
                    >
                        <div
                            style={{
                                position: "relative",
                                flex: 1,
                                minWidth: 200,
                                maxWidth: 340,
                            }}
                        >
                            <span
                                style={{
                                    position: "absolute",
                                    left: 11,
                                    top: 8,
                                    color: "var(--muted)",
                                }}
                            >
                                {I.search({ style: { width: 16, height: 16 } })}
                            </span>
                            <input
                                value={q}
                                onChange={(e) => setQ(e.target.value)}
                                placeholder="Search SKU or description…"
                                style={{
                                    width: "100%",
                                    padding: "8px 12px 8px 34px",
                                    border: "1px solid var(--line)",
                                    borderRadius: 8,
                                    fontSize: 12.5,
                                }}
                            />
                        </div>
                        <select
                            className="btn"
                            value={cat}
                            onChange={(e) => setCat(e.target.value)}
                            style={{ paddingRight: 8 }}
                        >
                            <option value="">All categories</option>
                            {cats.map((c) => (
                                <option key={c} value={c}>
                                    {c}
                                </option>
                            ))}
                        </select>
                        {lvl >= 40 && (
                            <div style={{ display: "flex", gap: 4 }}>
                                {(() => {
                                    const attnCount = rows.filter((r: any) => r.needs_attention).length;
                                    return (
                                        <button
                                            className={"btn" + (triageFilter ? " primary" : "")}
                                            style={{ fontSize: 11, padding: "5px 8px" }}
                                            onClick={() => setTriageFilter(!triageFilter)}
                                            title="Show items needing attention — placeholder SKU or no real category"
                                        >
                                            Needs Attention
                                            {!triageFilter && attnCount > 0 && (
                                                <span className="sc-badge-count">{attnCount}</span>
                                            )}
                                        </button>
                                    );
                                })()}
                            </div>
                        )}
                    </div>
                    {/* ── Week selector — visible in all 3 modes ── */}
                    {(() => {
                        const visibleWeeks = Array.from({ length: Math.min(maxWeeks, 4) }, (_, i) => i + 1);
                        const lockIcon = (w: number) => {
                            const s = weekLockStatus[w];
                            return s === 'locked' ? ' (locked)' : s === 'published' ? ' (pub)' : '';
                        };
                        return (
                            <div style={{ padding: "2px 16px 8px", borderBottom: "1px solid var(--line)" }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                    <div className="tab-bar" style={{ marginBottom: 0, flex: 1 }}>
                                        {[
                                            { val: 0 as 0|1|2|3, label: "All weeks" },
                                            ...visibleWeeks.map((w) => ({
                                                val: w as 0|1|2|3,
                                                label: `Week ${w}${lockIcon(w)}`,
                                            })),
                                        ].map(({ val, label }) => (
                                            <button
                                                key={val}
                                                className={"tab-btn" + (compactWeek === val ? " active" : "")}
                                                onClick={() => setCompactWeek(val)}
                                            >
                                                {label}
                                            </button>
                                        ))}
                                    </div>
                                    {lvl >= 30 && compactWeek > 0 && (() => {
                                        const ws = weekLockStatus[compactWeek] || 'open';
                                        if (ws === 'published') return null;
                                        return (
                                            <button
                                                className="btn"
                                                style={{ fontSize: 11, padding: '4px 10px', whiteSpace: 'nowrap' }}
                                                disabled={weekLockBusy}
                                                onClick={async () => {
                                                    setWeekLockBusy(true);
                                                    try {
                                                        const newStatus = ws === 'locked' ? 'open' : 'locked';
                                                        await api.setWeekStatus(period[0] + 1, period[1], compactWeek, newStatus);
                                                        reloadWeekStatus();
                                                        toast(`Week ${compactWeek} ${newStatus === 'locked' ? 'locked' : 'unlocked'}.`);
                                                    } catch (e: any) {
                                                        toast(`Failed: ${e?.message || 'Error'}`);
                                                    } finally {
                                                        setWeekLockBusy(false);
                                                    }
                                                }}
                                            >
                                                {I.lock({ style: { width: 12, height: 12, marginRight: 5 } })}
                                                {ws === 'locked' ? 'Unlock' : 'Lock'} Week {compactWeek}
                                            </button>
                                        );
                                    })()}
                                    {lvl >= 30 && (
                                        <button
                                            className="btn"
                                            style={{ fontSize: 11, padding: '4px 10px', whiteSpace: 'nowrap' }}
                                            onClick={() => setShowRollover(true)}
                                            title="Publish this month and create the next period"
                                        >
                                            {I.check({ style: { width: 12, height: 12, marginRight: 5 } })}
                                            Publish Month
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })()}
                    {viewMode === "regular" && (
                    <div className="card-body flush tbl-wrap">
                        <table className="data">
                            <thead>
                                <tr>
                                    <th>SKU</th>
                                    <th>Description</th>
                                    <th>Category</th>
                                    <th className="r">Unit Price</th>
                                    <th className="r">On Hand</th>
                                    <th className="r">Par</th>
                                    <th>Status</th>
                                    <th className="r">Value</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map((r: any, i: number) => {
                                    const sku = String(r.sku || "");
                                    const staged = draft[sku];
                                    const onHand = staged?.onHand ?? stagedValues[sku]?.onHand ?? r.onHand;
                                    const par = staged?.par ?? stagedValues[sku]?.par ?? r.par;
                                    const isLow = onHand < par && par > 0;
                                    const rowValue = rowDisplayValue(r);
                                    return (
                                        <tr key={(r.sku || "") + i} className={"inv-row" + (selectedSkus.has(sku) ? " envo-selected" : "")} onClick={rowClick(r)}>
                                            <td
                                                className="num"
                                                style={{
                                                    color: "var(--muted)",
                                                }}
                                            >
                                                <span style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
                                                    {r.sku || "—"}
                                                    {r.needs_attention && (
                                                        <span className="pill warn" style={{ fontSize: 9 }}>Uncategorized</span>
                                                    )}
                                                </span>
                                            </td>
                                            <td style={{ fontWeight: 600 }}>
                                                {r.desc}
                                            </td>
                                            <td>
                                                <span
                                                    style={{
                                                        display: "inline-flex",
                                                        alignItems: "center",
                                                        gap: 6,
                                                    }}
                                                >
                                                    <span
                                                        style={{
                                                            width: 8,
                                                            height: 8,
                                                            borderRadius: 2,
                                                            background:
                                                                catColor(r.cat),
                                                        }}
                                                    ></span>
                                                    {r.cat}
                                                </span>
                                            </td>
                                            <td className="r num">
                                                ${(r.price || 0).toFixed(2)}
                                            </td>
                                            <td className="r num">
                                                {canStage ? (
                                                    <input
                                                        className="sheet-inp mobile-num-inp"
                                                        type="number"
                                                        min={0}
                                                        step="1"
                                                        value={onHand}
                                                        onChange={(e) =>
                                                            setDraftField(
                                                                sku,
                                                                "onHand",
                                                                e.target.value,
                                                                r.onHand,
                                                                r.par,
                                                            )
                                                        }
                                                        style={{
                                                            width: 70,
                                                            textAlign: "right",
                                                        }}
                                                    />
                                                ) : (
                                                    onHand
                                                )}
                                            </td>
                                            <td
                                                className="r num"
                                                style={{
                                                    color: "var(--muted)",
                                                }}
                                            >
                                                {canEditPar ? (
                                                    <input
                                                        className="sheet-inp mobile-num-inp"
                                                        type="number"
                                                        min={0}
                                                        step="1"
                                                        value={par}
                                                        onChange={(e) =>
                                                            setDraftField(
                                                                sku,
                                                                "par",
                                                                e.target.value,
                                                                r.onHand,
                                                                r.par,
                                                            )
                                                        }
                                                        style={{
                                                            width: 70,
                                                            textAlign: "right",
                                                        }}
                                                    />
                                                ) : (
                                                    par
                                                )}
                                            </td>
                                            <td>
                                                {isLow ? (
                                                    <span className="pill warn">
                                                        Below par
                                                    </span>
                                                ) : (
                                                    <span className="pill ok">
                                                        In stock
                                                    </span>
                                                )}
                                            </td>
                                            <td className="r num">
                                                {fmtMoneyFull(rowValue)}
                                            </td>
                                        </tr>
                                    );
                                })}
                                {!filtered.length && (
                                    <tr>
                                        <td
                                            colSpan={7}
                                            style={{
                                                textAlign: "center",
                                                padding: 30,
                                                color: "var(--muted)",
                                            }}
                                        >
                                            No items match your filters.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                    )}
                    {viewMode === "grouped" && (
                        <div className="card-body flush cat-secs">
                            {cats
                                .filter((c) => filtered.some((r: any) => r.cat === c))
                                .map((c) => {
                                    const items = filtered.filter(
                                        (r: any) => r.cat === c,
                                    );
                                    const catVal = items.reduce(
                                        (s: number, r: any) => s + rowDisplayValue(r),
                                        0,
                                    );
                                    const lowCount = items.filter((r: any) => {
                                        const sku = String(r.sku || "");
                                        const oh = draft[sku]?.onHand ?? stagedValues[sku]?.onHand ?? r.onHand;
                                        const pr = draft[sku]?.par ?? stagedValues[sku]?.par ?? r.par;
                                        return oh < pr && pr > 0;
                                    }).length;
                                    const open = !collapsed[c];
                                    return (
                                        <div className="cat-sec" key={c}>
                                            <button
                                                className="cat-sec-head"
                                                onClick={() => toggleCat(c)}
                                                aria-expanded={open}
                                            >
                                                <span className="csh-l">
                                                    <span
                                                        className="csh-dot"
                                                        style={{
                                                            background:
                                                                catColor(c),
                                                        }}
                                                    />
                                                    <span className="csh-name">
                                                        {c}
                                                    </span>
                                                    <span className="csh-cnt">
                                                        {items.length} item
                                                        {items.length !== 1
                                                            ? "s"
                                                            : ""}
                                                    </span>
                                                    {lowCount > 0 && (
                                                        <StatusPill warn className="csh-low">
                                                            {lowCount} below par
                                                        </StatusPill>
                                                    )}
                                                </span>
                                                <span className="csh-r">
                                                    <span className="csh-tot">
                                                        {fmtMoneyFull(catVal)}
                                                    </span>
                                                    <span className="csh-arr">
                                                        {open ? "▾" : "▸"}
                                                    </span>
                                                </span>
                                            </button>
                                            {open && (
                                                <div className="tbl-wrap">
                                                    <table className="data">
                                                        <thead>
                                                            <tr>
                                                                <th>SKU</th>
                                                                <th>
                                                                    Description
                                                                </th>
                                                                <th className="r">
                                                                    Unit Price
                                                                </th>
                                                                <th className="r">
                                                                    On Hand
                                                                </th>
                                                                <th className="r">
                                                                    Par
                                                                </th>
                                                                <th>Status</th>
                                                                <th className="r">
                                                                    Value
                                                                </th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {items.map(
                                                                (
                                                                    r: any,
                                                                    i: number,
                                                                ) => {
                                                                    const sku =
                                                                        String(
                                                                            r.sku ||
                                                                                "",
                                                                        );
                                                                    const staged =
                                                                        draft[
                                                                            sku
                                                                        ];
                                                                    const onHand =
                                                                        staged?.onHand ??
                                                                        stagedValues[sku]?.onHand ??
                                                                        r.onHand;
                                                                    const par =
                                                                        staged?.par ??
                                                                        stagedValues[sku]?.par ??
                                                                        r.par;
                                                                    const isLow =
                                                                        onHand <
                                                                            par &&
                                                                        par > 0;
                                                                    const rowValue =
                                                                        onHand *
                                                                        (r.price ||
                                                                            0);
                                                                    return (
                                                                        <tr
                                                                            key={
                                                                                (r.sku ||
                                                                                    "") +
                                                                                i
                                                                            }
                                                                            className={"inv-row" + (selectedSkus.has(sku) ? " envo-selected" : "")}
                                                                            onClick={rowClick(r)}
                                                                        >
                                                                            <td
                                                                                className="num"
                                                                                style={{
                                                                                    color: "var(--muted)",
                                                                                }}
                                                                            >
                                                                                <span style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
                                                                                    {r.sku || "—"}
                                                                                    {r.needs_attention && (
                                                                                        <span className="pill warn" style={{ fontSize: 9 }}>Uncategorized</span>
                                                                                    )}
                                                                                </span>
                                                                            </td>
                                                                            <td
                                                                                style={{
                                                                                    fontWeight: 600,
                                                                                }}
                                                                            >
                                                                                {
                                                                                    r.desc
                                                                                }
                                                                            </td>
                                                                            <td className="r num">
                                                                                $
                                                                                {(
                                                                                    r.price ||
                                                                                    0
                                                                                ).toFixed(
                                                                                    2,
                                                                                )}
                                                                            </td>
                                                                            <td className="r num">
                                                                                {canStage ? (
                                                                                    <input
                                                                                        className="sheet-inp mobile-num-inp"
                                                                                        type="number"
                                                                                        min={
                                                                                            0
                                                                                        }
                                                                                        step="1"
                                                                                        value={
                                                                                            onHand
                                                                                        }
                                                                                        onChange={(
                                                                                            e,
                                                                                        ) =>
                                                                                            setDraftField(
                                                                                                sku,
                                                                                                "onHand",
                                                                                                e
                                                                                                    .target
                                                                                                    .value,
                                                                                                r.onHand,
                                                                                                r.par,
                                                                                            )
                                                                                        }
                                                                                        style={{
                                                                                            width: 70,
                                                                                            textAlign:
                                                                                                "right",
                                                                                        }}
                                                                                    />
                                                                                ) : (
                                                                                    onHand
                                                                                )}
                                                                            </td>
                                                                            <td
                                                                                className="r num"
                                                                                style={{
                                                                                    color: "var(--muted)",
                                                                                }}
                                                                            >
                                                                                {canEditPar ? (
                                                                                    <input
                                                                                        className="sheet-inp mobile-num-inp"
                                                                                        type="number"
                                                                                        min={
                                                                                            0
                                                                                        }
                                                                                        step="1"
                                                                                        value={
                                                                                            par
                                                                                        }
                                                                                        onChange={(
                                                                                            e,
                                                                                        ) =>
                                                                                            setDraftField(
                                                                                                sku,
                                                                                                "par",
                                                                                                e
                                                                                                    .target
                                                                                                    .value,
                                                                                                r.onHand,
                                                                                                r.par,
                                                                                            )
                                                                                        }
                                                                                        style={{
                                                                                            width: 70,
                                                                                            textAlign:
                                                                                                "right",
                                                                                        }}
                                                                                    />
                                                                                ) : (
                                                                                    par
                                                                                )}
                                                                            </td>
                                                                            <td>
                                                                                {isLow ? (
                                                                                    <span className="pill warn">
                                                                                        Below
                                                                                        par
                                                                                    </span>
                                                                                ) : (
                                                                                    <span className="pill ok">
                                                                                        In
                                                                                        stock
                                                                                    </span>
                                                                                )}
                                                                            </td>
                                                                            <td className="r num">
                                                                                {fmtMoneyFull(
                                                                                    rowValue,
                                                                                )}
                                                                            </td>
                                                                        </tr>
                                                                    );
                                                                },
                                                            )}
                                                        </tbody>
                                                        <tfoot>
                                                            <tr className="inv-cat-total">
                                                                <td colSpan={4} />
                                                                <td className="r num" style={{ fontWeight: 700, color: "var(--muted)", fontSize: 11 }}>
                                                                    Total
                                                                </td>
                                                                <td />
                                                                <td className="r num" style={{ fontWeight: 700 }}>
                                                                    {fmtMoneyFull(catVal)}
                                                                </td>
                                                            </tr>
                                                        </tfoot>
                                                    </table>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            {!filtered.length && (
                                <div
                                    style={{
                                        textAlign: "center",
                                        padding: 30,
                                        color: "var(--muted)",
                                    }}
                                >
                                    No items match your filters.
                                </div>
                            )}
                        </div>
                    )}
                    {viewMode === "compact" && (
                        <div className="card-body flush cat-secs inv-compact">
                            {canStage &&
                                (() => {
                                    const dirtyCount = compactDirtyRows().length;
                                    return (
                                        <div
                                            className="compact-stagebar"
                                            style={{
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "space-between",
                                                gap: 10,
                                                flexWrap: "wrap",
                                                padding: "8px 12px",
                                                marginBottom: 8,
                                            }}
                                        >
                                            <span style={{ fontSize: 12, color: "var(--muted)" }}>
                                                {dirtyCount
                                                    ? `${dirtyCount} item${dirtyCount === 1 ? "" : "s"} edited`
                                                    : compactWeek > 0
                                                        ? "Enter received ↑ and/or issued ↓ quantities, then stage"
                                                        : "Enter on-hand quantities, then stage"}
                                            </span>
                                            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--ink)" }}>
                                                {compactWeek === 0 ? "Month save" : `W${compactWeek} — both directions staged`}
                                            </span>
                                        </div>
                                    );
                                })()}
                            {cats
                                .filter((c) =>
                                    filtered.some((r: any) => r.cat === c),
                                )
                                .map((c) => {
                                    const items = filtered.filter(
                                        (r: any) => r.cat === c,
                                    );
                                    const wk = (r: any, k: WeeklyField) =>
                                        wkDraft[String(r.sku || "")]?.[k] ??
                                        r[k] ??
                                        0;
                                    const rowTotal = (r: any) => {
                                        const sku = String(r.sku || "");
                                        if (!draft[sku] && !stagedValues[sku] && !wkDraft[sku] && typeof r.value === "number") return r.value;
                                        const oh = draft[sku]?.onHand ?? stagedValues[sku]?.onHand ?? r.onHand;
                                        const price = draft[sku]?.price ?? r.price ?? 0;
                                        const rcv = RECEIVED.reduce(
                                            (a, k) => a + wk(r, k),
                                            0,
                                        );
                                        const iss = PULLED.reduce(
                                            (a, k) => a + wk(r, k),
                                            0,
                                        );
                                        return (
                                            Math.max(0, oh + rcv - iss) *
                                            price
                                        );
                                    };
                                    const catVal = items.reduce(
                                        (s: number, r: any) => s + rowTotal(r),
                                        0,
                                    );
                                    const hasRcvd = items.some((r: any) =>
                                        RECEIVED.some((k) => wk(r, k) > 0),
                                    );
                                    const lowCount = items.filter((r: any) => {
                                        const sku = String(r.sku || "");
                                        const oh =
                                            draft[sku]?.onHand ?? stagedValues[sku]?.onHand ?? r.onHand;
                                        const pr = draft[sku]?.par ?? stagedValues[sku]?.par ?? r.par;
                                        return oh < pr && pr > 0;
                                    }).length;
                                    const open = !collapsed[c];
                                    return (
                                        <div className="cat-sec" key={c}>
                                            <button
                                                className="cat-sec-head"
                                                onClick={() => toggleCat(c)}
                                                aria-expanded={open}
                                            >
                                                <span className="csh-l">
                                                    <span
                                                        className="csh-dot"
                                                        style={{
                                                            background:
                                                                catColor(c),
                                                        }}
                                                    />
                                                    <span className="csh-name">
                                                        {c}
                                                    </span>
                                                    <span className="csh-cnt">
                                                        {items.length} item
                                                        {items.length !== 1
                                                            ? "s"
                                                            : ""}
                                                    </span>
                                                    {hasRcvd && (
                                                        <span className="pill ok csh-low">
                                                            🚚 received
                                                        </span>
                                                    )}
                                                    {lowCount > 0 && (
                                                        <StatusPill warn className="csh-low">
                                                            {lowCount} below par
                                                        </StatusPill>
                                                    )}
                                                </span>
                                                <span className="csh-r">
                                                    <span className="csh-tot">
                                                        {fmtMoneyFull(catVal)}
                                                    </span>
                                                    <span className="csh-arr">
                                                        {open ? "▾" : "▸"}
                                                    </span>
                                                </span>
                                            </button>
                                            {open && (
                                                <div className="tbl-wrap">
                                                    <table className="data compact">
                                                        <thead>
                                                            <tr>
                                                                <th>
                                                                    Description
                                                                </th>
                                                                <th>SKU</th>
                                                                <th className="r">
                                                                    On hand
                                                                </th>
                                                                <th className="r">
                                                                    Price ($)
                                                                </th>
                                                                <th className="r">
                                                                    Par
                                                                </th>
                                                                {compactWeek === 0 ? (
                                                                    <>
                                                                        {Array.from({ length: maxWeeks }, (_, i) => (
                                                                            <th key={`i${i}`} className="r">W{i+1}↓</th>
                                                                        ))}
                                                                        {Array.from({ length: maxWeeks }, (_, i) => (
                                                                            <th key={`r${i}`} className="r wk-rcv">W{i+1}↑</th>
                                                                        ))}
                                                                    </>
                                                                ) : (
                                                                    <>
                                                                        <th className="r">W{compactWeek}↓ Issued</th>
                                                                        <th className="r wk-rcv">W{compactWeek}↑ Received</th>
                                                                    </>
                                                                )}
                                                                <th className="r">
                                                                    Total $
                                                                </th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {items.map(
                                                                (
                                                                    r: any,
                                                                    i: number,
                                                                ) => {
                                                                    const sku =
                                                                        String(
                                                                            r.sku ||
                                                                                "",
                                                                        );
                                                                    const oh =
                                                                        draft[
                                                                            sku
                                                                        ]
                                                                            ?.onHand ??
                                                                        stagedValues[sku]?.onHand ??
                                                                        r.onHand;
                                                                    const par =
                                                                        draft[
                                                                            sku
                                                                        ]?.par ??
                                                                        stagedValues[sku]?.par ??
                                                                        r.par;
                                                                    const rcv =
                                                                        RECEIVED.some(
                                                                            (k) =>
                                                                                wk(
                                                                                    r,
                                                                                    k,
                                                                                ) >
                                                                                0,
                                                                        );
                                                                    return (
                                                                        <tr
                                                                            key={
                                                                                (r.sku ||
                                                                                    "") +
                                                                                i
                                                                            }
                                                                            className={
                                                                                "inv-row" +
                                                                                (rcv
                                                                                    ? " rcvd"
                                                                                    : "")
                                                                            }
                                                                            onClick={rowClick(r)}
                                                                        >
                                                                            <td
                                                                                style={{
                                                                                    fontWeight: 600,
                                                                                }}
                                                                            >
                                                                                {
                                                                                    r.desc
                                                                                }
                                                                            </td>
                                                                            <td
                                                                                className="num"
                                                                                style={{
                                                                                    color: "var(--muted)",
                                                                                }}
                                                                            >
                                                                                <span style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
                                                                                    {r.sku || "—"}
                                                                                    {r.needs_attention && (
                                                                                        <span className="pill warn" style={{ fontSize: 9 }}>Uncategorized</span>
                                                                                    )}
                                                                                </span>
                                                                            </td>
                                                                            <td className="r num" data-label="On hand">
                                                                                {canStage ? (
                                                                                    <input
                                                                                        className="cinp"
                                                                                        type="number"
                                                                                        min={
                                                                                            0
                                                                                        }
                                                                                        value={
                                                                                            oh
                                                                                        }
                                                                                        onFocus={cinpFocus}
                                                                                        onKeyDown={cinpKeyDown}
                                                                                        onChange={(
                                                                                            e,
                                                                                        ) =>
                                                                                            setDraftField(
                                                                                                sku,
                                                                                                "onHand",
                                                                                                e
                                                                                                    .target
                                                                                                    .value,
                                                                                                r.onHand,
                                                                                                r.par,
                                                                                            )
                                                                                        }
                                                                                    />
                                                                                ) : (
                                                                                    oh
                                                                                )}
                                                                            </td>
                                                                            <td className="r num" data-label="Price ($)">
                                                                                {canEditPar ? (
                                                                                    <input
                                                                                        className="cinp"
                                                                                        type="number"
                                                                                        min={0}
                                                                                        step="0.01"
                                                                                        value={(draft[sku]?.price ?? r.price ?? 0).toFixed(2)}
                                                                                        onFocus={cinpFocus}
                                                                                        onKeyDown={cinpKeyDown}
                                                                                        onChange={(e) => setPriceField(sku, e.target.value, r.price ?? 0)}
                                                                                    />
                                                                                ) : (
                                                                                    `$${(r.price || 0).toFixed(2)}`
                                                                                )}
                                                                            </td>
                                                                            <td className="r num" data-label="Par">
                                                                                {canEditPar ? (
                                                                                    <input
                                                                                        className="cinp"
                                                                                        type="number"
                                                                                        min={
                                                                                            0
                                                                                        }
                                                                                        value={
                                                                                            par
                                                                                        }
                                                                                        onFocus={cinpFocus}
                                                                                        onKeyDown={cinpKeyDown}
                                                                                        onChange={(
                                                                                            e,
                                                                                        ) =>
                                                                                            setDraftField(
                                                                                                sku,
                                                                                                "par",
                                                                                                e
                                                                                                    .target
                                                                                                    .value,
                                                                                                r.onHand,
                                                                                                r.par,
                                                                                            )
                                                                                        }
                                                                                    />
                                                                                ) : (
                                                                                    par
                                                                                )}
                                                                            </td>
                                                                            {compactWeek === 0 ? (
                                                                                <>
                                                                                    {PULLED.map((k) => {
                                                                                        const wNum = parseInt(k[1]);
                                                                                        const locked = (weekLockStatus[wNum] || 'open') !== 'open';
                                                                                        const canEditIssued = canStage && lvl >= 30 && !locked;
                                                                                        return (
                                                                                            <td className="r num" key={k} data-label={`W${k[1]}↓`}>
                                                                                                {canEditIssued ? (
                                                                                                    <input className="cinp" type="number" min={0}
                                                                                                        value={wk(r, k)}
                                                                                                        onFocus={cinpFocus}
                                                                                                        onKeyDown={cinpKeyDown}
                                                                                                        onChange={(e) => setWeeklyField(sku, k, e.target.value)} />
                                                                                                ) : (
                                                                                                    <span title={lvl < 30 ? 'Manager only' : locked ? 'Week locked' : undefined}>
                                                                                                        {wk(r, k)}
                                                                                                    </span>
                                                                                                )}
                                                                                            </td>
                                                                                        );
                                                                                    })}
                                                                                    {RECEIVED.map((k) => {
                                                                                        const wNum = parseInt(k[1]);
                                                                                        const locked = (weekLockStatus[wNum] || 'open') !== 'open';
                                                                                        const canEditRcv = canStage && !locked;
                                                                                        return (
                                                                                            <td className="r num wk-rcv" key={k} data-label={`W${k[1]}↑`}>
                                                                                                {canEditRcv ? (
                                                                                                    <input className="cinp wk-rcv-inp" type="number" min={0}
                                                                                                        value={wk(r, k)}
                                                                                                        onFocus={cinpFocus}
                                                                                                        onKeyDown={cinpKeyDown}
                                                                                                        onChange={(e) => setWeeklyField(sku, k, e.target.value)} />
                                                                                                ) : wk(r, k)}
                                                                                            </td>
                                                                                        );
                                                                                    })}
                                                                                </>
                                                                            ) : (
                                                                                <>
                                                                                    {(() => {
                                                                                        const weekLocked = (weekLockStatus[compactWeek] || 'open') !== 'open';
                                                                                        const canEditIssued = canStage && lvl >= 30 && !weekLocked;
                                                                                        const canEditRcv = canStage && !weekLocked;
                                                                                        return (
                                                                                            <>
                                                                                                <td className="r num" data-label={`W${compactWeek}↓ Issued`}>
                                                                                                    {canEditIssued ? (
                                                                                                        <input className="cinp" type="number" min={0}
                                                                                                            value={wk(r, PULLED[compactWeek - 1])}
                                                                                                            onFocus={cinpFocus}
                                                                                                            onKeyDown={cinpKeyDown}
                                                                                                            onChange={(e) => setWeeklyField(sku, PULLED[compactWeek - 1], e.target.value)} />
                                                                                                    ) : (
                                                                                                        <span title={lvl < 30 ? 'Manager only' : weekLocked ? 'Week locked' : undefined}>
                                                                                                            {wk(r, PULLED[compactWeek - 1])}
                                                                                                        </span>
                                                                                                    )}
                                                                                                </td>
                                                                                                <td className="r num wk-rcv" data-label={`W${compactWeek}↑ Rcvd`}>
                                                                                                    {canEditRcv ? (
                                                                                                        <input className="cinp wk-rcv-inp" type="number" min={0}
                                                                                                            value={wk(r, RECEIVED[compactWeek - 1])}
                                                                                                            onFocus={cinpFocus}
                                                                                                            onKeyDown={cinpKeyDown}
                                                                                                            onChange={(e) => setWeeklyField(sku, RECEIVED[compactWeek - 1], e.target.value)} />
                                                                                                    ) : wk(r, RECEIVED[compactWeek - 1])}
                                                                                                </td>
                                                                                            </>
                                                                                        );
                                                                                    })()}
                                                                                </>
                                                                            )}
                                                                            <td
                                                                                className="r num"
                                                                                data-label="Total $"
                                                                                style={{
                                                                                    fontWeight: 700,
                                                                                }}
                                                                            >
                                                                                {fmtMoneyFull(
                                                                                    rowTotal(
                                                                                        r,
                                                                                    ),
                                                                                )}
                                                                            </td>
                                                                        </tr>
                                                                    );
                                                                },
                                                            )}
                                                        </tbody>
                                                        <tfoot>
                                                            <tr>
                                                                <td colSpan={5}>
                                                                    {lvl >= 30 && (
                                                                        <button
                                                                            className="btn-add-row"
                                                                            onClick={() => {
                                                                                setNewItem(
                                                                                    {
                                                                                        ...blankItem,
                                                                                        category:
                                                                                            c,
                                                                                    },
                                                                                );
                                                                                setShowAddItem(
                                                                                    true,
                                                                                );
                                                                            }}
                                                                        >
                                                                            {I.plus()}{" "}
                                                                            Add
                                                                            item
                                                                        </button>
                                                                    )}
                                                                </td>
                                                                <td
                                                                    className="r num"
                                                                    colSpan={compactWeek === 0 ? maxWeeks * 2 + 1 : 3}
                                                                    style={{
                                                                        fontWeight: 700,
                                                                    }}
                                                                >
                                                                    {fmtMoneyFull(
                                                                        catVal,
                                                                    )}
                                                                </td>
                                                            </tr>
                                                        </tfoot>
                                                    </table>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            {!filtered.length && (
                                <div
                                    style={{
                                        textAlign: "center",
                                        padding: 30,
                                        color: "var(--muted)",
                                    }}
                                >
                                    No items match your filters.
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
            {canStage && selectedSkus.size === 0 && (
                <SaveBar
                    dirtyCount={Object.keys(draft).length + Object.keys(wkDraft).length}
                    saved={(Object.keys(draft).length + Object.keys(wkDraft).length) === 0}
                    canEdit={canStage}
                    onSave={saveDraftLocally}
                    onStage={() => { void stageCompactChanges(); }}
                    onPush={openSC}
                    note={
                        <span className="formbar-meta">
                            {MONTHS[period[0]]} {period[1]}
                            {(Object.keys(draft).length + Object.keys(wkDraft).length) > 0 && (
                                <> · {Object.keys(draft).length + Object.keys(wkDraft).length} item{(Object.keys(draft).length + Object.keys(wkDraft).length) !== 1 ? "s" : ""} edited</>
                            )}
                        </span>
                    }
                />
            )}
            {canStage && showAddItem && (
                <div
                    className="overlay"
                    onClick={() => !addBusy && setShowAddItem(false)}
                >
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-head">
                            <div>
                                <h3>{I.plus()} Add inventory item</h3>
                                <div className="sub">
                                    Stages a new item to Source Control for{" "}
                                    {MONTHS[period[0]]} {period[1]}.
                                </div>
                            </div>
                            <button
                                className="modal-x"
                                onClick={() => setShowAddItem(false)}
                                disabled={addBusy}
                                aria-label="Close"
                            >
                                {I.x()}
                            </button>
                        </div>
                        <div className="modal-body">
                            <div className="field">
                                <label>Description *</label>
                                <input
                                    className="ipt"
                                    autoFocus
                                    value={newItem.desc}
                                    placeholder="e.g. RICE, LONG GRAIN 50LB"
                                    onChange={(e) =>
                                        setNewItem((p) => ({
                                            ...p,
                                            desc: e.target.value,
                                        }))
                                    }
                                />
                            </div>
                            <div className="field">
                                <label>Category *</label>
                                <select
                                    className="ipt sel"
                                    value={newItem.category}
                                    onChange={(e) =>
                                        setNewItem((p) => ({
                                            ...p,
                                            category: e.target.value,
                                        }))
                                    }
                                >
                                    <option value="">Select a category…</option>
                                    {(catOptions || []).map((c) => (
                                        <option key={c} value={c}>
                                            {c}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="grid-2" style={{ gap: 12 }}>
                                <div className="field">
                                    <label>SKU (optional)</label>
                                    <input
                                        className="ipt mono"
                                        value={newItem.sku}
                                        placeholder="auto if blank"
                                        onChange={(e) =>
                                            setNewItem((p) => ({
                                                ...p,
                                                sku: e.target.value,
                                            }))
                                        }
                                    />
                                </div>
                                <div className="field">
                                    <label>Unit price ($)</label>
                                    <input
                                        className="ipt mono"
                                        type="number"
                                        min={0}
                                        step="0.01"
                                        value={newItem.price}
                                        placeholder="0.00"
                                        onChange={(e) =>
                                            setNewItem((p) => ({
                                                ...p,
                                                price: e.target.value,
                                            }))
                                        }
                                    />
                                </div>
                            </div>
                            <div className="grid-2" style={{ gap: 12 }}>
                                <div className="field">
                                    <label>On hand</label>
                                    <input
                                        className="ipt mono"
                                        type="number"
                                        min={0}
                                        value={newItem.onHand}
                                        placeholder="0"
                                        onChange={(e) =>
                                            setNewItem((p) => ({
                                                ...p,
                                                onHand: e.target.value,
                                            }))
                                        }
                                    />
                                </div>
                                <div className="field">
                                    <label>Par level</label>
                                    <input
                                        className="ipt mono"
                                        type="number"
                                        min={0}
                                        value={newItem.par}
                                        placeholder="0"
                                        onChange={(e) =>
                                            setNewItem((p) => ({
                                                ...p,
                                                par: e.target.value,
                                            }))
                                        }
                                    />
                                </div>
                            </div>
                        </div>
                        <div className="modal-foot">
                            <button
                                className="btn"
                                onClick={() => setShowAddItem(false)}
                                disabled={addBusy}
                            >
                                Cancel
                            </button>
                            <button
                                className="btn primary"
                                onClick={submitNewItem}
                                disabled={addBusy}
                            >
                                {addBusy ? "Staging…" : "Add item"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {mergeDialog && (
                <div className="overlay" onClick={() => !mergeBusy && setMergeDialog(null)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
                        <div className="modal-head">
                            <div>
                                <h3>Merge items?</h3>
                                <div className="sub">
                                    SKU <span className="mono">{mergeDialog.removeSku}</span> belongs to another item
                                </div>
                            </div>
                            <button className="modal-x" onClick={() => setMergeDialog(null)} disabled={mergeBusy}>
                                {I.x()}
                            </button>
                        </div>
                        <div className="modal-body">
                            <p style={{ marginBottom: 0, lineHeight: 1.6 }}>
                                <b>{mergeDialog.removeDesc}</b> already uses SKU{" "}
                                <span className="mono">{mergeDialog.removeSku}</span>.
                                Merging will consolidate it into{" "}
                                <span className="mono">{mergeDialog.keepSku}</span> and
                                remove the duplicate. This action cannot be undone.
                            </p>
                        </div>
                        <div className="modal-foot">
                            <button className="btn" onClick={() => setMergeDialog(null)} disabled={mergeBusy}>
                                Cancel
                            </button>
                            <button
                                className="btn primary"
                                disabled={mergeBusy}
                                onClick={async () => {
                                    setMergeBusy(true);
                                    try {
                                        await api.mergeInventoryItems(mergeDialog.keepId, mergeDialog.removeId);
                                        toast(`Merged ${mergeDialog.removeDesc} → ${mergeDialog.keepSku}`);
                                        setMergeDialog(null);
                                        setEditTarget(null);
                                        onSync();
                                    } catch (e: any) {
                                        toast(`Merge failed: ${e?.message || "Unknown error"}`);
                                    } finally {
                                        setMergeBusy(false);
                                    }
                                }}
                            >
                                {mergeBusy ? "Merging…" : "Merge items"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {canStage && editTarget && (
                <div
                    className="overlay"
                    onClick={() => !editBusy && setEditTarget(null)}
                >
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-head">
                            <div>
                                <h3>{I.plus()} Edit item</h3>
                                <div className="sub">
                                    <span className="mono">
                                        {editTarget.sku}
                                    </span>{" "}
                                    · stages an edit to Source Control. Reassign
                                    the category to move it out of New Items.
                                </div>
                            </div>
                            <button
                                className="modal-x"
                                onClick={() => setEditTarget(null)}
                                disabled={editBusy}
                                aria-label="Close"
                            >
                                {I.x()}
                            </button>
                        </div>
                        <div className="modal-body">
                            <div className="field">
                                <label>Description</label>
                                <input
                                    className="ipt"
                                    autoFocus
                                    value={editForm.desc}
                                    onChange={(e) =>
                                        setEditForm((p) => ({
                                            ...p,
                                            desc: e.target.value,
                                        }))
                                    }
                                />
                            </div>
                            <div className="field">
                                <label>Category (reassign)</label>
                                {editTarget.suggested_category && (
                                    <div
                                        className="banner info"
                                        style={{ margin: "0 0 8px" }}
                                    >
                                        {I.alert()}
                                        <span>
                                            Parser suggests{" "}
                                            <b>{editTarget.suggested_category}</b>{" "}
                                            from the invoice — pre-selected below.
                                            Confirm or change it, then Save.
                                        </span>
                                    </div>
                                )}
                                <select
                                    className="ipt sel"
                                    value={editForm.category}
                                    onChange={(e) =>
                                        setEditForm((p) => ({
                                            ...p,
                                            category: e.target.value,
                                        }))
                                    }
                                >
                                    {(catOptions || []).map((c) => (
                                        <option key={c} value={c}>
                                            {c}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="grid-2" style={{ gap: 12 }}>
                                <div className="field">
                                    <label>Unit price ($)</label>
                                    <input
                                        className="ipt mono"
                                        type="number"
                                        min={0}
                                        step="0.01"
                                        value={editForm.price}
                                        onChange={(e) =>
                                            setEditForm((p) => ({
                                                ...p,
                                                price: e.target.value,
                                            }))
                                        }
                                    />
                                </div>
                                <div className="field">
                                    <label>Par level</label>
                                    <input
                                        className="ipt mono"
                                        type="number"
                                        min={0}
                                        value={editForm.par}
                                        onChange={(e) =>
                                            setEditForm((p) => ({
                                                ...p,
                                                par: e.target.value,
                                            }))
                                        }
                                    />
                                </div>
                            </div>
                            {lvl >= 40 && (
                                <>
                                    <div className="grid-2" style={{ gap: 12 }}>
                                        <div className="field">
                                            <label>SKU (rename)</label>
                                            <input
                                                className="ipt mono"
                                                value={editForm.sku}
                                                onChange={(e) =>
                                                    setEditForm((p) => ({
                                                        ...p,
                                                        sku: e.target.value.toUpperCase(),
                                                    }))
                                                }
                                                placeholder={editTarget.sku}
                                            />
                                        </div>
                                        <div className="field">
                                            <label>Unit</label>
                                            <input
                                                className="ipt"
                                                value={editForm.unit}
                                                onChange={(e) =>
                                                    setEditForm((p) => ({
                                                        ...p,
                                                        unit: e.target.value,
                                                    }))
                                                }
                                                placeholder="e.g. case, ea"
                                            />
                                        </div>
                                    </div>
                                    <div className="field">
                                        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                                            <input
                                                type="checkbox"
                                                checked={editForm.active}
                                                onChange={(e) =>
                                                    setEditForm((p) => ({
                                                        ...p,
                                                        active: e.target.checked,
                                                    }))
                                                }
                                            />
                                            Item is active
                                        </label>
                                    </div>
                                </>
                            )}
                        </div>
                        <div className="modal-foot">
                            <button
                                className="btn"
                                onClick={deleteEditItem}
                                disabled={editBusy}
                                title="Soft-delete (deactivate) this item"
                                style={{
                                    marginRight: "auto",
                                    color: "var(--red)",
                                    borderColor: "var(--red)",
                                }}
                            >
                                Delete
                            </button>
                            <button
                                className="btn"
                                onClick={() => setEditTarget(null)}
                                disabled={editBusy}
                            >
                                Cancel
                            </button>
                            <button
                                className="btn primary"
                                onClick={submitEditItem}
                                disabled={editBusy}
                            >
                                {editBusy ? "Staging…" : "Save changes"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Envo floating selection bar — portalled to body to escape stacking contexts */}
            {canStage && selectedSkus.size > 0 && createPortal((() => {
                const selRows = rows.filter((r: any) => selectedSkus.has(String(r.sku || "")));
                const first = selRows[0];
                const hasDraft = selRows.some((r: any) => !!draft[String(r.sku)]);
                return (
                    <div className="envo-bar">
                        <span className="envo-bar-count">{selectedSkus.size} item{selectedSkus.size !== 1 ? "s" : ""}</span>
                        {first && (
                            <button className="btn" style={{ borderRadius: 100 }} onClick={() => { setInspectTarget(first); setSelectedSkus(new Set()); }}>
                                {I.edit({ style: { width: 13, height: 13 } })} Edit
                            </button>
                        )}
                        {selRows.length === 1 && first && (
                            <button className="btn" style={{ borderRadius: 100 }} onClick={() => duplicateItem(first)}>
                                {I.plus({ style: { width: 13, height: 13 } })} Duplicate
                            </button>
                        )}
                        <button className="btn" style={{ borderRadius: 100, color: "var(--red, #dc2626)" }} onClick={stageDeleteSelected}>
                            {I.del({ style: { width: 13, height: 13 } })} Delete
                        </button>
                        <button className="btn primary" style={{ borderRadius: 100 }} onClick={stageSelectedItems} disabled={!hasDraft}>
                            {I.branch({ style: { width: 13, height: 13 } })} Stage
                        </button>
                        <button className="sc-icon-btn" onClick={() => setSelectedSkus(new Set())} title="Clear selection" style={{ marginLeft: 2 }}>
                            {I.x({ style: { width: 12, height: 12 } })}
                        </button>
                    </div>
                );
            })(), document.body)}

            {/* Roster-style item inspector — floating per-item toolbar */}
            {canStage && inspectTarget && (
                <ItemInspector
                    row={inspectTarget}
                    period={period}
                    lvl={lvl}
                    maxWeeks={maxWeeks}
                    weekLockStatus={weekLockStatus}
                    initialWeek={compactWeek || 1}
                    onClose={() => setInspectTarget(null)}
                    onStaged={() => { openSC?.(); }}
                    onSync={onSync}
                    onEditDetails={(r) => openEdit(r)}
                />
            )}

            {/* Category management — manager+ only */}
            {canEditPar && (
                <CategoryManager onChanged={reloadCatNames} />
            )}
        </div>
    );
}

function CategoryManager({ onChanged }: { onChanged?: () => void }) {
    const [cats, setCats] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);
    const [editing, setEditing] = useState<Record<string, { name: string; sort_order: string }>>({});
    const [editBusy, setEditBusy] = useState<Record<string, boolean>>({});
    const [delBusy, setDelBusy] = useState<Record<string, boolean>>({});
    const [newName, setNewName] = useState('');
    const [addBusy, setAddBusy] = useState(false);
    const [addErr, setAddErr] = useState<string | null>(null);

    const load = useCallback(() => {
        setLoading(true);
        setErr(null);
        api.getInventoryCategories()
            .then(data => { setCats(data || []); })
            .catch(e => { setErr(e?.message || 'Failed to load categories'); })
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => { load(); }, [load]);

    const startEdit = (cat: any) =>
        setEditing(p => ({ ...p, [cat.id]: { name: cat.name, sort_order: String(cat.sort_order ?? '') } }));
    const cancelEdit = (id: string) =>
        setEditing(p => { const n = { ...p }; delete n[id]; return n; });

    const saveEdit = async (cat: any) => {
        const vals = editing[cat.id];
        if (!vals) return;
        setEditBusy(p => ({ ...p, [cat.id]: true }));
        try {
            const sortVal = vals.sort_order !== '' ? +vals.sort_order : undefined;
            await api.updateCategory(cat.id, vals.name, sortVal);
            cancelEdit(cat.id);
            load();
            onChanged?.();
        } catch (e: any) {
            setErr(e?.message || 'Save failed');
        } finally {
            setEditBusy(p => ({ ...p, [cat.id]: false }));
        }
    };

    const doDelete = async (cat: any) => {
        if (!window.confirm(`Delete category "${cat.name}"? This cannot be undone.`)) return;
        setDelBusy(p => ({ ...p, [cat.id]: true }));
        try {
            await api.deleteCategory(cat.id);
            load();
            onChanged?.();
        } catch (e: any) {
            setErr(e?.message || 'Delete failed');
        } finally {
            setDelBusy(p => ({ ...p, [cat.id]: false }));
        }
    };

    const doAdd = async () => {
        if (!newName.trim()) return;
        setAddBusy(true);
        setAddErr(null);
        try {
            await api.createCategory(newName.trim());
            setNewName('');
            load();
            onChanged?.();
        } catch (e: any) {
            setAddErr(e?.message || 'Add failed');
        } finally {
            setAddBusy(false);
        }
    };

    return (
        <WinCard title="Category management" defaultOpen={false} style={{ marginTop: 16 }}>
            {loading && <div style={{ padding: '12px 0', color: 'var(--muted)', fontSize: 12 }}>Loading…</div>}
            {err && <div className="banner warn" style={{ marginBottom: 10 }}>{I.alert()} <span>{err}</span></div>}
            {!loading && (
                <table className="data" style={{ marginBottom: 14 }}>
                    <thead>
                        <tr><th>Name</th><th className="r" style={{ width: 80 }}>Order</th><th></th></tr>
                    </thead>
                    <tbody>
                        {cats.map(cat => {
                            const isEditing = !!editing[cat.id];
                            const isNew = cat.name === 'New Items';
                            return (
                                <tr key={cat.id}>
                                    <td>
                                        {isEditing ? (
                                            <input
                                                className="sheet-inp"
                                                value={editing[cat.id].name}
                                                onChange={e => setEditing(p => ({ ...p, [cat.id]: { ...p[cat.id], name: e.target.value } }))}
                                                style={{ width: '100%', minWidth: 120 }}
                                                autoFocus
                                            />
                                        ) : (
                                            <span style={{ fontWeight: 600 }}>{cat.name}</span>
                                        )}
                                        {isNew && <span className="pill warn" style={{ marginLeft: 6, fontSize: 10 }}>review bucket</span>}
                                    </td>
                                    <td className="r">
                                        {isEditing ? (
                                            <input
                                                className="sheet-inp"
                                                type="number"
                                                value={editing[cat.id].sort_order}
                                                onChange={e => setEditing(p => ({ ...p, [cat.id]: { ...p[cat.id], sort_order: e.target.value } }))}
                                                style={{ width: 60, textAlign: 'right' }}
                                            />
                                        ) : (
                                            <span style={{ color: 'var(--muted)', fontSize: 12 }}>{cat.sort_order}</span>
                                        )}
                                    </td>
                                    <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                                        {isEditing ? (
                                            <>
                                                <button className="btn primary" style={{ fontSize: 11, padding: '3px 10px', marginRight: 4 }} onClick={() => saveEdit(cat)} disabled={editBusy[cat.id]}>
                                                    {editBusy[cat.id] ? '…' : 'Save'}
                                                </button>
                                                <button className="btn" style={{ fontSize: 11, padding: '3px 10px' }} onClick={() => cancelEdit(cat.id)}>Cancel</button>
                                            </>
                                        ) : (
                                            <>
                                                <button className="btn" style={{ fontSize: 11, padding: '3px 10px', marginRight: 4 }} onClick={() => startEdit(cat)}>Rename</button>
                                                {!isNew && (
                                                    <button className="btn" style={{ fontSize: 11, padding: '3px 10px', color: 'var(--red)', borderColor: 'var(--red)' }} onClick={() => doDelete(cat)} disabled={delBusy[cat.id]}>
                                                        {delBusy[cat.id] ? '…' : 'Delete'}
                                                    </button>
                                                )}
                                            </>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            )}
            {/* Add new category */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                    className="sheet-inp"
                    placeholder="New category name…"
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') doAdd(); }}
                    style={{ flex: 1 }}
                />
                <button className="btn primary" onClick={doAdd} disabled={addBusy || !newName.trim()} style={{ minHeight: 36 }}>
                    {addBusy ? '…' : '+ Add'}
                </button>
            </div>
            {addErr && <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 6 }}>{addErr}</div>}
        </WinCard>
    );
}

function UsersView({ user: currentUser }: { user: User }) {
    const isSudo = currentUser.role === 'sudo';
    const currentLevel = ROLE_LEVEL[currentUser.role] || 0;
    const canManageStaff = currentLevel >= 30;
    const blankForm = {
        username: "",
        email: "",
        display_name: "",
        last_name: "",
        role: "staff",
        pin: "",
        password: "",
        active: true,
        phone: "",
        job_title: "",
        bio: "",
        avatar_url: "",
        new_username: "",
        new_password: "",
    };
    const [state, setState] = useState({
        loading: true,
        users: null as any[] | null,
        error: null as string | null,
    });
    const [form, setForm] = useState(blankForm);
    const [editing, setEditing] = useState<any | null>(null);
    const [showForm, setShowForm] = useState(false);
    const [saving, setSaving] = useState(false);
    const [credentialView, setCredentialView] = useState<any | null>(null);
    const [loadingCredentials, setLoadingCredentials] = useState<string | null>(null);
    const [roleScopes, setRoleScopes] = useState<Record<string, string[]> | null>(null);
    const [availableScopes, setAvailableScopes] = useState<string[]>([]);
    const [savingScopes, setSavingScopes] = useState(false);
    useEscapeClose(showForm, () => setShowForm(false), saving);

    const loadUsers = useCallback(async () => {
        setState({ loading: true, users: null, error: null });
        try {
            const users = await api.getUsers();
            setState({ loading: false, users, error: null });
        } catch (e: any) {
            setState({
                loading: false,
                users: null,
                error: e?.message || "Failed to load users",
            });
        }
    }, []);
    useEffect(() => {
        let alive = true;
        (async () => {
            setState({ loading: true, users: null, error: null });
            try {
                const users = await api.getUsers();
                if (!alive) return;
                setState({ loading: false, users, error: null });
            } catch (e: any) {
                if (!alive) return;
                setState({
                    loading: false,
                    users: null,
                    error: e?.message || 'Failed to load users',
                });
            }
        })();
        return () => {
            alive = false;
        };
    }, []);

    useEffect(() => {
        let alive = true;
        if (!canManageStaff) return () => { alive = false; };
        api.getRoleScopes()
            .then((data) => {
                if (!alive) return;
                setRoleScopes(data.scopes || {});
                setAvailableScopes(data.available || []);
            })
            .catch(() => {
                if (!alive) return;
                setRoleScopes(null);
                setAvailableScopes([]);
            });
        return () => {
            alive = false;
        };
    }, [canManageStaff]);

    const openCreate = () => {
        setEditing(null);
        setForm(blankForm);
        setShowForm(true);
    };

    const openEdit = (u: any) => {
        const standard = u.role === "staff" ? standardUsernameFor(u.last_name || "", u.display_name || "") : "";
        setEditing(u);
        setForm({
            username: u.username || "",
            email: u.email || `${u.username || ""}@mjc-cafeteria.com`,
            display_name: u.display_name || "",
            last_name: u.last_name || "",
            role: u.role || "staff",
            pin: u.pin || "",
            password: "",
            active: u.active !== false,
            phone: u.phone || "",
            job_title: u.job_title || "",
            bio: u.bio || "",
            avatar_url: u.avatar_url || "",
            new_username: standard && standard !== u.username ? standard : "",
            new_password: "",
        });
        setShowForm(true);
    };

    function usernamePart(value: string) {
        return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
    }
    function standardUsernameFor(lastName: string, firstName: string) {
        const last = usernamePart(lastName);
        const first = usernamePart(firstName);
        return last && first ? `${last}.${first}` : "";
    }
    const canEditUser = (u: any) => isSudo || (canManageStaff && u.role === "staff");
    const canEditCredentials = Boolean(editing && (isSudo || (canManageStaff && editing.role === "staff")));
    const updateForm = (key: string, value: string | boolean) => {
        setForm((prev) => {
            const next = { ...prev, [key]: value };
            if (!editing && next.role === "staff" && ["display_name", "last_name", "role"].includes(key)) {
                const standard = standardUsernameFor(next.last_name, next.display_name);
                if (standard) next.username = standard;
            }
            if (editing?.role === "staff" && canEditCredentials && ["display_name", "last_name"].includes(key)) {
                const standard = standardUsernameFor(next.last_name, next.display_name);
                if (standard && standard !== editing.username) next.new_username = standard;
            }
            return next;
        });
    };
    const loginEmailFor = (name: string) => {
        const clean = (name || "").trim().toLowerCase();
        return clean === "sudo" ? "sudo@mjc.local" : `${clean || "username"}@mjc-cafeteria.com`;
    };

    const submitUser = async () => {
        const displayName = form.display_name.trim();
        const standardUsername = standardUsernameFor(form.last_name, displayName);
        const username = (form.username.trim().toLowerCase() || standardUsername);
        const email = loginEmailFor(username);
        const newUsername = (form as any).new_username?.trim().toLowerCase() || "";
        const newPassword = (form as any).new_password?.trim() || "";
        if (!displayName) {
            toast("Display name is required");
            return;
        }
        if (!editing && !username) {
            toast("Username is required");
            return;
        }
        if (!editing && form.role === "staff" && standardUsername && username !== standardUsername) {
            toast(`Staff username must be ${standardUsername}`);
            return;
        }
        if (editing && editing.role === "staff" && newUsername && standardUsername && newUsername !== standardUsername) {
            toast(`Staff username must be ${standardUsername}`);
            return;
        }
        if (!editing && form.role !== "staff" && form.password.length < 8) {
            toast("Password must be at least 8 characters");
            return;
        }
        if (!editing && form.password && form.password.length < 8) {
            toast("Password must be at least 8 characters");
            return;
        }
        if (editing && newPassword && newPassword.length < 8) {
            toast("Password must be at least 8 characters");
            return;
        }
        if (form.role === "staff" && form.pin && !/^\d+$/.test(form.pin)) {
            toast("PIN must be numeric");
            return;
        }

        setSaving(true);
        try {
            if (editing) {
                await api.updateUser(editing.id, (() => {
                    const p: any = {
                        display_name: displayName,
                        last_name: form.last_name.trim(),
                        role: form.role,
                        pin: form.role === "staff" ? form.pin : null,
                        active: form.active,
                        phone: form.phone || undefined,
                        job_title: form.job_title || undefined,
                        bio: form.bio || undefined,
                        avatar_url: form.avatar_url || undefined,
                    };
                    if (canEditCredentials && newUsername && newUsername !== editing.username) p.new_username = newUsername;
                    if (canEditCredentials && newPassword) p.new_password = newPassword;
                    return p;
                })());
                toast(`Updated ${displayName}`);
            } else {
                await api.createUser({
                    username,
                    email,
                    display_name: displayName,
                    last_name: form.last_name.trim(),
                    role: form.role,
                    pin: form.role === "staff" ? form.pin : "",
                    password: form.password || undefined,
                    phone: form.phone || undefined,
                    job_title: form.job_title || undefined,
                    bio: form.bio || undefined,
                    avatar_url: form.avatar_url || undefined,
                });
                toast(`Created ${displayName}`);
            }
            setShowForm(false);
            setEditing(null);
            setForm(blankForm);
            await loadUsers();
        } catch (e: any) {
            toast(e?.message || "User save failed");
        } finally {
            setSaving(false);
        }
    };

    const disableUser = async (u: any) => {
        if (!window.confirm(`Disable ${u.display_name || u.username}?`)) return;
        try {
            await api.deleteUser(u.id);
            toast(`Disabled ${u.display_name || u.username}`);
            await loadUsers();
        } catch (e: any) {
            toast(e?.message || "Could not disable user");
        }
    };

    const viewCredentials = async (u: any) => {
        setLoadingCredentials(u.id);
        try {
            const credentials = await api.getUserPassword(u.id);
            setCredentialView({ user: u, credentials });
        } catch (e: any) {
            toast(e?.message || "Could not load credentials");
        } finally {
            setLoadingCredentials(null);
        }
    };

    const toggleScope = (role: string, scope: string) => {
        if (role === "sudo") return;
        setRoleScopes((prev) => {
            const next = { ...(prev || {}) };
            const current = new Set(next[role] || []);
            if (current.has(scope)) current.delete(scope);
            else current.add(scope);
            next[role] = [...current].sort();
            return next;
        });
    };

    const saveScopes = async () => {
        if (!roleScopes) return;
        setSavingScopes(true);
        try {
            const data = await api.updateRoleScopes(roleScopes);
            setRoleScopes(data.scopes);
            setAvailableScopes(data.available);
            toast("Role scopes updated");
        } catch (e: any) {
            toast(e?.message || "Could not save role scopes");
        } finally {
            setSavingScopes(false);
        }
    };

    const users = state.users || [];
    const activeUsers = users.filter((u: any) => u.active !== false).length;
    const disabledUsers = users.length - activeUsers;
    return (
        <div className="fade-in">
            <div className="page-head">
                <div>
                    <h2>Users &amp; Access</h2>
                    <div className="ph-sub" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <StatusPill>{users.length} accounts</StatusPill>
                        <StatusPill ok>{activeUsers} active</StatusPill>
                        <StatusPill warn={disabledUsers > 0}>{disabledUsers} disabled</StatusPill>
                        {!isSudo && (canManageStaff ? "staff management" : "read-only view")}
                    </div>
                </div>
                <div className="ph-actions">
                    <button className="btn" onClick={loadUsers} disabled={state.loading}>
                        {I.refresh()} Refresh
                    </button>
                    {isSudo && (
                        <button className="btn primary" onClick={openCreate}>
                            {I.plus()} Invite user
                        </button>
                    )}
                </div>
            </div>

            {state.loading && <Loading label="Loading directory…" />}
            {state.error && (
                <div className="banner warn">
                    {I.alert()}
                    <span>Couldn't load users: {state.error}</span>
                </div>
            )}

            {!state.loading && !state.error && (
                <div className="card">
                    <div className="card-body flush tbl-wrap">
                        <table className="data">
                            <thead>
                                <tr>
                                    <th>User</th>
                                    <th>Username</th>
                                    <th>Role</th>
                                    <th>Auth method</th>
                                    <th>Status</th>
                                    <th></th>
                                </tr>
                            </thead>
                            <tbody>
                                {users.map((u: any) => (
                                    <tr key={u.id || u.username}>
                                        <td>
                                            <div className="user-cell">
                                                <Avatar user={u} />
                                                <div>
                                                    <div
                                                        style={{
                                                            fontWeight: 700,
                                                        }}
                                                    >
                                                        {u.display_name}{" "}
                                                        {u.last_name || ""}
                                                    </div>
                                                    {u.job_title && (
                                                        <div style={{ fontSize: 11, color: "var(--accent)", fontWeight: 600 }}>
                                                            {u.job_title}
                                                        </div>
                                                    )}
                                                    <div
                                                        style={{
                                                            fontSize: 11,
                                                            color: "var(--muted)",
                                                        }}
                                                    >
                                                        {u.username}
                                                        @mjc-cafeteria.com
                                                    </div>
                                                </div>
                                            </div>
                                        </td>
                                        <td
                                            className="num"
                                            style={{ color: "var(--muted)" }}
                                        >
                                            {u.username}
                                        </td>
                                        <td>
                                            <span
                                                className={
                                                    "pill role-" + u.role
                                                }
                                            >
                                                {ROLE_LABEL[u.role as Role] || u.role}
                                            </span>
                                        </td>
                                        <td style={{ color: "var(--muted)" }}>
                                            {u.role === "staff"
                                                ? "4-digit PIN"
                                                : "Password"}
                                        </td>
                                        <td>
                                            {u.active ? (
                                                <span className="pill ok">
                                                    Active
                                                </span>
                                            ) : (
                                                <span className="pill off">
                                                    Disabled
                                                </span>
                                            )}
                                        </td>
                                        <td style={{ display: "flex", gap: 6 }}>
                                            {canEditUser(u) && (
                                                <>
                                                    <button
                                                        className="btn"
                                                        style={{ padding: "5px 9px" }}
                                                        onClick={() => openEdit(u)}
                                                        title="Edit user"
                                                    >
                                                        {I.edit({
                                                            style: {
                                                                width: 14,
                                                                height: 14,
                                                            },
                                                        })}
                                                    </button>
                                                    {(isSudo || (canManageStaff && u.role === "staff")) && (
                                                        <button
                                                            className="btn"
                                                            style={{ padding: "5px 9px" }}
                                                            onClick={() => viewCredentials(u)}
                                                            disabled={loadingCredentials === u.id}
                                                            title="View credential recovery"
                                                        >
                                                            {loadingCredentials === u.id ? "..." : "Creds"}
                                                        </button>
                                                    )}
                                                    {isSudo && (
                                                        <button
                                                            className="btn"
                                                            style={{
                                                                padding: "5px 9px",
                                                                color: "var(--red)",
                                                            }}
                                                            onClick={() => disableUser(u)}
                                                            disabled={u.active === false}
                                                            title="Disable user"
                                                        >
                                                            {I.del({
                                                                style: {
                                                                    width: 14,
                                                                    height: 14,
                                                                },
                                                            })}
                                                        </button>
                                                    )}
                                                </>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
            {isSudo && roleScopes && (
                <div className="card" style={{ marginTop: 12 }}>
                    <div className="card-head">
                        <h3>Role Scopes</h3>
                        <span className="ph-sub">page permissions by auth group</span>
                    </div>
                    <div className="banner info" style={{ margin: "0 16px 12px" }}>
                        {I.alert()}
                        <span>
                            Checking a box here controls whether that role can see and navigate to a page. Financial pages
                            (Inventory, Monthly Inventory, Reports, Archives, Pull Sheet, Snack Bar, Data Entry) additionally
                            require assistant level or above regardless of these checkboxes. Some actions inside a page
                            (editing users, deleting events, changing settings, publishing the menu) still enforce their own
                            minimum role on the server, as a second layer of protection for sensitive writes.
                        </span>
                    </div>
                    <div className="card-body" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12 }}>
                        {(["staff", "assistant", "manager", "admin", "sudo"] as Role[]).map((role) => (
                            <div key={role} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 10, background: "var(--surface)" }}>
                                <div style={{ fontWeight: 850, marginBottom: 8 }}>{ROLE_LABEL[role]}</div>
                                <div style={{ display: "grid", gap: 6 }}>
                                    {availableScopes.map((scope) => {
                                        const label = NAV.flatMap((g) => g.items).find((it) => it.key === scope)?.label || scope;
                                        const checked = roleScopes[role]?.includes(scope) || role === "sudo";
                                        return (
                                            <label key={`${role}-${scope}`} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12 }}>
                                                <input
                                                    type="checkbox"
                                                    checked={checked}
                                                    disabled={role === "sudo"}
                                                    onChange={() => toggleScope(role, scope)}
                                                />
                                                <span>{label}</span>
                                            </label>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                        <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end" }}>
                            <button className="btn primary" onClick={saveScopes} disabled={savingScopes}>
                                {savingScopes ? "Saving..." : "Save scopes"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {credentialView && (
                <div className="overlay" onClick={() => setCredentialView(null)}>
                    <div className="modal" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
                        <div className="modal-head">
                            <h3>Credential recovery</h3>
                            <button className="btn" onClick={() => setCredentialView(null)}>Close</button>
                        </div>
                        <div className="card-body" style={{ display: "grid", gap: 10 }}>
                            <div><strong>{credentialView.user.display_name || credentialView.user.username}</strong></div>
                            <div style={{ fontSize: 13 }}>Username: <span style={{ fontFamily: "var(--mono)" }}>{credentialView.credentials.username}</span></div>
                            <div style={{ fontSize: 13 }}>Login email: <span style={{ fontFamily: "var(--mono)" }}>{credentialView.credentials.email || "-"}</span></div>
                            {credentialView.credentials.pin ? (
                                <div style={{ fontSize: 13 }}>Current PIN: <span className="pill" style={{ fontFamily: "var(--mono)" }}>{credentialView.credentials.pin}</span></div>
                            ) : (
                                <div style={{ fontSize: 13, color: "var(--muted)" }}>No staff PIN is set.</div>
                            )}
                            <div className="banner warn" style={{ margin: 0 }}>
                                {I.alert()}
                                <span>{credentialView.credentials.password_note}</span>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            {showForm && (
                <div className="overlay" onClick={() => setShowForm(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-head">
                            <h3>{editing ? "Edit user" : "Invite user"}</h3>
                            <button className="btn" onClick={() => setShowForm(false)}>
                                Close
                            </button>
                        </div>
                        <div className="form-grid" style={{ padding: 16 }}>
                            {!editing && (
                                <>
                                    <label>
                                        <span>Username</span>
                                        <input
                                            value={form.username}
                                            onChange={(e) => updateForm("username", e.target.value)}
                                            placeholder="lastname.firstname"
                                        />
                                    </label>
                                    <label>
                                        <span>Login email</span>
                                        <input
                                            value={loginEmailFor(form.username)}
                                            disabled
                                        />
                                    </label>
                                </>
                            )}
                            <label>
                                <span>First name</span>
                                <input
                                    value={form.display_name}
                                    onChange={(e) => updateForm("display_name", e.target.value)}
                                />
                            </label>
                            <label>
                                <span>Last name</span>
                                <input
                                    value={form.last_name}
                                    onChange={(e) => updateForm("last_name", e.target.value)}
                                />
                            </label>
                            <label>
                                <span>Role</span>
                                <select
                                    value={form.role}
                                    onChange={(e) => updateForm("role", e.target.value)}
                                    disabled={editing && !isSudo}
                                >
                                    <option value="staff">Staff</option>
                                    {isSudo && (
                                        <>
                                            <option value="assistant">Assistant</option>
                                            <option value="manager">Manager</option>
                                            <option value="admin">Administrator</option>
                                            <option value="sudo">Sudo Administrator</option>
                                        </>
                                    )}
                                </select>
                            </label>
                            {form.role === "staff" && (
                                <label>
                                    <span>PIN</span>
                                    <input
                                        value={form.pin}
                                        onChange={(e) => updateForm("pin", e.target.value)}
                                        placeholder="4-digit PIN"
                                    />
                                </label>
                            )}
                            {!editing && (
                                <label>
                                    <span>{form.role === "staff" ? "Password (optional)" : "Password"}</span>
                                    <input
                                        type="password"
                                        value={form.password}
                                        onChange={(e) => updateForm("password", e.target.value)}
                                        placeholder="At least 8 characters"
                                    />
                                </label>
                            )}
                            <label>
                                <span>Job Title</span>
                                <input
                                    value={form.job_title}
                                    onChange={(e) => updateForm("job_title", e.target.value)}
                                    placeholder="e.g. Cafeteria Manager"
                                />
                            </label>
                            <label>
                                <span>Phone</span>
                                <input
                                    value={form.phone}
                                    onChange={(e) => updateForm("phone", e.target.value)}
                                    placeholder="e.g. 305-555-0100"
                                />
                            </label>
                            <label>
                                <span>Avatar URL</span>
                                <input
                                    value={form.avatar_url}
                                    onChange={(e) => updateForm("avatar_url", e.target.value)}
                                    placeholder="https://…"
                                />
                            </label>
                            {editing && (
                                <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                    <input
                                        type="checkbox"
                                        checked={form.active}
                                        onChange={(e) => updateForm("active", e.target.checked)}
                                    />
                                    <span>Active account</span>
                                </label>
                            )}
                            {editing && canEditCredentials && (
                                <>
                                    <label>
                                        <span>Change username</span>
                                        <input
                                            value={(form as any).new_username || ""}
                                            onChange={(e) => updateForm("new_username", e.target.value.toLowerCase())}
                                            placeholder={standardUsernameFor(form.last_name, form.display_name) || editing.username || "lastname.firstname"}
                                            autoComplete="off"
                                        />
                                    </label>
                                    <label>
                                        <span>Set new password</span>
                                        <input
                                            type="password"
                                            value={(form as any).new_password || ""}
                                            onChange={(e) => updateForm("new_password", e.target.value)}
                                            placeholder="Min 8 characters"
                                            autoComplete="new-password"
                                        />
                                    </label>
                                </>
                            )}
                        </div>
                        <div className="modal-foot">
                            <button className="btn" onClick={() => setShowForm(false)} disabled={saving}>
                                Cancel
                            </button>
                            <button className="btn primary" onClick={submitUser} disabled={saving}>
                                {saving ? "Saving..." : editing ? "Save changes" : "Create user"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

const PAGE_INFO: Record<
    string,
    { icon: string; title: string; sub: string; feats: string[] }
> = {
    menu: {
        icon: "calendar",
        title: "28-Day Cycle Menu",
        sub: "Plan the rotating cycle menu, map recipes to inventory items, and forecast quantities against on-hand counts.",
        feats: [
            "28-day rotation",
            "Recipe → SKU mapping",
            "Quantity forecasting",
            "Nutrition / HACCP notes",
        ],
    },
    sourcectrl: {
        icon: "branch",
        title: "Source Control",
        sub: "Every inventory change is staged, reviewed, and committed — with full history and one-click revert.",
        feats: [
            "Staged commits",
            "Diff & review",
            "Change history",
            "Revert to commit",
        ],
    },
    archives: {
        icon: "archive",
        title: "Archives",
        sub: "Monthly snapshots, vendor invoices, and exported reports — retained and searchable.",
        feats: [
            "Monthly snapshots",
            "Invoice archive",
            "Report exports",
            "Audit trail",
        ],
    },
    settings: {
        icon: "settings",
        title: "Settings",
        sub: "Configure the data source, AI invoice parsing, and platform preferences.",
        feats: [
            "Supabase connection",
            "AI provider & model",
            "Org preferences",
            "API keys",
        ],
    },
};

function PlaceholderPage({ pageKey }: { pageKey: string }) {
    const p = PAGE_INFO[pageKey] || {
        icon: "grid",
        title: "Page",
        sub: "",
        feats: [] as string[],
    };
    return (
        <div className="fade-in">
            <div className="page-head">
                <div>
                    <h2>{p.title}</h2>
                    <div className="ph-sub">Module preview</div>
                </div>
            </div>
            <div className="placeholder">
                <div className="pic">{I[p.icon]()}</div>
                <h3>{p.title}</h3>
                <p>{p.sub}</p>
                <div className="feature-list">
                    {p.feats.map((f, i) => (
                        <div className="fl" key={i}>
                            {I.checkCircle()} {f}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

function ArchivesView(_props: { period: [number, number] }) {
    const [archives, setArchives] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [liveTick, setLiveTick] = useState(0);

    useEffect(() => {
        let alive = true;
        (async () => {
            setLoading(true);
            try {
            const data = await api.getInventoryHistory();
            if (!alive) return;
            const arch = (data || []).map((s: any) => {
                const items = s.items || [];
                const meta = s.metadata || {};
                const totals = moneyTotalsFromMeta(meta);
                const dt = s.created_at ? new Date(s.created_at) : new Date();
                // Label by the snapshot's ACTUAL period (month/year), not its
                // save date — created_at clusters on the bulk-write date, which
                // made every archive read "June 2026". meta.month is 1-indexed.
                const label =
                    meta.label ||
                    (meta.month && meta.year
                        ? `${MONTHS[meta.month - 1]} ${meta.year}`
                        : dt.toLocaleDateString("en-US", {
                              month: "long",
                              year: "numeric",
                          }));
                return {
                    period: s.id || dt.toISOString().slice(0, 7),
                    label,
                    value: totals.close,
                    startingBalance: totals.open,
                    totalReceived: totals.recv,
                    totalPulled: totals.iss,
                    endingBalance: totals.close,
                    items: Math.round(num(meta.item_count)) || items.length,
                    low: Math.round(num(meta.reorder_count)),
                    status: "archived",
                };
            });
            setArchives(arch);
            } catch {
                if (alive) setArchives([]);
            } finally {
                if (alive) setLoading(false);
            }
        })();
        return () => {
            alive = false;
        };
    }, [liveTick]);

    useEffect(() => {
        const refresh = () => setLiveTick((tick) => tick + 1);
        window.addEventListener("mjcc:live-data-changed", refresh);
        window.addEventListener("focus", refresh);
        return () => {
            window.removeEventListener("mjcc:live-data-changed", refresh);
            window.removeEventListener("focus", refresh);
        };
    }, []);

    if (loading) return <Loading label="Loading archives…" />;

    return (
        <div className="fade-in">
            <div className="page-head">
                <div>
                    <h2>Archives</h2>
                    <div className="ph-sub">
                        Monthly inventory snapshots · retained for audit
                    </div>
                </div>
                <div className="ph-actions">
                    <button className="btn" disabled={archives.length === 0} title={archives.length === 0 ? 'No archives to export yet' : 'Export all archive snapshots'}>{I.download()} Export all</button>
                </div>
            </div>
            {archives.length === 0 ? (
                <div className="card">
                    <div
                        className="card-body"
                        style={{
                            textAlign: "center",
                            padding: 40,
                            color: "var(--muted)",
                        }}
                    >
                        {I.archive({
                            style: { width: 32, height: 32, marginBottom: 12 },
                        })}
                        <br />
                        No archive snapshots yet.
                    </div>
                </div>
            ) : (
                <>
                    <div className="stat-grid">
                        {archives.slice(0, 4).map((a: any) => (
                            <div className="stat-card" key={a.period}>
                                <div className="sc-top">
                                    <div
                                        className="sc-ic"
                                        style={{
                                            background: "#EEF2F8",
                                            color: "#1B3A6B",
                                        }}
                                    >
                                        {I.archive()}
                                    </div>
                                </div>
                                <div className="sc-lbl">{a.label}</div>
                                <div className="sc-val">
                                    {fmtMoney(a.endingBalance)}
                                </div>
                                <div
                                    className="sc-delta eq"
                                    style={{ marginTop: 4 }}
                                >
                                    Start {fmtMoney(a.startingBalance)} · Rcv {fmtMoney(a.totalReceived)} · Pull {fmtMoney(a.totalPulled)}
                                </div>
                            </div>
                        ))}
                    </div>
                    <div className="card">
                        <div className="card-head">
                            <h3>All snapshots</h3>
                        </div>
                        <div className="card-body flush tbl-wrap">
                            <table className="data">
                                <thead>
                                    <tr>
                                        <th>Period</th>
                                        <th className="r">Starting Bal</th>
                                        <th className="r">Total Received</th>
                                        <th className="r">Total Pulled</th>
                                        <th className="r">Ending Bal</th>
                                        <th className="r">Line Items</th>
                                        <th className="r">Below Par</th>
                                        <th>Status</th>
                                        <th></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {archives.map((a: any) => (
                                        <tr key={a.period}>
                                            <td style={{ fontWeight: 700 }}>
                                                {a.label}
                                            </td>
                                            <td className="r num">
                                                {fmtMoneyFull(a.startingBalance)}
                                            </td>
                                            <td className="r num">
                                                {fmtMoneyFull(a.totalReceived)}
                                            </td>
                                            <td className="r num">
                                                {fmtMoneyFull(a.totalPulled)}
                                            </td>
                                            <td className="r num">
                                                {fmtMoneyFull(a.endingBalance)}
                                            </td>
                                            <td className="r num">{a.items}</td>
                                            <td
                                                className="r num"
                                                style={{
                                                    color: a.low
                                                        ? "var(--amber)"
                                                        : "var(--green)",
                                                }}
                                            >
                                                {a.low}
                                            </td>
                                            <td>
                                                <span className="pill off">
                                                    Archived
                                                </span>
                                            </td>
                                            <td className="r">
                                                <button
                                                    className="btn"
                                                    style={{
                                                        padding: "5px 11px",
                                                    }}
                                                >
                                                    {I.download({
                                                        style: {
                                                            width: 14,
                                                            height: 14,
                                                        },
                                                    })}{" "}
                                                    CSV
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}

export interface PortalProps {
    user: User;
    onLogout: () => void;
    density?: string;
}

/**
 * Live-date guard: when the real-world month is newer than the latest inventory
 * period in the DB, prompt a manager to roll over so the team stops working in
 * the stale month. Managers get an actionable button; others get a passive note.
 *
 * Contextual: the banner only appears on the Inventory page while the period
 * being viewed IS the stale latest period — so "You're viewing May" is literally
 * true. It does not nag on the Dashboard, other modules, or while viewing a
 * different month.
 */
function WhatsNewPopup({ user }: { user: User }) {
    const [entry, setEntry] = useState<{ version: string; date: string; title: string } | null>(null);
    const [busy, setBusy] = useState(false);
    useEscapeClose(!!entry, () => setEntry(null), busy);

    useEffect(() => {
        let alive = true;
        api.getWhatsNew()
            .then((r) => {
                if (alive && r.show && r.version && r.title) {
                    setEntry({ version: r.version, date: r.date || "", title: r.title });
                }
            })
            .catch(() => {});
        return () => {
            alive = false;
        };
    }, [user.id]);

    if (!entry) return null;

    const dismiss = async () => {
        setBusy(true);
        try {
            await api.updateUserPreferences({ last_seen_changelog_version: entry.version });
        } catch {
            // non-fatal — popup just reappears next login
        } finally {
            setBusy(false);
            setEntry(null);
        }
    };

    return (
        <div className="overlay" onClick={dismiss}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal-head">
                    <h3>{I.bell()} What's New</h3>
                    <div className="sub">{entry.version}{entry.date ? ` · ${entry.date}` : ""}</div>
                    <button className="modal-x" onClick={dismiss} aria-label="Close">
                        {I.x()}
                    </button>
                </div>
                <div style={{ padding: "0 16px 16px" }}>
                    <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>{entry.title}</p>
                </div>
                <div className="modal-foot">
                    <button className="btn primary" disabled={busy} onClick={dismiss}>
                        Got it
                    </button>
                </div>
            </div>
        </div>
    );
}

function CredentialBanner({ user }: { user: User }) {
    const needsPassword = !!user.must_change_password;
    const needsPin = !needsPassword && !!user.must_change_pin;
    const [open, setOpen] = useState(false);
    const [value, setValue] = useState("");
    const [confirm, setConfirm] = useState("");
    const [busy, setBusy] = useState(false);

    if (!needsPassword && !needsPin) return null;
    const label = needsPassword ? "password" : "PIN";

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (value !== confirm) {
            toast("Entries do not match.");
            return;
        }
        if (needsPassword && value.length < 8) {
            toast("Password must be at least 8 characters.");
            return;
        }
        if (needsPin && !/^\d{4}$/.test(value)) {
            toast("PIN must be exactly 4 digits.");
            return;
        }
        setBusy(true);
        try {
            if (needsPassword) {
                await api.updateMyPassword({ new_password: value });
            } else {
                await api.updateMyPin({ new_pin: value });
            }
            toast(`Your ${label} has been updated.`);
            window.dispatchEvent(
                new CustomEvent("mjcc:user-profile-updated", {
                    detail: {
                        user: needsPassword
                            ? { id: user.id, must_change_password: false }
                            : { id: user.id, must_change_pin: false, pin: value },
                    },
                }),
            );
        } catch (e: any) {
            toast(e?.message || "Update failed — please try again.");
        } finally {
            setBusy(false);
        }
    };

    return (
        <div
            className="banner warn"
            style={{ marginBottom: 12, alignItems: "center", flexWrap: "wrap" }}
        >
            {I.lock()}
            <span style={{ flex: 1 }}>
                Security notice: you're using the <b>default {label}</b>.
                Please set your own {label} now.
            </span>
            {!open ? (
                <button className="btn primary" onClick={() => setOpen(true)}>
                    Change {label}
                </button>
            ) : (
                <form
                    onSubmit={submit}
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        flexWrap: "wrap",
                    }}
                >
                    <input
                        className="ipt"
                        type="password"
                        autoFocus
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        placeholder={
                            needsPassword ? "New password" : "New 4-digit PIN"
                        }
                        inputMode={needsPin ? "numeric" : undefined}
                        maxLength={needsPin ? 4 : 128}
                        style={{ width: needsPin ? 130 : 170 }}
                    />
                    <input
                        className="ipt"
                        type="password"
                        value={confirm}
                        onChange={(e) => setConfirm(e.target.value)}
                        placeholder={`Confirm ${label}`}
                        inputMode={needsPin ? "numeric" : undefined}
                        maxLength={needsPin ? 4 : 128}
                        style={{ width: needsPin ? 130 : 170 }}
                    />
                    <button className="btn primary" type="submit" disabled={busy}>
                        {busy ? "Saving…" : "Save"}
                    </button>
                </form>
            )}
        </div>
    );
}

function RolloverBanner({
    user,
    active,
    period,
    onDone,
}: {
    user: User;
    active: string;
    period: [number, number];
    onDone: () => void;
}) {
    const [status, setStatus] = useState<any>(null);
    const [busy, setBusy] = useState(false);
    const [dismissed, setDismissed] = useState(false);

    useEffect(() => {
        let alive = true;
        api.getPeriodStatus()
            .then((s) => {
                if (alive) setStatus(s);
            })
            .catch(() => {});
        return () => {
            alive = false;
        };
    }, []);

    if (!status || !status.needs_rollover || dismissed) return null;
    // Only on the two pages where the viewed period is actually on screen — the
    // simple Inventory list and the Monthly Inventory master editor (where staff
    // and managers actually do the month's work; without this the calendar-date
    // nudge only ever appeared on the lesser-used page, same gap the "Publish
    // Month" button had before it was added to the editor directly).
    if (active !== "inventory" && active !== "moninv") return null;
    // …and only while actually viewing the stale latest period (e.g. May), so the
    // message matches what's on screen instead of nagging from every other view.
    if (period[0] !== status.latest_month || period[1] !== status.latest_year)
        return null;

    const canRoll = ROLE_LEVEL[user.role] >= 30; // manager+
    const doRollover = async () => {
        setBusy(true);
        try {
            await api.performRollover(
                `Rollover ${status.latest_label} → ${status.next_label}`,
            );
            toast(`Rolled over to ${status.next_label}.`);
            setStatus({ ...status, needs_rollover: false });
            onDone();
        } catch (e: any) {
            toast(e?.message || "Rollover failed.");
        } finally {
            setBusy(false);
        }
    };

    return (
        <div
            className="banner warn"
            style={{ marginBottom: 12, alignItems: "center" }}
        >
            {I.database()}
            <span style={{ flex: 1 }}>
                You're viewing <b>{status.latest_label}</b>, but it's now{" "}
                <b>{status.current_label}</b>.{" "}
                {canRoll
                    ? `Roll over to ${status.next_label} to start the new month's inventory.`
                    : `Ask a manager to roll over to ${status.next_label}.`}
            </span>
            {canRoll && (
                <button
                    className="btn primary"
                    disabled={busy}
                    onClick={doRollover}
                >
                    {busy ? "Rolling over…" : `Roll over to ${status.next_label}`}
                </button>
            )}
            <button
                className="btn"
                disabled={busy}
                onClick={() => setDismissed(true)}
                aria-label="Dismiss"
            >
                {I.x()}
            </button>
        </div>
    );
}

export function Portal({
    user,
    onLogout,
    density = "comfortable",
}: PortalProps) {
    const lvl = ROLE_LEVEL[user.role];
    const [active, setActive] = useState("dashboard");
    // Default to the CURRENT real-world month (0-indexed, matching the DB/period
    // convention) instead of a hardcoded month, so the app always opens on the
    // live/open period rather than a stale one.
    const [period, setPeriod] = useState<[number, number]>([
        new Date().getMonth(),
        new Date().getFullYear(),
    ]);
    const [explorerOpen, setExplorerOpen] = useState(false);
    const [openPrId, setOpenPrId] = useState<string | null>(null); // deep-link target PR for SourceControl
    const [showPullSheet, setShowPullSheet] = useState(false);
    const [scPanelOpen, setScPanelOpen] = useState(false);
    const [invState, reloadInv] = useInventory(period);
    const apiStatus = invState.loading ? 'syncing' : invState.error && invState.error !== 'empty' ? 'error' : 'live';
    const lastFetch = invState.syncedAt;
    const [stagedCount, setStagedCount] = useState(0);
    const [skuReviewCount, setSkuReviewCount] = useState(0);
    const [periodPublished, setPeriodPublished] = useState<boolean | null>(null);
    const [roleScopes, setRoleScopes] = useState<Record<string, string[]> | null>(null);

    useEffect(() => {
        (window as any).__logout = onLogout;
    }, [onLogout]);

    useEffect(() => {
        let alive = true;
        // All roles fetch scopes — staff/assistant nav is gated by role_permissions too
        // (GET /users/role-scopes is readable by any authenticated user; PUT stays sudo).
        api.getRoleScopes()
            .then((data) => {
                if (alive) setRoleScopes(data.scopes || null);
            })
            .catch(() => {
                if (alive) setRoleScopes(null);
            });
        return () => {
            alive = false;
        };
    }, [lvl]);

    // Open SC panel + highlight batch on custom event (from DataEntry)
    useEffect(() => {
        const h = () => {
            setScPanelOpen(true);
        };
        window.addEventListener('mjcc:open-sc', h);
        return () => window.removeEventListener('mjcc:open-sc', h);
    }, []);

    // Fetch published/open status for the currently selected period
    useEffect(() => {
        let alive = true;
        setPeriodPublished(null);
        api.getMonthStatus(period[0] + 1, period[1])
            .then(s => { if (alive) setPeriodPublished(s.published); })
            .catch(() => { if (alive) setPeriodPublished(null); });
        return () => { alive = false; };
    }, [period[0], period[1]]);

    // Reload inventory after a commit — 500 ms delay lets the backend finish
    // surfacing the write before we re-fetch, avoiding a race where the reload
    // returns the pre-commit state.
    useEffect(() => {
        let t: ReturnType<typeof setTimeout>;
        const handler = () => { t = setTimeout(reloadInv, 500); };
        window.addEventListener('mjcc:committed', handler);
        return () => { window.removeEventListener('mjcc:committed', handler); clearTimeout(t); };
    }, [reloadInv]);

    // Apply saved theme on mount and react to OS preference changes (auto mode)
    useEffect(() => {
        const pref = getThemePref(user.id);
        applyThemePref(pref);
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        const handler = () => applyThemePref(getThemePref(user.id));
        mq.addEventListener('change', handler);
        return () => mq.removeEventListener('change', handler);
    }, [user.id]);

    const allowedScopes = roleScopes?.[user.role] || null;
    const hasScope = (routeKey: string) => !allowedScopes || allowedScopes.includes(routeKey);
    const navItem = NAV.flatMap((g) => g.items).find((it) => it.key === active);
    useEffect(() => {
        if (active === "settings") return;
        if (navItem && !hasScope(active)) setActive("dashboard");
    }, [active, allowedScopes, lvl, navItem]);

    function doSync() {
        reloadInv();
        toast("Refreshing live data…");
    }

    const FINANCIAL_KEYS = ['inventory', 'moninv', 'reports', 'archives', 'pullsheet', 'snackbar', 'dataentry'];
    const canAccess = (routeKey: string) => {
        if (lvl < 20 && FINANCIAL_KEYS.includes(routeKey)) return false;
        return routeKey === "settings" || hasScope(routeKey);
    };
    const goTo = (routeKey: string, opts?: { prId?: string }) => {
        setExplorerOpen(false);
        if (routeKey === "sourcectrl") {
            setOpenPrId(opts?.prId || null);
            setActive("sourcectrl");
            return;
        }
        if (routeKey === "lioncafe") {
            if (!canAccess(routeKey)) {
                toast("This page isn't enabled for your role. Ask an administrator to grant it in Role Scopes.");
                return;
            }
            window.location.assign("/?launch=lioncafe");
            return;
        }
        if (!canAccess(routeKey)) {
            toast("This page isn't enabled for your role. Ask an administrator to grant it in Role Scopes.");
            return;
        }
        setActive(routeKey);
    };

    const reorderCount = invState.inv ? reorders(invState.inv).length : 0;

    const common = { user, period, invState, onSync: doSync, go: goTo };

    const renderPage = () => {
        if (!canAccess(active)) return <PlaceholderPage pageKey={active} />;
        if (active === "dashboard") return <Dashboard {...common} />;
        if (active === "inventory")
            return (
                <>
                    {showPullSheet && (
                        <div className="overlay" style={{ alignItems: 'flex-start', padding: '24px 16px', overflowY: 'auto' }} onClick={() => setShowPullSheet(false)}>
                            <div style={{ background: 'var(--bg)', borderRadius: 'var(--radius)', width: '100%', maxWidth: 900, margin: '0 auto', padding: '0 0 24px', minHeight: 400 }} onClick={e => e.stopPropagation()}>
                                <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '10px 16px 0' }}>
                                    <button className="modal-x" onClick={() => setShowPullSheet(false)} aria-label="Close Pull Sheet">{I.x()}</button>
                                </div>
                                <div style={{ padding: '0 20px' }}>
                                    <PullSheet
                                        user={user}
                                        initialMonth={period[0] + 1}
                                        initialYear={period[1]}
                                        onStagingDone={() => {
                                            setShowPullSheet(false);
                                            goTo('sourcectrl');
                                        }}
                                    />
                                </div>
                            </div>
                        </div>
                    )}
                    <InventoryView
                        {...common}
                        openSC={() => setScPanelOpen(true)}
                        onPullSheet={() => setShowPullSheet(true)}
                    />
                </>
            );
        if (active === "haccp") return <ComplianceHub user={user} />;
        if (active === "dailyops") return <DailyOps user={user} go={goTo} />;
        if (active === "events") return <EventsCalendar user={user} />;
        if (active === "menu") return <CycleMenu user={user} />;
        if (active === "mballot") return <MealLog user={user} />;
        if (active === "inspection") return <InspectionSheet user={user} />;
        if (active === "foodreq") return <FoodRequest user={user} />;
        if (active === "snackbar") return <SnackBar user={user} />;
        if (active === "moninv")
            return <MonthlyInventory user={user} period={period} openSC={() => setScPanelOpen(true)} go={goTo} />;
        if (active === "pullsheet")
            return (
                <PullSheet
                    user={user}
                    initialMonth={period[0] + 1}
                    initialYear={period[1]}
                    onStagingDone={() => {
                        setScPanelOpen(true);
                        goTo('sourcectrl');
                    }}
                />
            );
        if (active === "reports")
            return <Reports user={user} period={period} />;
        if (active === "costmgr")
            return <CostManager user={user} period={period} onNav={goTo} />;
        if (active === "dataentry") return <DataEntry user={user} onNavigate={goTo} />;
        if (active === "users") return <UsersView user={user} />;
        if (active === "archives") return <ArchivesView period={period} />;
        if (active === "filevault") return <FileVault />;
        if (active === "settings") return <Settings user={user} />;
        if (active === "ai-usage")   return <AIUsageView user={user} />;
        if (active === "ai-tools")   return <AIToolsView user={user} />;
        if (active === "ai-presets") return <AIPresetsView user={user} />;
        if (active === "sourcectrl") return <SourceControlPage user={user} openPrId={openPrId} onConsumePrId={() => setOpenPrId(null)} />;
        return <PlaceholderPage pageKey={active} />;
    };

    const portalCls = [
        "portal",
        explorerOpen ? "explorer-open" : "",
        scPanelOpen ? "sc-open" : "",
    ].filter(Boolean).join(" ");
    const toggleExplorer = () => setExplorerOpen((v) => !v);

    return (
        <div className={portalCls} data-density={density}>
            <Topbar
                user={user}
                period={period}
                setPeriod={setPeriod}
                sidebarOpen={explorerOpen}
                toggleSidebar={toggleExplorer}
                scOpen={scPanelOpen}
                onToggleSC={() => setScPanelOpen((v) => !v)}
                scCount={stagedCount}
                active={active}
                periodPublished={periodPublished}
                apiStatus={apiStatus}
                lastFetch={lastFetch}
                onRefresh={reloadInv}
                onNav={goTo}
            />
            <ActivityBar
                user={user}
                active={active}
                explorerOpen={explorerOpen}
                onToggleExplorer={toggleExplorer}
                onToggleSC={() => setScPanelOpen((v) => !v)}
                scOpen={scPanelOpen}
                scCount={stagedCount}
                goTo={goTo}
                allowedScopes={allowedScopes}
            />
            <Sidebar
                user={user}
                active={active}
                setActive={(k) => {
                    goTo(k);
                    setExplorerOpen(false);
                }}
                reorderCount={reorderCount}
                stagedCount={stagedCount}
                skuReviewCount={skuReviewCount}
                allowedScopes={allowedScopes}
            />
            {explorerOpen && (
                <div
                    className="sidebar-overlay"
                    onClick={() => setExplorerOpen(false)}
                />
            )}
            <WhatsNewPopup user={user} />
            <main className="main">
                <CredentialBanner user={user} />
                <RolloverBanner
                    user={user}
                    active={active}
                    period={period}
                    onDone={doSync}
                />
                {[
                    "haccp",
                    "dailyops",
                    "mballot",
                    "inspection",
                    "foodreq",
                    "snackbar",
                ].includes(active) && (
                    <div className="banner info" style={{ marginBottom: 12 }}>
                        {I.database()}
                        <span>
                            This module is local-first for form drafts and also
                            attempts API sync. Source Control remains the
                            review/commit authority for operational data.
                        </span>
                    </div>
                )}
                {renderPage()}
            </main>
            <StatusBar
                user={user}
                period={period}
                stagedCount={stagedCount}
                onOpenSC={() => setScPanelOpen(true)}
                active={active}
                onNav={goTo}
            />
            <SourceControlPanel
                user={user}
                open={scPanelOpen}
                onClose={() => setScPanelOpen(false)}
                onCountChange={(n) => setStagedCount(n)}
                onSkuReviewCount={(n) => setSkuReviewCount(n)}
            />
            <AgentBubble user={user} />
        </div>
    );
}
