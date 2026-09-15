import { describe, expect, it } from 'vitest';
import { rankPaletteItems, scorePaletteItem } from './commandSearch';

const items = [
    { label: 'Source Control', group: 'Records', keywords: ['pull request', 'history'] },
    { label: 'Pull Sheet', group: 'Inventory', keywords: ['issue'] },
    { label: 'Monthly Inventory', group: 'Inventory', keywords: ['month end'] },
    { label: 'HACCP & Compliance', group: 'Daily Logs', keywords: ['temperature', 'cooler'] },
    { label: 'Meal Log', group: 'Daily Logs', keywords: ['tickets'] },
];

const labels = (query: string) => rankPaletteItems(items, query).map((item) => item.label);

describe('command search ranking', () => {
    it('keeps the original order for an empty query', () => {
        expect(labels('   ')).toEqual(items.map((item) => item.label));
    });

    it('ranks a label match above a keyword match', () => {
        expect(labels('pull')).toEqual(['Pull Sheet', 'Source Control']);
    });

    it('finds pages by the task staff describe', () => {
        expect(labels('temperature')).toEqual(['HACCP & Compliance']);
        expect(labels('tickets')).toEqual(['Meal Log']);
    });

    it('matches group names and multi-word queries across fields', () => {
        expect(labels('daily logs')).toEqual(['HACCP & Compliance', 'Meal Log']);
        expect(labels('inventory month')).toEqual(['Monthly Inventory']);
    });

    it('treats ampersands as "and"', () => {
        expect(scorePaletteItem(items[3], 'haccp and')).toBe(90);
    });

    it('tolerates abbreviations but rejects unrelated text', () => {
        expect(labels('mninv')).toEqual(['Monthly Inventory']);
        expect(labels('zzz')).toEqual([]);
    });
});
