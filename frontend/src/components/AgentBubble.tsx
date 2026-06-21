import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../lib/api';
import { ROLE_LEVEL } from '../lib/constants';
import type { User } from '../lib/constants';
import { I } from '../lib/icons';

// ── types ─────────────────────────────────────────────────────────────────────

interface AgentMessage {
    id: string;
    role: 'user' | 'assistant' | 'tool';
    content: string;
    tool_calls?: Array<{ name: string; args: any; result_summary: string }>;
    timestamp: Date;
}

interface AgentConfig {
    enabled: boolean;
    min_role: string;
    rate_limit_per_hour: Record<string, number>;
}

// ── sub-components ────────────────────────────────────────────────────────────

function ThinkingDots() {
    return (
        <div style={{ display: 'flex', gap: 4, padding: '10px 14px', background: 'var(--surface-2)', borderRadius: '16px 16px 16px 4px', width: 'fit-content', alignItems: 'center' }}>
            {[0, 1, 2].map(i => (
                <div key={i} className="agent-dot" style={{ animationDelay: `${i * 0.18}s` }} />
            ))}
        </div>
    );
}

function ToolCallPill({ tc }: { tc: { name: string; result_summary: string } }) {
    const [open, setOpen] = useState(false);
    return (
        <button
            onClick={() => setOpen(o => !o)}
            style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                fontSize: 10.5, padding: '3px 8px',
                background: 'var(--surface-2)', border: '1px solid var(--line)',
                borderRadius: 10, cursor: 'pointer', color: 'var(--muted)',
                marginTop: 4,
            }}
        >
            <span style={{ fontSize: 11 }}>⚙</span>
            <span style={{ fontWeight: 700 }}>{tc.name}</span>
            {open && <span style={{ color: 'var(--faint)' }}>— {tc.result_summary}</span>}
            <span style={{ color: 'var(--faint)' }}>{open ? '▲' : '▼'}</span>
        </button>
    );
}

function MessageRow({ msg }: { msg: AgentMessage }) {
    const isUser = msg.role === 'user';
    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start', gap: 3 }}>
            <div style={{
                maxWidth: '88%',
                padding: '9px 13px',
                borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                background: isUser ? 'var(--navy)' : 'var(--surface-2)',
                color: isUser ? '#fff' : 'var(--ink)',
                fontSize: 13,
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
            }}>
                {msg.content}
            </div>
            {msg.tool_calls && msg.tool_calls.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxWidth: '88%' }}>
                    {msg.tool_calls.map((tc, i) => <ToolCallPill key={i} tc={tc} />)}
                </div>
            )}
            <span style={{ fontSize: 10, color: 'var(--faint)' }}>
                {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
        </div>
    );
}

// ── suggestion chips shown when chat is empty ──────────────────────────────────

const SUGGESTIONS = [
    'Dashboard overview?',
    'Items below par?',
    'Upcoming events?',
    "What's on the menu?",
];

// ── main component ─────────────────────────────────────────────────────────────

export function AgentBubble({ user }: { user: User }) {
    const [isOpen,    setIsOpen]    = useState(false);
    const [nearby,    setNearby]    = useState(false);
    const [messages,  setMessages]  = useState<AgentMessage[]>([]);
    const [input,     setInput]     = useState('');
    const [loading,   setLoading]   = useState(false);
    const [config,    setConfig]    = useState<AgentConfig | null>(null);
    const [rateInfo,  setRateInfo]  = useState<{ remaining_hour: number } | null>(null);
    const [initDone,  setInitDone]  = useState(false);

    const bubbleRef    = useRef<HTMLDivElement>(null);
    const msgEndRef    = useRef<HTMLDivElement>(null);
    const inputRef     = useRef<HTMLInputElement>(null);

    // Load config + history on mount
    useEffect(() => {
        (async () => {
            try {
                const cfg = await api.getAgentConfig();
                setConfig(cfg);

                const userLevel = ROLE_LEVEL[user.role] ?? 0;
                const minLevel  = ROLE_LEVEL[cfg.min_role as keyof typeof ROLE_LEVEL] ?? 0;
                if (!cfg.enabled || userLevel < minLevel) return;

                const turns = await api.getAgentHistory(30);
                const msgs: AgentMessage[] = turns
                    .filter((t: any) => t.role !== 'tool')
                    .map((t: any) => ({
                        id:        t.id,
                        role:      t.role,
                        content:   t.content,
                        timestamp: new Date(t.created_at),
                    }));
                setMessages(msgs);
            } catch { /* silently fail — agent is optional */ }
            finally   { setInitDone(true); }
        })();
    }, [user.role]);

    // Proximity detection
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            const el = bubbleRef.current;
            if (!el || isOpen) { setNearby(false); return; }
            const rect = el.getBoundingClientRect();
            const cx   = rect.left + rect.width  / 2;
            const cy   = rect.top  + rect.height / 2;
            const dist = Math.hypot(e.clientX - cx, e.clientY - cy);
            setNearby(dist < 130);
        };
        window.addEventListener('mousemove', handler, { passive: true });
        return () => window.removeEventListener('mousemove', handler);
    }, [isOpen]);

    // Auto-scroll on new messages
    useEffect(() => {
        if (isOpen) setTimeout(() => msgEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 60);
    }, [messages, loading, isOpen]);

    // Focus input when opened
    useEffect(() => {
        if (isOpen) setTimeout(() => inputRef.current?.focus(), 220);
    }, [isOpen]);

    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent<{ prompt?: string }>).detail || {};
            setIsOpen(true);
            if (detail.prompt) setInput(detail.prompt);
            setTimeout(() => inputRef.current?.focus(), 240);
        };
        window.addEventListener('mjcc:open-agent', handler);
        return () => window.removeEventListener('mjcc:open-agent', handler);
    }, []);

    const sendMessage = useCallback(async (text: string) => {
        const trimmed = text.trim();
        if (!trimmed || loading) return;
        setInput('');

        const userMsg: AgentMessage = {
            id:        crypto.randomUUID(),
            role:      'user',
            content:   trimmed,
            timestamp: new Date(),
        };
        setMessages(prev => [...prev, userMsg]);
        setLoading(true);

        try {
            const result = await api.sendAgentMessage(trimmed);
            const asstMsg: AgentMessage = {
                id:         crypto.randomUUID(),
                role:       'assistant',
                content:    result.response,
                tool_calls: result.tool_calls,
                timestamp:  new Date(),
            };
            setMessages(prev => [...prev, asstMsg]);
            if (result.rate_limit) setRateInfo({ remaining_hour: result.rate_limit.remaining_hour });
        } catch (e: any) {
            const errMsg: AgentMessage = {
                id:        crypto.randomUUID(),
                role:      'assistant',
                content:   `Sorry, I ran into an error: ${e?.message || 'unknown error'}. Please try again.`,
                timestamp: new Date(),
            };
            setMessages(prev => [...prev, errMsg]);
        } finally {
            setLoading(false);
        }
    }, [loading]);

    const clearHistory = async () => {
        try {
            await api.clearAgentHistory();
            setMessages([]);
        } catch { /* ignore */ }
    };

    // ── access gate ───────────────────────────────────────────────────────────
    if (!initDone) return null;
    if (!config?.enabled) return null;
    const userLevel = ROLE_LEVEL[user.role] ?? 0;
    const minLevel  = ROLE_LEVEL[config.min_role as keyof typeof ROLE_LEVEL] ?? 0;
    if (userLevel < minLevel) return null;

    // ── sizing ────────────────────────────────────────────────────────────────
    const maxW = typeof window !== 'undefined' ? window.innerWidth - 16 : 380;
    const W  = isOpen ? Math.min(380, maxW) : nearby ? 62 : 52;
    const H  = isOpen ? 520 : nearby ? 62 : 52;
    const BR = isOpen ? 18  : '50%';

    return (
        <div
            ref={bubbleRef}
            className={`agent-shell${isOpen ? ' open' : ''}${nearby ? ' nearby' : ''}`}
            onClick={!isOpen ? () => setIsOpen(true) : undefined}
            style={{
                position:   'fixed',
                bottom:     24,
                right:      24,
                zIndex:     9000,
                width:      W,
                height:     H,
                borderRadius: BR,
                background: isOpen ? 'var(--surface)' : 'var(--navy)',
                boxShadow:  isOpen
                    ? '0 24px 64px rgba(0,0,0,0.28), 0 0 0 1px var(--line)'
                    : nearby
                        ? '0 0 0 6px rgba(30,58,138,0.18), 0 8px 28px rgba(0,0,0,0.22)'
                        : '0 4px 18px rgba(0,0,0,0.2)',
                transition: 'width .22s cubic-bezier(.4,0,.2,1), height .22s cubic-bezier(.4,0,.2,1), border-radius .22s, box-shadow .22s',
                overflow:   'hidden',
                cursor:     isOpen ? 'default' : 'pointer',
                display:    'flex',
                flexDirection: isOpen ? 'column' : 'row',
                alignItems:    isOpen ? 'stretch' : 'center',
                justifyContent: isOpen ? 'flex-start' : 'center',
                userSelect: 'none',
            }}
        >
            {/* ── collapsed: spark icon ──────────────────────────────────── */}
            {!isOpen && (
                <div className="agent-launch-icon">
                    {I.flame({ 'aria-hidden': true })}
                </div>
            )}

            {/* ── expanded: chat panel ───────────────────────────────────── */}
            {isOpen && (
                <>
                    {/* Header */}
                    <div className="agent-head">
                        <div className={`agent-status-dot${loading ? ' busy' : ''}`} />
                        <span className="agent-title">MJCC AI</span>
                        {rateInfo != null && (
                            <span className="agent-rate">{rateInfo.remaining_hour}/h left</span>
                        )}
                        <button
                            onClick={clearHistory}
                            title="Clear conversation"
                            className="agent-head-btn"
                        >
                            Clear
                        </button>
                        <button
                            onClick={() => setIsOpen(false)}
                            className="agent-close-btn"
                            aria-label="Close MJCC AI"
                        >
                            {I.x({ 'aria-hidden': true })}
                        </button>
                    </div>

                    {/* Message list */}
                    <div className="agent-messages">
                        {messages.length === 0 && !loading && (
                            <div className="agent-empty">
                                <div className="agent-empty-icon">{I.flame({ 'aria-hidden': true })}</div>
                                <div className="agent-empty-text">
                                    Ask me anything about MJCC operations
                                </div>
                                <div className="agent-suggestions">
                                    {SUGGESTIONS.map(s => (
                                        <button
                                            key={s}
                                            onClick={() => sendMessage(s)}
                                            className="agent-suggestion"
                                        >
                                            {s}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {messages.map(msg => (
                            <MessageRow key={msg.id} msg={msg} />
                        ))}

                        {loading && <ThinkingDots />}
                        <div ref={msgEndRef} />
                    </div>

                    {/* Input bar */}
                    <div className="agent-inputbar">
                        <input
                            ref={inputRef}
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            onKeyDown={e => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    sendMessage(input);
                                }
                            }}
                            placeholder="Ask MJCC AI…"
                            disabled={loading}
                            className="agent-input"
                        />
                        <button
                            onClick={() => sendMessage(input)}
                            disabled={loading || !input.trim()}
                            className="agent-send-btn"
                            aria-label="Send message"
                        >
                            {I.chevR({ 'aria-hidden': true })}
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}
