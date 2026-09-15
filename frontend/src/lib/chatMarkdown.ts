/**
 * Just enough Markdown for assistant replies: paragraphs, bullet and numbered
 * lists, **bold**, *italic*, and `code`.
 *
 * Both functions are pure and return data, never HTML, so the chat can render
 * React elements and never inject markup from a model response.
 */

export type ChatBlock =
    | { kind: 'p'; text: string }
    | { kind: 'ul'; items: string[] }
    | { kind: 'ol'; items: string[] }
    | { kind: 'code'; text: string };

export type InlineSpan =
    | { kind: 'text'; value: string }
    | { kind: 'bold'; value: string }
    | { kind: 'italic'; value: string }
    | { kind: 'code'; value: string };

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
// Headings are rendered as their own bold paragraph rather than a heading level.
const HEADING = /^\s*#{1,6}\s+(.*)$/;
const FENCE = /^\s*```/;

/** Group raw reply text into paragraphs and lists. */
export function toBlocks(text: string): ChatBlock[] {
    const blocks: ChatBlock[] = [];
    // Lines inside ``` fences are kept verbatim; without this the inline code
    // rule pairs the fence backticks and leaves stray markers on screen.
    let fence: string[] | null = null;
    for (const raw of (text || '').split('\n')) {
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
        const bullet = BULLET.exec(line);
        const numbered = NUMBERED.exec(line);
        const heading = HEADING.exec(line);
        const previous = blocks[blocks.length - 1];

        if (bullet) {
            if (previous && previous.kind === 'ul') previous.items.push(bullet[1]);
            else blocks.push({ kind: 'ul', items: [bullet[1]] });
        } else if (numbered) {
            if (previous && previous.kind === 'ol') previous.items.push(numbered[1]);
            else blocks.push({ kind: 'ol', items: [numbered[1]] });
        } else if (heading) {
            blocks.push({ kind: 'p', text: `**${heading[1].replace(/\*+/g, '').trim()}**` });
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

/** Split one line into plain, bold, italic, and code spans. */
export function splitInline(text: string): InlineSpan[] {
    const spans: InlineSpan[] = [];
    const pattern = /\*\*([^*]+)\*\*|`([^`]+)`|\*([^*\n]+)\*/g;
    let index = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
        if (match.index > index) spans.push({ kind: 'text', value: text.slice(index, match.index) });
        if (match[1] !== undefined) spans.push({ kind: 'bold', value: match[1] });
        else if (match[2] !== undefined) spans.push({ kind: 'code', value: match[2] });
        else spans.push({ kind: 'italic', value: match[3] });
        index = match.index + match[0].length;
    }
    if (index < text.length) spans.push({ kind: 'text', value: text.slice(index) });
    return spans.length ? spans : [{ kind: 'text', value: text }];
}
