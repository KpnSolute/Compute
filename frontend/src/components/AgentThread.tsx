import { useEffect, useRef, useState } from "react";
import { I } from "../lib/icons";
import { splitInline, toBlocks } from "../lib/chatMarkdown";
import type { AgentMessage, AgentState } from "../lib/agentSession";

/** Assistant replies arrive as Markdown; render them as elements, never HTML. */
function Inline({ text }: { text: string }) {
    return (
        <>
            {splitInline(text).map((span, index) => {
                if (span.kind === "bold") return <strong key={index}>{span.value}</strong>;
                if (span.kind === "italic") return <em key={index}>{span.value}</em>;
                if (span.kind === "code") return <code key={index}>{span.value}</code>;
                return <span key={index}>{span.value}</span>;
            })}
        </>
    );
}

export function MarkdownText({ text }: { text: string }) {
    return (
        <>
            {toBlocks(text).map((block, index) => {
                if (block.kind === "p") return <p key={index}><Inline text={block.text} /></p>;
                if (block.kind === "code") return <pre key={index}><code>{block.text}</code></pre>;
                if (block.kind === "table") return (
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
                return block.kind === "ul" ? <ul key={index}>{items}</ul> : <ol key={index}>{items}</ol>;
            })}
        </>
    );
}

function ToolCall({ tc }: { tc: { name: string; result_summary: string } }) {
    const [open, setOpen] = useState(false);
    return (
        <button className="agent-tool-call" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
            {I.terminal({ width: 14, height: 14 })}
            <span>{tc.name}</span>
            {open && <span className="agent-tool-result">{tc.result_summary}</span>}
            {open ? I.up({ width: 13, height: 13 }) : I.down({ width: 13, height: 13 })}
        </button>
    );
}

function MessageRow({ msg, compact }: { msg: AgentMessage; compact?: boolean }) {
    const isUser = msg.role === "user";
    return (
        <article className={`agent-chat-row ${isUser ? "user" : "assistant"}`}>
            {!isUser && !compact && <div className="agent-chat-avatar">{I.chat({ width: 17, height: 17 })}</div>}
            <div className="agent-chat-message-wrap">
                <div className={isUser ? "agent-user-message" : "agent-chat-response"}>
                    {isUser ? msg.content : <MarkdownText text={msg.content} />}
                </div>
                {msg.tool_calls && msg.tool_calls.length > 0 && (
                    <div className="agent-tool-list">
                        {msg.tool_calls.map((tc, index) => <ToolCall key={`${tc.name}-${index}`} tc={tc} />)}
                    </div>
                )}
                <time className="agent-chat-time">{msg.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
            </div>
        </article>
    );
}

export function ThinkingState({ compact }: { compact?: boolean }) {
    return (
        <div className="agent-chat-row assistant">
            {!compact && <div className="agent-chat-avatar">{I.chat({ width: 17, height: 17 })}</div>}
            <div className="agent-chat-response agent-thinking">
                <span>Working</span>
                <span className="agent-thinking-dots" aria-label="MJCC AI is working"><i /><i /><i /></span>
            </div>
        </div>
    );
}

/** The shared conversation view used by the bubble and the full page. */
export function AgentThread({
    state,
    compact,
    emptyHint,
    children,
}: {
    state: AgentState;
    compact?: boolean;
    emptyHint?: string;
    children?: React.ReactNode;
}) {
    const endRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const reduceMotion = typeof window.matchMedia === "function"
            && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        endRef.current?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "end" });
    }, [state.messages, state.status]);

    const empty = state.messages.length === 0 && state.status !== "working";
    return (
        <div className={"agent-chat-scroll" + (compact ? " compact" : "")}>
            <div className="agent-chat-thread" role="log" aria-live="polite" aria-relevant="additions text">
                {empty ? (children ?? <p className="agent-mini-empty">{emptyHint}</p>) : state.messages.map((message) => (
                    <MessageRow key={message.id} msg={message} compact={compact} />
                ))}
                {state.status === "working" && <ThinkingState compact={compact} />}
                <div ref={endRef} />
            </div>
        </div>
    );
}
