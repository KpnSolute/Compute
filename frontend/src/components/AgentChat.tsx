import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../lib/api';
import { ROLE_LEVEL } from '../lib/constants';
import type { User } from '../lib/constants';
import { I } from '../lib/icons';
import { confirmAction } from './ui/ConfirmDialog';
import { splitInline, toBlocks } from '../lib/chatMarkdown';

interface AgentMessage {
    id: string;
    role: 'user' | 'assistant' | 'tool';
    content: string;
    tool_calls?: Array<{ name: string; args: unknown; result_summary: string }>;
    timestamp: Date;
}

interface AgentConfig { enabled: boolean; min_role: string; rate_limit_per_hour: Record<string, number>; }

const SUGGESTIONS = [
    { icon: 'grid', title: 'Operations overview', prompt: 'Give me a concise overview of today’s MJCC operations.' },
    { icon: 'box', title: 'Inventory health', prompt: 'Show me inventory items below par and what needs attention first.' },
    { icon: 'calendar', title: 'Upcoming events', prompt: 'What events are coming up and what operational preparation is needed?' },
    { icon: 'coffee', title: 'Today’s menu', prompt: 'What is on today’s menu? Organize it by meal period.' },
];

function SvgIcon({ name, size = 18 }: { name: string; size?: number }) {
    const Icon = I[name] || I.terminal;
    return <Icon width={size} height={size} aria-hidden="true" />;
}

function ThinkingState() {
    return <div className="agent-chat-row assistant"><div className="agent-chat-avatar"><SvgIcon name="chat" size={17} /></div><div className="agent-chat-response agent-thinking"><span>Working</span><span className="agent-thinking-dots" aria-label="MJCC AI is working"><i /><i /><i /></span></div></div>;
}

function ToolCall({ tc }: { tc: { name: string; result_summary: string } }) {
    const [open, setOpen] = useState(false);
    return <button className="agent-tool-call" onClick={() => setOpen(value => !value)} aria-expanded={open}><SvgIcon name="terminal" size={14} /><span>{tc.name}</span>{open && <span className="agent-tool-result">{tc.result_summary}</span>}<SvgIcon name={open ? 'up' : 'down'} size={13} /></button>;
}

/** Assistant replies arrive as Markdown; render them as elements, never HTML. */
function Inline({ text }: { text: string }) {
    return (
        <>
            {splitInline(text).map((span, index) => {
                if (span.kind === 'bold') return <strong key={index}>{span.value}</strong>;
                if (span.kind === 'italic') return <em key={index}>{span.value}</em>;
                if (span.kind === 'code') return <code key={index}>{span.value}</code>;
                return <span key={index}>{span.value}</span>;
            })}
        </>
    );
}

function MarkdownText({ text }: { text: string }) {
    return (
        <>
            {toBlocks(text).map((block, index) => {
                if (block.kind === 'p') return <p key={index}><Inline text={block.text} /></p>;
                if (block.kind === 'code') return <pre key={index}><code>{block.text}</code></pre>;
                if (block.kind === 'table') return (
                    <div className="agent-chat-table" key={index}>
                        <table>
                            <thead>
                                <tr>{block.head.map((cell, cellIndex) => <th key={cellIndex}><Inline text={cell} /></th>)}</tr>
                            </thead>
                            <tbody>
                                {block.rows.map((row, rowIndex) => (
                                    <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}><Inline text={cell} /></td>)}</tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                );
                const items = block.items.map((item, itemIndex) => <li key={itemIndex}><Inline text={item} /></li>);
                return block.kind === 'ul' ? <ul key={index}>{items}</ul> : <ol key={index}>{items}</ol>;
            })}
        </>
    );
}

function MessageRow({ msg }: { msg: AgentMessage }) {
    const isUser = msg.role === 'user';
    return (
        <article className={`agent-chat-row ${isUser ? 'user' : 'assistant'}`}>
            {!isUser && <div className="agent-chat-avatar"><SvgIcon name="chat" size={17} /></div>}
            <div className="agent-chat-message-wrap">
                <div className={isUser ? 'agent-user-message' : 'agent-chat-response'}>
                    {isUser ? msg.content : <MarkdownText text={msg.content} />}
                </div>
                {msg.tool_calls && msg.tool_calls.length > 0 && <div className="agent-tool-list">{msg.tool_calls.map((tc, index) => <ToolCall key={`${tc.name}-${index}`} tc={tc} />)}</div>}
                <time className="agent-chat-time">{msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
            </div>
        </article>
    );
}

export function AgentChatView({ user }: { user: User }) {
    const [messages, setMessages] = useState<AgentMessage[]>([]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [config, setConfig] = useState<AgentConfig | null>(null);
    const [rateInfo, setRateInfo] = useState<{ remaining_hour: number } | null>(null);
    const [initDone, setInitDone] = useState(false);
    const msgEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        (async () => {
            try {
                const cfg = await api.getAgentConfig();
                setConfig(cfg);
                const userLevel = ROLE_LEVEL[user.role] ?? 0;
                const minLevel = ROLE_LEVEL[cfg.min_role as keyof typeof ROLE_LEVEL] ?? 0;
                if (!cfg.enabled || userLevel < minLevel) return;
                const turns = await api.getAgentHistory(60);
                setMessages(turns.filter((turn: any) => turn.role !== 'tool').map((turn: any) => ({ id: turn.id, role: turn.role, content: turn.content, timestamp: new Date(turn.created_at) })));
            } catch { /* AI remains optional when its service is unavailable. */ }
            finally { setInitDone(true); }
        })();
    }, [user.role]);

    useEffect(() => {
        const draft = sessionStorage.getItem('mjcc:agent-draft');
        if (draft) { setInput(draft); sessionStorage.removeItem('mjcc:agent-draft'); }
        inputRef.current?.focus();
    }, []);

    useEffect(() => { msgEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, loading]);

    const sendMessage = useCallback(async (text: string) => {
        const trimmed = text.trim();
        if (!trimmed || loading) return;
        setInput('');
        setMessages(previous => [...previous, { id: crypto.randomUUID(), role: 'user', content: trimmed, timestamp: new Date() }]);
        setLoading(true);
        try {
            const result = await api.sendAgentMessage(trimmed);
            setMessages(previous => [...previous, { id: crypto.randomUUID(), role: 'assistant', content: result.response, tool_calls: result.tool_calls, timestamp: new Date() }]);
            if (result.rate_limit) setRateInfo({ remaining_hour: result.rate_limit.remaining_hour });
        } catch (error: any) {
            setMessages(previous => [...previous, { id: crypto.randomUUID(), role: 'assistant', content: `I couldn’t complete that request: ${error?.message || 'unknown error'}. Please try again.`, timestamp: new Date() }]);
        } finally { setLoading(false); }
    }, [loading]);

    const clearHistory = async () => {
        const ok = await confirmAction({
            title: 'Clear this conversation?',
            message: 'The message history is deleted for your account and cannot be restored.',
            confirmLabel: 'Clear',
            tone: 'danger',
        });
        if (!ok) return;
        await api.clearAgentHistory();
        setMessages([]);
        inputRef.current?.focus();
    };

    if (!initDone) return <div className="agent-chat-loading">Opening MJCC AI…</div>;
    const userLevel = ROLE_LEVEL[user.role] ?? 0;
    const minLevel = ROLE_LEVEL[config?.min_role as keyof typeof ROLE_LEVEL] ?? 0;
    if (!config?.enabled || userLevel < minLevel) return <div className="agent-chat-loading">MJCC AI is not available for this account.</div>;

    return (
        <section className="agent-chat-page" aria-label="MJCC AI chat">
            <header className="agent-chat-header">
                <div className="agent-chat-heading"><div className="agent-chat-mark"><SvgIcon name="chat" size={20} /></div><div><h2>MJCC AI</h2><p>Ask about operations, inventory, menus, events, reports, and connected API data.</p></div></div>
                <div className="agent-chat-actions">{rateInfo && <span className="agent-chat-rate">{rateInfo.remaining_hour} requests left this hour</span>}<button className="btn" onClick={clearHistory} disabled={messages.length === 0 || loading}><SvgIcon name="del" size={15} /> Clear conversation</button></div>
            </header>
            <div className="agent-chat-scroll"><div className="agent-chat-thread" role="log" aria-live="polite" aria-relevant="additions text">
                {messages.length === 0 && !loading ? <div className="agent-chat-welcome"><div className="agent-chat-welcome-mark"><SvgIcon name="chat" size={26} /></div><h3>How can I help with MJCC today?</h3><p>I can work with the operational tools and API access available to your role.</p><div className="agent-chat-suggestions">{SUGGESTIONS.map(suggestion => <button key={suggestion.title} onClick={() => sendMessage(suggestion.prompt)}><SvgIcon name={suggestion.icon} size={18} /><span><strong>{suggestion.title}</strong><small>{suggestion.prompt}</small></span><SvgIcon name="chevR" size={15} /></button>)}</div></div> : messages.map(message => <MessageRow key={message.id} msg={message} />)}
                {loading && <ThinkingState />}<div ref={msgEndRef} />
            </div></div>
            <footer className="agent-composer-shell"><div className="agent-composer"><textarea ref={inputRef} rows={1} value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage(input); } }} placeholder="Ask MJCC AI" disabled={loading} aria-label="Message MJCC AI" /><button onClick={() => sendMessage(input)} disabled={loading || !input.trim()} aria-label="Send message"><SvgIcon name="up" size={18} /></button></div><p>MJCC AI can make mistakes. Verify important operational decisions and records.</p></footer>
        </section>
    );
}
