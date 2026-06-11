import { useState, useEffect, useCallback } from "react";
import { I } from "../lib/icons";
import { type User, ROLE_LEVEL, ROLE_LABEL } from "../lib/constants";
import { api, type Commit, type StagingEntry } from "../lib/api";

const t = (msg: string) => (window as any).toast?.(msg);
type SCTab = "changes" | "history" | "ai";

const OP_LABEL: Record<string, string> = {
    inventory_save: "Inventory update",
    inventory_week_update: "Weekly invoice",
    item_update: "Item edit",
    item_delete: "Item delete",
    menu_save: "Menu change",
    event_create: "New event",
    haccp_save: "HACCP log",
    daily_log_save: "Daily ops entry",
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

function relTime(iso: string) {
    const d = new Date(iso), now = new Date();
    const mins = Math.round((now.getTime() - d.getTime()) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return mins + " min ago";
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs + " hr" + (hrs > 1 ? "s" : "") + " ago";
    const days = Math.round(hrs / 24);
    if (days < 7) return days + " day" + (days > 1 ? "s" : "") + " ago";
    return d.toLocaleDateString();
}

function shortSha(sha: string | null | undefined): string {
    return sha ? sha.slice(0, 7) : "";
}

function opPayloadSummary(entry: StagingEntry): string {
    const fp = (entry as any).full_payload;
    const op = (entry as any).operation;
    if (op === "inventory_save" && fp?.items)
        return `${fp.items.length} item${fp.items.length !== 1 ? "s" : ""}`;
    if (op === "inventory_week_update" && fp?.items)
        return `${fp.items.length} item${fp.items.length !== 1 ? "s" : ""} → W${fp.week} ${fp.direction === "issued" ? "exported" : "received"}`;
    if (op === "item_update" && fp?.sku)
        return `Edit ${fp.sku}${fp.category ? ` → ${fp.category}` : ""}`;
    if (op === "item_delete" && fp?.sku) return `Delete ${fp.sku}`;
    if (op === "menu_save" && fp?.day) return `Menu for ${fp.day}`;
    if (op === "event_create" && fp?.title) return fp.title;
    if (op === "haccp_save" && fp?.location)
        return `${fp.location} · ${fp.temperature}${fp.unit}`;
    if (op === "daily_log_save" && fp?.title) return fp.title;
    return "";
}

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
    const lvl = ROLE_LEVEL[user.role] || 0;
    const isStaff = lvl < 20;
    const canCommit = lvl >= 30;

    const [tab, setTab] = useState<SCTab>("changes");
    const [staged, setStaged] = useState<StagingEntry[]>([]);
    const [commits, setCommits] = useState<Commit[]>([]);
    const [loading, setLoading] = useState(false);
    const [busy, setBusy] = useState(false);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [commitMsg, setCommitMsg] = useState("");
    const [confirm, setConfirm] = useState<{
        action: string;
        entries: StagingEntry[];
    } | null>(null);

    const [aiPrompt, setAiPrompt] = useState("");
    const [aiRunning, setAiRunning] = useState(false);
    const [aiResult, setAiResult] = useState<string | null>(null);

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

    useEffect(() => {
        if (open) loadData();
    }, [open, loadData]);

    // Real-time updates: reload whenever any component stages or rejects something
    useEffect(() => {
        const handler = () => loadData();
        window.addEventListener('mjcc:staging-changed', handler);
        return () => window.removeEventListener('mjcc:staging-changed', handler);
    }, [loadData]);

    // Polling fallback for cross-tab changes and external staging (30s)
    useEffect(() => {
        const id = setInterval(loadData, 30000);
        return () => clearInterval(id);
    }, [loadData]);

    useEffect(() => {
        onCountChange?.(staged.length);
    }, [staged.length, onCountChange]);

    const myStaged = staged.filter(
        (s) =>
            s.submitted_by === user.username ||
            s.submitter_name?.startsWith(user.display_name),
    );
    const visibleStaged = isStaff ? myStaged : staged;
    const lastCommit = commits[0];

    function toggleSelect(id: string) {
        setSelected((p) => {
            const next = new Set(p);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }

    function toggleAll() {
        if (selected.size === visibleStaged.length) setSelected(new Set());
        else setSelected(new Set(visibleStaged.map((s) => s.entry_id)));
    }

    async function doCommit(entries: StagingEntry[]) {
        setConfirm(null);
        setBusy(true);
        try {
            const ids = entries.map((e) => e.entry_id);
            const msg =
                commitMsg.trim() ||
                (entries.length === 1
                    ? OP_LABEL[(entries[0] as any).operation] || entries[0].change_type
                    : `Batch commit — ${entries.length} change${entries.length !== 1 ? "s" : ""}`);
            const commit = await api.approveCommit({ staging_ids: ids, message: msg, author_id: user.id });
            setStaged((s) => s.filter((x) => !ids.includes(x.entry_id)));
            setCommits((cs) => [commit, ...cs]);
            setSelected(new Set());
            setCommitMsg("");
            t(`Committed ${entries.length} change${entries.length !== 1 ? "s" : ""}`);
            window.dispatchEvent(new CustomEvent('mjcc:committed'));
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
            setSelected((p) => { const n = new Set(p); n.delete(entry.entry_id); return n; });
            t("Entry returned to author");
            window.dispatchEvent(new CustomEvent('mjcc:staging-changed'));
        } catch (err: any) {
            t(`Rejection failed: ${err?.message || "Unknown error"}`);
        } finally {
            setBusy(false);
        }
    }

    async function runAICommit() {
        if (!aiPrompt.trim()) return;
        setAiRunning(true);
        setAiResult(null);
        try {
            const res = await api.sendAgentMessage(aiPrompt.trim());
            setAiResult(res.response);
            t("AI processed — check Changes tab");
            await loadData();
            setTab("changes");
        } catch (err: any) {
            const msg = err?.message || "Unknown error";
            t(`AI error: ${msg}`);
            setAiResult(`Error: ${msg}`);
        } finally {
            setAiRunning(false);
        }
    }

    const selectedEntries = visibleStaged.filter((s) => selected.has(s.entry_id));

    return (
        <>
            {open && <div className="sc-backdrop" onClick={onClose} />}

            <div className={"sc-panel" + (open ? " open" : "")}>
                {/* ── Header ── */}
                <div className="sc-header">
                    <div className="sc-title-row">
                        <span className="sc-title-icon">
                            {I.branch({ style: { width: 14, height: 14 } })}
                        </span>
                        <span className="sc-title">SOURCE CONTROL</span>
                        <span className="sc-branch-badge">main</span>
                        <div style={{ flex: 1 }} />
                        <button
                            className="sc-icon-btn"
                            onClick={loadData}
                            disabled={loading}
                            title="Refresh"
                        >
                            {I.refresh({ style: { width: 14, height: 14 } })}
                        </button>
                        <button
                            className="sc-icon-btn"
                            onClick={onClose}
                            title="Close panel"
                        >
                            {I.x({ style: { width: 14, height: 14 } })}
                        </button>
                    </div>

                    <div className="sc-tabs">
                        {(["changes", "history", "ai"] as SCTab[]).map((tb) => (
                            <button
                                key={tb}
                                className={"sc-tab" + (tab === tb ? " active" : "")}
                                onClick={() => setTab(tb)}
                            >
                                {tb === "changes" && (
                                    <>
                                        Changes
                                        {visibleStaged.length > 0 && (
                                            <span className="sc-tab-badge">{visibleStaged.length}</span>
                                        )}
                                    </>
                                )}
                                {tb === "history" && "History"}
                                {tb === "ai" && (
                                    <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                        {I.flame({ style: { width: 11, height: 11 } })} AI
                                    </span>
                                )}
                            </button>
                        ))}
                    </div>
                </div>

                {/* ── Status bar ── */}
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
                </div>

                {/* ── Body ── */}
                <div className="sc-body">
                    {loading && (
                        <div className="sc-loading">
                            <div className="spinner" style={{ width: 18, height: 18 }} />
                            <span>Loading…</span>
                        </div>
                    )}

                    {/* ── CHANGES TAB ── */}
                    {!loading && tab === "changes" && (
                        <div className="sc-changes">
                            <div className="sc-section-head">
                                {canCommit && visibleStaged.length > 0 && (
                                    <label className="sc-select-all" title="Select all">
                                        <input
                                            type="checkbox"
                                            checked={selected.size === visibleStaged.length && visibleStaged.length > 0}
                                            onChange={toggleAll}
                                        />
                                    </label>
                                )}
                                <span className="sc-section-label">
                                    {isStaff ? "MY SUBMISSIONS" : "STAGED CHANGES"}
                                </span>
                                {visibleStaged.length > 0 && (
                                    <span className="sc-section-count">{visibleStaged.length}</span>
                                )}
                            </div>

                            {visibleStaged.length === 0 && (
                                <div className="sc-empty">
                                    <div className="sc-empty-icon">
                                        {I.branch({ style: { width: 26, height: 26 } })}
                                    </div>
                                    <div className="sc-empty-title">Working tree is clean</div>
                                    <div className="sc-empty-sub">
                                        Make inventory or data edits to stage changes for review.
                                    </div>
                                </div>
                            )}

                            {visibleStaged.map((ch) => {
                                const op = (ch as any).operation || ch.change_type;
                                const kind = OP_KIND[op] ?? "M";
                                const label = OP_LABEL[op] || op;
                                const summary = opPayloadSummary(ch) || ch.new_value_text || ch.field_name;
                                const isSel = selected.has(ch.entry_id);

                                return (
                                    <div
                                        key={ch.entry_id}
                                        className={"sc-change-item" + (isSel ? " selected" : "")}
                                    >
                                        {canCommit && (
                                            <label
                                                className="sc-cb"
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={isSel}
                                                    onChange={() => toggleSelect(ch.entry_id)}
                                                />
                                            </label>
                                        )}
                                        <span className={"sc-kind sc-kind-" + kind.toLowerCase()}>
                                            {kind}
                                        </span>
                                        <div className="sc-change-body">
                                            <div className="sc-change-name">{label}</div>
                                            {summary && (
                                                <div className="sc-change-desc">{summary}</div>
                                            )}
                                            <div className="sc-change-meta">
                                                <span className="sc-avatar-xs">
                                                    {(ch.submitter_name || ch.submitted_by)[0]?.toUpperCase() || "?"}
                                                </span>
                                                <span>{ch.submitter_name || ch.submitted_by}</span>
                                                {ch.submitter_role && (
                                                    <span className={"pill role-" + ch.submitter_role} style={{ padding: "0 5px", fontSize: 9 }}>
                                                        {ROLE_LABEL[ch.submitter_role as keyof typeof ROLE_LABEL] || ch.submitter_role}
                                                    </span>
                                                )}
                                                <span style={{ marginLeft: "auto", opacity: 0.65 }}>
                                                    {relTime(ch.created_at)}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="sc-item-actions">
                                            {canCommit ? (
                                                <>
                                                    <button
                                                        className="sc-icon-btn danger"
                                                        onClick={() => doReject(ch)}
                                                        disabled={busy}
                                                        title="Return to author"
                                                    >
                                                        {I.x({ style: { width: 11, height: 11 } })}
                                                    </button>
                                                    <button
                                                        className="sc-icon-btn ok"
                                                        onClick={() =>
                                                            setConfirm({ action: "single", entries: [ch] })
                                                        }
                                                        disabled={busy}
                                                        title="Commit"
                                                    >
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

                            {/* Manager commit controls */}
                            {canCommit && visibleStaged.length > 0 && (
                                <div className="sc-commit-area">
                                    <textarea
                                        className="sc-commit-msg"
                                        placeholder="Commit message (auto-generated if blank)…"
                                        rows={2}
                                        value={commitMsg}
                                        onChange={(e) => setCommitMsg(e.target.value)}
                                    />
                                    <div className="sc-commit-btns">
                                        {selected.size > 0 && (
                                            <button
                                                className="btn primary"
                                                style={{ flex: 1, justifyContent: "center" }}
                                                onClick={() =>
                                                    setConfirm({ action: "selected", entries: selectedEntries })
                                                }
                                                disabled={busy}
                                            >
                                                {I.check({ style: { width: 13, height: 13 } })}
                                                &nbsp;Commit {selected.size}
                                            </button>
                                        )}
                                        <button
                                            className="btn primary"
                                            style={{ flex: 1, justifyContent: "center" }}
                                            onClick={() =>
                                                setConfirm({ action: "all", entries: visibleStaged })
                                            }
                                            disabled={busy}
                                        >
                                            {I.branch()}&nbsp;Commit all ({visibleStaged.length})
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* Staff note */}
                            {isStaff && (
                                <div className="sc-staff-note">
                                    {I.user({ style: { width: 12, height: 12 } })}
                                    <span>Your changes are pending manager review.</span>
                                </div>
                            )}
                        </div>
                    )}

                    {/* ── HISTORY TAB ── */}
                    {!loading && tab === "history" && (
                        <div className="sc-history">
                            <div className="sc-section-head">
                                <span className="sc-section-label">COMMIT LOG</span>
                                {commits.length > 0 && (
                                    <span className="sc-section-count">{commits.length}</span>
                                )}
                            </div>

                            {commits.length === 0 ? (
                                <div className="sc-empty">
                                    <div className="sc-empty-title">No commits yet</div>
                                </div>
                            ) : (
                                commits.map((c, i) => (
                                    <div key={c.commit_id} className="sc-commit-item">
                                        <div className="sc-graph">
                                            <span className="sc-g-dot" />
                                            {i < commits.length - 1 && (
                                                <span className="sc-g-line" />
                                            )}
                                        </div>
                                        <div className="sc-commit-body">
                                            <div className="sc-hist-msg">{c.message}</div>
                                            <div className="sc-commit-meta">
                                                <span className="sc-sha mono">
                                                    {shortSha(c.github_sha) || c.commit_id.slice(0, 7)}
                                                </span>
                                                <span>{c.author_name || c.author_id}</span>
                                                {c.submitter_role && (
                                                    <span
                                                        className={"pill role-" + c.submitter_role}
                                                        style={{ padding: "0 5px", fontSize: 9 }}
                                                    >
                                                        {ROLE_LABEL[c.submitter_role as keyof typeof ROLE_LABEL] || c.submitter_role}
                                                    </span>
                                                )}
                                                <span style={{ marginLeft: "auto", opacity: 0.6 }}>
                                                    {relTime((c as any).github_synced_at || c.merged_at || c.created_at)}
                                                </span>
                                            </div>
                                            <div className="sc-commit-detail">
                                                <span>{c.change_count} field{c.change_count !== 1 ? "s" : ""}</span>
                                                {c.github_sha && (
                                                    <span className="sc-synced">
                                                        {I.check({ style: { width: 10, height: 10 } })} synced
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    )}

                    {/* ── AI TAB ── */}
                    {!loading && tab === "ai" && (
                        <div className="sc-ai">
                            <div className="sc-section-head">
                                <span className="sc-section-label">
                                    {I.flame({ style: { width: 11, height: 11, display: "inline-block", marginRight: 5 } })}
                                    AI COMMIT ASSISTANT
                                </span>
                            </div>

                            <div className="sc-ai-desc">
                                Describe a change in plain English. The AI will apply it and stage it for review.
                            </div>

                            <textarea
                                className="sc-ai-input"
                                placeholder={"e.g. \"Set chicken stock to 20 units\"\n\"Add new item: Olive Oil, $8.50, par 6\"\n\"Mark all dairy items below par as critical\""}
                                rows={5}
                                value={aiPrompt}
                                onChange={(e) => setAiPrompt(e.target.value)}
                                disabled={aiRunning}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) runAICommit();
                                }}
                            />

                            <button
                                className="btn primary"
                                style={{ width: "100%", justifyContent: "center", marginTop: 10 }}
                                onClick={runAICommit}
                                disabled={aiRunning || !aiPrompt.trim()}
                            >
                                {aiRunning ? (
                                    <>
                                        <div className="spinner" style={{ width: 13, height: 13 }} />
                                        &nbsp;Processing…
                                    </>
                                ) : (
                                    <>
                                        {I.flame({ style: { width: 14, height: 14 } })}&nbsp;Apply &amp; Stage
                                    </>
                                )}
                            </button>

                            {aiResult && (
                                <div className="sc-ai-result">
                                    <div className="sc-ai-result-head">AI Response</div>
                                    <div className="sc-ai-result-body">{aiResult}</div>
                                    <button
                                        className="sc-ai-result-link"
                                        onClick={() => setTab("changes")}
                                    >
                                        View staged changes →
                                    </button>
                                </div>
                            )}

                            <div className="sc-ai-roles">
                                <div className="sc-ai-role-row">
                                    <span className="pill role-staff" style={{ fontSize: 10 }}>Staff</span>
                                    <span>Changes staged → awaiting manager approval</span>
                                </div>
                                <div className="sc-ai-role-row">
                                    <span className="pill role-manager" style={{ fontSize: 10 }}>Manager</span>
                                    <span>Changes staged → you can commit immediately</span>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* ── Confirm dialog ── */}
                {confirm && (
                    <div className="sc-confirm-overlay" onClick={() => setConfirm(null)}>
                        <div className="sc-confirm" onClick={(e) => e.stopPropagation()}>
                            <p>
                                {confirm.action === "all"
                                    ? `Commit all ${confirm.entries.length} staged change${confirm.entries.length !== 1 ? "s" : ""}? Changes will be applied and pushed to GitHub.`
                                    : confirm.action === "selected"
                                        ? `Commit ${confirm.entries.length} selected change${confirm.entries.length !== 1 ? "s" : ""}?`
                                        : "Commit this change to the record?"}
                            </p>
                            <div className="sc-confirm-btns">
                                <button className="btn" onClick={() => setConfirm(null)}>
                                    Cancel
                                </button>
                                <button
                                    className="btn primary"
                                    onClick={() => doCommit(confirm.entries)}
                                    disabled={busy}
                                >
                                    {I.check({ style: { width: 13, height: 13 } })}&nbsp;Commit
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </>
    );
}
