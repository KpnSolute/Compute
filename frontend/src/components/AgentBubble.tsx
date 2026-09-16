import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react";
import { I } from "../lib/icons";
import type { User } from "../lib/constants";
import {
    agentStatusLabel,
    clearAgentHistory,
    createAgentThread,
    getAgentState,
    initAgentSession,
    markAgentSeen,
    sendAgentMessage,
    setAgentDraft,
    subscribeAgent,
} from "../lib/agentSession";
import { AgentThread } from "./AgentThread";
import { confirmAction } from "./ui/ConfirmDialog";

/**
 * Floating MyAI orb.
 *
 * The surface carries the state: it breathes when idle, boils while a request
 * is in flight, swells once when an answer lands, and keeps an unread dot until
 * the thread is seen. Hovering reveals what it is doing; clicking opens a
 * compact chat that shares one conversation with the full page.
 */
export function AgentBubble({ user, onOpenFullPage }: { user: User; onOpenFullPage: () => void }) {
    const state = useSyncExternalStore(subscribeAgent, getAgentState);
    const [open, setOpen] = useState(false);
    const [now, setNow] = useState(() => Date.now());
    const orbRef = useRef<HTMLButtonElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => { initAgentSession(user); }, [user]);

    // Elapsed seconds for the status card while a request is in flight.
    useEffect(() => {
        if (state.status !== "working") return;
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, [state.status]);

    useEffect(() => {
        if (!open) return;
        markAgentSeen();
        const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 120);
        return () => window.clearTimeout(focusTimer);
    }, [open, state.messages.length]);

    // Closing returns focus to the orb so keyboard users are not dropped on the body.
    const closeMini = () => {
        setOpen(false);
        window.setTimeout(() => orbRef.current?.focus(), 0);
    };

    useEffect(() => {
        if (!open) return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            setOpen(false);
            window.setTimeout(() => orbRef.current?.focus(), 0);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open]);

    if (!state.ready || !state.available) return null;

    // The specular highlight follows the pointer across the glass.
    const trackPointer = (event: ReactPointerEvent<HTMLElement>) => {
        const target = event.currentTarget;
        const rect = target.getBoundingClientRect();
        target.style.setProperty("--px", `${((event.clientX - rect.left) / rect.width) * 100}%`);
        target.style.setProperty("--py", `${((event.clientY - rect.top) / rect.height) * 100}%`);
    };

    const status = agentStatusLabel(state, now);
    const toolSummary = state.lastTools.length
        ? `Used ${state.lastTools.slice(0, 3).join(", ")}${state.lastTools.length > 3 ? "…" : ""}`
        : null;

    const clear = async () => {
        const ok = await confirmAction({
            title: "Clear this conversation?",
            message: "The message history is deleted for your account and cannot be restored.",
            confirmLabel: "Clear",
            tone: "danger",
        });
        if (ok) await clearAgentHistory();
    };

    // The bubble starts conversations but does not list them: switching among
    // ten belongs on the full page, not in a 380px panel.
    const atCap = state.maxThreads > 0 && state.threads.length >= state.maxThreads;
    const startNewConversation = async () => {
        try {
            await createAgentThread();
            inputRef.current?.focus();
        } catch {
            // The cap is the server's to enforce; the full page shows why.
        }
    };

    return (
        <div className={"agent-orb-layer" + (open ? " open" : "")}>
            {open && (
                <section className="agent-mini glass-panel" aria-label="MyAI quick chat">
                    <header className="agent-mini-head">
                        <span className={"agent-mini-mark state-" + state.status} aria-hidden="true" />
                        <strong>MyAI</strong>
                        <span className="agent-mini-status">{status}</span>
                        {state.maxThreads > 0 && (
                            <button
                                className="agent-mini-btn"
                                onClick={() => void startNewConversation()}
                                disabled={state.status === "working" || atCap}
                                title={atCap ? `You have all ${state.maxThreads} conversations` : "New conversation"}
                                aria-label="New conversation"
                            >
                                {I.plus({ width: 15, height: 15 })}
                            </button>
                        )}
                        <button className="agent-mini-btn" onClick={onOpenFullPage} title="Open the full workspace" aria-label="Open full workspace">
                            {I.scan({ width: 15, height: 15 })}
                        </button>
                        <button className="agent-mini-btn" onClick={clear} disabled={!state.messages.length || state.status === "working"} title="Clear conversation" aria-label="Clear conversation">
                            {I.del({ width: 15, height: 15 })}
                        </button>
                        <button className="agent-mini-btn" onClick={closeMini} title="Close" aria-label="Close quick chat">
                            {I.x({ width: 15, height: 15 })}
                        </button>
                    </header>
                    <AgentThread state={state} compact emptyHint="Ask about inventory, menus, events, or today's operations." />
                    <form
                        className="agent-mini-composer"
                        onSubmit={(event) => { event.preventDefault(); void sendAgentMessage(state.draft); }}
                    >
                        <textarea
                            ref={inputRef}
                            rows={1}
                            value={state.draft}
                            onChange={(event) => setAgentDraft(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === "Enter" && !event.shiftKey) {
                                    event.preventDefault();
                                    void sendAgentMessage(state.draft);
                                }
                            }}
                            placeholder="Ask MyAI"
                            aria-label="Message MyAI"
                            disabled={state.status === "working"}
                        />
                        <button type="submit" disabled={state.status === "working" || !state.draft.trim()} aria-label="Send message">
                            {I.up({ width: 16, height: 16 })}
                        </button>
                    </form>
                </section>
            )}

            <button
                ref={orbRef}
                type="button"
                className={"agent-orb state-" + state.status}
                onPointerMove={trackPointer}
                onClick={() => setOpen((value) => !value)}
                aria-expanded={open}
                aria-label={open ? "Close MyAI" : `MyAI — ${status}`}
                data-unread={state.unread > 0 ? Math.min(9, state.unread) : undefined}
            >
                <span className="agent-orb-glass" aria-hidden="true" />
                <span className="agent-orb-caustic" aria-hidden="true" />
                <span className="agent-orb-spec" aria-hidden="true" />
                <span className="agent-orb-icon" aria-hidden="true">{I.chat({ width: 18, height: 18 })}</span>
                {state.unread > 0 && !open && <span className="agent-orb-badge" aria-hidden="true">{Math.min(9, state.unread)}</span>}
            </button>

            {!open && (
                <div className="agent-orb-card glass-panel" role="status" aria-live="polite">
                    <strong>{status}</strong>
                    {toolSummary && <span>{toolSummary}</span>}
                    {!toolSummary && state.status === "idle" && <span>Click to ask · opens the full workspace from the corner</span>}
                </div>
            )}
        </div>
    );
}
