import { api } from './api';
import { ROLE_LEVEL, type User } from './constants';

/**
 * One MyAI conversation shared by the floating bubble and the full page.
 *
 * Both surfaces read and write this store, so opening the page from the bubble
 * (or minimising back) keeps the same messages, the same draft, and the same
 * in-flight request — no refetch and no second conversation.
 */

export interface AgentMessage {
    id: string;
    role: 'user' | 'assistant' | 'tool';
    content: string;
    tool_calls?: Array<{ name: string; args?: unknown; result_summary: string }>;
    timestamp: Date;
    failed?: boolean;
}

export interface AgentConfig {
    enabled: boolean;
    min_role: string;
    rate_limit_per_hour?: Record<string, number>;
}

/** idle → working → (ready | error). "ready" clears once the thread is seen. */
export type AgentStatus = 'idle' | 'working' | 'ready' | 'error';

/** One named conversation. The server caps how many a user may keep. */
export interface AgentThread {
    id: string;
    title: string;
    created_at?: string;
    updated_at?: string;
}

export interface AgentState {
    ready: boolean;
    available: boolean;
    config: AgentConfig | null;
    messages: AgentMessage[];
    status: AgentStatus;
    /** Epoch ms the current request started, for the elapsed read-out. */
    startedAt: number | null;
    /** Tools the last answer used, surfaced on the bubble after it lands. */
    lastTools: string[];
    unread: number;
    draft: string;
    remainingHour: number | null;
    /** Conversations, most recently used first. */
    threads: AgentThread[];
    activeThreadId: string | null;
    /** How many conversations the server allows; 0 until config loads. */
    maxThreads: number;
}

// The draft is stored per account: one browser tab can sign out and sign in as
// somebody else, and neither the draft nor the thread may cross over.
const draftKey = (userId: string) => `mjcc:agent-draft:${userId}`;

function readDraft(userId: string | null): string {
    if (!userId) return '';
    try {
        return sessionStorage.getItem(draftKey(userId)) || '';
    } catch {
        return '';
    }
}

function writeDraft(value: string): void {
    if (!currentUserId) return;
    try {
        if (value) sessionStorage.setItem(draftKey(currentUserId), value);
        else sessionStorage.removeItem(draftKey(currentUserId));
    } catch {
        // storage blocked — the draft still lives in memory for this session
    }
}

/** The conversation belongs to one account; switching users starts over. */
let currentUserId: string | null = null;

function emptyState(userId: string | null): AgentState {
    return {
        ready: false,
        available: false,
        config: null,
        messages: [],
        status: 'idle',
        startedAt: null,
        lastTools: [],
        unread: 0,
        draft: readDraft(userId),
        remainingHour: null,
        threads: [],
        activeThreadId: null,
        maxThreads: 0,
    };
}

/** Turns from the API into messages, dropping the tool rows the UI never shows. */
function toMessages(turns: unknown[]): AgentMessage[] {
    return (turns || [])
        .filter((turn) => (turn as { role?: string }).role !== 'tool')
        .map((turn) => {
            const row = turn as { id: string; role: AgentMessage['role']; content: string; created_at: string };
            return {
                id: row.id,
                role: row.role,
                content: row.content,
                timestamp: new Date(row.created_at),
            };
        });
}

let state: AgentState = emptyState(null);

const listeners = new Set<() => void>();
let loadStarted = false;

function set(patch: Partial<AgentState>): void {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
}

export function subscribeAgent(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function getAgentState(): AgentState {
    return state;
}

function canUse(config: AgentConfig | null, user: User): boolean {
    if (!config?.enabled) return false;
    const level = ROLE_LEVEL[user.role] ?? 0;
    const minimum = ROLE_LEVEL[config.min_role as keyof typeof ROLE_LEVEL] ?? 0;
    return level >= minimum;
}

/**
 * Load config and history once per account. A different user in the same tab
 * resets the store first, so no message, draft, or rate count carries over.
 */
export function initAgentSession(user: User): void {
    if (currentUserId !== user.id) {
        currentUserId = user.id;
        loadStarted = false;
        state = emptyState(user.id);
        listeners.forEach((listener) => listener());
    }
    if (loadStarted) return;
    loadStarted = true;
    (async () => {
        try {
            const config = (await api.getAgentConfig()) as AgentConfig;
            const available = canUse(config, user);
            if (!available) {
                set({ ready: true, available: false, config });
                return;
            }
            // Conversations load first so the newest one decides which history
            // to fetch. A build talking to an older API gets an empty list and
            // falls back to the single shared thread, which still works.
            let threads: AgentThread[] = [];
            let maxThreads = 0;
            try {
                const listed = await api.listAgentThreads();
                threads = (listed.threads || []) as AgentThread[];
                maxThreads = listed.max || 0;
            } catch {
                threads = [];
            }
            const activeThreadId = threads.length ? threads[0].id : null;
            const turns = await api.getAgentHistory(60, activeThreadId ?? undefined);
            set({
                ready: true,
                available: true,
                config,
                messages: toMessages(turns),
                threads,
                activeThreadId,
                maxThreads,
            });
        } catch {
            // MyAI stays optional when its service is unavailable.
            set({ ready: true, available: false });
        }
    })();
}

export function setAgentDraft(draft: string): void {
    writeDraft(draft);
    set({ draft });
}

/** Mark the thread as seen: clears the unread count and the "ready" glow. */
export function markAgentSeen(): void {
    if (state.unread === 0 && state.status !== 'ready') return;
    set({ unread: 0, status: state.status === 'ready' ? 'idle' : state.status });
}

export async function sendAgentMessage(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed || state.status === 'working') return;
    const userMessage: AgentMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content: trimmed,
        timestamp: new Date(),
    };
    writeDraft('');
    set({
        messages: [...state.messages, userMessage],
        draft: '',
        status: 'working',
        startedAt: Date.now(),
        lastTools: [],
    });
    try {
        const result = await api.sendAgentMessage(trimmed, state.activeThreadId ?? undefined);
        const tools = (result.tool_calls || []).map((call: { name: string }) => call.name);
        // The server decides the conversation when the client had none, and it
        // names a new one from the first message, so re-read the list.
        const threadId = result.thread_id || state.activeThreadId;
        if (threadId && threadId !== state.activeThreadId) set({ activeThreadId: threadId });
        void refreshAgentThreads();
        set({
            messages: [...state.messages, {
                id: crypto.randomUUID(),
                role: 'assistant',
                content: result.response,
                tool_calls: result.tool_calls,
                timestamp: new Date(),
            }],
            status: 'ready',
            startedAt: null,
            lastTools: tools,
            unread: state.unread + 1,
            remainingHour: result.rate_limit?.remaining_hour ?? state.remainingHour,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown error';
        set({
            messages: [...state.messages, {
                id: crypto.randomUUID(),
                role: 'assistant',
                content: `I couldn’t complete that request: ${message}. Please try again.`,
                timestamp: new Date(),
                failed: true,
            }],
            status: 'error',
            startedAt: null,
            unread: state.unread + 1,
        });
    }
}

export async function clearAgentHistory(): Promise<void> {
    await api.clearAgentHistory(state.activeThreadId ?? undefined);
    set({ messages: [], lastTools: [], unread: 0, status: 'idle' });
}

/** Re-read the conversation list; titles change as the server names them. */
export async function refreshAgentThreads(): Promise<void> {
    try {
        const listed = await api.listAgentThreads();
        set({
            threads: (listed.threads || []) as AgentThread[],
            maxThreads: listed.max || state.maxThreads,
        });
    } catch {
        // an older API has no conversations; the single thread still works
    }
}

/** Switch conversations, loading that thread's messages. */
export async function selectAgentThread(threadId: string): Promise<void> {
    if (threadId === state.activeThreadId || state.status === 'working') return;
    set({ activeThreadId: threadId, messages: [], status: 'idle', lastTools: [], unread: 0 });
    try {
        const turns = await api.getAgentHistory(60, threadId);
        // Ignore a slow response for a conversation the user has since left.
        if (state.activeThreadId === threadId) set({ messages: toMessages(turns) });
    } catch {
        if (state.activeThreadId === threadId) set({ messages: [] });
    }
}

/**
 * Start a new conversation. The cap is the server's to enforce; its refusal
 * message is surfaced rather than second-guessed here.
 */
export async function createAgentThread(): Promise<string | null> {
    if (state.status === 'working') return null;
    const created = await api.createAgentThread();
    const thread = (created?.thread || created) as AgentThread;
    if (!thread?.id) return null;
    set({
        threads: [thread, ...state.threads],
        activeThreadId: thread.id,
        messages: [],
        lastTools: [],
        unread: 0,
        status: 'idle',
    });
    return thread.id;
}

export async function renameAgentThread(threadId: string, title: string): Promise<void> {
    const clean = title.trim();
    if (!clean) return;
    await api.renameAgentThread(threadId, clean);
    set({
        threads: state.threads.map((thread) =>
            thread.id === threadId ? { ...thread, title: clean } : thread,
        ),
    });
}

/** Delete a conversation, moving to the next one if it was the open one. */
export async function deleteAgentThread(threadId: string): Promise<void> {
    await api.deleteAgentThread(threadId);
    const remaining = state.threads.filter((thread) => thread.id !== threadId);
    set({ threads: remaining });
    if (state.activeThreadId !== threadId) return;
    if (remaining.length) {
        set({ activeThreadId: null });
        await selectAgentThread(remaining[0].id);
    } else {
        set({ activeThreadId: null, messages: [], lastTools: [], unread: 0, status: 'idle' });
    }
}

/** Short label for the bubble's status card. */
export function agentStatusLabel(current: AgentState, now = Date.now()): string {
    if (current.status === 'working') {
        const seconds = current.startedAt ? Math.max(1, Math.round((now - current.startedAt) / 1000)) : 0;
        return seconds ? `Working · ${seconds}s` : 'Working…';
    }
    if (current.status === 'error') return 'Last request failed';
    if (current.unread > 0) return current.unread === 1 ? '1 new answer' : `${current.unread} new answers`;
    if (current.messages.length > 0) return 'Ask MyAI';
    return 'Ask MyAI anything';
}
