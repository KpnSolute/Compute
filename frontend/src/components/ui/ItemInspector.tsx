import { useState, useEffect, useMemo, useCallback } from "react";
import { I } from "../../lib/icons";
import { api } from "../../lib/api";
import { catColor, fmtMoneyFull } from "../../lib/supabase";
import { MONTHS } from "../../lib/constants";

export interface InspectRow {
    id: string;
    sku: string;
    desc: string;
    cat: string;
    price: number;
    onHand: number;
    par: number;
    unit?: string;
    active?: boolean;
    needs_attention?: boolean;
    w1p: number; w2p: number; w3p: number;
    w1r: number; w2r: number; w3r: number;
    totalReceived?: number;
    totalPulled?: number;
    closingQty?: number;
    value?: number;
}

interface ItemInspectorProps {
    row: InspectRow;
    period: [number, number];
    lvl: number;
    maxWeeks: number;
    weekLockStatus: Record<number, string>;
    initialWeek: number; // 1-4; the week the editor was focused on
    onClose: () => void;
    onStaged: () => void; // openSC + refresh badges
    onSync: () => void; // reload live inventory
    onEditDetails: (row: InspectRow) => void; // open the full edit modal
}

const toast = (msg: string) => (window as any).toast?.(msg);
const num = (v: string, fallback = 0) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? Math.max(0, n) : fallback;
};

/**
 * Roster-style floating inspector for a single inventory item. Slides in from
 * the right; surfaces the essential per-item tools (receive ↑ / pull ↓ for a
 * chosen week, on-hand / par / price adjusters) in one toolbar. Every action
 * routes through the same Source Control staging ops the table uses
 * (inventory_week_update + inventory_save), so nothing bypasses the audit path.
 */
export function ItemInspector({
    row,
    period,
    lvl,
    maxWeeks,
    weekLockStatus,
    initialWeek,
    onClose,
    onStaged,
    onSync,
    onEditDetails,
}: ItemInspectorProps) {
    const canStage = lvl >= 10;
    const canManage = lvl >= 30; // issued, par, price
    const month1 = period[0] + 1;
    const yr = period[1];

    const [week, setWeek] = useState<number>(
        Math.min(Math.max(1, initialWeek || 1), Math.max(1, maxWeeks)),
    );
    const weekLocked = (weekLockStatus[week] || "open") !== "open";
    const canRcv = canStage && !weekLocked;
    const canIss = canManage && !weekLocked;

    // Working values — initialised from the row, re-seeded when the row or the
    // selected week changes.
    const [rcv, setRcv] = useState(0);
    const [iss, setIss] = useState(0);
    const [onHand, setOnHand] = useState(0);
    const [par, setPar] = useState(0);
    const [price, setPrice] = useState(0);
    const [busy, setBusy] = useState(false);

    const seed = useCallback(() => {
        setRcv((row as any)[`w${week}r`] || 0);
        setIss((row as any)[`w${week}i`] || 0);
        setOnHand(row.onHand || 0);
        setPar(row.par || 0);
        setPrice(row.price || 0);
    }, [row, week]);

    useEffect(() => { seed(); }, [seed]);

    // Esc to close
    useEffect(() => {
        const h = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [busy, onClose]);

    const baseRcv = (row as any)[`w${week}r`] || 0;
    const baseIss = (row as any)[`w${week}p`] || 0;

    const rcvDirty = canRcv && rcv !== baseRcv;
    const issDirty = canIss && iss !== baseIss;
    const onHandDirty = canStage && onHand !== (row.onHand || 0);
    const parDirty = canManage && par !== (row.par || 0);
    const priceDirty = canManage && price !== (row.price || 0);
    const detailDirty = onHandDirty || parDirty || priceDirty;
    const dirty = rcvDirty || issDirty || detailDirty;

    // Projected closing balance using the working week overrides.
    const projection = useMemo(() => {
        let totalRcv = 0, totalPulled = 0;
        for (let w = 1; w <= 3; w++) {
            totalRcv += w === week ? rcv : (row as any)[`w${w}r`] || 0;
            totalPulled += w === week ? iss : (row as any)[`w${w}p`] || 0;
        }
        const closing = Math.max(0, onHand + totalRcv - totalPulled);
        return { totalRcv, totalIss: totalPulled, closing, value: closing * price };
    }, [row, week, rcv, iss, onHand, price]);

    const isLow = projection.closing < par && par > 0;

    async function stageAll() {
        if (!dirty || busy) return;
        setBusy(true);
        try {
            const ops: Promise<any>[] = [];
            if (rcvDirty) {
                ops.push(api.stageChange(
                    "inventory_week_update", "inventory",
                    `${row.sku}-W${week}-received-${month1}-${yr}`,
                    {
                        month: month1, year: yr, week, direction: "received", review_new: true,
                        items: [{ sku: row.sku, desc: row.desc, category: row.cat, price, par, qty: rcv }],
                    },
                    `W${week} received · ${row.desc} → ${rcv}`,
                ));
            }
            if (issDirty) {
                ops.push(api.stageChange(
                    "inventory_week_update", "inventory",
                    `${row.sku}-W${week}-issued-${month1}-${yr}`,
                    {
                        month: month1, year: yr, week, direction: "issued", review_new: true,
                        items: [{ sku: row.sku, desc: row.desc, category: row.cat, price, par, qty: iss }],
                    },
                    `W${week} issued · ${row.desc} → ${iss}`,
                ));
            }
            if (detailDirty) {
                ops.push(api.stageChange(
                    "inventory_save", "inventory",
                    `${row.sku}-${month1}-${yr}`,
                    {
                        month: month1, year: yr,
                        notes: `Inventory edit · ${MONTHS[period[0]]} ${yr}`,
                        items: [{ sku: row.sku, desc: row.desc, category: row.cat, onHand, par, price }],
                    },
                    `Inventory update · ${row.desc}`,
                ));
            }
            await Promise.all(ops);
            const parts = [
                rcvDirty ? "received" : "",
                issDirty ? "issued" : "",
                detailDirty ? "details" : "",
            ].filter(Boolean).join(" · ");
            toast(`Staged ${row.desc} — ${parts}`);
            onStaged();
            onSync();
            onClose();
        } catch (e: any) {
            toast(`Failed to stage: ${e?.message || "Unknown error"}`);
        } finally {
            setBusy(false);
        }
    }

    const accent = catColor(row.cat);

    return (
        <div className="ins-overlay" onClick={() => !busy && onClose()}>
            <aside
                className="ins-drawer"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-label={`Inventory item ${row.desc}`}
            >
                {/* ── Header ── */}
                <header className="ins-head" style={{ ["--ins-accent" as any]: accent }}>
                    <div className="ins-head-row">
                        <span className="ins-cat-chip">
                            <span className="ins-cat-dot" style={{ background: accent }} />
                            {row.cat || "Uncategorized"}
                        </span>
                        <button className="ins-x" onClick={onClose} disabled={busy} aria-label="Close">
                            {I.x()}
                        </button>
                    </div>
                    <h3 className="ins-title">{row.desc}</h3>
                    <div className="ins-sub">
                        <span className="ins-sku mono">{row.sku || "—"}</span>
                        <span className="ins-dot-sep">·</span>
                        <span>{MONTHS[period[0]]} {yr}</span>
                        {row.unit && <><span className="ins-dot-sep">·</span><span>{row.unit}</span></>}
                        {row.needs_attention && <span className="pill warn" style={{ fontSize: 9 }}>Uncategorized</span>}
                    </div>
                </header>

                {/* ── Stat tiles ── */}
                <div className="ins-stats">
                    <div className="ins-stat">
                        <div className="ins-stat-lbl">On hand</div>
                        <div className="ins-stat-val">{onHand}</div>
                    </div>
                    <div className="ins-stat">
                        <div className="ins-stat-lbl">Projected close</div>
                        <div className="ins-stat-val">{projection.closing}</div>
                    </div>
                    <div className="ins-stat">
                        <div className="ins-stat-lbl">Value</div>
                        <div className="ins-stat-val">{fmtMoneyFull(projection.value)}</div>
                    </div>
                    <div className="ins-stat">
                        <div className="ins-stat-lbl">Status</div>
                        <div className="ins-stat-val">
                            {isLow
                                ? <span className="pill warn">Below par</span>
                                : <span className="pill ok">In stock</span>}
                        </div>
                    </div>
                </div>

                <div className="ins-body">
                    {/* ── Week selector ── */}
                    <div className="ins-section">
                        <div className="ins-section-lbl">Week</div>
                        <div className="ins-week-seg">
                            {Array.from({ length: Math.min(maxWeeks, 4) }, (_, i) => i + 1).map((w) => {
                                const locked = (weekLockStatus[w] || "open") !== "open";
                                return (
                                    <button
                                        key={w}
                                        className={"ins-week-btn" + (week === w ? " active" : "")}
                                        onClick={() => setWeek(w)}
                                        title={locked ? `Week ${w} is locked` : undefined}
                                    >
                                        W{w}
                                        {locked && I.lock({ style: { width: 10, height: 10, marginLeft: 3 } })}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {weekLocked && (
                        <div className="banner info" style={{ margin: "0 0 4px" }}>
                            {I.lock({ style: { width: 14, height: 14 } })}
                            <span>Week {week} is locked — quantities are read-only.</span>
                        </div>
                    )}

                    {/* ── Receive ↑ ── */}
                    <Stepper
                        label={`Received this week`}
                        hint={`Deliveries logged into W${week}`}
                        tone="green"
                        icon={I.up({ style: { width: 15, height: 15 } })}
                        value={rcv}
                        base={baseRcv}
                        disabled={!canRcv}
                        onChange={setRcv}
                    />

                    {/* ── Pull / issue ↓ ── */}
                    <Stepper
                        label={`Pulled this week`}
                        hint={canManage ? `Issued / used out of W${week}` : "Manager only"}
                        tone="amber"
                        icon={I.down({ style: { width: 15, height: 15 } })}
                        value={iss}
                        base={baseIss}
                        disabled={!canIss}
                        onChange={setIss}
                    />

                    {/* ── On-hand / Par / Price ── */}
                    <div className="ins-section">
                        <div className="ins-section-lbl">Levels</div>
                        <div className="ins-field-grid">
                            <NumField label="On hand" value={onHand} disabled={!canStage} onChange={setOnHand} />
                            <NumField label="Par" value={par} disabled={!canManage} onChange={setPar} />
                            <NumField label="Unit price ($)" value={price} step={0.01} disabled={!canManage} onChange={setPrice} money />
                        </div>
                        {!canManage && (
                            <div className="ins-note">Par, price and issued are manager-only.</div>
                        )}
                    </div>
                </div>

                {/* ── Footer toolbar ── */}
                <footer className="ins-foot">
                    <div className="ins-foot-secondary">
                        <button
                            className="btn"
                            onClick={() => { onEditDetails(row); onClose(); }}
                            disabled={busy || !canStage}
                            title="Rename, recategorize, re-SKU or delete"
                        >
                            {I.edit({ style: { width: 14, height: 14 } })} Details
                        </button>
                        <button className="btn" onClick={() => { seed(); }} disabled={busy || !dirty} title="Revert unsaved changes">
                            {I.refresh({ style: { width: 14, height: 14 } })} Reset
                        </button>
                    </div>
                    <button
                        className="btn primary ins-stage-btn"
                        onClick={stageAll}
                        disabled={busy || !dirty}
                    >
                        {I.branch({ style: { width: 14, height: 14 } })}
                        {busy ? "Staging…" : dirty ? "Stage changes" : "No changes"}
                    </button>
                </footer>
            </aside>
        </div>
    );
}

/** Quantity stepper with −/+ controls and a centered numeric field. */
function Stepper({
    label, hint, tone, icon, value, base, disabled, onChange,
}: {
    label: string;
    hint: string;
    tone: "green" | "amber";
    icon: React.ReactNode;
    value: number;
    base: number;
    disabled: boolean;
    onChange: (v: number) => void;
}) {
    const delta = value - base;
    return (
        <div className={"ins-stepper tone-" + tone + (disabled ? " disabled" : "")}>
            <div className="ins-stepper-head">
                <span className="ins-stepper-ic">{icon}</span>
                <div>
                    <div className="ins-stepper-lbl">{label}</div>
                    <div className="ins-stepper-hint">{hint}</div>
                </div>
                {delta !== 0 && (
                    <span className="ins-delta">{delta > 0 ? "+" : ""}{delta}</span>
                )}
            </div>
            <div className="ins-stepper-ctrl">
                <button
                    className="ins-step-btn"
                    disabled={disabled || value <= 0}
                    onClick={() => onChange(Math.max(0, value - 1))}
                    aria-label="decrease"
                >−</button>
                <input
                    className="ins-step-inp"
                    type="number"
                    min={0}
                    value={value}
                    disabled={disabled}
                    onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) => onChange(num(e.target.value))}
                />
                <button
                    className="ins-step-btn"
                    disabled={disabled}
                    onClick={() => onChange(value + 1)}
                    aria-label="increase"
                >+</button>
            </div>
        </div>
    );
}

/** Compact labelled numeric field used in the Levels grid. */
function NumField({
    label, value, step = 1, money, disabled, onChange,
}: {
    label: string;
    value: number;
    step?: number;
    money?: boolean;
    disabled: boolean;
    onChange: (v: number) => void;
}) {
    return (
        <label className="ins-numfield">
            <span>{label}</span>
            <input
                className="ipt mono"
                type="number"
                min={0}
                step={step}
                value={money ? value.toFixed(2) : value}
                disabled={disabled}
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => onChange(num(e.target.value))}
            />
        </label>
    );
}
