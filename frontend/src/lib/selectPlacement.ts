/**
 * Where an anchored dropdown menu goes, in viewport coordinates.
 *
 * The menu is rendered into document.body to escape ancestor `overflow`
 * clipping, which means nothing positions it for us — this arithmetic does.
 * It lives here, apart from the component, because the decisions worth getting
 * right are numeric: open upward only when there is genuinely more room there,
 * and never clamp the menu so short it becomes unusable.
 */
export interface AnchorRect {
    top: number;
    bottom: number;
    left: number;
    width: number;
}

export interface Viewport {
    height: number;
}

export interface Placement {
    /** True when the menu opens above the trigger instead of below it. */
    flip: boolean;
    /** Distance from the viewport edge the menu is pinned to. */
    offset: number;
    maxHeight: number;
    left: number;
    minWidth: number;
}

/** Gap between trigger and menu, and from the viewport edge. */
const GAP = 4;
const MARGIN = 8;
/** Never clamp shorter than this; a 40px menu is worse than one that overlaps. */
export const MIN_MENU_HEIGHT = 120;
/** Enough room for a few options before flipping is considered worthwhile. */
export const COMFORTABLE_HEIGHT = 240;

export function placeMenu(anchor: AnchorRect, viewport: Viewport, wantedHeight = 0): Placement {
    const below = viewport.height - anchor.bottom - MARGIN;
    const above = anchor.top - MARGIN;

    // Flip only when below is genuinely cramped AND above is roomier. Flipping
    // toward an equally cramped edge just moves the problem.
    const cramped = below < Math.min(wantedHeight || COMFORTABLE_HEIGHT, COMFORTABLE_HEIGHT);
    const flip = cramped && above > below;

    const available = flip ? above : below;
    return {
        flip,
        offset: flip ? viewport.height - anchor.top + GAP : anchor.bottom + GAP,
        maxHeight: Math.max(MIN_MENU_HEIGHT, Math.floor(available)),
        left: Math.round(anchor.left),
        minWidth: Math.round(anchor.width),
    };
}
