import { I } from "../../lib/icons";

export interface SaveBarProps {
    dirtyCount: number;
    saved: boolean;
    savedAt?: Date | null;
    busy?: boolean;
    canEdit: boolean;
    onSave?: () => void;
    onReset?: () => void;
    saveLabel?: string;
    savePrimary?: boolean;
    onStage?: () => void;
    onPush?: () => void;
    note?: React.ReactNode;
}

export function SaveBar({
    dirtyCount,
    saved,
    savedAt,
    busy,
    canEdit,
    onSave,
    onReset,
    saveLabel = "Save",
    savePrimary = false,
    onStage,
    onPush,
    note,
}: SaveBarProps) {
    if (dirtyCount === 0 && saved) return null;

    const isDirty = dirtyCount > 0;
    return (
        <div className={"save-bar" + (isDirty ? " dirty" : "")}>
            <div className="save-bar-l">
                {note}
                {isDirty && canEdit && (
                    <span className="save-bar-msg">
                        {I.alert({ style: { width: 13, height: 13 } })}{" "}
                        Careful — you have {dirtyCount} unsaved change{dirtyCount !== 1 ? "s" : ""}
                    </span>
                )}
                {!isDirty && savedAt && (
                    <span className="saved-chip">
                        {I.check({ style: { width: 12, height: 12 } })} Saved{" "}
                        {savedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                )}
            </div>
            {canEdit && (
                <div className="save-bar-actions">
                    {onReset && isDirty && (
                        <button className="btn" onClick={onReset} disabled={busy}>
                            Reset
                        </button>
                    )}
                    {onSave && (
                        <button
                            className={"btn" + (savePrimary ? " primary" : "")}
                            onClick={onSave}
                            disabled={busy || !isDirty}
                        >
                            {I.save({ style: { width: 14, height: 14 } })} {saveLabel}
                        </button>
                    )}
                    {onStage && (
                        <button
                            className="btn"
                            onClick={onStage}
                            disabled={busy || !isDirty}
                        >
                            {I.branch({ style: { width: 13, height: 13 } })} Stage
                        </button>
                    )}
                    {onPush && (
                        <button
                            className="btn primary"
                            onClick={onPush}
                            disabled={busy}
                        >
                            {I.branch({ style: { width: 13, height: 13 } })} Push
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}

export function PageToolbar({
    children,
    className,
}: {
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <div className={"page-toolbar" + (className ? " " + className : "")}>
            {children}
        </div>
    );
}
