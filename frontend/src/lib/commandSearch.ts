export interface PaletteItem {
    id: string;
    label: string;
    group: string;
    icon?: string;
    /** Short right-aligned note, e.g. "Current" on the active theme. */
    hint?: string;
    keywords?: string[];
    run: () => void;
}

type Searchable = Pick<PaletteItem, 'label' | 'group' | 'keywords'>;

const normalize = (text: string) => text.toLowerCase().replace(/&/g, ' and ').replace(/\s+/g, ' ').trim();

function isSubsequence(needle: string, haystack: string): boolean {
    let matched = 0;
    for (const ch of haystack) {
        if (ch === needle[matched]) matched++;
        if (matched === needle.length) return true;
    }
    return matched === needle.length;
}

/** Relevance of one item for a query: higher is better, 0 means no match. */
export function scorePaletteItem(item: Searchable, query: string): number {
    const q = normalize(query);
    if (!q) return 1;
    const label = normalize(item.label);
    const group = normalize(item.group);
    const keywords = (item.keywords || []).map(normalize);

    if (label === q) return 100;
    if (label.startsWith(q)) return 90;
    if (label.split(' ').some((word) => word.startsWith(q))) return 75;
    if (label.includes(q)) return 60;
    if (keywords.includes(q)) return 55;
    if (keywords.some((k) => k.startsWith(q) || k.split(' ').some((word) => word.startsWith(q)))) return 45;
    if (keywords.some((k) => k.includes(q))) return 35;
    if (group.startsWith(q)) return 30;

    const tokens = q.split(' ');
    const haystack = [label, group, ...keywords].join(' ');
    if (tokens.length > 1 && tokens.every((token) => haystack.includes(token))) return 25;

    // Typo-tolerant fallback for abbreviations such as "mninv" → Monthly Inventory.
    if (q.length >= 3 && isSubsequence(q.replace(/ /g, ''), label.replace(/ /g, ''))) return 10;
    return 0;
}

/** Items that match, best first; ties keep their original order. */
export function rankPaletteItems<T extends Searchable>(items: T[], query: string): T[] {
    if (!normalize(query)) return items;
    return items
        .map((item, order) => ({ item, order, score: scorePaletteItem(item, query) }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score || a.order - b.order)
        .map((entry) => entry.item);
}
