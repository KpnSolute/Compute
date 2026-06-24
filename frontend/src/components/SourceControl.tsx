import { useState, useEffect, useCallback, useMemo } from "react";
import { I } from "../lib/icons";
import { type User, ROLE_LEVEL, ROLE_LABEL } from "../lib/constants";
import { api, type Commit, type StagingEntry } from "../lib/api";
import { useEscapeClose } from "../lib/useEscapeClose";
import { SaveBar, PageToolbar } from "./ui/ActionBars";
import { matchesInventoryQuery, parseInventoryQuery } from "../lib/inventorySearch";

const t = (msg: string) => (window as any).toast?.(msg);

function SCPushButton() {
    const [syncing, setSyncing] = useState(false);

    async function doPush() {
        setSyncing(true);
        try {
            await api.runGithubSync();
            t("Push queued — draining archive sync in background");
            // give the background task a moment, then check how it landed
            setTimeout(async () => {
                try {
                    const status = await api.getGithubSyncStatus();
                    if (status.failed > 0) {
                        t(`Sync: ${status.synced} synced, ${status.failed} failed — check server logs`);
                    } else if (status.pending > 0) {
                        t(`Sync in progress — ${status.pending} still pending`);
                    } else {
                        t("Archive sync complete");
                    }
                } catch { /* status check is best-effort */ }
            }, 3000);
        } catch (err: any) {
            t(`Push failed: ${err?.message || "Unknown error"}`);
        } finally {
            setSyncing(false);
        }
    }

    return (
        <button
            className="sc-icon-btn"
            onClick={doPush}
            disabled={syncing}
            title="Push pending commits to the GitHub archive repo"
            style={{ marginLeft: 6 }}
        >
            {syncing ? "Pushing…" : "Push"}
        </button>
    );
}

const OP_LABEL: Record<string, string> = {
    inventory_save: "Inventory",
    inventory_week_update: "Weekly invoice",
    item_create: "New item",
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
    item_create: "A",
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

function prStatusPill(status: string) {
    const map: Record<string, string> = { merged: "ok", draft: "warn", closed: "" };
    const cls = map[status] ?? "info";
    return (
        <span
            className={"pill " + cls}
            style={{ fontSize: 9, padding: "1px 6px", textTransform: "capitalize" }}
        >
            {status}
        </span>
    );
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
        const id = setInterval(loadData, 15000);
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
    openPrId,
    onConsumePrId,
    externalTab,
}: {
    user: User;
    staged: StagingEntry[];
    setStaged: React.Dispatch<React.SetStateAction<StagingEntry[]>>;
    commits: Commit[];
    loading: boolean;
    loadData: () => void;
    openPrId?: string | null;
    onConsumePrId?: () => void;
    externalTab?: string;
}) {
    const pageMode = externalTab !== undefined;
    const lvl = ROLE_LEVEL[user.role] || 0;
    const canReview = lvl >= 30; // manager, admin, sudo
    const canCommit = lvl >= 30;

    const [draftChanges, setDraftChanges] = useState<DraftChange[]>([]);
    const [changesOpen, setChangesOpen] = useState(true);
    const [stagedOpen, setStagedOpen] = useState(true);
    const [commitMsg, setCommitMsg] = useState("");
    const [busy, setBusy] = useState(false);
    const [confirm, setConfirm] = useState<StagingEntry[] | null>(null);
    useEscapeClose(!!confirm, () => setConfirm(null));

    // Sub-view toggles (fixed: buttons now exist to open each one)
    const [showHistory, setShowHistory] = useState(false);
    useEscapeClose(showHistory, () => setShowHistory(false));
    const [showAI, setShowAI] = useState(false);
    const [showPRs, setShowPRs] = useState(false);

    // AI state
    const [aiPrompt, setAiPrompt] = useState("");
    const [aiRunning, setAiRunning] = useState(false);
    useEscapeClose(showAI, () => setShowAI(false), aiRunning);
    const [aiResult, setAiResult] = useState<string | null>(null);

    // PR state
    const [pulls, setPulls] = useState<any[]>([]);
    const [pullsLoading, setPullsLoading] = useState(false);
    const [prTitle, setPrTitle] = useState("");
    const [prBusy, setPrBusy] = useState(false);
    useEscapeClose(showPRs, () => setShowPRs(false), prBusy || pullsLoading);
    const [expandedPR, setExpandedPR] = useState<string | null>(null);
    const [prDetail, setPrDetail] = useState<Record<string, any>>({});
    const [prDetailLoading, setPrDetailLoading] = useState<string | null>(null);
    const [prActionBusy, setPrActionBusy] = useState<string | null>(null);

    // SKU Review state
    const [showSKUReview, setShowSKUReview] = useState(false);
    const [skuRows, setSkuRows] = useState<any[]>([]);
    const [skuLoading, setSkuLoading] = useState(false);
    const [skuExpandedId, setSkuExpandedId] = useState<string | null>(null);
    const [skuResolution, setSkuResolution] = useState<'new_item' | 'alias_existing' | 'override_existing' | null>(null);
    const [skuNewSku, setSkuNewSku] = useState('');
    const [skuNewDesc, setSkuNewDesc] = useState('');
    const [skuNewCategory, setSkuNewCategory] = useState('');
    const [skuItemSearch, setSkuItemSearch] = useState('');
    const [skuSelectedItem, setSkuSelectedItem] = useState<any>(null);
    const [skuOverrideSku, setSkuOverrideSku] = useState('');
    const [skuConflict, setSkuConflict] = useState<any>(null);
    const [skuBusy, setSkuBusy] = useState(false);
    useEscapeClose(showSKUReview, () => setShowSKUReview(false), skuLoading || skuBusy);
    const [allItems, setAllItems] = useState<any[]>([]);
    const [allItemsLoaded, setAllItemsLoaded] = useState(false);

    // receive draft state from InventoryView via custom event
    useEffect(() => {
        const h = (e: Event) => {
            setDraftChanges((e as CustomEvent<DraftChange[]>).detail || []);
        };
        window.addEventListener("mjcc:draft-changed", h);
        return () => window.removeEventListener("mjcc:draft-changed", h);
    }, []);

    const visibleStaged = !canReview
        ? staged.filter((s) => s.submitted_by === user.id || s.submitter_name === user.display_name)
        : staged;

    // Unlinked = pending and not yet attached to any PR
    const unlinkedStaged = visibleStaged.filter((e) => !(e as any).pull_request_id);

    // ── PR helpers ────────────────────────────────────────────────────────────
    const loadPRs = useCallback(async () => {
        setPullsLoading(true);
        try {
            const results = await api.getPulls(canReview ? "open" : "all");
            setPulls(results);
        } catch { /* silent */ }
        setPullsLoading(false);
    }, [canReview]);

    // Deep-link: Data Entry just created/extended a PR and navigated here to
    // show its diff immediately (the "Copilot push" moment) -- open the PR
    // panel pre-expanded on that PR instead of making the user hunt for it.
    useEffect(() => {
        if (!openPrId) return;
        setShowPRs(true);
        loadPRs().then(() => {
            setExpandedPR(openPrId);
            if (!prDetail[openPrId]) {
                setPrDetailLoading(openPrId);
                api.getPull(openPrId)
                    .then((detail) => setPrDetail((prev) => ({ ...prev, [openPrId]: detail })))
                    .catch(() => {})
                    .finally(() => setPrDetailLoading(null));
            }
            onConsumePrId?.();
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [openPrId]);

    // In page mode (SourceControlPage), the PageToolbar passes a tab name via
    // externalTab.  Map tab changes to overlay-open state so tabs feel responsive.
    useEffect(() => {
        if (!externalTab || externalTab === 'changes') {
            setShowHistory(false); setShowAI(false); setShowPRs(false); setShowSKUReview(false);
            return;
        }
        setShowHistory(externalTab === 'history');
        setShowAI(externalTab === 'ai');
        setShowSKUReview(externalTab === 'sku');
        if (externalTab === 'prs') { setShowPRs(true); loadPRs(); }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [externalTab]);

    const loadSKUReview = useCallback(async () => {
        setSkuLoading(true);
        try {
            const rows = await api.getSKUReview('pending', 100);
            setSkuRows(rows);
        } catch { /* silent */ }
        setSkuLoading(false);
    }, []);

    const loadAllItems = useCallback(async () => {
        if (allItemsLoaded) return;
        try {
            const items = await api.getInventoryItems({ limit: 300 });
            setAllItems(items);
            setAllItemsLoaded(true);
        } catch { /* silent */ }
    }, [allItemsLoaded]);

    const openSkuAction = (rowId: string, row: any, res: typeof skuResolution) => {
        setSkuExpandedId(rowId);
        setSkuResolution(res);
        setSkuConflict(null);
        if (res === 'new_item') {
            setSkuNewSku(row.parsed_sku || '');
            setSkuNewDesc(row.parsed_description || '');
            setSkuNewCategory('');
        } else {
            setSkuItemSearch('');
            setSkuSelectedItem(null);
            setSkuOverrideSku(row.parsed_sku || '');
            loadAllItems();
        }
    };

    const doSKUResolve = async (rowId: string) => {
        setSkuBusy(true);
        setSkuConflict(null);
        try {
            const body: Parameters<typeof api.resolveSKU>[1] = { resolution: skuResolution! };
            if (skuResolution === 'new_item') {
                body.new_sku = skuNewSku;
                body.new_desc = skuNewDesc;
                if (skuNewCategory) body.new_category = skuNewCategory;
            } else if (skuResolution === 'alias_existing') {
                body.item_id = skuSelectedItem?.id;
            } else {
                body.item_id = skuSelectedItem?.id;
                body.new_sku = skuOverrideSku;
            }
            await api.resolveSKU(rowId, body);
            t(`Resolved as ${(skuResolution || '').replace(/_/g, ' ')}`);
            setSkuExpandedId(null);
            setSkuResolution(null);
            window.dispatchEvent(new CustomEvent("mjcc:committed"));
            await Promise.all([loadSKUReview(), loadData()]);
        } catch (err: any) {
            const detail = (err as any).detail;
            if ((err as any).status === 409 && detail && typeof detail === 'object' && detail.error === 'sku_conflict') {
                setSkuConflict(detail);
            } else {
                t(`Failed: ${(err as any).message || 'Unknown error'}`);
            }
        }
        setSkuBusy(false);
    };

    const doOpenPR = async () => {
        const title = prTitle.trim();
        if (!title) return;
        if (!unlinkedStaged.length) { t("No unsubmitted staged entries."); return; }
        setPrBusy(true);
        try {
            await api.openPull({ title, entry_ids: unlinkedStaged.map((e) => e.entry_id) });
            t("Request submitted for review!");
            setPrTitle("");
            await loadData();
            await loadPRs();
        } catch (err: any) {
            t(`Failed: ${err?.message || "Unknown error"}`);
        }
        setPrBusy(false);
    };

    const toggleExpandPR = async (pr_id: string) => {
        if (expandedPR === pr_id) { setExpandedPR(null); return; }
        setExpandedPR(pr_id);
        if (!prDetail[pr_id]) {
            setPrDetailLoading(pr_id);
            try {
                const detail = await api.getPull(pr_id);
                setPrDetail((prev) => ({ ...prev, [pr_id]: detail }));
            } catch { /* silent */ }
            setPrDetailLoading(null);
        }
    };

    const doMergePR = async (pr_id: string) => {
        setPrActionBusy(pr_id);
        try {
            await api.mergePull(pr_id);
            t("Pull request merged!");
            window.dispatchEvent(new CustomEvent("mjcc:committed"));
            await loadData();
            await loadPRs();
            setExpandedPR(null);
        } catch (err: any) {
            t(`Merge failed: ${err?.message || "Unknown error"}`);
        }
        setPrActionBusy(null);
    };

    const doClosePR = async (pr_id: string) => {
        setPrActionBusy(pr_id);
        try {
            await api.closePull(pr_id);
            t("Request closed.");
            await loadPRs();
            if (expandedPR === pr_id) setExpandedPR(null);
        } catch (err: any) {
            t(`Close failed: ${err?.message || "Unknown error"}`);
        }
        setPrActionBusy(null);
    };

    // ── commit helpers ─────────────────────────────────────────────────────────
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
            // DB needs a moment to make the new commit row queryable — re-fetch
            // after 1 s so the commit shows in History without manual refresh.
            setTimeout(() => loadData(), 1000);
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

    // ── sub-view: COMMIT LOG (rendered as overlay) ────────────────────────────
    const renderHistory = () => (showHistory ? (
        <div className="overlay" onClick={() => setShowHistory(false)}>
            <div className="modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
                <div className="modal-head">
                    <h3>{I.clock()} Commit Log</h3>
                    <div className="sub">{commits.length} commit{commits.length !== 1 ? "s" : ""}</div>
                    <button className="modal-x" onClick={() => setShowHistory(false)} aria-label="Close">{I.x()}</button>
                </div>
                <div className="modal-body" style={{ padding: 0 }}>
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
                                    {c.pr_number != null && (
                                        <span className="pill info" style={{ padding: "0 5px", fontSize: 9 }}>
                                            #{c.pr_number}
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
            </div>
        </div>
    ) : null);

    // ── sub-view: AI ASSISTANT (rendered as overlay) ──────────────────────────
    const renderAI = () => (showAI ? (
        <div className="overlay" onClick={() => setShowAI(false)}>
            <div className="modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
                <div className="modal-head">
                    <h3>{I.flame()} AI Assistant</h3>
                    <div className="sub">Describe a change in plain English. The AI stages it for review.</div>
                    <button className="modal-x" onClick={() => setShowAI(false)} aria-label="Close">{I.x()}</button>
                </div>
                <div className="modal-body">
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
        </div>
    ) : null);

    // ── sub-view: PULL REQUESTS (rendered as overlay) ────────────────────────
    const renderPRs = () => {
        if (!showPRs) return null;
        const openCount = pulls.filter((p) => p.status === "open").length;
        return (
            <div className="overlay" onClick={() => setShowPRs(false)}>
                <div className="modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
                    <div className="modal-head">
                        <h3>{I.inbox()} {canReview ? "Pull Requests" : "My Requests"}</h3>
                        <div className="sub">{openCount > 0 ? `${openCount} open` : "All requests"}</div>
                        <button className="modal-x" onClick={() => setShowPRs(false)} aria-label="Close">{I.x()}</button>
                    </div>
                    <div className="modal-body" style={{ padding: 0 }}>

                        {/* Staff: Submit for Review form */}
                        {!canReview && (
                            <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--line)" }}>
                                {unlinkedStaged.length > 0 ? (
                                    <>
                                        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8 }}>
                                            Submit your {unlinkedStaged.length} staged change{unlinkedStaged.length !== 1 ? "s" : ""} for manager review.
                                        </div>
                                        <input
                                            className="ipt"
                                            style={{ width: "100%", marginBottom: 8, fontSize: 12 }}
                                            placeholder="Request title…"
                                            value={prTitle}
                                            onChange={(e) => setPrTitle(e.target.value)}
                                            onKeyDown={(e) => { if (e.key === "Enter") doOpenPR(); }}
                                        />
                                        <button
                                            className="btn primary"
                                            style={{ width: "100%", justifyContent: "center" }}
                                            disabled={prBusy || !prTitle.trim()}
                                            onClick={doOpenPR}
                                        >
                                            {prBusy ? "Submitting…" : <>{I.inbox({ style: { width: 13, height: 13 } })} Submit for Review</>}
                                        </button>
                                    </>
                                ) : (
                                    <div style={{ fontSize: 11, color: "var(--muted)" }}>
                                        No unsubmitted staged changes. Stage inventory or data edits first.
                                    </div>
                                )}
                            </div>
                        )}

                        {pullsLoading && (
                            <div className="sc-loading">
                                <div className="spinner" style={{ width: 14, height: 14 }} />
                                <span>Loading…</span>
                            </div>
                        )}

                        {!pullsLoading && pulls.length === 0 && (
                            <div className="sc-empty">
                                <div className="sc-empty-icon">{I.inbox({ style: { width: 24, height: 24 } })}</div>
                                <div className="sc-empty-title">
                                    {canReview ? "No open pull requests" : "No requests yet"}
                                </div>
                                {!canReview && (
                                    <div className="sc-empty-sub">Stage changes and submit them for review.</div>
                                )}
                            </div>
                        )}

                        {pulls.map((pr) => {
                            const isExpanded = expandedPR === pr.pr_id;
                            const detail = prDetail[pr.pr_id];
                            const isBusy = prActionBusy === pr.pr_id;
                            const isDetailLoading = prDetailLoading === pr.pr_id;
                            const canClose = canReview || pr.author_id === user.id;

                            return (
                                <div key={pr.pr_id} style={{ borderBottom: "1px solid var(--line)" }}>
                                    <div
                                        className="sc-vsc-section-head"
                                        style={{ cursor: "pointer", alignItems: "flex-start", padding: "8px 12px" }}
                                        onClick={() => toggleExpandPR(pr.pr_id)}
                                    >
                                        <span className="sc-vsc-chevron" style={{ marginTop: 2 }}>
                                            {isExpanded ? "▾" : "▸"}
                                        </span>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontSize: 12, fontWeight: 600 }}>
                                                #{pr.pr_number} {pr.title}
                                            </div>
                                            <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 2 }}>
                                                {canReview && pr.author_name ? `${pr.author_name} · ` : ""}
                                                {pr.entry_count} change{pr.entry_count !== 1 ? "s" : ""} · {relTime(pr.created_at)}
                                            </div>
                                        </div>
                                        {prStatusPill(pr.status)}
                                    </div>

                                    {isExpanded && (
                                        <div style={{ padding: "4px 12px 10px 28px", background: "rgba(0,0,0,0.02)" }}>
                                            {isDetailLoading && (
                                                <div className="sc-loading" style={{ padding: "4px 0" }}>
                                                    <div className="spinner" style={{ width: 12, height: 12 }} />
                                                    <span>Loading diff…</span>
                                                </div>
                                            )}
                                            {detail?.entries?.map((e: StagingEntry) => {
                                                const op = (e as any).operation || e.change_type;
                                                const kind = OP_KIND[op] ?? "M";
                                                return (
                                                    <div key={e.entry_id} className="sc-vsc-file-row" style={{ paddingLeft: 0 }}>
                                                        <span className="sc-vsc-file-icon">
                                                            {I.database({ style: { width: 12, height: 12, opacity: 0.5 } })}
                                                        </span>
                                                        <div className="sc-vsc-file-info">
                                                            <span className="sc-vsc-file-name">{OP_LABEL[op] || op}</span>
                                                            <span className="sc-vsc-file-path">{stagedSummary(e)}</span>
                                                        </div>
                                                        <span className={`sc-vsc-badge sc-vsc-badge-${kind.toLowerCase()}`}>{kind}</span>
                                                    </div>
                                                );
                                            })}
                                            {pr.status === "open" && (
                                                <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                                                    {canReview && (
                                                        <button
                                                            className="btn primary"
                                                            style={{ fontSize: 11, padding: "4px 10px" }}
                                                            disabled={isBusy}
                                                            onClick={(e) => { e.stopPropagation(); doMergePR(pr.pr_id); }}
                                                        >
                                                            {isBusy ? "Merging…" : <>{I.check({ style: { width: 11, height: 11 } })}&nbsp;Merge</>}
                                                        </button>
                                                    )}
                                                    {canClose && (
                                                        <button
                                                            className="btn"
                                                            style={{ fontSize: 11, padding: "4px 10px", color: "var(--red)", borderColor: "var(--red)" }}
                                                            disabled={isBusy}
                                                            onClick={(e) => { e.stopPropagation(); doClosePR(pr.pr_id); }}
                                                        >
                                                            {isBusy ? "Closing…" : "Close"}
                                                        </button>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        );
    };

    // Computed before any conditional returns (rules of hooks)
    const skuFilteredItems = useMemo(() => {
        if (!skuItemSearch.trim()) return allItems.slice(0, 8);
        const q = parseInventoryQuery(skuItemSearch);
        return allItems
            .filter((it: any) => matchesInventoryQuery(it, q))
            .slice(0, 8);
    }, [allItems, skuItemSearch]);

    // ── sub-view: SKU REVIEW QUEUE (rendered as overlay) ─────────────────────
    const renderSKUReview = () => {
        if (!(showSKUReview && canReview)) return null;
        return (
            <div className="overlay" onClick={() => setShowSKUReview(false)}>
                <div className="modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
                    <div className="modal-head">
                        <h3>{I.archive()} SKU Review Queue</h3>
                        <div className="sub">{skuRows.length > 0 ? `${skuRows.length} pending` : "All resolved"}</div>
                        <button className="modal-x" onClick={() => setShowSKUReview(false)} aria-label="Close">{I.x()}</button>
                    </div>
                    <div className="modal-body" style={{ padding: 0 }}>

                        {skuLoading && (
                            <div className="sc-loading">
                                <div className="spinner" style={{ width: 14, height: 14 }} />
                                <span>Loading…</span>
                            </div>
                        )}

                        {!skuLoading && skuRows.length === 0 && (
                            <div className="sc-empty">
                                <div className="sc-empty-icon">{I.check({ style: { width: 24, height: 24 } })}</div>
                                <div className="sc-empty-title">Queue is clear</div>
                                <div className="sc-empty-sub">All imported SKUs resolved.</div>
                            </div>
                        )}

                        {skuRows.map((row: any) => {
                            const isExpanded = skuExpandedId === row.id;
                            return (
                                <div key={row.id} style={{ borderBottom: "1px solid var(--line)" }}>
                                    {/* Row header */}
                                    <div
                                        className="sc-vsc-section-head"
                                        style={{ cursor: "pointer", alignItems: "flex-start", padding: "8px 12px" }}
                                        onClick={() => setSkuExpandedId(isExpanded ? null : row.id)}
                                    >
                                        <span className="sc-vsc-chevron" style={{ marginTop: 2 }}>
                                            {isExpanded ? "▾" : "▸"}
                                        </span>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontSize: 12, fontWeight: 600, display: "flex", gap: 6, alignItems: "center" }}>
                                                <span className="mono">{row.parsed_sku}</span>
                                                <span className="pill warn" style={{ fontSize: 9 }}>unknown</span>
                                            </div>
                                            <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 2 }}>
                                                {row.parsed_description || "—"}
                                                {row.qty != null ? ` · qty ${row.qty}` : ""}
                                                {row.unit_price != null ? ` · $${Number(row.unit_price).toFixed(2)}` : ""}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Expanded form */}
                                    {isExpanded && (
                                        <div style={{ padding: "6px 12px 12px 28px", background: "rgba(0,0,0,0.02)" }}>
                                            {/* Conflict banner */}
                                            {skuConflict && skuExpandedId === row.id && (
                                                <div style={{ background: "rgba(220,38,38,0.08)", border: "1px solid var(--red,#dc2626)", borderRadius: 6, padding: "8px 10px", marginBottom: 8, fontSize: 11.5 }}>
                                                    <strong>SKU conflict:</strong> &ldquo;{skuConflict.conflict_sku}&rdquo; already belongs to{" "}
                                                    <em>{skuConflict.conflict_desc}</em>.
                                                    <div style={{ marginTop: 6, display: "flex", gap: 6 }}>
                                                        <button
                                                            className="btn"
                                                            style={{ fontSize: 11, padding: "3px 8px" }}
                                                            onClick={() => {
                                                                setSkuConflict(null);
                                                                setSkuResolution('alias_existing');
                                                                setSkuSelectedItem(allItems.find((it: any) => it.id === skuConflict.conflict_id) || { id: skuConflict.conflict_id, sku: skuConflict.conflict_sku, desc: skuConflict.conflict_desc });
                                                                loadAllItems();
                                                            }}
                                                        >
                                                            {I.check({ style: { width: 10, height: 10 } })} Link as alias
                                                        </button>
                                                        <button className="btn" style={{ fontSize: 11, padding: "3px 8px" }} onClick={() => setSkuConflict(null)}>
                                                            Cancel
                                                        </button>
                                                    </div>
                                                </div>
                                            )}

                                            {/* Action selector */}
                                            <div style={{ display: "flex", gap: 4, marginBottom: 8, flexWrap: "wrap" }}>
                                                {(["new_item", "alias_existing", "override_existing"] as const).map((res) => (
                                                    <button
                                                        key={res}
                                                        className={"sc-nav-btn" + (skuResolution === res && skuExpandedId === row.id ? " active" : "")}
                                                        onClick={() => openSkuAction(row.id, row, res)}
                                                        style={{ fontSize: 11 }}
                                                    >
                                                        {res === "new_item" && <>{I.plus({ style: { width: 11, height: 11 } })} New item</>}
                                                        {res === "alias_existing" && <>{I.check({ style: { width: 11, height: 11 } })} Alias existing</>}
                                                        {res === "override_existing" && <>{I.edit({ style: { width: 11, height: 11 } })} Override SKU</>}
                                                    </button>
                                                ))}
                                            </div>

                                            {/* New item form */}
                                            {skuResolution === 'new_item' && skuExpandedId === row.id && (
                                                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                                    <input className="ipt" placeholder="SKU" value={skuNewSku} onChange={(e) => setSkuNewSku(e.target.value)} style={{ fontSize: 12 }} />
                                                    <input className="ipt" placeholder="Description" value={skuNewDesc} onChange={(e) => setSkuNewDesc(e.target.value)} style={{ fontSize: 12 }} />
                                                    <input className="ipt" placeholder="Category (leave blank → Uncategorized)" value={skuNewCategory} onChange={(e) => setSkuNewCategory(e.target.value)} style={{ fontSize: 12 }} />
                                                    <button
                                                        className="btn primary"
                                                        style={{ fontSize: 11, padding: "4px 10px", alignSelf: "flex-start" }}
                                                        disabled={skuBusy || !skuNewSku.trim()}
                                                        onClick={() => doSKUResolve(row.id)}
                                                    >
                                                        {skuBusy ? "Creating…" : <>{I.plus({ style: { width: 11, height: 11 } })} Create &amp; Commit</>}
                                                    </button>
                                                </div>
                                            )}

                                            {/* Alias / Override form (shared item picker) */}
                                            {(skuResolution === 'alias_existing' || skuResolution === 'override_existing') && skuExpandedId === row.id && (
                                                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                                    <div style={{ position: "relative" }}>
                                                        <input
                                                            className="ipt"
                                                            placeholder="Search SKU, description, or $price"
                                                            value={skuSelectedItem ? `${skuSelectedItem.sku} — ${skuSelectedItem.desc || skuSelectedItem.description || ''}` : skuItemSearch}
                                                            onChange={(e) => { setSkuItemSearch(e.target.value); setSkuSelectedItem(null); }}
                                                            style={{ fontSize: 12, width: "100%" }}
                                                        />
                                                        {!skuSelectedItem && skuItemSearch && (
                                                            <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 6, zIndex: 10, maxHeight: 160, overflowY: "auto", boxShadow: "0 4px 12px rgba(0,0,0,0.12)" }}>
                                                                {skuFilteredItems.length === 0 && (
                                                                    <div style={{ padding: "8px 10px", fontSize: 11, color: "var(--muted)" }}>No items found</div>
                                                                )}
                                                                {skuFilteredItems.map((it: any) => (
                                                                    <div
                                                                        key={it.id}
                                                                        style={{ padding: "6px 10px", cursor: "pointer", fontSize: 11.5 }}
                                                                        onMouseDown={(e) => { e.preventDefault(); setSkuSelectedItem(it); setSkuItemSearch(''); }}
                                                                    >
                                                                        <span className="mono" style={{ fontSize: 10.5, color: "var(--muted)", marginRight: 6 }}>{it.sku}</span>
                                                                        {it.desc || it.description}
                                                                        {(it.price ?? it.unit_price) != null && (
                                                                            <span className="mono" style={{ fontSize: 10.5, color: "var(--faint)", marginLeft: 6 }}>
                                                                                ${Number(it.price ?? it.unit_price).toFixed(2)}
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                    {skuSelectedItem && (
                                                        <div style={{ fontSize: 11, color: "var(--muted)", display: "flex", alignItems: "center", gap: 6 }}>
                                                            {I.check({ style: { width: 11, height: 11, color: "var(--ok, #16a34a)" } })}
                                                            Selected: <strong>{skuSelectedItem.sku}</strong> — {skuSelectedItem.desc || skuSelectedItem.description}
                                                            <button className="sc-icon-btn" style={{ marginLeft: 4 }} onClick={() => { setSkuSelectedItem(null); setSkuItemSearch(''); }}>
                                                                {I.x({ style: { width: 10, height: 10 } })}
                                                            </button>
                                                        </div>
                                                    )}
                                                    {skuResolution === 'override_existing' && (
                                                        <input className="ipt" placeholder="New canonical SKU" value={skuOverrideSku} onChange={(e) => setSkuOverrideSku(e.target.value)} style={{ fontSize: 12 }} />
                                                    )}
                                                    <button
                                                        className="btn primary"
                                                        style={{ fontSize: 11, padding: "4px 10px", alignSelf: "flex-start" }}
                                                        disabled={skuBusy || !skuSelectedItem || (skuResolution === 'override_existing' && !skuOverrideSku.trim())}
                                                        onClick={() => doSKUResolve(row.id)}
                                                    >
                                                        {skuBusy
                                                            ? "Saving…"
                                                            : skuResolution === 'alias_existing'
                                                                ? <>{I.check({ style: { width: 11, height: 11 } })} Link Alias</>
                                                                : <>{I.edit({ style: { width: 11, height: 11 } })} Override &amp; Commit</>
                                                        }
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        );
    };

    // ── main view ─────────────────────────────────────────────────────────────
    return (
        <div className="sc-body" style={{ overflowY: "auto" }}>
            {loading && <div className="sc-loading"><div className="spinner" style={{ width: 16, height: 16 }} /><span>Loading…</span></div>}

            {/* Toolbar: labeled nav buttons (panel mode only — page mode uses PageToolbar) */}
            {!pageMode && (
            <div style={{ display: "flex", gap: 4, padding: "5px 8px 4px", borderBottom: "1px solid var(--line)", flexWrap: "wrap" }}>
                <button className="sc-nav-btn" title="Commit History" onClick={() => setShowHistory(true)}>
                    {I.clock({ style: { width: 13, height: 13 } })} History
                </button>
                <button className="sc-nav-btn" title={canReview ? "Pull Requests" : "My Requests"} onClick={() => { setShowPRs(true); loadPRs(); }}>
                    {I.inbox({ style: { width: 13, height: 13 } })} {canReview ? "Pull Requests" : "My Requests"}
                </button>
                {canReview && (
                    <button className="sc-nav-btn" title="AI Assistant" onClick={() => setShowAI(true)}>
                        {I.flame({ style: { width: 13, height: 13 } })} AI
                    </button>
                )}
                {canReview && (
                    <button className="sc-nav-btn" title="SKU Review Queue" onClick={() => { setShowSKUReview(true); loadSKUReview(); }}>
                        {I.archive({ style: { width: 13, height: 13 } })} SKU Review
                    </button>
                )}
            </div>
            )}

            {/* Commit textarea — admin/manager only, when there are staged changes */}
            {canCommit && visibleStaged.length > 0 && (
                <div style={{ padding: "8px 12px 0" }}>
                    <textarea className="sc-commit-msg" placeholder="Commit message (Ctrl+Enter)…" rows={2}
                        value={commitMsg} onChange={(e) => setCommitMsg(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && visibleStaged.length > 0) setConfirm(visibleStaged); }} />
                </div>
            )}
            {canCommit && (
                <SaveBar
                    dirtyCount={visibleStaged.length}
                    saved={visibleStaged.length === 0}
                    busy={busy}
                    canEdit={canCommit}
                    onSave={() => setConfirm(visibleStaged)}
                    saveLabel={`Commit${visibleStaged.length > 0 ? ` (${visibleStaged.length})` : ""}`}
                    savePrimary
                />
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
                        <span className="sc-section-label">{!canReview ? "MY SUBMISSIONS" : "STAGED CHANGES"}</span>
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
                        const inPR = !!(ch as any).pull_request_id;
                        return (
                            <div key={ch.entry_id} className="sc-vsc-file-row">
                                <span className="sc-vsc-file-icon">
                                    {I.database({ style: { width: 13, height: 13, opacity: 0.6 } })}
                                </span>
                                <div className="sc-vsc-file-info">
                                    <span className="sc-vsc-file-name">{label}</span>
                                    <span className="sc-vsc-file-path">
                                        {summary}{summary ? " · " : ""}{ch.submitter_name || ""}{ch.created_at ? " · " + relTime(ch.created_at) : ""}
                                        {inPR && <span style={{ color: "var(--blue, #2563EB)", marginLeft: 4 }}>· in review</span>}
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
                                        <span className="sc-pending-badge">{inPR ? "In review" : "Pending"}</span>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Staff footer: Submit for Review shortcut */}
            {!canReview && unlinkedStaged.length > 0 && (
                <div className="sc-staff-note" style={{ cursor: "pointer" }} onClick={() => { setShowPRs(true); loadPRs(); }}>
                    {I.inbox({ style: { width: 12, height: 12 } })}
                    <span>Submit {unlinkedStaged.length} change{unlinkedStaged.length !== 1 ? "s" : ""} for review →</span>
                </div>
            )}
            {!canReview && unlinkedStaged.length === 0 && visibleStaged.length > 0 && (
                <div className="sc-staff-note">
                    {I.user({ style: { width: 12, height: 12 } })}
                    <span>Your changes are pending manager review.</span>
                </div>
            )}
            {!canReview && visibleStaged.length === 0 && (
                <div className="sc-staff-note">
                    {I.user({ style: { width: 12, height: 12 } })}
                    <span>No pending submissions.</span>
                </div>
            )}

            {/* Confirm overlay */}
            {confirm && (
                <div className="overlay" onClick={() => setConfirm(null)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-head">
                            <h3>{I.check()} Commit changes</h3>
                            <div className="sub">
                                {confirm.length === 1 ? "Commit this staged change to the live database?" : `Commit all ${confirm.length} staged changes to the live database?`}
                            </div>
                            <button className="modal-x" onClick={() => setConfirm(null)} aria-label="Close">
                                {I.x()}
                            </button>
                        </div>
                        <div className="modal-body">
                            <p style={{ lineHeight: 1.5, fontSize: 13 }}>
                                {confirm.length === 1
                                    ? "This will apply the change and create a commit record. The change will be dispatched to the live tables immediately."
                                    : `This will apply all ${confirm.length} staged changes and create a commit record. Each change will be dispatched to the live tables.`}
                            </p>
                        </div>
                        <div className="modal-foot">
                            <button className="btn" onClick={() => setConfirm(null)}>Cancel</button>
                            <button className="btn primary" disabled={busy} onClick={() => doCommit(confirm)}>
                                {I.check({ style: { width: 13, height: 13 } })}&nbsp;Commit
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {renderHistory()}
            {renderAI()}
            {renderPRs()}
            {renderSKUReview()}
        </div>
    );
}

// ── Side panel (VSCode-style slide-in) ──────────────────────────────────────
export function SourceControlPanel({
    user,
    open,
    onClose,
    onCountChange,
    onSkuReviewCount,
}: {
    user: User;
    open: boolean;
    onClose: () => void;
    onCountChange?: (n: number) => void;
    onSkuReviewCount?: (n: number) => void;
}) {
    const { staged, setStaged, commits, loading, loadData } = useSCData(open);

    const [skuReviewCount, setSkuReviewCount] = useState(0);

    useEffect(() => { onCountChange?.(staged.length); }, [staged.length, onCountChange]);
    useEffect(() => { onSkuReviewCount?.(skuReviewCount); }, [skuReviewCount, onSkuReviewCount]);

    // Fetch pending SKU review count
    useEffect(() => {
        if (!open) return;
        let alive = true;
        api.getSKUReview('pending', 1).then(rows => {
            if (alive) setSkuReviewCount(rows?.[0]?.total_count ?? rows?.length ?? 0);
        }).catch(() => {});
        return () => { alive = false; };
    }, [open]);

    const lvl = ROLE_LEVEL[user.role] || 0;
    const canReview = lvl >= 30;
    const visibleStaged = !canReview
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
                        {(ROLE_LEVEL[user.role] || 0) >= ROLE_LEVEL.manager && (
                            <SCPushButton />
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
type SCPageTab = 'changes' | 'history' | 'prs' | 'ai' | 'sku';

export function SourceControlPage({
    user, openPrId, onConsumePrId,
}: { user: User; openPrId?: string | null; onConsumePrId?: () => void }) {
    const { staged, setStaged, commits, loading, loadData } = useSCData(true);
    const [tab, setTab] = useState<SCPageTab>('changes');
    const lastCommit = commits[0];
    const lvl = ROLE_LEVEL[user.role] ?? 0;
    const canReview = lvl >= 30;

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
                {(ROLE_LEVEL[user.role] || 0) >= ROLE_LEVEL.manager && <SCPushButton />}
            </div>
            <PageToolbar>
                <button className={"sc-nav-btn" + (tab === 'changes' ? " active" : "")} onClick={() => setTab('changes')}>
                    {I.branch({ style: { width: 13, height: 13 } })} Changes
                </button>
                <button className={"sc-nav-btn" + (tab === 'history' ? " active" : "")} onClick={() => setTab('history')}>
                    {I.clock({ style: { width: 13, height: 13 } })} History
                </button>
                <button className={"sc-nav-btn" + (tab === 'prs' ? " active" : "")} onClick={() => setTab('prs')}>
                    {I.inbox({ style: { width: 13, height: 13 } })} {canReview ? "Pull Requests" : "My Requests"}
                </button>
                {canReview && (
                    <button className={"sc-nav-btn" + (tab === 'ai' ? " active" : "")} onClick={() => setTab('ai')}>
                        {I.flame({ style: { width: 13, height: 13 } })} AI
                    </button>
                )}
                {canReview && (
                    <button className={"sc-nav-btn" + (tab === 'sku' ? " active" : "")} onClick={() => setTab('sku')}>
                        {I.archive({ style: { width: 13, height: 13 } })} SKU Review
                    </button>
                )}
            </PageToolbar>
            <div className="sc-page-body">
                <div className="sc-page-panel card">
                    <SCChangesView
                        user={user}
                        staged={staged}
                        setStaged={setStaged}
                        commits={commits}
                        loading={loading}
                        openPrId={openPrId}
                        onConsumePrId={onConsumePrId}
                        loadData={loadData}
                        externalTab={tab}
                    />
                </div>
            </div>
        </div>
    );
}
