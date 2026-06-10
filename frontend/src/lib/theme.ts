export type ThemePref = 'light' | 'auto' | 'dark';

const ls = (id: string) => `mjcc_theme_${id}`;

export function getThemePref(userId: string): ThemePref {
    return (localStorage.getItem(ls(userId)) as ThemePref) || 'light';
}

export function applyThemePref(pref: ThemePref): void {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const dark = pref === 'dark' || (pref === 'auto' && prefersDark);
    if (dark) {
        document.documentElement.setAttribute('data-theme', 'dark');
    } else {
        document.documentElement.removeAttribute('data-theme');
    }
}

export function saveThemePref(userId: string, pref: ThemePref): void {
    localStorage.setItem(ls(userId), pref);
    applyThemePref(pref);
}
