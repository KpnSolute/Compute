import { useEffect, useRef, useSyncExternalStore } from 'react';
import { I } from '../lib/icons';
import type { User } from '../lib/constants';
import {
    clearAgentHistory,
    getAgentState,
    initAgentSession,
    markAgentSeen,
    sendAgentMessage,
    setAgentDraft,
    subscribeAgent,
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
 * Full-page MyAI workspace. It shares one conversation with the floating
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
