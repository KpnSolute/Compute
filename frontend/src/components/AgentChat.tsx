import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { I } from '../lib/icons';
import type { User } from '../lib/constants';
import {
    clearAgentHistory,
    createAgentThread,
    deleteAgentThread,
    getAgentState,
    initAgentSession,
    markAgentSeen,
    renameAgentThread,
    selectAgentThread,
    sendAgentMessage,
    setAgentDraft,
    subscribeAgent,
    // Aliased: AgentThread is also the name of the thread-rendering component.
    type AgentThread as Conversation,
} from '../lib/agentSession';
import { AgentThread } from './AgentThread';
import { confirmAction } from './ui/ConfirmDialog';

const SUGGESTIONS = [
    { icon: 'grid', title: 'Operations overview', prompt: 'Give me a concise overview of today’s MJCC operations.' },
    { icon: 'box', title: 'Inventory health', prompt: 'Show me inventory items below par and what needs attention first.' },
    { icon: 'calendar', title: 'Upcoming events', prompt: 'What events are coming up and what operational preparation is needed?' },
    { icon: 'coffee', title: 'Today’s menu', prompt: 'What is on today’s menu? Organize it by meal period.' },
];

/**
 * Conversation switcher. The cap belongs to the server, so "new" is attempted
 * and its refusal shown, rather than the limit being re-implemented here where
 * it could drift out of step.
 */
function ConversationPicker({
    threads,
    activeId,
    max,
    busy,
}: {
    threads: Conversation[];
    activeId: string | null;
    max: number;
    busy: boolean;
}) {
    const [open, setOpen] = useState(false);
    const [renaming, setRenaming] = useState<string | null>(null);
    const [draftTitle, setDraftTitle] = useState('');
    const [error, setError] = useState('');
    const boxRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const onDown = (event: MouseEvent) => {
            if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
        };
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setOpen(false);
        };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    const active = threads.find((thread) => thread.id === activeId);
    const atCap = max > 0 && threads.length >= max;

    const startNew = async () => {
        setError('');
        try {
            await createAgentThread();
            setOpen(false);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not start a conversation.');
        }
    };

    const remove = async (thread: Conversation) => {
        const ok = await confirmAction({
            title: `Delete “${thread.title}”?`,
            message: 'This conversation and its messages are deleted for your account and cannot be restored.',
            confirmLabel: 'Delete',
            tone: 'danger',
        });
        if (ok) await deleteAgentThread(thread.id);
    };

    const commitRename = async (thread: Conversation) => {
        const next = draftTitle.trim();
        setRenaming(null);
        if (next && next !== thread.title) await renameAgentThread(thread.id, next);
    };

    return (
        <div className="agent-convo" ref={boxRef}>
            <button
                className="agent-convo-btn"
                onClick={() => setOpen((value) => !value)}
                aria-expanded={open}
                aria-haspopup="menu"
                disabled={busy}
                title="Switch conversation"
            >
                {I.chat({ width: 14, height: 14 })}
                <span>{active?.title || 'New chat'}</span>
                {max > 0 && <small>{threads.length}/{max}</small>}
                {I.down({ width: 13, height: 13 })}
            </button>
            {open && (
                <div className="agent-convo-menu" role="menu">
                    <div className="agent-convo-list">
                        {threads.length === 0 && <p className="agent-convo-empty">No conversations yet.</p>}
                        {threads.map((thread) => (
                            <div
                                key={thread.id}
                                className={'agent-convo-row' + (thread.id === activeId ? ' active' : '')}
                            >
                                {renaming === thread.id ? (
                                    <input
                                        className="agent-convo-rename"
                                        autoFocus
                                        value={draftTitle}
                                        onChange={(event) => setDraftTitle(event.target.value)}
                                        onBlur={() => void commitRename(thread)}
                                        onKeyDown={(event) => {
                                            if (event.key === 'Enter') {
                                                event.preventDefault();
                                                void commitRename(thread);
                                            }
                                            if (event.key === 'Escape') setRenaming(null);
                                        }}
                                        aria-label="Conversation name"
                                    />
                                ) : (
                                    <button
                                        className="agent-convo-pick"
                                        role="menuitem"
                                        onClick={() => {
                                            void selectAgentThread(thread.id);
                                            setOpen(false);
                                        }}
                                    >
                                        <span>{thread.title}</span>
                                    </button>
                                )}
                                <button
                                    className="agent-convo-act"
                                    title="Rename"
                                    aria-label={`Rename ${thread.title}`}
                                    onClick={() => {
                                        setRenaming(thread.id);
                                        setDraftTitle(thread.title);
                                    }}
                                >
                                    {I.edit({ width: 13, height: 13 })}
                                </button>
                                <button
                                    className="agent-convo-act"
                                    title="Delete"
                                    aria-label={`Delete ${thread.title}`}
                                    onClick={() => void remove(thread)}
                                >
                                    {I.del({ width: 13, height: 13 })}
                                </button>
                            </div>
                        ))}
                    </div>
                    {error && <p className="agent-convo-error">{error}</p>}
                    <button className="agent-convo-new" onClick={() => void startNew()} disabled={atCap}>
                        {I.plus({ width: 14, height: 14 })}
                        {atCap ? `You have all ${max} conversations` : 'New conversation'}
                    </button>
                </div>
            )}
        </div>
    );
}

/**
 * Full-page MyAI workspace. It shares its conversations with the floating
 * bubble through the agent session store, so moving between them is seamless.
 */
export function AgentChatView({ user, onMinimize }: { user: User; onMinimize?: () => void }) {
    const state = useSyncExternalStore(subscribeAgent, getAgentState);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => { initAgentSession(user); }, [user]);
    useEffect(() => { markAgentSeen(); }, [state.messages.length]);
    useEffect(() => { inputRef.current?.focus(); }, []);

    const clearHistory = async () => {
        const ok = await confirmAction({
            title: 'Clear this conversation?',
            message: 'The message history is deleted for your account and cannot be restored.',
            confirmLabel: 'Clear',
            tone: 'danger',
        });
        if (!ok) return;
        await clearAgentHistory();
        inputRef.current?.focus();
    };

    if (!state.ready) return <div className="agent-chat-loading">Opening MyAI…</div>;
    if (!state.available) return <div className="agent-chat-loading">MyAI is not available for this account.</div>;

    const working = state.status === 'working';

    return (
        <section className="agent-chat-page" aria-label="MyAI chat">
            <header className="agent-chat-header">
                <div className="agent-chat-header-inner">
                    <div className="agent-chat-heading">
                        <div className="agent-chat-mark">{I.chat({ width: 20, height: 20 })}</div>
                        <div>
                            <h2>MyAI</h2>
                            <p>Ask about operations, inventory, menus, events, reports, and connected API data.</p>
                        </div>
                    </div>
                    <div className="agent-chat-actions">
                        {/* Hidden until the server reports conversations are
                            available, so a build running ahead of the migration
                            shows the assistant exactly as it was before. */}
                        {state.maxThreads > 0 && (
                            <ConversationPicker
                                threads={state.threads}
                                activeId={state.activeThreadId}
                                max={state.maxThreads}
                                busy={working}
                            />
                        )}
                        {state.remainingHour !== null && <span className="agent-chat-rate">{state.remainingHour} requests left this hour</span>}
                        <button className="btn" onClick={clearHistory} disabled={state.messages.length === 0 || working}>
                            {I.del({ width: 15, height: 15 })} Clear conversation
                        </button>
                        {onMinimize && (
                            <button className="btn" onClick={onMinimize} title="Keep this conversation in the corner bubble">
                                {I.chevR({ width: 15, height: 15 })} Minimize
                            </button>
                        )}
                    </div>
                </div>
            </header>

            <AgentThread state={state}>
                <div className="agent-chat-welcome">
                    <div className="agent-chat-welcome-mark">{I.chat({ width: 26, height: 26 })}</div>
                    <h3>How can I help with MJCC today?</h3>
                    <p>I can work with the operational tools and API access available to your role.</p>
                    <div className="agent-chat-suggestions">
                        {SUGGESTIONS.map((suggestion) => {
                            const Icon = (I as Record<string, (props?: Record<string, unknown>) => React.ReactElement>)[suggestion.icon];
                            return (
                                <button key={suggestion.title} onClick={() => void sendAgentMessage(suggestion.prompt)}>
                                    {Icon ? Icon({ width: 18, height: 18 }) : null}
                                    <span>
                                        <strong>{suggestion.title}</strong>
                                        <small>{suggestion.prompt}</small>
                                    </span>
                                    {I.chevR({ width: 15, height: 15 })}
                                </button>
                            );
                        })}
                    </div>
                </div>
            </AgentThread>

            <footer className="agent-composer-shell">
                <form
                    className="agent-composer"
                    onSubmit={(event) => { event.preventDefault(); void sendAgentMessage(state.draft); }}
                >
                    <textarea
                        ref={inputRef}
                        rows={1}
                        value={state.draft}
                        onChange={(event) => setAgentDraft(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter' && !event.shiftKey) {
                                event.preventDefault();
                                void sendAgentMessage(state.draft);
                            }
                        }}
                        placeholder="Ask MyAI"
                        disabled={working}
                        aria-label="Message MyAI"
                    />
                    <button type="submit" disabled={working || !state.draft.trim()} aria-label="Send message">
                        {I.up({ width: 18, height: 18 })}
                    </button>
                </form>
                <p>MyAI can make mistakes. Verify important operational decisions and records.</p>
            </footer>
        </section>
    );
}
