import { describe, expect, it } from 'vitest';
import { nestListItems, safeHref, splitInline, toBlocks } from './chatMarkdown';

describe('chat markdown blocks', () => {
    it('keeps a single paragraph together and splits on blank lines', () => {
        expect(toBlocks('one\ntwo\n\nthree')).toEqual([
            { kind: 'p', text: 'one\ntwo' },
            { kind: 'p', text: 'three' },
        ]);
    });

    it('groups bullet and numbered runs into lists with depth', () => {
        expect(toBlocks('Summary:\n* first\n- second\n1. step one\n2) step two')).toEqual([
            { kind: 'p', text: 'Summary:' },
            { kind: 'ul', items: [{ text: 'first', depth: 0 }, { text: 'second', depth: 0 }] },
            { kind: 'ol', items: [{ text: 'step one', depth: 0 }, { text: 'step two', depth: 0 }] },
        ]);
    });

    it('records indent depth for nested list items', () => {
        expect(toBlocks('- top\n  - child\n    - grandchild')).toEqual([
            {
                kind: 'ul',
                items: [
                    { text: 'top', depth: 0 },
                    { text: 'child', depth: 1 },
                    { text: 'grandchild', depth: 2 },
                ],
            },
        ]);
    });

    it('renders headings, quotes and rules as their own blocks', () => {
        expect(toBlocks('## Operational Summary\n> watch the walk-in\n---')).toEqual([
            { kind: 'h', level: 3, text: 'Operational Summary' },
            { kind: 'quote', text: 'watch the walk-in' },
            { kind: 'hr' },
        ]);
    });

    it('ignores empty input', () => {
        expect(toBlocks('')).toEqual([]);
    });

    it('keeps fenced code verbatim instead of leaving stray backticks', () => {
        expect(toBlocks('Run this:\n```sql\nselect 1;\n* not a bullet\n```\ndone')).toEqual([
            { kind: 'p', text: 'Run this:' },
            { kind: 'code', text: 'select 1;\n* not a bullet' },
            { kind: 'p', text: 'done' },
        ]);
    });

    it('does not lose text when a fence is never closed', () => {
        expect(toBlocks('```\nselect 1;')).toEqual([{ kind: 'code', text: 'select 1;' }]);
    });

    it('reads a pipe table into head and rows', () => {
        const table = '| Metric | Value |\n|---|---|\n| Active Users | 10 staff |\nEverything looks good.';
        expect(toBlocks(table)).toEqual([
            { kind: 'table', head: ['Metric', 'Value'], rows: [['Active Users', '10 staff']] },
            { kind: 'p', text: 'Everything looks good.' },
        ]);
    });

    it('leaves a pipe line alone when no separator row follows', () => {
        expect(toBlocks('| not | a table |')).toEqual([{ kind: 'p', text: '| not | a table |' }]);
    });
});

describe('chat markdown inline spans', () => {
    it('splits bold, italic, strikethrough and code out of plain text', () => {
        expect(splitInline('Total **$30,572.50** in `inventory`, *rising*, ~~stale~~')).toEqual([
            { kind: 'text', value: 'Total ' },
            { kind: 'bold', value: '$30,572.50' },
            { kind: 'text', value: ' in ' },
            { kind: 'code', value: 'inventory' },
            { kind: 'text', value: ', ' },
            { kind: 'italic', value: 'rising' },
            { kind: 'text', value: ', ' },
            { kind: 'strike', value: 'stale' },
        ]);
    });

    it('turns markdown links and bare URLs into link spans', () => {
        expect(splitInline('See [the report](https://example.com/r) or https://kpnsolute.com')).toEqual([
            { kind: 'text', value: 'See ' },
            { kind: 'link', value: 'the report', href: 'https://example.com/r' },
            { kind: 'text', value: ' or ' },
            { kind: 'link', value: 'https://kpnsolute.com', href: 'https://kpnsolute.com' },
        ]);
    });

    it('refuses unsafe link schemes and keeps them as text', () => {
        expect(splitInline('[click](javascript:alert(1))')).toEqual([
            { kind: 'text', value: '[click](javascript:alert(1))' },
        ]);
        expect(safeHref('data:text/html,<script>')).toBeNull();
        expect(safeHref('  https://ok.example  ')).toBe('https://ok.example');
        expect(safeHref('www.example.com')).toBe('https://www.example.com');
    });

    it('returns plain text unchanged and leaves a stray asterisk alone', () => {
        expect(splitInline('no markup here')).toEqual([{ kind: 'text', value: 'no markup here' }]);
        expect(splitInline('2 * 3 = 6')).toEqual([{ kind: 'text', value: '2 * 3 = 6' }]);
    });
});

describe('nested list building', () => {
    it('nests children under the preceding item', () => {
        const nodes = nestListItems([
            { text: 'top', depth: 0 },
            { text: 'child', depth: 1 },
            { text: 'grandchild', depth: 2 },
            { text: 'second top', depth: 0 },
        ]);
        expect(nodes).toEqual([
            {
                text: 'top',
                children: [{ text: 'child', children: [{ text: 'grandchild', children: [] }] }],
            },
            { text: 'second top', children: [] },
        ]);
    });

    it('clamps an over-indented item to the next available level', () => {
        expect(nestListItems([{ text: 'orphan', depth: 2 }])).toEqual([{ text: 'orphan', children: [] }]);
    });
});
