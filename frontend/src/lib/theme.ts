export type ThemePref = 'light' | 'auto' | 'dark';

const ls = (id: string) => `mjcc_theme_${id}`;
// Device-level copy of the last applied preference, so the right theme is on
// screen before sign-in and before React mounts (no light flash for dark users).
const DEVICE_KEY = 'mjcc_theme_device';
const DARK_QUERY = '(prefers-color-scheme: dark)';

let currentPref: ThemePref = 'auto';
let listening = false;
// Bumped on every explicit choice, so a slow server read can tell it is stale.
let revision = 0;

function isThemePref(value: unknown): value is ThemePref {
    return value === 'light' || value === 'auto' || value === 'dark';
}

function readStored(key: string): string | null {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

function writeStored(key: string, value: string): void {
    try {
        localStorage.setItem(key, value);
    } catch {
        // storage blocked — the theme still applies for this page load
    }
}

function systemPrefersDark(): boolean {
    return typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches;
}

/** A user who never picked a theme follows the operating system. */
export function getThemePref(userId: string): ThemePref {
    const stored = readStored(ls(userId));
    return isThemePref(stored) ? stored : 'auto';
}

export function getCurrentThemePref(): ThemePref {
    return currentPref;
}

export function applyThemePref(pref: ThemePref): void {
    currentPref = pref;
    const dark = pref === 'dark' || (pref === 'auto' && systemPrefersDark());
    const root = document.documentElement;
    if (dark) {
        root.setAttribute('data-theme', 'dark');
    } else {
        root.removeAttribute('data-theme');
    }
    root.style.colorScheme = dark ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0f1117' : '#0E2148');
    writeStored(DEVICE_KEY, pref);
}

export function saveThemePref(userId: string, pref: ThemePref): void {
    revision++;
    writeStored(ls(userId), pref);
    applyThemePref(pref);
}

export function getThemeRevision(): number {
    return revision;
}

/**
 * Apply the device's last theme before the first render and keep "auto" in
 * step with OS changes for the whole session, signed in or not.
 */
export function initTheme(): void {
    const stored = readStored(DEVICE_KEY);
    applyThemePref(isThemePref(stored) ? stored : 'auto');
    if (listening || typeof window.matchMedia !== 'function') return;
    listening = true;
    window.matchMedia(DARK_QUERY).addEventListener('change', () => {
        if (currentPref === 'auto') applyThemePref('auto');
    });
}
