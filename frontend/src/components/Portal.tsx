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

const ROUTE_MIN: Record<string, number> = Object.fromEntries(
    NAV.flatMap((g) => g.items.map((i) => [i.key, i.min || 0])),
) as Record<string, number>;

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
    catTotals,
    reorders,
    iTotal,
    grandTotal,
    fmtMoney,
    fmtMoneyFull,
    catColor,
    getBackendToken,
} from "../lib/supabase";
import { api } from "../lib/api";
import { ComplianceHub } from "./ComplianceHub";
import { DataEntry } from "./DataEntry";
import { DailyOps } from "./DailyOps";
import { EventsCalendar } from "./EventsCalendar";
import { MealLog, InspectionSheet, FoodRequest } from "./Forms";
import { CycleMenu } from "./CycleMenu";
import { SnackBar, MonthlyInventory } from "./Operations";
import { SourceControlPanel, SourceControlPage } from "./SourceControl";
import { SaveBar } from "./ui/ActionBars";
import { ItemInspector } from "./ui/ItemInspector";
import { Reports } from "./Reports";
import { PullSheet } from "./PullSheet";
import { Settings } from "./Settings";
import { AgentBubble } from "./AgentBubble";
import { AIUsageView, AIToolsView, AIPresetsView } from "./AIStudio";
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

const initials = (u: User) =>
    ((u.display_name?.[0] || "") + (u.last_name?.[0] || "")).toUpperCase() ||
    (u.username || "?").slice(0, 2).toUpperCase();

const AUTO_REFRESH_MS = 60_000; // re-fetch from DB every 60 s

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
    useEffect(() => {
        const close = () => setMenu(false);
        if (menu) {
            window.addEventListener("click", close);
            return () => window.removeEventListener("click", close);
        }
    }, [menu]);
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
                <div
                    className="tb-user"
                    onClick={(e) => {
                        e.stopPropagation();
                        setMenu((v) => !v);
                    }}
                >
                    <div className="avatar">{initials(user)}</div>
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
}: {
    user: User;
    active: string;
    setActive: (k: string) => void;
    reorderCount: number;
    stagedCount: number;
    skuReviewCount: number;
}) {
    const lvl = ROLE_LEVEL[user.role];
    return (
        <nav className="sidebar">
            <div className="explorer-title">Explorer</div>
            {NAV.map((group) => {
                const items = group.items.filter((it) => lvl >= (it.min || 0));
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
}: {
    user: User;
    active: string;
    explorerOpen: boolean;
    onToggleExplorer: () => void;
    onToggleSC: () => void;
    scOpen: boolean;
    scCount: number;
    goTo: (k: string) => void;
}) {
    const lvl = ROLE_LEVEL[user.role];
    const [userMenu, setUserMenu] = useState(false);
    useEffect(() => {
        if (!userMenu) return;
        const close = () => setUserMenu(false);
        window.addEventListener("click", close);
        return () => window.removeEventListener("click", close);
    }, [userMenu]);

    const inGroup = (keys: string[]) => keys.some((k) => active === k);

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
                <button
                    className={"ab-btn" + (inGroup(["inventory", "moninv"]) ? " active" : "")}
                    onClick={() => goTo("inventory")}
                    title="Inventory"
                >
                    {I.box({})}
                </button>
                <button
                    className={"ab-btn" + (active === "sourcectrl" || scOpen ? " active" : "")}
                    onClick={() => active === "sourcectrl" ? onToggleSC() : goTo("sourcectrl")}
                    title="Source Control"
                >
                    {I.branch({})}
                    {scCount > 0 && <span className="ab-badge">{scCount > 9 ? "9+" : scCount}</span>}
                </button>
                <button
                    className={"ab-btn" + (active === "dataentry" ? " active" : "")}
                    onClick={() => goTo("dataentry")}
                    title="Data Entry"
                >
                    {I.inbox({})}
                </button>
                <button
                    className={"ab-btn" + (inGroup(["events", "menu"]) ? " active" : "")}
                    onClick={() => goTo("events")}
                    title="Events & Menu"
                >
                    {I.calCheck({})}
                </button>
                <button
                    className={"ab-btn" + (active.startsWith("ai-") ? " active" : "")}
                    onClick={() => goTo("ai-usage")}
                    title="AI Studio"
                >
                    {I.flame({})}
                </button>
                {lvl >= 30 && (
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
                {lvl >= 40 && (
                    <button
                        className={"ab-btn" + (inGroup(["settings", "users"]) ? " active" : "")}
                        onClick={() => goTo("settings")}
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
                <button
                    className={"ab-btn ab-user-btn" + (userMenu ? " active" : "")}
                    onClick={(e) => { e.stopPropagation(); setUserMenu((v) => !v); }}
                    title={`${user.display_name} ${user.last_name} — ${ROLE_LABEL[user.role]}`}
                >
                    <div className="avatar ab-avatar">{initials(user)}</div>
                    {userMenu && (
                        <div
                            className="usermenu ab-usermenu"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="um-head">
                                <div className="nm">{user.display_name} {user.last_name}</div>
                                <div className="em">{user.username}@mjc-cafeteria.com</div>
                            </div>
                            <button className="um-item" onClick={() => { goTo('settings'); setUserMenu(false); }}>
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
                </button>
            </div>
        </div>
    );
}

function StatusBar({
    user,
    period,
    stagedCount,
    onOpenSC,
}: {
    user: User;
    period: [number, number];
    stagedCount: number;
    onOpenSC: () => void;
}) {
    const [m, y] = period;
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
    const todayISO = new Date().toISOString().slice(0, 10);

    const [menuData, setMenuData] = useState<any>({});
    const [menuLoading, setMenuLoading] = useState(true);
    const [events, setEvents] = useState<any[]>([]);
    const [eventsLoading, setEventsLoading] = useState(true);

    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                setMenuLoading(true);
                const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][
                    new Date().getDay()
                ];
                const res = await api.getMenu(day);
                if (alive) {
                    const raw = res?.data || {};
                    const normalized: any = {};
                    Object.keys(raw).forEach(k => {
                        const key = k.charAt(0).toUpperCase() + k.slice(1);
                        normalized[key] = Array.isArray(raw[k]) ? raw[k] : [];
                    });
                    setMenuData(normalized);
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
        gt = grandTotal(live);
        reorderList = reorders(live);
        const ct = catTotals(live);
        const maxCat = ct.length ? ct[0].val : 1;
        itemCount = invToList(live).length;
        catRows = ct.slice(0, 7).map((c: any) => ({
            name: c.name,
            color: c.color,
            val: fmtMoney(c.val),
            pct: maxCat ? Math.max(4, Math.round((c.val / maxCat) * 100)) : 0,
        }));
    }

    const monRows = invToList(live || {}).map((it: any) => ({
        price: it.price || 0,
        opening: it.onHand || 0,
        received: typeof it.totalReceived === "number"
            ? it.totalReceived
            : (it.w1r || 0) + (it.w2r || 0) + (it.w3r || 0),
        issued: typeof it.totalPulled === "number"
            ? it.totalPulled
            : (it.w1p || 0) + (it.w2p || 0) + (it.w3p || 0),
        closing: typeof it.closingQty === "number" ? it.closingQty : undefined,
    }));
    const miSum = monRows.reduce(
        (a: any, r: any) => {
            a.open += r.opening * r.price;
            a.recv += r.received * r.price;
            a.iss  += r.issued * r.price;
            a.close += (typeof r.closing === "number" ? r.closing : Math.max(0, r.opening + r.received - r.issued)) * r.price;
            return a;
        },
        { open: 0, recv: 0, iss: 0, close: 0 },
    );

    const menuMeals = [
        "Breakfast",
        "Brunch",
        "Lunch",
        "Dinner",
        "Snack",
    ].filter((m) => menuData[m] && menuData[m].length);

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

    const KPIS = [
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
            label: "Daily operations",
            icon: "checkSquare",
            to: "dailyops",
            min: 20,
        },
        { label: "Monthly inventory", icon: "fileText", to: "moninv", min: 20 },
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
                        title={`Today's menu · ${DOW_FULL[new Date().getDay()]}`}
                        link="Full menu →"
                        onLink={() => go("menu")}
                    >
                        <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
                            {menuLoading ? (
                                <div style={{ fontSize: 12, color: "var(--faint)" }}>Loading menu…</div>
                            ) : menuMeals.length === 0 ? (
                                <div style={{ fontSize: 12, color: "var(--faint)" }}>No menu for today.</div>
                            ) : (
                                menuMeals.map((meal) => (
                                    <div key={meal} className="dash-meal">
                                        <div className="dm-head">{meal}</div>
                                        <div className="dm-items">
                                            {meal === "Snack"
                                                ? menuData[meal].join(" · ")
                                                : menuData[meal].map((it: any) => typeof it === "string" ? it : it.item).join(" · ")}
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </WinCard>

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

                    <WinCard title="Inventory alerts">
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: reorderList.length ? 10 : 0 }}>
                            <span className="viol-pill" style={{ margin: 0 }}>
                                {I.alert({ style: { width: 13, height: 13 } })} {reorderList.length} below par
                            </span>
                        </div>
                        {reorderList.length === 0 ? (
                            <div style={{ fontSize: 12, color: "var(--faint)" }}>All items at or above par level.</div>
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

                    <WinCard title="Upcoming events" link="Calendar →" onLink={() => go("events")}>
                        <div className="card-body flush" style={{ margin: "-16px -17px" }}>
                            {eventsLoading ? (
                                <div style={{ padding: 12, fontSize: 12, color: "var(--faint)" }}>Loading events…</div>
                            ) : upcoming.slice(0, 4).length === 0 ? (
                                <div style={{ padding: 12, fontSize: 12, color: "var(--faint)" }}>No upcoming events.</div>
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

    // Week lock status: keyed by week number (1-4), value = 'open'|'locked'|'published'
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

    // Invoice mode selectors: which week (1-4) and direction this staging batch
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

    // Save draft to localStorage
    const saveDraftLocally = () => {
        const key = `mjcc_inv_draft_${period[0]}_${period[1]}`;
        localStorage.setItem(key, JSON.stringify({ draft, wkDraft }));
        toast("Draft saved locally");
    };

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
            value: typeof it.value === "number" ? it.value : iTotal(it),
            sku_pending: it.sku_pending ?? String(it.sku || "").startsWith("MJC-"),
            needs_attention: it.needs_attention ?? it.sku_pending ?? String(it.sku || "").startsWith("MJC-"),
            status:
                ((typeof it.closingQty === "number" ? it.closingQty : it.onHand || 0) < (it.par || 0)) && (it.par || 0) > 0
                    ? "low"
                    : "ok",
        }))
        : [];
    const cats: string[] = live ? [...new Set(rows.map((r: any) => r.cat))] : [];

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
                const issKey = `w${compactWeek}i` as WeeklyField;

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
                        removeDesc: conflict.description || conflict.desc || payload.new_sku,
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
                    <button className="btn no-print" onClick={() => go?.("barcodes")}>{I.scan()} Scan</button>
                    <button className="btn no-print" onClick={onSync}>
                        {I.refresh()} Refresh
                    </button>
                    {lvl >= 20 && onPullSheet && (
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
                                    color: "var(--faint)",
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
                                            Uncategorized
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
                                    const rowValue = onHand * (r.price || 0);
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
                                                    color: "var(--faint)",
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
                                                color: "var(--faint)",
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
                                        (s: number, r: any) => {
                                            const sku = String(r.sku || "");
                                            const oh =
                                                draft[sku]?.onHand ?? stagedValues[sku]?.onHand ?? r.onHand;
                                            return s + oh * (r.price || 0);
                                        },
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
                                                        <span className="pill warn csh-low">
                                                            {lowCount} below par
                                                        </span>
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
                                                                                    color: "var(--faint)",
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
                                        color: "var(--faint)",
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
                                            <span style={{ fontSize: 12, color: "var(--faint)" }}>
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
                                                        <span className="pill warn csh-low">
                                                            {lowCount} below par
                                                        </span>
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
                                        color: "var(--faint)",
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

    const openCreate = () => {
        setEditing(null);
        setForm(blankForm);
        setShowForm(true);
    };

    const openEdit = (u: any) => {
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
        });
        setShowForm(true);
    };

    const updateForm = (key: string, value: string | boolean) => {
        setForm((prev) => ({ ...prev, [key]: value }));
    };

    const submitUser = async () => {
        const username = form.username.trim().toLowerCase();
        const displayName = form.display_name.trim();
        const email = (form.email || `${username}@mjc-cafeteria.com`).trim();
        if (!displayName) {
            toast("Display name is required");
            return;
        }
        if (!editing && !username) {
            toast("Username is required");
            return;
        }
        if (!editing && form.role !== "staff" && form.password.length < 8) {
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
                    if (isSudo && (form as any).new_username?.trim()) p.new_username = (form as any).new_username.trim().toLowerCase();
                    if (isSudo && (form as any).new_password?.trim()) p.new_password = (form as any).new_password.trim();
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
                    password: form.role === "staff" ? undefined : form.password,
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

    const users = state.users || [];
    const activeUsers = users.filter((u: any) => u.active !== false).length;
    const disabledUsers = users.length - activeUsers;
    return (
        <div className="fade-in">
            <div className="page-head">
                <div>
                    <h2>Users &amp; Access</h2>
                    <div className="ph-sub">
                        {users.length} accounts · {activeUsers} active · {disabledUsers} disabled
                        {!isSudo && " · read-only view"}
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
                                                <div className="avatar">
                                                    {initials(u)}
                                                </div>
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
                                                            color: "var(--faint)",
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
                                            {isSudo && (
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
                                            placeholder="staff1"
                                        />
                                    </label>
                                    <label>
                                        <span>Email</span>
                                        <input
                                            value={form.email}
                                            onChange={(e) => updateForm("email", e.target.value)}
                                            placeholder="username@mjc-cafeteria.com"
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
                                >
                                    <option value="staff">Staff</option>
                                    <option value="assistant">Assistant</option>
                                    <option value="manager">Manager</option>
                                    <option value="admin">Administrator</option>
                                    {isSudo && <option value="sudo">Sudo Administrator</option>}
                                </select>
                            </label>
                            {form.role === "staff" ? (
                                <label>
                                    <span>PIN</span>
                                    <input
                                        value={form.pin}
                                        onChange={(e) => updateForm("pin", e.target.value)}
                                        placeholder="4-digit PIN"
                                    />
                                </label>
                            ) : !editing ? (
                                <label>
                                    <span>Password</span>
                                    <input
                                        type="password"
                                        value={form.password}
                                        onChange={(e) => updateForm("password", e.target.value)}
                                        placeholder="At least 8 characters"
                                    />
                                </label>
                            ) : null}
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
                            {editing && isSudo && (
                                <>
                                    <label>
                                        <span>Change username</span>
                                        <input
                                            value={(form as any).new_username || ""}
                                            onChange={(e) => updateForm("new_username", e.target.value.toLowerCase())}
                                            placeholder={editing.username || "new-username"}
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
    barcodes: {
        icon: "qr",
        title: "Barcodes & Scan",
        sub: "Generate CODE128 / QR labels and run mobile scan sessions to update on-hand counts in real time.",
        feats: [
            "Bulk label export",
            "Camera scan sessions",
            "Auto on-hand sync",
            "Print sheets",
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

    useEffect(() => {
        let alive = true;
        (async () => {
            setLoading(true);
            try {
            const data = await api.getInventoryHistory();
            if (!alive) return;
            const arch = (data || []).map((s: any) => {
                const items = s.items || [];
                const totalReceived = (i: any) =>
                    typeof i.totalReceived === "number"
                        ? i.totalReceived
                        : (i.w1r || 0) + (i.w2r || 0) + (i.w3r || 0);
                const totalPulled = (i: any) =>
                    typeof i.totalPulled === "number"
                        ? i.totalPulled
                        : (i.w1p || 0) + (i.w2p || 0) + (i.w3p || 0);
                const endingQty = (i: any) =>
                    typeof i.closingQty === "number"
                        ? i.closingQty
                        : Math.max(0, (i.onHand || 0) + totalReceived(i) - totalPulled(i));
                const low = items.filter((i: any) => endingQty(i) < (i.par || 0));
                const startingBalance = items.reduce(
                    (sum: number, i: any) => sum + (i.onHand || 0) * (i.price || 0),
                    0,
                );
                const totalReceivedValue = items.reduce(
                    (sum: number, i: any) => sum + totalReceived(i) * (i.price || 0),
                    0,
                );
                const totalPulledValue = items.reduce(
                    (sum: number, i: any) => sum + totalPulled(i) * (i.price || 0),
                    0,
                );
                const endingBalance = items.reduce(
                    (sum: number, i: any) =>
                        sum + (typeof i.value === "number" ? i.value : endingQty(i) * (i.price || 0)),
                    0,
                );
                const meta = s.metadata || {};
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
                    value: endingBalance,
                    startingBalance,
                    totalReceived: totalReceivedValue,
                    totalPulled: totalPulledValue,
                    endingBalance,
                    items: items.length,
                    low: low.length,
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
                            color: "var(--faint)",
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
    // Only on the Inventory page…
    if (active !== "inventory") return null;
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

    useEffect(() => {
        (window as any).__logout = onLogout;
    }, [onLogout]);

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

    const navItem = NAV.flatMap((g) => g.items).find((it) => it.key === active);
    useEffect(() => {
        if (navItem && lvl < (navItem.min || 0)) setActive("dashboard");
    }, [active, lvl, navItem]);

    function doSync() {
        reloadInv();
        toast("Refreshing live data…");
    }

    const canAccess = (routeKey: string) => lvl >= (ROUTE_MIN[routeKey] ?? 10);
    const goTo = (routeKey: string, opts?: { prId?: string }) => {
        setExplorerOpen(false);
        if (routeKey === "sourcectrl") {
            setOpenPrId(opts?.prId || null);
            setActive("sourcectrl");
            return;
        }
        if (!canAccess(routeKey)) {
            const need = ROUTE_MIN[routeKey] ?? 10;
            const role =
                need >= 40
                    ? "Administrator"
                    : need >= 30
                      ? "Manager"
                      : need >= 20
                        ? "Assistant"
                        : "Staff";
            toast(`${role} access required for this route.`);
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
        if (active === "dailyops") return <DailyOps user={user} />;
        if (active === "events") return <EventsCalendar user={user} />;
        if (active === "menu") return <CycleMenu user={user} />;
        if (active === "mballot") return <MealLog user={user} />;
        if (active === "inspection") return <InspectionSheet user={user} />;
        if (active === "foodreq") return <FoodRequest user={user} />;
        if (active === "snackbar") return <SnackBar user={user} />;
        if (active === "moninv")
            return <MonthlyInventory user={user} period={period} openSC={() => setScPanelOpen(true)} go={goTo} />;
        if (active === "reports")
            return <Reports user={user} period={period} />;
        if (active === "dataentry") return <DataEntry user={user} onNavigate={goTo} />;
        if (active === "users") return <UsersView user={user} />;
        if (active === "archives") return <ArchivesView period={period} />;
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
            />
            {explorerOpen && (
                <div
                    className="sidebar-overlay"
                    onClick={() => setExplorerOpen(false)}
                />
            )}
            <main className="main">
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
