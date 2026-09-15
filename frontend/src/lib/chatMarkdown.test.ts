import { describe, expect, it } from 'vitest';
import { splitInline, toBlocks } from './chatMarkdown';

describe('chat markdown blocks', () => {
    it('keeps a single paragraph together and splits on blank lines', () => {
        expect(toBlocks('one\ntwo\n\nthree')).toEqual([
            { kind: 'p', text: 'one\ntwo' },
            { kind: 'p', text: 'three' },
        ]);
    });

    it('groups bullet and numbered runs into lists', () => {
        expect(toBlocks('Summary:\n* first\n- second\n1. step one\n2) step two')).toEqual([
            { kind: 'p', text: 'Summary:' },
            { kind: 'ul', items: ['first', 'second'] },
            { kind: 'ol', items: ['step one', 'step two'] },
        ]);
    });

    it('turns headings into a bold paragraph', () => {
        expect(toBlocks('## Operational Summary')).toEqual([{ kind: 'p', text: '**Operational Summary**' }]);
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
});

describe('chat markdown inline spans', () => {
    it('splits bold, italic, and code out of plain text', () => {
        expect(splitInline('Total **$30,572.50** in `inventory` and *rising*')).toEqual([
            { kind: 'text', value: 'Total ' },
            { kind: 'bold', value: '$30,572.50' },
            { kind: 'text', value: ' in ' },
            { kind: 'code', value: 'inventory' },
            { kind: 'text', value: ' and ' },
            { kind: 'italic', value: 'rising' },
        ]);
    });

    it('returns plain text unchanged', () => {
        expect(splitInline('no markup here')).toEqual([{ kind: 'text', value: 'no markup here' }]);
    });

    it('leaves an unmatched asterisk alone', () => {
        expect(splitInline('2 * 3 = 6')).toEqual([{ kind: 'text', value: '2 * 3 = 6' }]);
    });
});
