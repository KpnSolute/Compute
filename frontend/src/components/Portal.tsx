import { useState, useEffect, useCallback } from "react";
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

const ROUTE_MIN: Record<string, number> = Object.fromEntries(
    NAV.flatMap((g) => g.items.map((i) => [i.key, i.min || 0])),
) as Record<string, number>;
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
} from "../lib/supabase";
import { api } from "../lib/api";
import { ComplianceHub } from "./ComplianceHub";
import { DataEntry } from "./DataEntry";
import { DailyOps } from "./DailyOps";
import { EventsCalendar } from "./EventsCalendar";
import { MealLog, InspectionSheet, FoodRequest } from "./Forms";
import { CycleMenu } from "./CycleMenu";
import { SnackBar, MonthlyInventory } from "./Operations";
import { SourceControlPanel } from "./SourceControl";
import { Reports } from "./Reports";
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

function useInventory(): [any, () => Promise<void>] {
    const [state, setState] = useState({
        loading: false,
        inv: null as any,
        syncedBy: null as string | null,
        syncedAt: null as string | null,
        error: null as string | null,
    });
    const load = useCallback(async () => {
        setState((s) => ({ ...s, loading: true, error: null }));
        const res = await fetchInventory();
        if (res.ok)
            setState({
                loading: false,
                inv: res.inv,
                syncedBy: (res as any).syncedBy ?? null,
                syncedAt: res.syncedAt ?? null,
                error: res.inv ? null : "empty",
            });
        else
            setState({
                loading: false,
                inv: null,
                syncedBy: null,
                syncedAt: null,
                error: res.error,
            });
    }, []);
    useEffect(() => {
        load();
    }, [load]);
    return [state, load];
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
}: {
    user: User;
    period: [number, number];
    setPeriod: (p: [number, number]) => void;
    sidebarOpen?: boolean;
    toggleSidebar?: () => void;
    scOpen?: boolean;
    onToggleSC?: () => void;
    scCount?: number;
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
                    <div className="tb-title">KpnCompute · MJCC Portal</div>
                    <div className="tb-sub">
                        Inventory · 28-Day Menu · Sourcing
                    </div>
                </div>
            </div>
            <div className="tb-right">
                <span className="inv-badge">
                    <span className="rt"></span>LIVE · API Connected
                </span>
                <select
                    className="tb-select"
                    value={m}
                    onChange={(e) => setPeriod([+e.target.value, y])}
                >
                    {MONTHS.map((nm, i) => (
                        <option key={i} value={i}>
                            {nm}
                        </option>
                    ))}
                </select>
                <select
                    className="tb-select"
                    value={y}
                    onChange={(e) => setPeriod([m, +e.target.value])}
                >
                    {[2024, 2025, 2026].map((yr) => (
                        <option key={yr} value={yr}>
                            {yr}
                        </option>
                    ))}
                </select>
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
                            <button className="um-item">
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
}: {
    user: User;
    active: string;
    setActive: (k: string) => void;
    reorderCount: number;
    stagedCount: number;
}) {
    const lvl = ROLE_LEVEL[user.role];
    return (
        <nav className="sidebar">
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
                                {it.key === "sourcectrl" && stagedCount > 0 && (
                                    <span className="nb">{stagedCount}</span>
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
        received: (it.w1r || 0) + (it.w2r || 0) + (it.w3r || 0) + (it.w4r || 0),
        issued: (it.w1i || 0) + (it.w2i || 0) + (it.w3i || 0) + (it.w4i || 0),
    }));
    const miSum = monRows.reduce(
        (a: any, r: any) => {
            a.open += r.opening * r.price;
            a.recv += r.received * r.price;
            a.close += Math.max(0, r.opening + r.received - r.issued) * r.price;
            return a;
        },
        { open: 0, recv: 0, close: 0 },
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
                        {live && invState.syncedAt && (
                            <>
                                {" "}
                                · synced{" "}
                                {new Date(invState.syncedAt).toLocaleString()}
                            </>
                        )}
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
                    <span>Couldn’t load live data: {invState.error}</span>
                    <span className="bx" onClick={onSync}>
                        Retry
                    </span>
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
                    <div className="card">
                        <div className="card-head">
                            <h3>
                                Today’s menu ·{" "}
                                {DOW_FULL[new Date().getDay()]}
                            </h3>
                            <span
                                className="ch-link"
                                onClick={() => go("menu")}
                                style={{ cursor: "pointer" }}
                            >
                                Full menu →
                            </span>
                        </div>
                        <div
                            className="card-body"
                            style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: 11,
                            }}
                        >
                            {menuLoading ? (
                                <div
                                    style={{
                                        fontSize: 12,
                                        color: "var(--faint)",
                                    }}
                                >
                                    Loading menu…
                                </div>
                            ) : menuMeals.length === 0 ? (
                                <div
                                    style={{
                                        fontSize: 12,
                                        color: "var(--faint)",
                                    }}
                                >
                                    No menu for today.
                                </div>
                            ) : (
                                menuMeals.map((meal) => (
                                    <div key={meal} className="dash-meal">
                                        <div className="dm-head">{meal}</div>
                                        <div className="dm-items">
                                            {meal === "Snack"
                                                ? menuData[meal].join(" · ")
                                                : menuData[meal]
                                                      .map((it: any) =>
                                                          typeof it === "string"
                                                              ? it
                                                              : it.item,
                                                      )
                                                      .join(" · ")}
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    <div className="card">
                        <div className="card-head">
                            <h3>Inventory value by category</h3>
                            <span
                                className="ch-link"
                                onClick={() => go("inventory")}
                                style={{ cursor: "pointer" }}
                            >
                                Live
                            </span>
                        </div>
                        <div className="card-body flush">
                            {catRows.map((c: any) => (
                                <div className="cat-row" key={c.name}>
                                    <span
                                        className="cat-dot"
                                        style={{ background: c.color }}
                                    ></span>
                                    <span className="cat-nm">{c.name}</span>
                                    <span className="cat-bar">
                                        <span
                                            className="cat-fill"
                                            style={{
                                                width: c.pct + "%",
                                                background: c.color,
                                            }}
                                        ></span>
                                    </span>
                                    <span className="cat-val">{c.val}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="card">
                        <div className="card-head">
                            <h3>Inventory alerts</h3>
                            <span className="viol-pill" style={{ margin: 0 }}>
                                {I.alert({ style: { width: 13, height: 13 } })}{" "}
                                {reorderList.length} below par
                            </span>
                        </div>
                        <div className="card-body">
                            {reorderList.length === 0 ? (
                                <div
                                    style={{
                                        fontSize: 12,
                                        color: "var(--faint)",
                                    }}
                                >
                                    All items at or above par level.
                                </div>
                            ) : (
                                <div className="alert-chips">
                                    {reorderList
                                        .slice(0, 12)
                                        .map((r: any, i: number) => (
                                            <span
                                                className="alert-chip"
                                                key={i}
                                            >
                                                {r.desc}
                                                <b>
                                                    {r.onHand || 0}/{r.par}
                                                </b>
                                            </span>
                                        ))}
                                    {reorderList.length > 12 && (
                                        <span
                                            className="alert-more"
                                            onClick={() => go("inventory")}
                                        >
                                            +{reorderList.length - 12} more
                                            →
                                        </span>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 16,
                    }}
                >
                    <div className="card">
                        <div className="card-head">
                            <h3>Meal log · today</h3>
                            <span
                                className="ch-link"
                                onClick={() => go("mballot")}
                                style={{ cursor: "pointer" }}
                            >
                                Full log →
                            </span>
                        </div>
                        <div className="card-body">
                            <div className="dash-meal-counts">
                                {[
                                    ["Breakfast", mlTotals.B],
                                    ["Lunch", mlTotals.L],
                                    ["Dinner", mlTotals.D],
                                    ["Tickets", mlTotals.T],
                                ].map(([l, n]) => (
                                    <div className="dmc" key={l as string}>
                                        <span className="dmc-n">
                                            {n as number}
                                        </span>
                                        <span className="dmc-l">
                                            {l as string}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="card">
                        <div className="card-head">
                            <h3>Monthly inventory · {MONTHS[period[0]]}</h3>
                            <span
                                className="ch-link"
                                onClick={() => go("moninv")}
                                style={{ cursor: "pointer" }}
                            >
                                Manage →
                            </span>
                        </div>
                        <div className="card-body">
                            <div className="mi-mini">
                                <div
                                    className="mim"
                                    style={{ background: "#EEF2F8" }}
                                >
                                    <span
                                        className="mim-l"
                                        style={{ color: "#1B3A6B" }}
                                    >
                                        Opening
                                    </span>
                                    <span className="mim-v">
                                        {fmtMoney(miSum.open)}
                                    </span>
                                </div>
                                <div
                                    className="mim"
                                    style={{ background: "#F0FDF4" }}
                                >
                                    <span
                                        className="mim-l"
                                        style={{ color: "#166534" }}
                                    >
                                        Received
                                    </span>
                                    <span
                                        className="mim-v"
                                        style={{ color: "#166534" }}
                                    >
                                        {fmtMoney(miSum.recv)}
                                    </span>
                                </div>
                                <div
                                    className="mim"
                                    style={{ background: "#EFF5FE" }}
                                >
                                    <span
                                        className="mim-l"
                                        style={{ color: "#1660C8" }}
                                    >
                                        Closing
                                    </span>
                                    <span
                                        className="mim-v"
                                        style={{ color: "#1660C8" }}
                                    >
                                        {fmtMoney(miSum.close)}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="card">
                        <div className="card-head">
                            <h3>Upcoming events</h3>
                            <span
                                className="ch-link"
                                onClick={() => go("events")}
                                style={{ cursor: "pointer" }}
                            >
                                Calendar →
                            </span>
                        </div>
                        <div className="card-body flush">
                            {eventsLoading ? (
                                <div
                                    style={{
                                        padding: 12,
                                        fontSize: 12,
                                        color: "var(--faint)",
                                    }}
                                >
                                    Loading events…
                                </div>
                            ) : upcoming.slice(0, 4).length === 0 ? (
                                <div
                                    style={{
                                        padding: 12,
                                        fontSize: 12,
                                        color: "var(--faint)",
                                    }}
                                >
                                    No upcoming events.
                                </div>
                            ) : (
                                upcoming.slice(0, 4).map((e: any) => (
                                    <div
                                        className="up-ev"
                                        key={e.id}
                                        onClick={() => go("events")}
                                    >
                                        <span
                                            className="up-dot"
                                            style={{ background: "#64748B" }}
                                        ></span>
                                        <span className="up-title">
                                            {e.title}
                                        </span>
                                        <span className="up-date">
                                            {fmtShort(e.date)}
                                        </span>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    <div className="card">
                        <div className="card-head">
                            <h3>Quick actions</h3>
                        </div>
                        <div className="card-body">
                            <div className="qa-grid">
                                {QUICK.map((q) => (
                                    <button
                                        className="qa-btn"
                                        key={q.to}
                                        onClick={() => go(q.to)}
                                    >
                                        {I[q.icon]({
                                            style: { width: 15, height: 15 },
                                        })}
                                        <span>{q.label}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function InventoryView({
    user,
    period,
    invState,
    onSync,
    openSC,
    scCount,
}: {
    user: User;
    period: [number, number];
    invState: any;
    onSync: () => void;
    openSC?: () => void;
    scCount?: number;
}) {
    const lvl = ROLE_LEVEL[user.role];
    const canStage = lvl >= 10;
    const canEditPar = lvl >= 30;
    const [q, setQ] = useState("");
    const [cat, setCat] = useState("");
    const [draft, setDraft] = useState<
        Record<string, { onHand: number; par: number }>
    >({});
    // Holds the last-staged values per SKU so inputs keep showing the staged
    // value after draft is cleared (staging queues via SC, not direct DB write).
    const [stagedValues, setStagedValues] = useState<
        Record<string, { onHand: number; par: number }>
    >({});
    const [stagingBusy, setStagingBusy] = useState<Record<string, boolean>>({});
    const [viewMode, setViewMode] = useState<
        "regular" | "grouped" | "compact"
    >("regular");
    const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
    const toggleCat = (c: string) =>
        setCollapsed((p) => ({ ...p, [c]: !p[c] }));

    // Add-item modal (creates a new inventory_items row via the inventory_save
    // staging path — a new SKU upserts as a new item on approval).
    const [showAddItem, setShowAddItem] = useState(false);
    const [addBusy, setAddBusy] = useState(false);
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
    });
    const [editBusy, setEditBusy] = useState(false);
    const openEdit = (row: any) => {
        setEditTarget(row);
        setEditForm({
            desc: row.desc || "",
            category: row.cat || "",
            price: String(row.price ?? ""),
            par: String(row.par ?? ""),
        });
    };

    // Authoritative category list from the API (includes empty categories like
    // "New Items"), so the add/edit dropdowns can target a bucket even when no
    // item is in it yet. Falls back to item-derived names if the fetch fails.
    const [apiCatNames, setApiCatNames] = useState<string[]>([]);
    useEffect(() => {
        let alive = true;
        api.getInventoryCategories()
            .then((rows: any[]) => {
                if (alive && Array.isArray(rows))
                    setApiCatNames(rows.map((c) => c.name).filter(Boolean));
            })
            .catch(() => {});
        return () => {
            alive = false;
        };
    }, []);

    // Weekly pulled (issued, ↓) / received (↑) columns — mirrors the offline
    // template's compact sheet. Edits live in local `wkDraft` and are persisted
    // via the "Stage weekly changes" batch action (stageCompactChanges), which
    // routes through Source Control like the Monthly Inventory view.
    const ISSUED = ["w1i", "w2i", "w3i", "w4i"] as const; // pulled ↓
    const RECEIVED = ["w1r", "w2r", "w3r", "w4r"] as const; // delivered ↑
    type WeeklyField = (typeof ISSUED)[number] | (typeof RECEIVED)[number];
    const [wkDraft, setWkDraft] = useState<
        Record<string, Partial<Record<WeeklyField, number>>>
    >({});

    // Invoice mode selectors: which week (1-4) and direction this staging batch
    // represents. 0 = whole-month save (inventory_save). When week>0, the batch
    // is routed as inventory_week_update for that specific column only.
    const [compactWeek, setCompactWeek] = useState<0 | 1 | 2 | 3 | 4>(0);
    const [compactDir, setCompactDir] = useState<"received" | "issued">("received");
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
                // Invoice mode: stage as inventory_week_update for the chosen week+direction.
                // Only the single selected column is written; other weeks are untouched.
                const colKey = `w${compactWeek}${compactDir === "received" ? "r" : "i"}` as WeeklyField;
                const wkItems = dirty
                    .filter((r: any) => wkDraft[String(r.sku || "")] !== undefined)
                    .map((r: any) => {
                        const sku = String(r.sku);
                        const qty = wkDraft[sku]?.[colKey] ?? (r[colKey] ?? 0);
                        return { sku, desc: r.desc, category: r.cat, price: r.price, par: r.par, qty };
                    });
                // Rows with on_hand/par edits need an inventory_save regardless of
                // whether they also have wkDraft entries — both changes are staged independently.
                const monthItems = dirty
                    .filter((r: any) => {
                        const sku = String(r.sku || "");
                        return Boolean(draft[sku]);
                    })
                    .map((r: any) => {
                        const sku = String(r.sku);
                        const d = draft[sku];
                        return { sku, desc: r.desc, category: r.cat, price: r.price, onHand: d?.onHand ?? r.onHand, par: d?.par ?? r.par };
                    });
                const ops: Promise<any>[] = [];
                if (wkItems.length) {
                    ops.push(api.stageChange(
                        "inventory_week_update",
                        "inventory",
                        `W${compactWeek}-${compactDir}-${month1}-${yr}`,
                        { month: month1, year: yr, week: compactWeek, direction: compactDir, review_new: true, items: wkItems },
                        `W${compactWeek} ${compactDir} · ${wkItems.length} item${wkItems.length !== 1 ? "s" : ""}`,
                    ));
                }
                if (monthItems.length) {
                    ops.push(api.stageChange(
                        "inventory_save",
                        "inventory",
                        `batch-compact-${month1}-${yr}`,
                        { month: month1, year: yr, notes: `On-hand update · ${MONTHS[period[0]]} ${yr}`, items: monthItems },
                        `On-hand update · ${monthItems.length} item${monthItems.length !== 1 ? "s" : ""}`,
                    ));
                }
                await Promise.all(ops);
                toast(`Staged W${compactWeek} ${compactDir} invoice · ${n} item${n !== 1 ? "s" : ""}`);
                openSC?.();
            } else {
                // Whole-month save: on_hand/par + any explicitly-edited weekly columns.
                // Only w* keys present in wkDraft are included, so unedited weeks are preserved.
                const items = dirty.map((r: any) => {
                    const sku = String(r.sku);
                    const d = draft[sku];
                    const w = wkDraft[sku] || {};
                    const base: any = {
                        sku, desc: r.desc, category: r.cat, price: r.price,
                        onHand: d?.onHand ?? r.onHand,
                        par: d?.par ?? r.par,
                    };
                    // Spread only explicitly-edited weekly fields
                    for (const k of ["w1r","w2r","w3r","w4r","w1i","w2i","w3i","w4i"] as WeeklyField[]) {
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
        setEditBusy(true);
        try {
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

    const live = invState.inv;
    let rows: any[], cats: string[];
    if (live) {
        rows = invToList(invState.inv).map((it: any) => ({
            sku: it.sku,
            desc: it.desc,
            cat: it.cat,
            price: it.price || 0,
            onHand: it.onHand || 0,
            par: it.par || 0,
            w1i: it.w1i || 0,
            w2i: it.w2i || 0,
            w3i: it.w3i || 0,
            w4i: it.w4i || 0,
            w1r: it.w1r || 0,
            w2r: it.w2r || 0,
            w3r: it.w3r || 0,
            w4r: it.w4r || 0,
            status:
                (it.onHand || 0) < (it.par || 0) && (it.par || 0) > 0
                    ? "low"
                    : "ok",
            value: iTotal(it),
        }));
        cats = [...new Set(rows.map((r: any) => r.cat))];
    } else {
        rows = [];
        cats = [];
    }
    // Dropdown options: API categories first (authoritative + ordered, includes
    // empty buckets like "New Items"), then any item-only categories not in it.
    const catOptions = apiCatNames.length
        ? Array.from(new Set([...apiCatNames, ...cats]))
        : cats;
    const filtered = rows.filter(
        (r: any) =>
            (!cat || r.cat === cat) &&
            (!q ||
                (r.desc || "").toLowerCase().includes(q.toLowerCase()) ||
                String(r.sku || "").includes(q)),
    );

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
                    <button className="btn">{I.scan()} Scan</button>
                    <button className="btn" onClick={onSync}>
                        {I.refresh()} Refresh
                    </button>
                    {canStage && Object.keys(draft).length > 0 && (
                        <span className="pill warn">
                            {Object.keys(draft).length} pending change
                            {Object.keys(draft).length !== 1 ? "s" : ""}
                        </span>
                    )}
                    {openSC && (scCount ?? 0) > 0 && (
                        <button
                            className="btn sc-staged-pill"
                            onClick={openSC}
                            title="Open Source Control"
                        >
                            {I.branch({ style: { width: 13, height: 13 } })}
                            {scCount} staged
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
                    <span>Couldn’t load live data: {invState.error}</span>
                    <span className="bx" onClick={onSync}>
                        Retry
                    </span>
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
                    </div>
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
                                    {canStage && (
                                        <th className="r">SourceCtrl</th>
                                    )}
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
                                    const hasDraft = Boolean(staged);
                                    return (
                                        <tr key={(r.sku || "") + i}>
                                            <td
                                                className="num"
                                                style={{
                                                    color: "var(--muted)",
                                                }}
                                            >
                                                {r.sku || "—"}
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
                                            {canStage && (
                                                <td className="r">
                                                    <button
                                                        className="btn"
                                                        disabled={!sku}
                                                        style={{
                                                            padding: "5px 10px",
                                                            marginRight: 6,
                                                        }}
                                                        onClick={() =>
                                                            openEdit(r)
                                                        }
                                                        title="Edit / reassign / delete this item"
                                                    >
                                                        Edit
                                                    </button>
                                                    <button
                                                        className="btn"
                                                        disabled={
                                                            !hasDraft ||
                                                            !sku ||
                                                            Boolean(
                                                                stagingBusy[
                                                                    sku
                                                                ],
                                                            )
                                                        }
                                                        style={{
                                                            padding: "5px 10px",
                                                        }}
                                                        onClick={() =>
                                                            stageInventoryRow({
                                                                ...r,
                                                                onHand,
                                                                par,
                                                            })
                                                        }
                                                        title="Stage this row in Source Control"
                                                    >
                                                        {stagingBusy[sku]
                                                            ? "Staging…"
                                                            : "Stage"}
                                                    </button>
                                                </td>
                                            )}
                                        </tr>
                                    );
                                })}
                                {!filtered.length && (
                                    <tr>
                                        <td
                                            colSpan={canStage ? 9 : 8}
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
                                                                {canStage && (
                                                                    <th className="r">
                                                                        SourceCtrl
                                                                    </th>
                                                                )}
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
                                                                    const hasDraft =
                                                                        Boolean(
                                                                            staged,
                                                                        );
                                                                    return (
                                                                        <tr
                                                                            key={
                                                                                (r.sku ||
                                                                                    "") +
                                                                                i
                                                                            }
                                                                        >
                                                                            <td
                                                                                className="num"
                                                                                style={{
                                                                                    color: "var(--muted)",
                                                                                }}
                                                                            >
                                                                                {r.sku ||
                                                                                    "—"}
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
                                                                            {canStage && (
                                                                                <td className="r">
                                                                                    <button
                                                                                        className="btn"
                                                                                        disabled={!sku}
                                                                                        style={{
                                                                                            padding: "5px 10px",
                                                                                            marginRight: 6,
                                                                                        }}
                                                                                        onClick={() => openEdit(r)}
                                                                                        title="Edit / reassign / delete this item"
                                                                                    >
                                                                                        Edit
                                                                                    </button>
                                                                                    <button
                                                                                        className="btn"
                                                                                        disabled={
                                                                                            !hasDraft ||
                                                                                            !sku ||
                                                                                            Boolean(
                                                                                                stagingBusy[sku],
                                                                                            )
                                                                                        }
                                                                                        style={{
                                                                                            padding: "5px 10px",
                                                                                        }}
                                                                                        onClick={() =>
                                                                                            stageInventoryRow({
                                                                                                ...r,
                                                                                                onHand,
                                                                                                par,
                                                                                            })
                                                                                        }
                                                                                        title="Stage this row in Source Control"
                                                                                    >
                                                                                        {stagingBusy[sku]
                                                                                            ? "Staging…"
                                                                                            : "Stage"}
                                                                                    </button>
                                                                                </td>
                                                                            )}
                                                                        </tr>
                                                                    );
                                                                },
                                                            )}
                                                        </tbody>
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
                                    const busy = Boolean(
                                        stagingBusy["__compact__"],
                                    );
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
                                                    : "Invoice mode — pick week & direction, enter quantities, stage"}
                                            </span>
                                            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                                                <select
                                                    className="tb-select"
                                                    value={compactWeek}
                                                    onChange={(e) => setCompactWeek(+e.target.value as 0|1|2|3|4)}
                                                    style={{ fontSize: 12 }}
                                                    title="Which week's invoice is this?"
                                                >
                                                    <option value={0}>Month save</option>
                                                    <option value={1}>W1 Invoice</option>
                                                    <option value={2}>W2 Invoice</option>
                                                    <option value={3}>W3 Invoice</option>
                                                    <option value={4}>W4 Invoice</option>
                                                </select>
                                                {compactWeek > 0 && (
                                                    <select
                                                        className="tb-select"
                                                        value={compactDir}
                                                        onChange={(e) => setCompactDir(e.target.value as "received" | "issued")}
                                                        style={{ fontSize: 12 }}
                                                    >
                                                        <option value="received">Received ↑</option>
                                                        <option value="issued">Issued ↓</option>
                                                    </select>
                                                )}
                                                <button
                                                    className="btn"
                                                    disabled={!dirtyCount || busy}
                                                    style={{ padding: "6px 12px" }}
                                                    onClick={stageCompactChanges}
                                                    title={compactWeek > 0
                                                        ? `Stage W${compactWeek} ${compactDir} invoice in Source Control`
                                                        : "Stage all edits in Source Control"}
                                                >
                                                    {busy
                                                        ? "Staging…"
                                                        : compactWeek > 0
                                                            ? `Stage W${compactWeek} ${compactDir}`
                                                            : "Stage changes"}
                                                </button>
                                            </div>
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
                                        const rcv = RECEIVED.reduce(
                                            (a, k) => a + wk(r, k),
                                            0,
                                        );
                                        const iss = ISSUED.reduce(
                                            (a, k) => a + wk(r, k),
                                            0,
                                        );
                                        return (
                                            Math.max(0, oh + rcv - iss) *
                                            (r.price || 0)
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
                                                                <th className="r">
                                                                    W1↓
                                                                </th>
                                                                <th className="r">
                                                                    W2↓
                                                                </th>
                                                                <th className="r">
                                                                    W3↓
                                                                </th>
                                                                <th className="r">
                                                                    W4↓
                                                                </th>
                                                                <th className="r wk-rcv">
                                                                    W1↑
                                                                </th>
                                                                <th className="r wk-rcv">
                                                                    W2↑
                                                                </th>
                                                                <th className="r wk-rcv">
                                                                    W3↑
                                                                </th>
                                                                <th className="r wk-rcv">
                                                                    W4↑
                                                                </th>
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
                                                                                rcv
                                                                                    ? "rcvd"
                                                                                    : ""
                                                                            }
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
                                                                                {r.sku ||
                                                                                    "—"}
                                                                            </td>
                                                                            <td className="r num">
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
                                                                            {ISSUED.map(
                                                                                (
                                                                                    k,
                                                                                ) => (
                                                                                    <td
                                                                                        className="r num"
                                                                                        key={
                                                                                            k
                                                                                        }
                                                                                    >
                                                                                        {canStage ? (
                                                                                            <input
                                                                                                className="cinp"
                                                                                                type="number"
                                                                                                min={
                                                                                                    0
                                                                                                }
                                                                                                value={wk(
                                                                                                    r,
                                                                                                    k,
                                                                                                )}
                                                                                                onChange={(
                                                                                                    e,
                                                                                                ) =>
                                                                                                    setWeeklyField(
                                                                                                        sku,
                                                                                                        k,
                                                                                                        e
                                                                                                            .target
                                                                                                            .value,
                                                                                                    )
                                                                                                }
                                                                                            />
                                                                                        ) : (
                                                                                            wk(
                                                                                                r,
                                                                                                k,
                                                                                            )
                                                                                        )}
                                                                                    </td>
                                                                                ),
                                                                            )}
                                                                            {RECEIVED.map(
                                                                                (
                                                                                    k,
                                                                                ) => (
                                                                                    <td
                                                                                        className="r num wk-rcv"
                                                                                        key={
                                                                                            k
                                                                                        }
                                                                                    >
                                                                                        {canStage ? (
                                                                                            <input
                                                                                                className="cinp wk-rcv-inp"
                                                                                                type="number"
                                                                                                min={
                                                                                                    0
                                                                                                }
                                                                                                value={wk(
                                                                                                    r,
                                                                                                    k,
                                                                                                )}
                                                                                                onChange={(
                                                                                                    e,
                                                                                                ) =>
                                                                                                    setWeeklyField(
                                                                                                        sku,
                                                                                                        k,
                                                                                                        e
                                                                                                            .target
                                                                                                            .value,
                                                                                                    )
                                                                                                }
                                                                                            />
                                                                                        ) : (
                                                                                            wk(
                                                                                                r,
                                                                                                k,
                                                                                            )
                                                                                        )}
                                                                                    </td>
                                                                                ),
                                                                            )}
                                                                            <td
                                                                                className="r num"
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
                                                                    colSpan={9}
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
        </div>
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
                await api.updateUser(editing.id, {
                    display_name: displayName,
                    last_name: form.last_name.trim(),
                    role: form.role,
                    pin: form.role === "staff" ? form.pin : null,
                    active: form.active,
                    phone: form.phone || undefined,
                    job_title: form.job_title || undefined,
                    bio: form.bio || undefined,
                    avatar_url: form.avatar_url || undefined,
                });
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
    return (
        <div className="fade-in">
            <div className="page-head">
                <div>
                    <h2>Users &amp; Access</h2>
                    <div className="ph-sub">
                        {users.length} accounts · role-based access control
                        {!isSudo && " · read-only view"}
                    </div>
                </div>
                {isSudo && (
                    <div className="ph-actions">
                        <button className="btn primary" onClick={openCreate}>
                            {I.plus()} Invite user
                        </button>
                    </div>
                )}
            </div>

            {state.loading && <Loading label="Loading directory…" />}
            {state.error && (
                <div className="banner warn">
                    {I.alert()}
                    <span>Couldn’t load users: {state.error}</span>
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
                <div className="modal-back" onClick={() => setShowForm(false)}>
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
                const low = items.filter((i: any) => i.onHand < i.par);
                const value = items.reduce(
                    (sum: number, i: any) => sum + i.onHand * (i.price || 0),
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
                    value,
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
                    <button className="btn">{I.download()} Export all</button>
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
                                    {fmtMoney(a.value)}
                                </div>
                                <div
                                    className="sc-delta eq"
                                    style={{ marginTop: 4 }}
                                >
                                    {a.items} items · {a.low} below par
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
                                        <th className="r">On-Hand Value</th>
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
                                                {fmtMoneyFull(a.value)}
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
 */
function RolloverBanner({ user, onDone }: { user: User; onDone: () => void }) {
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
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [scPanelOpen, setScPanelOpen] = useState(false);
    const [invState, reloadInv] = useInventory();
    const [stagedCount, setStagedCount] = useState(0);
    useEffect(() => {
        (window as any).__logout = onLogout;
    }, [onLogout]);

    // Reload inventory automatically when a commit is applied
    useEffect(() => {
        const handler = () => reloadInv();
        window.addEventListener('mjcc:committed', handler);
        return () => window.removeEventListener('mjcc:committed', handler);
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
    const goTo = (routeKey: string) => {
        setSidebarOpen(false);
        if (routeKey === "sourcectrl") {
            setScPanelOpen((v) => !v);
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
                <InventoryView
                    {...common}
                    openSC={() => setScPanelOpen(true)}
                    scCount={stagedCount}
                />
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
            return <MonthlyInventory user={user} period={period} openSC={() => setScPanelOpen(true)} />;
        if (active === "reports")
            return <Reports user={user} period={period} />;
        if (active === "dataentry") return <DataEntry user={user} onNavigate={goTo} />;
        if (active === "users") return <UsersView user={user} />;
        if (active === "archives") return <ArchivesView period={period} />;
        if (active === "settings") return <Settings user={user} />;
        if (active === "ai-usage")   return <AIUsageView user={user} />;
        if (active === "ai-tools")   return <AIToolsView user={user} />;
        if (active === "ai-presets") return <AIPresetsView user={user} />;
        return <PlaceholderPage pageKey={active} />;
    };

    const portalCls = 'portal' + (sidebarOpen ? ' sidebar-open' : '');
    const toggleSidebar = () => setSidebarOpen((v) => !v);

    return (
        <div className={portalCls + (scPanelOpen ? " sc-open" : "")} data-density={density}>
            <Topbar
                user={user}
                period={period}
                setPeriod={setPeriod}
                sidebarOpen={sidebarOpen}
                toggleSidebar={toggleSidebar}
                scOpen={scPanelOpen}
                onToggleSC={() => setScPanelOpen((v) => !v)}
                scCount={stagedCount}
            />
            <Sidebar
                user={user}
                active={active}
                setActive={(k) => {
                    goTo(k);
                    setSidebarOpen(false);
                }}
                reorderCount={reorderCount}
                stagedCount={stagedCount}
            />
            {sidebarOpen && (
                <div
                    className="sidebar-overlay"
                    onClick={() => setSidebarOpen(false)}
                />
            )}
            <main className="main">
                <RolloverBanner user={user} onDone={doSync} />
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
            <SourceControlPanel
                user={user}
                open={scPanelOpen}
                onClose={() => setScPanelOpen(false)}
                onCountChange={(n) => setStagedCount(n)}
            />
            <AgentBubble user={user} />
        </div>
    );
}
