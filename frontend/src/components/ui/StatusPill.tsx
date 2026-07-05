import type { ReactNode } from "react";

export interface StatusPillProps {
    warn?: boolean;
    ok?: boolean;
    children: ReactNode;
    style?: React.CSSProperties;
    className?: string;
}

export function StatusPill({ warn, ok, children, style, className }: StatusPillProps) {
    const cls = "status-pill" + (warn ? " warn" : ok ? " ok" : "") + (className ? " " + className : "");
    return (
        <span className={cls} style={style}>
            {children}
        </span>
    );
}
