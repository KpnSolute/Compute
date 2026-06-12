import { useState, useEffect, useCallback } from "react";
import { I } from "../lib/icons";
import { type User, ROLE_LEVEL, ROLE_LABEL } from "../lib/constants";
import { api, type Commit, type StagingEntry } from "../lib/api";

const t = (msg: string) => (window as any).toast?.(msg);

const OP_LABEL: Record<string, string> = {
    inventory_save: "Inventory",
    inventory_week_update: "Weekly invoice",
    item_update: "Item edit",
    item_delete: "Item delete",
    menu_save: "Menu",
    event_create: "New event",
    haccp_save: "HACCP log",
    daily_log_save: "Daily ops",
    user_create: "New user",
    user_update: "User update",
};

const OP_KIND: Record<string, "M" | "A" | "D"> = {
    inventory_save: "M",
    inventory_week_update: "M",
    item_update: "M",
    item_delete: "D",
    menu_save: "M",
    event_create: "A",
    haccp_save: "A",
    daily_log_save: "A",
    user_create: "A",
    user_update: "M",
};

export interface DraftChange {
    sku: string;
    desc: string;
    onHand: number;
    par: number;
    prevOnHand?: number;
    prevPar?: number;
}

function relTime(iso: string) {
    const d = new Date(iso), now = new Date();
    const mins = Math.round((now.getTime() - d.getTime()) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return mins + "m ago";
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs + "h ago";
    return d.toLocaleDateString();
}

function shortSha(sha: string | null | undefined): string {
    return sha ? sha.slice(0, 7) : "";
}

function stagedSummary(entry: StagingEntry): string {
    const fp = (entry as any).full_payload;
    const op = (entry as any).operation;
    if (op === "inventory_save" && fp?.items)
        return `${fp.items.length} item${fp.items.length !== 1 ? "s" : ""}`;
    if (op === "inventory_week_update" && fp?.items)
        return `${fp.items.length} item${fp.items.length !== 1 ? "s" : ""} · W${fp.week} ${fp.direction === "issued" ? "issued" : "received"}`;
    if (op === "item_update" && fp?.sku) return fp.sku;
    if (op === "item_delete" && fp?.sku) return fp.sku;
    if (op === "menu_save" && fp?.day) return fp.day;
    if (op === "event_create" && fp?.title) return fp.title;
    return entry.new_value_text || entry.field_name || "";
}

// ── shared hook ─────────────────────────────────────────────────────────────
function useSCData(isOpen: boolean) {
    const [staged, setStaged] = useState<StagingEntry[]>([]);
    const [commits, setCommits] = useState<Commit[]>([]);
    const [loading, setLoading] = useState(false);

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const [s, c] = await Promise.all([api.getStaging(), api.getCommits()]);
            setStaged(s || []);
            const sorted = [...(c || [])].sort((a, b) => {
                const da = new Date((a as any).github_synced_at || (a as any).merged_at || a.created_at || 0).getTime();
                const db = new Date((b as any).github_synced_at || (b as any).merged_at || b.created_at || 0).getTime();
                return db - da;
            });
            setCommits(sorted);
        } catch {
            setStaged([]);
            setCommits([]);
        }
        setLoading(false);
    }, []);

    useEffect(() => { if (isOpen) loadData(); }, [isOpen, loadData]);
    useEffect(() => {
        const h = () => loadData();
        window.addEventListener("mjcc:staging-changed", h);
        window.addEventListener("mjcc:committed", h);
        return () => {
            window.removeEventListener("mjcc:staging-changed", h);
            window.removeEventListener("mjcc:committed", h);
        };
    }, [loadData]);
    useEffect(() => {
        const id = setInterval(loadData, 30000);
        return () => clearInterval(id);
    }, [loadData]);
    useEffect(() => {
        const onVisible = () => { if (document.visibilityState === "visible") loadData(); };
        document.addEventListener("visibilitychange", onVisible);
        return () => document.removeEventListener("visibilitychange", onVisible);
    }, [loadData]);

    return { staged, setStaged, commits, setCommits, loading, loadData };
}

// ── VSCode-style changes view ────────────────────────────────────────────────
function SCChangesView({
    user,
    staged,
    setStaged,
    commits,
    loading,
    loadData,
}: {
    user: User;
    staged: StagingEntry[];
    setStaged: React.Dispatch<React.SetStateAction<StagingEntry[]>>;
    commits: Commit[];
    loading: boolean;
    loadData: () => void;
}) {
    const lvl = ROLE_LEVEL[user.role] || 0;
    const isStaff = lvl < 20;
    const canCommit = lvl >= 30;

    const [draftChanges, setDraftChanges] = useState<DraftChange[]>([]);
    const [changesOpen, setChangesOpen] = useState(true);
    const [stagedOpen, setStagedOpen] = useState(true);
    const [commitMsg, setCommitMsg] = useState("");
    const [busy, setBusy] = useState(false);
    const [confirm, setConfirm] = useState<StagingEntry[] | null>(null);
    const [showHistory, setShowHistory] = useState(false);
    const [showAI, setShowAI] = useState(false);
    const [aiPrompt, setAiPrompt] = useState("");
    const [aiRunning, setAiRunning] = useState(false);
    const [aiResult, setAiResult] = useState<string | null>(null);

    // receive draft state from InventoryView via custom event
    useEffect(() => {
        const h = (e: Event) => {
            setDraftChanges((e as CustomEvent<DraftChange[]>).detail || []);
        };
        window.addEventListener("mjcc:draft-changed", h);
        return () => window.removeEventListener("mjcc:draft-changed", h);
    }, []);

    const visibleStaged = isStaff
        ? staged.filter((s) => s.submitted_by === user.id || s.submitter_name === user.display_name)
        : staged;

    async function doCommit(entries: StagingEntry[]) {
        setConfirm(null);
        setBusy(true);
        try {
            const ids = entries.map((e) => e.entry_id);
            const msg = commitMsg.trim() || (entries.length === 1
                ? OP_LABEL[(entries[0] as any).operation] || entries[0].change_type
                : `Batch commit — ${entries.length} change${entries.length !== 1 ? "s" : ""}`);
            const commit = await api.approveCommit({ staging_ids: ids, message: msg, author_id: user.id });
            setStaged((s) => s.filter((x) => !ids.includes(x.entry_id)));
            setCommitMsg("");
            t(`Committed ${entries.length} change${entries.length !== 1 ? "s" : ""}`);
            window.dispatchEvent(new CustomEvent("mjcc:committed"));
            void commit;
        } catch (err: any) {
            t(`Commit failed: ${err?.message || "Unknown error"}`);
        } finally {
            setBusy(false);
        }
    }

    async function doReject(entry: StagingEntry) {
        setBusy(true);
        try {
            await api.rejectStaging(entry.entry_id);
            setStaged((s) => s.filter((x) => x.entry_id !== entry.entry_id));
            t("Entry removed");
            window.dispatchEvent(new CustomEvent("mjcc:staging-changed"));
        } catch (err: any) {
            t(`Failed: ${err?.message || "Unknown error"}`);
        } finally {
            setBusy(false);
        }
    }

    async function runAI() {
        if (!aiPrompt.trim()) return;
        setAiRunning(true);
        setAiResult(null);
        try {
            const res = await api.sendAgentMessage(aiPrompt.trim());
            setAiResult(res.response);
            t("AI staged — check Changes");
            await loadData();
            setShowAI(false);
        } catch (err: any) {
            setAiResult(`Error: ${err?.message || "Unknown error"}`);
        } finally {
            setAiRunning(false);
        }
    }

    function stageAll() { window.dispatchEvent(new CustomEvent("mjcc:stage-all-draft")); }
    function stageDraft(sku: string) { window.dispatchEvent(new CustomEvent("mjcc:stage-draft-item", { detail: { sku } })); }
    function discardDraft(sku: string) { window.dispatchEvent(new CustomEvent("mjcc:discard-draft-item", { detail: { sku } })); }

    if (showHistory) return (
        <div className="sc-body">
            <div className="sc-vsc-section-head" style={{ cursor: "pointer" }} onClick={() => setShowHistory(false)}>
                <span className="sc-vsc-chevron">‹</span>
                <span className="sc-section-label">COMMIT LOG</span>
                <span className="sc-section-count">{commits.length}</span>
            </div>
            {commits.length === 0 ? (
                <div className="sc-empty"><div className="sc-empty-title">No commits yet</div></div>
            ) : commits.map((c, i) => (
                <div key={c.commit_id} className="sc-commit-item">
                    <div className="sc-graph">
                        <span className="sc-g-dot" />
                        {i < commits.length - 1 && <span className="sc-g-line" />}
                    </div>
                    <div className="sc-commit-body">
                        <div className="sc-hist-msg">{c.message}</div>
                        <div className="sc-commit-meta">
                            <span className="sc-sha mono">{shortSha(c.github_sha) || c.commit_id.slice(0, 7)}</span>
                            <span>{c.author_name || c.author_id}</span>
                            {(c as any).submitter_role && (
                                <span className={"pill role-" + (c as any).submitter_role} style={{ padding: "0 5px", fontSize: 9 }}>
                                    {ROLE_LABEL[(c as any).submitter_role as keyof typeof ROLE_LABEL] || (c as any).submitter_role}
                                </span>
                            )}
                            <span style={{ marginLeft: "auto", opacity: 0.6 }}>
                                {relTime((c as any).github_synced_at || c.merged_at || c.created_at)}
                            </span>
                        </div>
                        <div className="sc-commit-detail">
                            <span>{c.change_count} field{c.change_count !== 1 ? "s" : ""}</span>
                            {c.github_sha && <span className="sc-synced">{I.check({ style: { width: 10, height: 10 } })} synced</span>}
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );

    if (showAI) return (
        <div className="sc-body">
            <div className="sc-vsc-section-head" style={{ cursor: "pointer" }} onClick={() => setShowAI(false)}>
                <span className="sc-vsc-chevron">‹</span>
                <span className="sc-section-label">{I.flame({ style: { width: 11, height: 11, display: "inline-block", marginRight: 4 } })} AI ASSISTANT</span>
            </div>
            <div style={{ padding: "10px 12px" }}>
                <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 10 }}>
                    Describe a change in plain English. The AI stages it for review.
                </div>
                <textarea className="sc-commit-msg" placeholder={"e.g. \"Set chicken stock to 20\"\n\"Add Olive Oil, $8.50, par 6\""}
                    rows={5} value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} disabled={aiRunning}
                    onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) runAI(); }} />
                <button className="btn primary" style={{ width: "100%", justifyContent: "center", marginTop: 8 }}
                    onClick={runAI} disabled={aiRunning || !aiPrompt.trim()}>
                    {aiRunning ? <><div className="spinner" style={{ width: 13, height: 13 }} />&nbsp;Processing…</> : <>{I.flame({ style: { width: 14, height: 14 } })}&nbsp;Apply &amp; Stage</>}
                </button>
                {aiResult && (
                    <div className="sc-ai-result">
                        <div className="sc-ai-result-head">AI Response</div>
                        <div className="sc-ai-result-body">{aiResult}</div>
                    </div>
                )}
            </div>
        </div>
    );

    return (
        <div className="sc-body" style={{ overflowY: "auto" }}>
            {loading && <div className="sc-loading"><div className="spinner" style={{ width: 16, height: 16 }} /><span>Loading…</span></div>}

            {/* Commit message + button — VSCode position: above sections */}
            {canCommit && (
                <div className="sc-vsc-commit-area">
                    <textarea className="sc-commit-msg" placeholder="Commit message (Ctrl+Enter)…" rows={2}
                        value={commitMsg} onChange={(e) => setCommitMsg(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && visibleStaged.length > 0) setConfirm(visibleStaged); }} />
                    <button className="btn primary sc-vsc-commit-btn"
                        disabled={busy || visibleStaged.length === 0}
                        onClick={() => setConfirm(visibleStaged)}>
                        {I.check({ style: { width: 13, height: 13 } })}&nbsp;
                        Commit{visibleStaged.length > 0 ? ` (${visibleStaged.length})` : ""}
                    </button>
                </div>
            )}

            {/* CHANGES — unstaged draft items */}
            {!loading && draftChanges.length > 0 && (
                <div className="sc-vsc-section">
                    <div className="sc-vsc-section-head" onClick={() => setChangesOpen((v) => !v)}>
                        <span className="sc-vsc-chevron">{changesOpen ? "▾" : "▸"}</span>
                        <span className="sc-section-label">CHANGES</span>
                        <span className="sc-section-count">{draftChanges.length}</span>
                        <div style={{ flex: 1 }} />
                        {canCommit && (
                            <>
                                <button className="sc-icon-btn" title="Stage All Changes" onClick={(e) => { e.stopPropagation(); stageAll(); }}>
                                    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M5 3l1.5-1.5L12 7 6.5 12.5 5 11l4-4z"/><rect x="1" y="7" width="3" height="1.5" rx=".75"/></svg>
                                </button>
                                <button className="sc-icon-btn danger" title="Discard All Changes"
                                    onClick={(e) => { e.stopPropagation(); draftChanges.forEach((d) => discardDraft(d.sku)); }}>
                                    {I.x({ style: { width: 12, height: 12 } })}
                                </button>
                            </>
                        )}
                    </div>
                    {changesOpen && draftChanges.map((d) => (
                        <div key={d.sku} className="sc-vsc-file-row">
                            <span className="sc-vsc-file-icon">
                                {I.database({ style: { width: 13, height: 13, opacity: 0.6 } })}
                            </span>
                            <div className="sc-vsc-file-info">
                                <span className="sc-vsc-file-name" title={d.desc}>{d.desc.length > 28 ? d.desc.slice(0, 28) + "…" : d.desc}</span>
                                <span className="sc-vsc-file-path">SKU {d.sku} · OH {d.onHand} · PAR {d.par}</span>
                            </div>
                            <span className="sc-vsc-badge sc-vsc-badge-m">M</span>
                            <div className="sc-vsc-file-actions">
                                <button className="sc-icon-btn" title="Discard changes" onClick={() => discardDraft(d.sku)}>
                                    {I.x({ style: { width: 11, height: 11 } })}
                                </button>
                                <button className="sc-icon-btn ok" title="Stage change" onClick={() => stageDraft(d.sku)}>
                                    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M5 3l1.5-1.5L12 7 6.5 12.5 5 11l4-4z"/></svg>
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* STAGED CHANGES */}
            {!loading && (
                <div className="sc-vsc-section">
                    <div className="sc-vsc-section-head" onClick={() => setStagedOpen((v) => !v)}>
                        <span className="sc-vsc-chevron">{stagedOpen ? "▾" : "▸"}</span>
                        <span className="sc-section-label">{isStaff ? "MY SUBMISSIONS" : "STAGED CHANGES"}</span>
                        {visibleStaged.length > 0 && <span className="sc-section-count">{visibleStaged.length}</span>}
                    </div>

                    {stagedOpen && visibleStaged.length === 0 && (
                        <div className="sc-empty">
                            <div className="sc-empty-icon">{I.branch({ style: { width: 24, height: 24 } })}</div>
                            <div className="sc-empty-title">Working tree is clean</div>
                            <div className="sc-empty-sub">Make inventory or data edits to stage changes.</div>
                        </div>
                    )}

                    {stagedOpen && visibleStaged.map((ch) => {
                        const op = (ch as any).operation || ch.change_type;
                        const kind = OP_KIND[op] ?? "M";
                        const label = OP_LABEL[op] || op;
                        const summary = stagedSummary(ch);
                        return (
                            <div key={ch.entry_id} className="sc-vsc-file-row">
                                <span className="sc-vsc-file-icon">
                                    {I.database({ style: { width: 13, height: 13, opacity: 0.6 } })}
                                </span>
                                <div className="sc-vsc-file-info">
                                    <span className="sc-vsc-file-name">{label}</span>
                                    <span className="sc-vsc-file-path">
                                        {summary}{summary ? " · " : ""}{ch.submitter_name || ""}{ch.created_at ? " · " + relTime(ch.created_at) : ""}
                                    </span>
                                </div>
                                <span className={"sc-vsc-badge sc-vsc-badge-" + kind.toLowerCase()}>{kind}</span>
                                <div className="sc-vsc-file-actions">
                                    {canCommit ? (
                                        <>
                                            <button className="sc-icon-btn danger" title="Discard / reject" disabled={busy} onClick={() => doReject(ch)}>
                                                {I.x({ style: { width: 11, height: 11 } })}
                                            </button>
                                            <button className="sc-icon-btn ok" title="Commit this entry" disabled={busy}
                                                onClick={() => setConfirm([ch])}>
                                                {I.check({ style: { width: 11, height: 11 } })}
                                            </button>
                                        </>
                                    ) : (
                                        <span className="sc-pending-badge">Pending</span>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {isStaff && (
                <div className="sc-staff-note">
                    {I.user({ style: { width: 12, height: 12 } })}
                    <span>Your changes are pending manager review.</span>
                </div>
            )}

            {/* Confirm overlay */}
            {confirm && (
                <div className="sc-confirm-overlay" onClick={() => setConfirm(null)}>
                    <div className="sc-confirm" onClick={(e) => e.stopPropagation()}>
                        <p>{confirm.length === 1 ? "Commit this change?" : `Commit all ${confirm.length} staged changes?`}</p>
                        <div className="sc-confirm-btns">
                            <button className="btn" onClick={() => setConfirm(null)}>Cancel</button>
                            <button className="btn primary" disabled={busy} onClick={() => doCommit(confirm)}>
                                {I.check({ style: { width: 13, height: 13 } })}&nbsp;Commit
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ── Side panel (VSCode-style slide-in) ──────────────────────────────────────
export function SourceControlPanel({
    user,
    open,
    onClose,
    onCountChange,
}: {
    user: User;
    open: boolean;
    onClose: () => void;
    onCountChange?: (n: number) => void;
}) {
    const { staged, setStaged, commits, loading, loadData } = useSCData(open);

    useEffect(() => { onCountChange?.(staged.length); }, [staged.length, onCountChange]);

    const lvl = ROLE_LEVEL[user.role] || 0;
    const isStaff = lvl < 20;
    const visibleStaged = isStaff
        ? staged.filter((s) => s.submitted_by === user.id || s.submitter_name === user.display_name)
        : staged;
    const lastCommit = commits[0];

    return (
        <>
            {open && <div className="sc-backdrop" onClick={onClose} />}
            <div className={"sc-panel" + (open ? " open" : "")}>
                {/* Header */}
                <div className="sc-header">
                    <div className="sc-title-row">
                        <span className="sc-title-icon">{I.branch({ style: { width: 14, height: 14 } })}</span>
                        <span className="sc-title">SOURCE CONTROL</span>
                        <span className="sc-branch-badge">main</span>
                        <div style={{ flex: 1 }} />
                        <button className="sc-icon-btn" onClick={loadData} disabled={loading} title="Refresh">
                            {I.refresh({ style: { width: 14, height: 14 } })}
                        </button>
                        <button className="sc-icon-btn" onClick={onClose} title="Close">
                            {I.x({ style: { width: 14, height: 14 } })}
                        </button>
                    </div>
                    {/* Status bar */}
                    <div className="sc-status-bar">
                        <span className={"sc-status-dot " + (lastCommit?.github_sha ? "synced" : "pending")} />
                        <span>MJCC-Portal/mjcc</span>
                        {lastCommit && (
                            <>
                                <span className="sc-status-sep">·</span>
                                <span className="mono" style={{ fontSize: 10, opacity: 0.7 }}>
                                    {shortSha(lastCommit.github_sha) || lastCommit.commit_id.slice(0, 7)}
                                </span>
                                <span style={{ opacity: 0.6, fontSize: 10.5 }}>
                                    {relTime((lastCommit as any).github_synced_at || lastCommit.merged_at || lastCommit.created_at)}
                                </span>
                            </>
                        )}
                        {visibleStaged.length > 0 && (
                            <span className="sc-section-count" style={{ marginLeft: "auto" }}>{visibleStaged.length} pending</span>
                        )}
                    </div>
                </div>
                <SCChangesView
                    user={user}
                    staged={staged}
                    setStaged={setStaged}
                    commits={commits}
                    loading={loading}
                    loadData={loadData}
                />
            </div>
        </>
    );
}

// ── Full page view ───────────────────────────────────────────────────────────
export function SourceControlPage({ user }: { user: User }) {
    const { staged, setStaged, commits, loading, loadData } = useSCData(true);
    const lastCommit = commits[0];

    return (
        <div className="sc-page">
            <div className="pg-head">
                <div>
                    <h2 className="pg-title">Source Control</h2>
                    <p className="pg-sub">
                        {I.branch({ style: { width: 12, height: 12, display: "inline-block", marginRight: 5 } })}
                        main
                        {lastCommit && (
                            <> · <span className="mono" style={{ fontSize: 11 }}>
                                {shortSha(lastCommit.github_sha) || lastCommit.commit_id.slice(0, 7)}
                            </span></>
                        )}
                    </p>
                </div>
                <button className="btn" onClick={loadData} disabled={loading}>
                    {I.refresh()} Refresh
                </button>
            </div>
            <div className="sc-page-body">
                <div className="sc-page-panel card">
                    <SCChangesView
                        user={user}
                        staged={staged}
                        setStaged={setStaged}
                        commits={commits}
                        loading={loading}
                        loadData={loadData}
                    />
                </div>
            </div>
        </div>
    );
}
