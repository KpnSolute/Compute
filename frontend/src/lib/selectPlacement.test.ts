import { describe, expect, it } from 'vitest';
import { COMFORTABLE_HEIGHT, MIN_MENU_HEIGHT, placeMenu } from './selectPlacement';

const anchor = (top: number, height = 38, left = 100, width = 160) => ({
    top,
    bottom: top + height,
    left,
    width,
});

describe('anchored menu placement', () => {
    it('opens downward when there is room below', () => {
        const placement = placeMenu(anchor(100), { height: 900 }, 300);
        expect(placement.flip).toBe(false);
        expect(placement.offset).toBe(142); // bottom + gap
    });

    it('opens upward when below is cramped and above is roomier', () => {
        // Trigger near the bottom of the viewport: this is the Data Entry case
        // where the menu was previously clipped.
        const placement = placeMenu(anchor(700), { height: 800 }, 300);
        expect(placement.flip).toBe(true);
        expect(placement.offset).toBe(104); // viewportHeight - top + gap
    });

    it('does not flip toward an edge that is equally cramped', () => {
        // Both sides tight: flipping would move the problem, not solve it.
        const placement = placeMenu(anchor(60, 38), { height: 200 }, 300);
        expect(placement.flip).toBe(false);
    });

    it('does not flip when below is merely smaller but still comfortable', () => {
        const placement = placeMenu(anchor(400), { height: 1200 }, 200);
        expect(placement.flip).toBe(false);
    });

    it('never clamps the menu below a usable height', () => {
        // Both edges cramped, so whichever side wins still has almost no room
        // (72px above, 14px below). The clamp must engage rather than yielding
        // an unusable sliver.
        const placement = placeMenu(anchor(80, 38), { height: 140 }, 600);
        expect(placement.flip).toBe(true);
        expect(placement.maxHeight).toBe(MIN_MENU_HEIGHT);
    });

    it('caps the menu to the space actually available', () => {
        const placement = placeMenu(anchor(100), { height: 900 }, 5000);
        expect(placement.maxHeight).toBe(900 - 138 - 8);
        expect(placement.maxHeight).toBeLessThan(5000);
    });

    it('treats an unknown wanted height as needing comfortable room', () => {
        // Called before the menu has been measured: assume it wants room.
        const tight = placeMenu(anchor(700), { height: 800 });
        expect(tight.flip).toBe(true);
        const roomy = placeMenu(anchor(100), { height: 900 });
        expect(roomy.flip).toBe(false);
        expect(COMFORTABLE_HEIGHT).toBe(240);
    });

    it('matches the trigger position and width so the menu lines up', () => {
        const placement = placeMenu(anchor(100, 38, 250, 340), { height: 900 }, 200);
        expect(placement.left).toBe(250);
        expect(placement.minWidth).toBe(340);
    });
});
