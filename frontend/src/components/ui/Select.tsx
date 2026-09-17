import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { I } from '../../lib/icons';
import { placeMenu } from '../../lib/selectPlacement';

/**
 * The standard dropdown.
 *
 * A native `<select>` cannot be themed: its option list is drawn by the
 * operating system, so it ignores the design tokens entirely and appears as a
 * square, system-blue menu in the middle of the app — most obviously in dark
 * mode. Anything that needs to look like the rest of the UI has to render its
 * own list, which is what this does.
 *
 * Lifted from the implementation PullSheet had grown locally, so the behaviour
 * here is the one already proven on that page: close on outside click, close on
 * Escape, and real listbox semantics rather than a div that merely looks the
 * part.
 */
/**
 * Which shape the control takes. The behaviour and the option list are
 * identical in every case; only the trigger's metrics change, so a dropdown
 * sitting in a form matches the text inputs beside it instead of appearing as
 * a filter pill among them.
 *
 * - `filter` — a compact pill for toolbars and filter bars (the default).
 * - `field`  — a full-width form control matching `.ipt` (38px).
 * - `field-sm` — the denser form control used inside table rows.
 */
export type SelectVariant = 'filter' | 'field' | 'field-sm';

export function Select<T extends number | string>({
    value,
    onChange,
    options,
    label,
    className,
    variant = 'filter',
    disabled = false,
    style,
}: {
    value: T;
    onChange: (value: T) => void;
    /**
     * `group` renders a heading above a run of options, replacing what an
     * `<optgroup>` did; `disabled` keeps an option visible but unselectable.
     * Both exist because flattening them away on conversion would lose real
     * meaning — a model's "Vision capable" grouping, or a resource type that
     * cannot be chosen yet.
     */
    options: { value: T; label: string; group?: string; disabled?: boolean }[];
    /** Accessible name for the control; there is no visible <label>. */
    label: string;
    className?: string;
    variant?: SelectVariant;
    disabled?: boolean;
    /**
     * Layout only — width or flex. Many call sites size their control inline,
     * and dropping that on conversion would quietly change their layout.
     */
    style?: CSSProperties;
}) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const [position, setPosition] = useState<CSSProperties | null>(null);
    const selected = options.find((option) => option.value === value);

    /**
     * Place the menu against the trigger in viewport coordinates.
     *
     * The menu is rendered into document.body rather than beside the trigger,
     * because an absolutely-positioned menu is clipped by any ancestor with
     * `overflow`, and plenty of them have it — `.card`, `.modal`, `.modal-body`,
     * `.table-wrap`, `.de-upload-card`. A native <select> never hit this because
     * the operating system drew its popup outside the page entirely. Escaping to
     * the body is the only fix that holds for all 46 call sites; widening the
     * containers would mean loosening overflow rules that exist for good reason.
     */
    const place = useCallback(() => {
        const trigger = ref.current;
        if (!trigger) return;
        const rect = trigger.getBoundingClientRect();
        // The arithmetic lives in lib/selectPlacement so the flip and clamp
        // rules can be tested without a DOM. scrollHeight is 0 on the first
        // open, before the menu has been measured; placeMenu treats that as
        // "assume it wants room" rather than "wants nothing".
        const placement = placeMenu(
            { top: rect.top, bottom: rect.bottom, left: rect.left, width: rect.width },
            { height: window.innerHeight },
            menuRef.current?.scrollHeight ?? 0,
        );
        setPosition({
            position: 'fixed',
            left: placement.left,
            minWidth: placement.minWidth,
            maxHeight: placement.maxHeight,
            overflowY: 'auto',
            ...(placement.flip ? { bottom: placement.offset } : { top: placement.offset }),
        });
    }, []);

    // Measure before paint so the menu never appears in the wrong place first.
    useLayoutEffect(() => {
        if (open) place();
    }, [open, place, options.length]);

    useEffect(() => {
        if (!open) return;
        const closeOnOutside = (event: MouseEvent) => {
            const target = event.target as Node;
            if (ref.current?.contains(target) || menuRef.current?.contains(target)) return;
            setOpen(false);
        };
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setOpen(false);
        };
        // A fixed menu does not travel with a scrolling ancestor, so follow the
        // trigger; `true` catches scrolls on inner containers, not just window.
        const reposition = () => place();
        document.addEventListener('mousedown', closeOnOutside);
        window.addEventListener('keydown', closeOnEscape);
        window.addEventListener('scroll', reposition, true);
        window.addEventListener('resize', reposition);
        return () => {
            document.removeEventListener('mousedown', closeOnOutside);
            window.removeEventListener('keydown', closeOnEscape);
            window.removeEventListener('scroll', reposition, true);
            window.removeEventListener('resize', reposition);
        };
    }, [open, place]);

    // 'filter' is the base look, so it carries no modifier class.
    const variantClass = variant === 'filter' ? '' : ` kpn-select--${variant}`;

    return (
        <div className={'kpn-select' + variantClass + (className ? ` ${className}` : '')} style={style} ref={ref}>
            <button
                type="button"
                className="kpn-select-btn"
                onClick={() => { if (!disabled) setOpen((current) => !current); }}
                disabled={disabled}
                aria-label={label}
                aria-expanded={open}
                aria-haspopup="listbox"
            >
                <span>{selected?.label ?? String(value)}</span>
                {I.down({ style: { width: 12, height: 12 } })}
            </button>
            {open && !disabled && createPortal(
                <div
                    className={'kpn-select-menu kpn-select-menu--portal' + variantClass}
                    role="listbox"
                    aria-label={label}
                    ref={menuRef}
                    style={position ?? { position: 'fixed', visibility: 'hidden' }}
                >
                    {options.map((option, index) => {
                        // A heading is drawn when the group changes, so a run of
                        // options stays visually grouped as its optgroup was.
                        const previousGroup = index > 0 ? options[index - 1].group : undefined;
                        const startsGroup = !!option.group && option.group !== previousGroup;
                        return (
                            <div key={String(option.value)} role="presentation">
                                {startsGroup && (
                                    <div className="kpn-select-group" role="presentation">{option.group}</div>
                                )}
                                <button
                                    type="button"
                                    role="option"
                                    aria-selected={option.value === value}
                                    aria-disabled={option.disabled || undefined}
                                    className="kpn-select-option"
                                    data-active={option.value === value}
                                    disabled={option.disabled}
                                    onClick={() => {
                                        if (option.disabled) return;
                                        onChange(option.value);
                                        setOpen(false);
                                    }}
                                >
                                    {option.label}
                                </button>
                            </div>
                        );
                    })}
                </div>,
                document.body,
            )}
        </div>
    );
}
