import { useState, useEffect, useCallback } from "react";
import { I } from "../lib/icons";
import { type User, ROLE_LEVEL, ROLE_LABEL } from "../lib/constants";
import { api, type Commit, type StagingEntry } from "../lib/api";

const t = (msg: string) => (window as any).toast?.(msg);

const OP_ICON: Record<string, string> = {
    inventory_save: "box",
    menu_save: "book",
    event_create: "calCheck",
    haccp_save: "thermo",
    daily_log_save: "checkSquare",
    user_create: "user",
    user_update: "user",
};

const OP_LABEL: Record<string, string> = {
    inventory_save: "Inventory update",
    menu_save: "Menu change",
    event_create: "New event",
    haccp_save: "HACCP log",
    daily_log_save: "Daily ops entry",
    user_create: "New user",
    user_update: "User update",
};

function relTime(iso: string) {
    const d = new Date(iso),
        now = new Date();
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

function ConfirmDialog({
    message,
    onConfirm,
    onCancel,
}: {
    message: string;
    onConfirm: () => void;
    onCancel: () => void;
}) {
    return (
        <div className="modal-overlay" onClick={onCancel}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
                <div
                    className="modal-body"
                    style={{ padding: 24, textAlign: "center" }}
                >
                    <p
                        style={{
                            margin: "0 0 18px",
                            fontSize: 13.5,
                            lineHeight: 1.5,
                        }}
                    >
                        {message}
                    </p>
                    <div
                        style={{
                            display: "flex",
                            gap: 10,
                            justifyContent: "center",
                        }}
                    >
                        <button className="btn" onClick={onCancel}>
                            Cancel
                        </button>
                        <button
                            className="btn primary"
                            onClick={onConfirm}
                            style={{
                                background: "var(--red)",
                                borderColor: "var(--red)",
                            }}
                        >
                            {I.check({ style: { width: 14, height: 14 } })}{" "}
                            Confirm
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

export function SourceControl({
    user,
    onCountChange,
}: {
    user: User;
    onCountChange?: (n: number) => void;
}) {
    const lvl = ROLE_LEVEL[user.role] || 0;
    const isStaff = lvl < 20;
    const canReview = lvl >= 30;

    const [staged, setStaged] = useState<StagingEntry[]>([]);
    const [commits, setCommits] = useState<Commit[]>([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [confirm, setConfirm] = useState<{
        action: string;
        entries: StagingEntry[];
    } | null>(null);

    const loadData = useCallback(async () => {
        try {
            const [s, c] = await Promise.all([
                api.getStaging(),
                api.getCommits(),
            ]);
            setStaged(s);
            // Defensive sort by date *pushed* (github_synced_at) so Source Control history is never out of order.
            // Numeric date compare (not lexical string) for robustness; fallback chain: synced (the push), merged, created.
            const sorted = [...(c || [])].sort((a, b) => {
                const da = new Date((a as any).github_synced_at || (a as any).merged_at || (a as any).created_at || 0).getTime();
                const db = new Date((b as any).github_synced_at || (b as any).merged_at || (b as any).created_at || 0).getTime();
                return db - da; // newest first
            });
            setCommits(sorted);
        } catch {
            setStaged([]);
            setCommits([]);
            t("Failed to load staging data");
        }
        setLoading(false);
    }, []);

    useEffect(() => {
        loadData();
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
    const lastCommit = commits[0]; // [0] is newest by pushed date after sort in loadData + backend

    function toggleSelect(id: string) {
        setSelected((p) => {
            const next = new Set(p);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }

    function toggleAll() {
        if (selected.size === visibleStaged.length) {
            setSelected(new Set());
        } else {
            setSelected(new Set(visibleStaged.map((s) => s.entry_id)));
        }
    }

    async function handleApprove(entries: StagingEntry[]) {
        setConfirm(null);
        setBusy(true);
        try {
            const ids = entries.map((e) => e.entry_id);
            const commit = await api.approveCommit({
                staging_ids: ids,
                message:
                    entries.length === 1
                        ? entries[0].operation
                            ? OP_LABEL[entries[0].operation] ||
                              entries[0].change_type
                            : entries[0].new_value_text || entries[0].field_name
                        : `Batch commit — ${entries.length} staged change${entries.length !== 1 ? "s" : ""}`,
                author_id: user.id,
            });
            setStaged((s) => s.filter((x) => !ids.includes(x.entry_id)));
            setCommits((cs) => [commit, ...cs]);
            setSelected(new Set());
            t(
                `Committed ${entries.length} change${entries.length !== 1 ? "s" : ""}`,
            );
        } catch (err: any) {
            t(`Commit failed: ${err?.message || "Unknown error"}`);
        } finally {
            setBusy(false);
        }
    }

    async function handleReject(entry: StagingEntry) {
        setBusy(true);
        try {
            await api.rejectStaging(entry.entry_id);
            setStaged((s) => s.filter((x) => x.entry_id !== entry.entry_id));
            setSelected((p) => {
                const n = new Set(p);
                n.delete(entry.entry_id);
                return n;
            });
            t("Entry returned to author");
        } catch (err: any) {
            t(`Rejection failed: ${err?.message || "Unknown error"}`);
        } finally {
            setBusy(false);
        }
    }

    const opPayloadSummary = (entry: StagingEntry): string => {
        const fp = (entry as any).full_payload;
        const op = (entry as any).operation;
        if (op === "inventory_save" && fp?.items)
            return `${fp.items.length} item${fp.items.length !== 1 ? "s" : ""}`;
        if (op === "menu_save" && fp?.day) return `Menu for ${fp.day}`;
        if (op === "event_create" && fp?.title) return fp.title;
        if (op === "haccp_save" && fp?.location)
            return `${fp.location} · ${fp.temperature}${fp.unit}`;
        if (op === "daily_log_save" && fp?.title) return fp.title;
        return "";
    };

    return (
        <div className="fade-in">
            {confirm && (
                <ConfirmDialog
                    message={
                        confirm.action === "approveAll"
                            ? `Commit all ${confirm.entries.length} staged change${confirm.entries.length !== 1 ? "s" : ""} to the record? This will apply changes and push to GitHub.`
                            : `Commit this change to the record? It will be applied to live data and pushed to GitHub.`
                    }
                    onConfirm={() => handleApprove(confirm.entries)}
                    onCancel={() => setConfirm(null)}
                />
            )}

            <div className="page-head">
                <div>
                    <h2>{isStaff ? "My Submissions" : "Source Control"}</h2>
                    <div className="ph-sub">
                        {isStaff
                            ? "Submit changes for review — an admin approves and commits them"
                            : "Review queue, commit history & data-store sync"}
                        {" · "}
                        {loading ? "…" : staged.length + " pending"}
                    </div>
                </div>
                <div className="ph-actions">
                    {canReview && selected.size > 0 && (
                        <button
                            className="btn primary"
                            onClick={() =>
                                setConfirm({
                                    action: "approveSelected",
                                    entries: staged.filter((s) =>
                                        selected.has(s.entry_id),
                                    ),
                                })
                            }
                            disabled={busy}
                        >
                            {I.check({ style: { width: 14, height: 14 } })}{" "}
                            Commit selected ({selected.size})
                        </button>
                    )}
                    {canReview && visibleStaged.length > 0 && (
                        <button
                            className="btn primary"
                            onClick={() =>
                                setConfirm({
                                    action: "approveAll",
                                    entries: visibleStaged,
                                })
                            }
                            disabled={busy}
                        >
                            {I.branch()} Commit all ({visibleStaged.length})
                        </button>
                    )}
                </div>
            </div>

            <div className="banner info" style={{ marginBottom: 12 }}>
                {I.flame({ style: { width: 15, height: 15 } })}
                <span>
                    SourceCtrl pipeline: Upload/import (including AI data-entry)
                    → staged diff → manager/admin review → commit to live data +
                    GitHub snapshot sync.
                </span>
            </div>

            <div className="sync-card on">
                <div className="sync-ic">
                    {I.database({ style: { width: 20, height: 20 } })}
                </div>
                <div className="sync-body">
                    <div className="sync-title">
                        Data store ·{" "}
                        <span className="mono">MJCC-Portal/mjcc</span>{" "}
                        <span className="sync-branch">main</span>
                    </div>
                    <div className="sync-sub">
                        Live — snapshots push after every commit
                        {lastCommit && (
                            <>
                                {" · last commit "}
                                <span className="commit-hash">
                                    {shortSha(lastCommit.github_sha) ||
                                        lastCommit.commit_id.slice(0, 7)}
                                </span>{" "}
                                {relTime((lastCommit as any).github_synced_at || lastCommit.merged_at || lastCommit.created_at)}
                            </>
                        )}
                    </div>
                </div>
                <span
                    className={
                        "pill " + (lastCommit?.github_sha ? "ok" : "warn")
                    }
                >
                    {lastCommit?.github_sha ? "Synced" : "Pending sync"}
                </span>
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
                                {canReview && visibleStaged.length > 0 && (
                                    <label
                                        style={{
                                            marginRight: 8,
                                            cursor: "pointer",
                                        }}
                                        title="Select all"
                                    >
                                        <input
                                            type="checkbox"
                                            checked={
                                                selected.size ===
                                                    visibleStaged.length &&
                                                visibleStaged.length > 0
                                            }
                                            onChange={toggleAll}
                                            style={{ marginRight: 6 }}
                                        />
                                    </label>
                                )}
                                {isStaff
                                    ? "My pending submissions"
                                    : "Review queue"}
                            </h3>
                            <span className="ch-link">
                                {visibleStaged.length} staged
                            </span>
                        </div>
                        <div className="card-body flush">
                            {loading ? (
                                <div
                                    style={{
                                        padding: "26px 17px",
                                        textAlign: "center",
                                        color: "var(--faint)",
                                        fontSize: 12.5,
                                    }}
                                >
                                    Loading…
                                </div>
                            ) : visibleStaged.length === 0 ? (
                                <div
                                    style={{
                                        padding: "26px 17px",
                                        textAlign: "center",
                                        color: "var(--faint)",
                                        fontSize: 12.5,
                                    }}
                                >
                                    Nothing staged — the working tree is
                                    clean.
                                </div>
                            ) : (
                                visibleStaged.map((ch) => {
                                    const op = (ch as any).operation;
                                    const icon = op
                                        ? OP_ICON[op] || "clock"
                                        : "clock";
                                    const opLabel = op
                                        ? OP_LABEL[op] || op
                                        : ch.change_type;
                                    const summary =
                                        opPayloadSummary(ch) ||
                                        ch.new_value_text ||
                                        ch.field_name;
                                    return (
                                        <div
                                            className="stage-item"
                                            key={ch.entry_id}
                                        >
                                            {canReview && (
                                                <label
                                                    className="stage-cb"
                                                    onClick={(e) =>
                                                        e.stopPropagation()
                                                    }
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={selected.has(
                                                            ch.entry_id,
                                                        )}
                                                        onChange={() =>
                                                            toggleSelect(
                                                                ch.entry_id,
                                                            )
                                                        }
                                                    />
                                                </label>
                                            )}
                                            <div className="stage-ic">
                                                {I[icon]({
                                                    style: {
                                                        width: 15,
                                                        height: 15,
                                                    },
                                                })}
                                            </div>
                                            <div className="stage-body">
                                                <div className="stage-top">
                                                    <span className="stage-type">
                                                        {opLabel}
                                                    </span>
                                                    <span className="stage-items">
                                                        {relTime(ch.created_at)}
                                                    </span>
                                                </div>
                                                <div className="stage-summary">
                                                    {summary}
                                                </div>
                                                <div className="stage-meta">
                                                    <span
                                                        className="avatar"
                                                        style={{
                                                            width: 18,
                                                            height: 18,
                                                            fontSize: 8,
                                                            borderRadius: 5,
                                                        }}
                                                    >
                                                        {(ch.submitter_name ||
                                                            ch.submitted_by)[0]?.toUpperCase() ||
                                                            "?"}
                                                    </span>
                                                    <b>
                                                        {ch.submitter_name ||
                                                            ch.submitted_by}
                                                    </b>
                                                    {ch.submitter_role && (
                                                        <span
                                                            className={
                                                                "pill role-" +
                                                                ch.submitter_role
                                                            }
                                                        >
                                                            {ROLE_LABEL[
                                                                ch.submitter_role as keyof typeof ROLE_LABEL
                                                            ] ||
                                                                ch.submitter_role}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            {canReview ? (
                                                <div className="stage-actions">
                                                    <button
                                                        className="btn"
                                                        style={{
                                                            padding: "6px 10px",
                                                        }}
                                                        onClick={() =>
                                                            handleReject(ch)
                                                        }
                                                        disabled={busy}
                                                        title="Return to author"
                                                    >
                                                        {I.x({
                                                            style: {
                                                                width: 14,
                                                                height: 14,
                                                            },
                                                        })}
                                                    </button>
                                                    <button
                                                        className="btn primary"
                                                        style={{
                                                            padding: "6px 11px",
                                                        }}
                                                        onClick={() =>
                                                            setConfirm({
                                                                action: "approve",
                                                                entries: [ch],
                                                            })
                                                        }
                                                        disabled={busy}
                                                    >
                                                        {I.check({
                                                            style: {
                                                                width: 14,
                                                                height: 14,
                                                            },
                                                        })}{" "}
                                                        Commit
                                                    </button>
                                                </div>
                                            ) : (
                                                <span className="pill warn">
                                                    Pending review
                                                </span>
                                            )}
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>
                </div>

                <div className="card" style={{ height: "fit-content" }}>
                    <div className="card-head">
                        <h3>Commit history</h3>
                        <span className="ch-link">
                            {commits.length} commits
                        </span>
                    </div>
                    <div className="card-body flush">
                        {commits.length === 0 && !loading ? (
                            <div
                                style={{
                                    padding: "26px 17px",
                                    textAlign: "center",
                                    color: "var(--faint)",
                                    fontSize: 12.5,
                                }}
                            >
                                No commits yet.
                            </div>
                        ) : (
                            commits.map((c, i) => (
                                <div className="commit-item" key={c.commit_id}>
                                    <div className="commit-graph">
                                        <span className="cg-dot" />
                                        {i < commits.length - 1 && (
                                            <span className="cg-line" />
                                        )}
                                    </div>
                                    <div className="commit-body">
                                        <div className="commit-msg">
                                            {c.message}
                                        </div>
                                        <div className="commit-meta">
                                            <span className="commit-hash">
                                                {shortSha(c.github_sha) ||
                                                    c.commit_id.slice(0, 7)}
                                            </span>
                                            <b>
                                                {c.author_name || c.author_id}
                                            </b>
                                            {c.submitter_role && (
                                                <span
                                                    className={
                                                        "pill role-" +
                                                        c.submitter_role
                                                    }
                                                >
                                                    {ROLE_LABEL[
                                                        c.submitter_role as keyof typeof ROLE_LABEL
                                                    ] || c.submitter_role}
                                                </span>
                                            )}
                                            <span>{relTime((c as any).github_synced_at || c.merged_at || c.created_at)}</span>
                                            {c.github_sha && (
                                                <span className="synced-tag">
                                                    {I.check({
                                                        style: {
                                                            width: 11,
                                                            height: 11,
                                                        },
                                                    })}{" "}
                                                    synced
                                                </span>
                                            )}
                                        </div>
                                        <div className="commit-diff">
                                            <span className="diff-files">
                                                {c.change_count} field
                                                {c.change_count !== 1
                                                    ? "s"
                                                    : ""}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
