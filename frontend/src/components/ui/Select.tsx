import { useEffect, useRef, useState } from 'react';
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
export function Select<T extends number | string>({
    value,
    onChange,
    options,
    label,
    className,
}: {
    value: T;
    onChange: (value: T) => void;
    options: { value: T; label: string }[];
    /** Accessible name for the control; there is no visible <label>. */
    label: string;
    className?: string;
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

    return (
        <div className={'kpn-select' + (className ? ` ${className}` : '')} ref={ref}>
            <button
                type="button"
                className="kpn-select-btn"
                onClick={() => setOpen((current) => !current)}
                aria-label={label}
                aria-expanded={open}
                aria-haspopup="listbox"
            >
                <span>{selected?.label ?? String(value)}</span>
                {I.down({ style: { width: 12, height: 12 } })}
            </button>
            {open && (
                <div className="kpn-select-menu" role="listbox" aria-label={label}>
                    {options.map((option) => (
                        <button
                            key={String(option.value)}
                            type="button"
                            role="option"
                            aria-selected={option.value === value}
                            className="kpn-select-option"
                            data-active={option.value === value}
                            onClick={() => {
                                onChange(option.value);
                                setOpen(false);
                            }}
                        >
                            {option.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
