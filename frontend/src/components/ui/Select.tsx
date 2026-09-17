import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { I } from '../../lib/icons';

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
    const selected = options.find((option) => option.value === value);

    useEffect(() => {
        if (!open) return;
        const closeOnOutside = (event: MouseEvent) => {
            if (!ref.current?.contains(event.target as Node)) setOpen(false);
        };
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setOpen(false);
        };
        document.addEventListener('mousedown', closeOnOutside);
        window.addEventListener('keydown', closeOnEscape);
        return () => {
            document.removeEventListener('mousedown', closeOnOutside);
            window.removeEventListener('keydown', closeOnEscape);
        };
    }, [open]);

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
            {open && !disabled && (
                <div className="kpn-select-menu" role="listbox" aria-label={label}>
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
                </div>
            )}
        </div>
    );
}
