import { useCallback, useEffect, useState } from "react";
import { I } from "../lib/icons";
import {
    api,
    type PriceDecision,
    type PriceDriftResponse,
    type PriceDriftRow,
    type PriceReviewRow,
} from "../lib/api";
import { useEscapeClose } from "../lib/useEscapeClose";

const toast = (msg: string) =>
    (window as unknown as { toast?: (m: string) => void }).toast?.(msg);

const errorText = (e: unknown, fallback: string) =>
    e instanceof Error && e.message ? e.message : fallback;

const money = (v: number | null | undefined) =>
    v == null ? "—" : `$${Number(v).toFixed(2)}`;

const pct = (v: number | null | undefined) =>
    v == null ? "" : `${v > 0 ? "+" : ""}${(Number(v) * 100).toFixed(1)}%`;

function currentPeriod(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function splitPeriod(period: string): { month: number; year: number } {
    const [y, m] = period.split("-").map(Number);
    return { month: m, year: y };
}

interface PriceReviewModalProps {
    open: boolean;
    onClose: () => void;
    /** Called after any decision so callers can refresh counts. */
    onChanged?: () => void;
}

interface Comparison {
    key: string;
    sku: string | null;
    description: string | null;
    inventory: number | null;
    invoice: number;
    change: number | null;
    invoiceNumber: string | null;
    week: number | null;
    reason?: string | null;
}

/**
 * Price Review — the manager side of the observed-price protocol.
 *
 * Inventory carries each item's latest invoice price. Ordinary moves apply on
 * commit; moves over the review threshold are held here, alongside any item
 * whose stored price still differs from its latest invoice. A period can't be
 * published until this list is clear.
 */
export function PriceReviewModal({ open, onClose, onChanged }: PriceReviewModalProps) {
    const [period, setPeriod] = useState(currentPeriod);
    const [held, setHeld] = useState<PriceReviewRow[]>([]);
    const [drift, setDrift] = useState<PriceDriftResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [busyKey, setBusyKey] = useState<string | null>(null);
    const [overrides, setOverrides] = useState<Record<string, string>>({});

    useEscapeClose(open, onClose, !!busyKey);

    const load = useCallback(async () => {
        const { month, year } = splitPeriod(period);
        setLoading(true);
        setError(null);
        try {
            const [rows, driftRes] = await Promise.all([
                api.getPriceReview({ status: "pending", month, year }),
                api.getPriceDrift(month, year),
            ]);
            setHeld(rows || []);
            setDrift(driftRes);
        } catch (e) {
            setError(errorText(e, "Price review could not be loaded."));
        }
        setLoading(false);
    }, [period]);

    useEffect(() => {
        if (open) void load();
    }, [open, load]);

    if (!open) return null;

    const outOfDate: PriceDriftRow[] = (drift?.rows || []).filter((r) => !r.review_pending);
    const openCount = held.length + outOfDate.length;

    const decide = async (key: string, run: () => Promise<unknown>, done: string) => {
        setBusyKey(key);
        try {
            await run();
            toast(done);
            setOverrides((o) => {
                const next = { ...o };
                delete next[key];
                return next;
            });
            await load();
            onChanged?.();
        } catch (e) {
            toast(`Price not updated: ${errorText(e, "unknown error")}`);
        }
        setBusyKey(null);
    };

    const decisionFor = (key: string, action: PriceDecision["action"]): PriceDecision | null => {
        if (action === "keep") return { action };
        const raw = (overrides[key] || "").trim();
        if (!raw) return { action };
        const price = Number(raw);
        if (!Number.isFinite(price) || price <= 0) {
            toast("Enter a price greater than 0, or leave the box empty to use the invoice price.");
            return null;
        }
        return { action, price };
    };

    const resolveHeld = (row: PriceReviewRow, action: PriceDecision["action"]) => {
        const body = decisionFor(row.id, action);
        if (!body) return;
        void decide(
            row.id,
            () => api.resolvePriceReview(row.id, body),
            action === "keep" ? `Kept ${money(row.previous_price)} for ${row.sku}` : `Price updated for ${row.sku}`,
        );
    };

    const resolveDrift = (row: PriceDriftRow, action: PriceDecision["action"]) => {
        const key = `drift-${row.item_id}`;
        const body = decisionFor(key, action);
        if (!body) return;
        const { month, year } = splitPeriod(period);
        void decide(
            key,
            () => api.resolvePriceDrift({ ...body, item_id: row.item_id, month, year }),
            action === "keep" ? `Kept ${money(row.inventory_price)} for ${row.sku}` : `Price updated for ${row.sku}`,
        );
    };

    const renderRow = (
        c: Comparison,
        onApply: () => void,
        onKeep: () => void,
        tone: "warn" | "off",
    ) => {
        const busy = busyKey === c.key;
        return (
            <div key={c.key} style={{ borderBottom: "1px solid var(--line)", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <span className="mono" style={{ fontSize: 12, fontWeight: 600 }}>{c.sku || "—"}</span>
                    {c.change != null && <span className={`pill ${tone}`} style={{ fontSize: 9 }}>{pct(c.change)}</span>}
                    <span style={{ fontSize: 11.5, color: "var(--muted)", minWidth: 0 }}>{c.description || ""}</span>
                </div>
                <div style={{ fontSize: 12, display: "flex", gap: 14, flexWrap: "wrap", fontVariantNumeric: "tabular-nums" }}>
                    <span>Inventory <strong>{money(c.inventory)}</strong></span>
                    <span>Invoice <strong>{money(c.invoice)}</strong></span>
                    <span style={{ color: "var(--muted)" }}>
                        {c.invoiceNumber ? `#${c.invoiceNumber}` : "invoice"}
                        {c.week ? ` · week ${c.week}` : ""}
                    </span>
                </div>
                {c.reason && <div style={{ fontSize: 10.5, color: "var(--muted)" }}>{c.reason}</div>}
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <button className="btn primary" style={{ fontSize: 11, padding: "4px 10px" }} disabled={busy} onClick={onApply}>
                        {I.check({ style: { width: 11, height: 11 } })} Use {overrides[c.key] ? "this price" : money(c.invoice)}
                    </button>
                    <button className="btn" style={{ fontSize: 11, padding: "4px 10px" }} disabled={busy} onClick={onKeep}>
                        Keep {money(c.inventory)}
                    </button>
                    <input
                        className="ipt"
                        inputMode="decimal"
                        aria-label={`Other price for ${c.sku || "item"}`}
                        placeholder="Other price"
                        value={overrides[c.key] || ""}
                        onChange={(e) => setOverrides((o) => ({ ...o, [c.key]: e.target.value }))}
                        disabled={busy}
                        style={{ fontSize: 11.5, width: 110, padding: "3px 8px" }}
                    />
                    {busy && <div className="spinner" style={{ width: 12, height: 12 }} />}
                </div>
            </div>
        );
    };

    return (
        <div className="overlay" onClick={() => !busyKey && onClose()}>
            <div className="modal" style={{ maxWidth: 620 }} onClick={(e) => e.stopPropagation()}>
                <div className="modal-head">
                    <h3>{I.dollar()} Price Review</h3>
                    <div className="sub">
                        {loading ? "Checking prices…" : openCount > 0 ? `${openCount} price${openCount === 1 ? "" : "s"} need a decision` : "Prices match the latest invoices"}
                    </div>
                    <button className="modal-x" onClick={onClose} aria-label="Close" disabled={!!busyKey}>{I.x()}</button>
                </div>
                <div className="modal-body" style={{ padding: 0 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "10px 12px", borderBottom: "1px solid var(--line)" }}>
                        <label htmlFor="price-review-period" style={{ fontSize: 11.5, color: "var(--muted)" }}>Period</label>
                        <input
                            id="price-review-period"
                            className="ipt"
                            type="month"
                            value={period}
                            onChange={(e) => e.target.value && setPeriod(e.target.value)}
                            style={{ fontSize: 12, padding: "3px 8px" }}
                        />
                        <div style={{ flex: 1 }} />
                        <button className="sc-icon-btn" onClick={() => void load()} disabled={loading} title="Refresh">
                            {I.refresh({ style: { width: 13, height: 13 } })}
                        </button>
                    </div>

                    {error && (
                        <div style={{ margin: 12, padding: "8px 10px", borderRadius: 6, fontSize: 12, background: "rgba(220,38,38,0.08)", border: "1px solid var(--red,#dc2626)" }}>
                            {error}
                        </div>
                    )}

                    {loading && (
                        <div className="sc-loading">
                            <div className="spinner" style={{ width: 14, height: 14 }} />
                            <span>Loading…</span>
                        </div>
                    )}

                    {!loading && !error && openCount === 0 && (
                        <div className="sc-empty">
                            <div className="sc-empty-icon">{I.check({ style: { width: 24, height: 24 } })}</div>
                            <div className="sc-empty-title">Prices are up to date</div>
                            <div className="sc-empty-sub">Every item carries its latest invoice price for this period.</div>
                        </div>
                    )}

                    {!loading && held.length > 0 && (
                        <>
                            <div className="sc-vsc-section-head" style={{ padding: "8px 12px", fontSize: 11 }}>
                                Held for review · {held.length}
                                <span style={{ color: "var(--muted)", fontWeight: 400, marginLeft: 6 }}>large changes are not applied automatically</span>
                            </div>
                            {held.map((row) =>
                                renderRow(
                                    {
                                        key: row.id,
                                        sku: row.sku,
                                        description: row.description,
                                        inventory: row.previous_price,
                                        invoice: row.observed_price,
                                        change: row.change_pct,
                                        invoiceNumber: row.invoice_number,
                                        week: row.week,
                                        reason: row.reason,
                                    },
                                    () => resolveHeld(row, "apply"),
                                    () => resolveHeld(row, "keep"),
                                    "warn",
                                ),
                            )}
                        </>
                    )}

                    {!loading && outOfDate.length > 0 && (
                        <>
                            <div className="sc-vsc-section-head" style={{ padding: "8px 12px", fontSize: 11 }}>
                                Out of date · {outOfDate.length}
                                <span style={{ color: "var(--muted)", fontWeight: 400, marginLeft: 6 }}>inventory price differs from the latest invoice</span>
                            </div>
                            {outOfDate.map((row) =>
                                renderRow(
                                    {
                                        key: `drift-${row.item_id}`,
                                        sku: row.sku,
                                        description: row.description,
                                        inventory: row.inventory_price,
                                        invoice: row.observed_price,
                                        change: row.change_pct,
                                        invoiceNumber: row.invoice_number,
                                        week: row.week_number,
                                    },
                                    () => resolveDrift(row, "apply"),
                                    () => resolveDrift(row, "keep"),
                                    "off",
                                ),
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
