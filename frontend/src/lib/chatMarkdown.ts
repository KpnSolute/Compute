/**
 * Markdown for assistant replies: headings, paragraphs, nested bullet and
 * numbered lists, tables, fenced code, block quotes, rules, and inline bold,
 * italic, strikethrough, code and links.
 *
 * Both functions are pure and return data, never HTML, so the chat renders
 * React elements and never injects markup from a model response. Link targets
 * are restricted to http, https and mailto here, at the parse step, so an
 * unsafe scheme can never reach an anchor.
 */

export interface ListItem {
    text: string;
    /** Indent level, 0-3; deeper indents are clamped. */
    depth: number;
}

export type ChatBlock =
    | { kind: 'p'; text: string }
    | { kind: 'h'; level: 3 | 4; text: string }
    | { kind: 'ul'; items: ListItem[] }
    | { kind: 'ol'; items: ListItem[] }
    | { kind: 'quote'; text: string }
    | { kind: 'code'; text: string }
    | { kind: 'hr' }
    | { kind: 'table'; head: string[]; rows: string[][] };

export type InlineSpan =
    | { kind: 'text'; value: string }
    | { kind: 'bold'; value: string }
    | { kind: 'italic'; value: string }
    | { kind: 'strike'; value: string }
    | { kind: 'code'; value: string }
    | { kind: 'link'; value: string; href: string };

const BULLET = /^(\s*)[-*•]\s+(.*)$/;
const NUMBERED = /^(\s*)\d+[.)]\s+(.*)$/;
const HEADING = /^\s*(#{1,6})\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const FENCE = /^\s*```/;
const RULE = /^\s*([-*_])\s*(?:\1\s*){2,}$/;
// A table is a pipe row followed by a dashed separator row.
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_SEPARATOR = /^\s*\|?(\s*:?-{2,}:?\s*\|)+\s*:?-{2,}:?\s*\|?\s*$/;

const MAX_DEPTH = 3;

function tableCells(line: string): string[] {
    return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

/** Indent width to list depth: two spaces (or a tab) per level. */
function indentDepth(indent: string): number {
    const width = indent.replace(/\t/g, '  ').length;
    return Math.min(MAX_DEPTH, Math.floor(width / 2));
}

/** Group raw reply text into blocks. */
export function toBlocks(text: string): ChatBlock[] {
    const blocks: ChatBlock[] = [];
    // Lines inside ``` fences are kept verbatim; without this the inline code
    // rule pairs the fence backticks and leaves stray markers on screen.
    let fence: string[] | null = null;
    const lines = (text || '').split('\n');

    for (let index = 0; index < lines.length; index++) {
        const raw = lines[index];
        const line = raw.trimEnd();

        if (FENCE.test(line)) {
            if (fence) {
                blocks.push({ kind: 'code', text: fence.join('\n') });
                fence = null;
            } else {
                fence = [];
            }
            continue;
        }
        if (fence) {
            fence.push(raw);
            continue;
        }

        if (TABLE_ROW.test(line) && index + 1 < lines.length && TABLE_SEPARATOR.test(lines[index + 1])) {
            const head = tableCells(line);
            const rows: string[][] = [];
            let cursor = index + 2;
            while (cursor < lines.length && TABLE_ROW.test(lines[cursor])) {
                rows.push(tableCells(lines[cursor]));
                cursor++;
            }
            blocks.push({ kind: 'table', head, rows });
            index = cursor - 1;
            continue;
        }

        const bullet = BULLET.exec(line);
        const numbered = NUMBERED.exec(line);
        const heading = HEADING.exec(line);
        const quote = QUOTE.exec(line);
        const previous = blocks[blocks.length - 1];

        if (RULE.test(line)) {
            blocks.push({ kind: 'hr' });
        } else if (bullet) {
            const item = { text: bullet[2], depth: indentDepth(bullet[1]) };
            if (previous && previous.kind === 'ul') previous.items.push(item);
            else blocks.push({ kind: 'ul', items: [item] });
        } else if (numbered) {
            const item = { text: numbered[2], depth: indentDepth(numbered[1]) };
            if (previous && previous.kind === 'ol') previous.items.push(item);
            else blocks.push({ kind: 'ol', items: [item] });
        } else if (heading) {
            // One visual step for h1-h2 and a smaller one below that; the chat
            // is not a document, so deeper levels would only add noise.
            blocks.push({ kind: 'h', level: heading[1].length <= 2 ? 3 : 4, text: heading[2].trim() });
        } else if (quote) {
            if (previous && previous.kind === 'quote') previous.text += `\n${quote[1]}`;
            else blocks.push({ kind: 'quote', text: quote[1] });
        } else if (!line.trim()) {
            // Blank line ends the current paragraph; the empty marker is dropped below.
            if (previous && previous.kind === 'p' && previous.text !== '') blocks.push({ kind: 'p', text: '' });
        } else if (previous && previous.kind === 'p' && previous.text !== '') {
            previous.text += `\n${line}`;
        } else {
            blocks.push({ kind: 'p', text: line });
        }
    }

    // An unterminated fence still renders as code rather than losing the text.
    if (fence) blocks.push({ kind: 'code', text: fence.join('\n') });
    return blocks.filter((block) => block.kind !== 'p' || block.text.trim() !== '');
}

/**
 * Only these schemes may become a clickable link. Anything else — javascript:,
 * data:, file: — stays inert text.
 */
export function safeHref(url: string): string | null {
    const trimmed = (url || '').trim();
    if (!trimmed) return null;
    if (/^(https?:\/\/|mailto:)/i.test(trimmed)) return trimmed;
    // A bare domain is treated as https so "www.example.com" still links.
    if (/^www\.[^\s]+$/i.test(trimmed)) return `https://${trimmed}`;
    return null;
}

const INLINE = /\*\*([^*]+)\*\*|~~([^~]+)~~|`([^`]+)`|\*([^*\n]+)\*|\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|(\bhttps?:\/\/[^\s<>()]+)/g;

/** Split one line into plain, bold, italic, strikethrough, code and link spans. */
export function splitInline(text: string): InlineSpan[] {
    const spans: InlineSpan[] = [];
    let index = 0;
    let match: RegExpExecArray | null;
    INLINE.lastIndex = 0;

    while ((match = INLINE.exec(text)) !== null) {
        if (match.index > index) spans.push({ kind: 'text', value: text.slice(index, match.index) });

        if (match[1] !== undefined) spans.push({ kind: 'bold', value: match[1] });
        else if (match[2] !== undefined) spans.push({ kind: 'strike', value: match[2] });
        else if (match[3] !== undefined) spans.push({ kind: 'code', value: match[3] });
        else if (match[4] !== undefined) spans.push({ kind: 'italic', value: match[4] });
        else if (match[5] !== undefined) {
            const href = safeHref(match[6]);
            // An unsafe scheme keeps the original markdown as plain text.
            if (href) spans.push({ kind: 'link', value: match[5], href });
            else spans.push({ kind: 'text', value: match[0] });
        } else if (match[7] !== undefined) {
            const href = safeHref(match[7]);
            if (href) spans.push({ kind: 'link', value: match[7], href });
            else spans.push({ kind: 'text', value: match[7] });
        }

        index = match.index + match[0].length;
    }

    if (index < text.length) spans.push({ kind: 'text', value: text.slice(index) });
    if (!spans.length) return [{ kind: 'text', value: text }];

    // A refused link leaves its markdown behind as text; merging neighbours keeps
    // that as one readable run instead of several fragments.
    return spans.reduce<InlineSpan[]>((merged, span) => {
        const last = merged[merged.length - 1];
        if (span.kind === 'text' && last && last.kind === 'text') last.value += span.value;
        else merged.push(span);
        return merged;
    }, []);
}

/** Nest a flat depth-tagged list for rendering. */
export interface ListNode {
    text: string;
    children: ListNode[];
}

export function nestListItems(items: ListItem[]): ListNode[] {
    const roots: ListNode[] = [];
    const stack: ListNode[] = [];
    for (const item of items) {
        const node: ListNode = { text: item.text, children: [] };
        const depth = Math.min(item.depth, stack.length);
        if (depth === 0) {
            roots.push(node);
            stack.length = 0;
            stack.push(node);
        } else {
            stack[depth - 1].children.push(node);
            stack.length = depth;
            stack.push(node);
        }
    }
    return roots;
}
