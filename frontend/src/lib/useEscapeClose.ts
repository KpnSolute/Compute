import { useEffect } from 'react';

export function useEscapeClose(open: boolean, onClose: () => void, disabled = false) {
    useEffect(() => {
        if (!open || disabled) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [open, onClose, disabled]);
}
