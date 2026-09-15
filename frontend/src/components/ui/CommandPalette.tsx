import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement, type SVGProps } from "react";
import { I } from "../../lib/icons";
import { rankPaletteItems, type PaletteItem } from "../../lib/commandSearch";

const RECENT_KEY = "kpn_palette_recent";
const MAX_RECENT = 5;

type IconFn = (props?: SVGProps<SVGSVGElement>) => ReactElement;
const ICONS = I as unknown as Record<string, IconFn>;

function readRecent(): string[] {
    try {
        const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
        return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
    } catch {
        return [];
    }
}

function rememberRecent(id: string) {
    try {
        localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...readRecent().filter((r) => r !== id)].slice(0, MAX_RECENT)));
    } catch {
        // storage unavailable — recents are only a convenience
    }
}

interface Section {
    title: string;
    items: PaletteItem[];
}

/**
 * Smart Search: a keyboard-first feature palette. Mount it only while open so
 * every opening starts with an empty query.
 */
export function CommandPalette({ onClose, items }: { onClose: () => void; items: PaletteItem[] }) {
    const [query, setQuery] = useState("");
    const [activeIndex, setActiveIndex] = useState(0);
    const [previousFocus] = useState(() => document.activeElement as HTMLElement | null);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        inputRef.current?.focus();
        return () => previousFocus?.focus?.();
    }, [previousFocus]);

    const sections = useMemo<Section[]>(() => {
        if (query.trim()) {
            const ranked = rankPaletteItems(items, query);
            return ranked.length ? [{ title: "Best matches", items: ranked }] : [];
        }
        const byId = new Map(items.map((item) => [item.id, item]));
        const recent = readRecent().map((id) => byId.get(id)).filter((item): item is PaletteItem => !!item);
        const grouped = new Map<string, PaletteItem[]>();
        for (const item of items) {
            if (recent.includes(item)) continue;
            grouped.set(item.group, [...(grouped.get(item.group) || []), item]);
        }
        return [
            ...(recent.length ? [{ title: "Recent", items: recent }] : []),
            ...[...grouped].map(([title, groupItems]) => ({ title, items: groupItems })),
        ];
    }, [items, query]);

    const flat = useMemo(() => sections.flatMap((section) => section.items), [sections]);
    const offsets = useMemo(
        () => sections.map((_, i) => sections.slice(0, i).reduce((total, section) => total + section.items.length, 0)),
        [sections],
    );
    const safeIndex = flat.length ? Math.min(activeIndex, flat.length - 1) : 0;

    useEffect(() => {
        listRef.current?.querySelector(`[data-index="${safeIndex}"]`)?.scrollIntoView({ block: "nearest" });
    }, [safeIndex]);

    const runItem = (item: PaletteItem) => {
        rememberRecent(item.id);
        onClose();
        item.run();
    };

    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onClose();
            return;
        }
        if (event.key === "Tab") {
            event.preventDefault();
            return;
        }
        if (!flat.length) return;
        if (event.key === "ArrowDown") {
            event.preventDefault();
            setActiveIndex((safeIndex + 1) % flat.length);
        } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((safeIndex - 1 + flat.length) % flat.length);
        } else if (event.key === "Enter") {
            event.preventDefault();
            runItem(flat[safeIndex]);
        }
    };

    const searching = !!query.trim();

    return (
        <div className="cmdk-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
            <div className="cmdk" role="dialog" aria-modal="true" aria-label="Smart Search" onKeyDown={onKeyDown}>
                <div className="cmdk-input-row">
                    {I.search()}
                    <input
                        ref={inputRef}
                        className="cmdk-input"
                        value={query}
                        onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }}
                        placeholder="Search pages, tools, and actions…"
                        role="combobox"
                        aria-expanded="true"
                        aria-controls="cmdk-list"
                        aria-autocomplete="list"
                        aria-activedescendant={flat.length ? `cmdk-opt-${safeIndex}` : undefined}
                        autoComplete="off"
                        spellCheck={false}
                    />
                    <kbd className="cmdk-kbd">Esc</kbd>
                </div>
                <div className="cmdk-list" id="cmdk-list" role="listbox" aria-label="Features and actions" ref={listRef}>
                    {flat.length === 0 && (
                        <div className="cmdk-empty">
                            No features match “{query.trim()}”
                            <span>Try a page name like “pull sheet” or a task like “temperature”.</span>
                        </div>
                    )}
                    {sections.map((section, sectionIndex) => (
                        <div className="cmdk-section" key={section.title} role="group" aria-label={section.title}>
                            <div className="cmdk-section-title" aria-hidden="true">{section.title}</div>
                            {section.items.map((item, itemIndex) => {
                                const index = offsets[sectionIndex] + itemIndex;
                                const isActive = index === safeIndex;
                                const icon = item.icon ? ICONS[item.icon] : undefined;
                                return (
                                    <div
                                        key={item.id}
                                        id={`cmdk-opt-${index}`}
                                        role="option"
                                        aria-selected={isActive}
                                        data-index={index}
                                        className={"cmdk-item" + (isActive ? " active" : "")}
                                        onMouseMove={() => { if (!isActive) setActiveIndex(index); }}
                                        onClick={() => runItem(item)}
                                    >
                                        <span className="cmdk-item-icon" aria-hidden="true">{icon ? icon() : I.chevR()}</span>
                                        <span className="cmdk-item-text">
                                            <span className="cmdk-item-label">{item.label}</span>
                                            {searching && <span className="cmdk-item-sub">{item.group}</span>}
                                        </span>
                                        <span className="cmdk-item-hint">
                                            {item.hint}
                                            <kbd className="cmdk-kbd">↵</kbd>
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    ))}
                </div>
                <div className="cmdk-foot" aria-hidden="true">
                    <span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span>
                    <span><kbd>Enter</kbd> Open</span>
                    <span><kbd>Esc</kbd> Close</span>
                    <span className="cmdk-brand">Smart Search · Ctrl S</span>
                </div>
            </div>
        </div>
    );
}
