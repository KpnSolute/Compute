export type Role = 'staff' | 'assistant' | 'manager' | 'admin' | 'sudo';

export interface User {
  id: string;
  username: string;
  display_name: string;
  last_name: string;
  role: Role;
  active?: boolean;
  pin?: string | null;
  password?: string | null;
  must_change_password?: boolean;
  must_change_pin?: boolean;
  access_token?: string;
  email?: string;
  phone?: string;
  job_title?: string;
  avatar_url?: string;
  bio?: string;
  created_at?: string;
}

export const ROLE_LEVEL: Record<Role, number> = {
  staff: 10,
  assistant: 20,
  manager: 30,
  admin: 40,
  sudo: 50,
};

export const ROLE_LABEL: Record<Role, string> = {
  staff: 'Staff',
  assistant: 'Assistant',
  manager: 'Manager',
  admin: 'Administrator',
  sudo: 'Sudo Administrator',
};

export const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export const NAV = [
  {
    group: 'Overview',
    items: [{ key: 'dashboard', label: 'Dashboard', icon: 'grid', min: 10 }],
  },
  {
    group: 'Data Entry',
    items: [
      { key: 'inventory', label: 'Inventory', icon: 'box', min: 10 },
      { key: 'moninv', label: 'Monthly Inventory', icon: 'fileText', min: 20 },
      { key: 'pullsheet', label: 'Pull Sheet', icon: 'clipboard', min: 30 },
      { key: 'mballot', label: 'Meal Log', icon: 'users', min: 10 },
      { key: 'foodreq', label: 'Food Request', icon: 'inbox', min: 10 },
      { key: 'dataentry', label: 'Data Entry', icon: 'inbox', min: 20 },
    ],
  },
  {
    group: 'Logs',
    items: [
      { key: 'haccp', label: 'HACCP & Logs', icon: 'thermo', min: 20 },
      { key: 'dailyops', label: 'Daily Operations', icon: 'checkSquare', min: 20 },
      { key: 'inspection', label: 'Inspection Sheet', icon: 'clipboard', min: 20 },
      { key: 'snackbar', label: 'Snack Bar', icon: 'coffee', min: 20 },
    ],
  },
  {
    group: 'Calendar',
    items: [
      { key: 'events', label: 'Events & Programs', icon: 'calCheck', min: 10 },
      { key: 'menu', label: '28-Day Menu', icon: 'book', min: 20 },
    ],
  },
  {
    group: 'Records',
    items: [
      { key: 'sourcectrl', label: 'Source Control', icon: 'branch', min: 10, badge: 'pending' },
      { key: 'reports', label: 'Reports', icon: 'download', min: 10 },
      { key: 'archives', label: 'Archives', icon: 'archive', min: 20 },
      { key: 'lioncafe', label: 'LionCafe', icon: 'coffee', min: 30 },
    ],
  },
  {
    group: 'AI Studio',
    items: [
      { key: 'ai-usage',   label: 'My Usage',   icon: 'trend',    min: 30 },
      { key: 'ai-tools',   label: 'Tools',       icon: 'database', min: 30 },
      { key: 'ai-presets', label: 'Automation',  icon: 'flame',    min: 30 },
    ],
  },
  {
    group: 'Administration',
    items: [
      { key: 'users', label: 'Users & Access', icon: 'users', min: 30 },
      { key: 'settings', label: 'Settings', icon: 'settings', min: 40 },
    ],
  },
];

export const COOKING_TEMPS = [
  { temp: '165°F (74°C)', hold: '15 sec', foods: 'Poultry (solid & ground); stuffed foods; dishes with previously cooked PHF ingredients.' },
  { temp: '155°F (68°C)', hold: '15 sec', foods: 'Ground meats (beef, pork, veal, lamb, fish); pork steaks & chops; injected meats; game; shell eggs for hot holding.' },
  { temp: '155°F (68°C)', hold: '22 sec', foods: 'Pork roasts.' },
  { temp: '145°F (63°C)', hold: '15 sec', foods: 'Beef, veal, lamb steaks & chops; seafood; shell eggs for immediate service; pasteurized egg dishes.' },
  { temp: '145°F (63°C)', hold: '4 min', foods: 'Beef, veal and lamb roasts.' },
  { temp: '140°F (60°C)', hold: '15 sec', foods: 'Commercially processed, ready-to-eat food heated for first time, to be hot-held for service.' },
  { temp: '135°F (57°C)', hold: '45 min', foods: 'Roast beef (record internal temperature).' },
];

export const TASTE_CODES = [
  { code: 'A', label: 'Excellent', tint: '#15803D', bg: '#F0FDF4' },
  { code: 'B', label: 'Acceptable — recipe review needed', tint: '#CA8A04', bg: '#FEFCE8' },
  { code: 'C', label: 'Corrective action required', tint: '#D97706', bg: '#FEF3C7' },
  { code: 'D', label: 'Rejected — product may not be served', tint: '#DC2626', bg: '#FEF2F2' },
];

export const INSPECTION_Q = [
  'Rate the quality and taste of food (freshness / nutritional value)',
  'Serving portions offered (availability of seconds / serving temp.)',
  'Variety of food offered (minimum of two main entrées at each meal)',
  'Presentation and appearance of food (eye appeal)',
  'Availability / appearance / variety of soup and salad bar offering',
  'Availability of salt, pepper and napkins',
  'Availability of condiments (ketchup, mustard, mayonnaise, butter, etc.)',
  'Availability of clean glasses, cups, dishes, silverware',
  'Availability of fresh fruit',
  'Availability of beverages (milk / juice / soda)',
  'Availability of breads, rolls, etc.',
  'Cleanliness and appearance of Food Services staff',
  'Friendliness and courtesy shown by Food Services staff',
  'Rate the level of student satisfaction and response to the meal',
  'Rate the overall cleanliness and appearance of the dining hall',
];

export const FOODREQ_FIELDS = [
  { k: 'originator', label: "Originator's Name", type: 'text', col: 6 },
  { k: 'date', label: 'Date', type: 'date', col: 3 },
  { k: 'dept', label: 'Department', type: 'text', col: 6 },
  { k: 'ext', label: 'Center Extension #', type: 'text', col: 3 },
  { k: 'eventDate', label: 'Date of Event', type: 'date', col: 4 },
  { k: 'eventTime', label: 'Time', type: 'time', col: 4 },
  { k: 'students', label: '# of Students', type: 'number', col: 2 },
  { k: 'staff', label: '# of Staff', type: 'number', col: 2 },
  { k: 'location', label: 'Location of Event (include Room #)', type: 'text', col: 8 },
  { k: 'theme', label: 'Event Theme or Purpose', type: 'text', col: 4 },
  { k: 'food', label: 'Type & Amount of Food Requested', type: 'textarea', col: 12 },
  { k: 'drinks', label: 'Type & Amount of Drinks Requested', type: 'textarea', col: 6 },
  { k: 'other', label: 'Other Items Requested', type: 'textarea', col: 6 },
];

export const MEAL_COLS = ['Breakfast', 'Lunch', 'Dinner'];

export const MEAL_LOG_TYPES = [
  { key: 'Staff', label: 'Staff', paid: true },
  { key: 'Visitor', label: 'Visitor', paid: true },
  { key: 'Monitor', label: 'Monitor', paid: false },
  { key: 'Comp Guest', label: 'Comp Guest', paid: false },
];

export const DOW_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const DOW_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// ── AI user preferences ───────────────────────────────────────────────────────

export interface AIPrefs {
  effects: boolean;   // Apple Intelligence border glow + animations
  bubble:  boolean;   // floating agent chat bubble
  autoAI:  boolean;   // AI auto-detect in Data Entry
}

const DEFAULT_AI_PREFS: AIPrefs = { effects: true, bubble: true, autoAI: true };

function aiPrefsKey(userId: string) { return `mjcc_ai_prefs_${userId}`; }

export function loadAIPrefs(userId: string): AIPrefs {
  try {
    const raw = localStorage.getItem(aiPrefsKey(userId));
    if (!raw) return { ...DEFAULT_AI_PREFS };
    return { ...DEFAULT_AI_PREFS, ...JSON.parse(raw) };
  } catch { return { ...DEFAULT_AI_PREFS }; }
}

export function saveAIPrefs(userId: string, prefs: AIPrefs): void {
  localStorage.setItem(aiPrefsKey(userId), JSON.stringify(prefs));
  window.dispatchEvent(new CustomEvent('mjcc-ai-prefs', { detail: { userId, prefs } }));
}

// React hook — re-renders when prefs change in any tab/component
import { useState as _useState, useEffect as _useEffect } from 'react';
export function useAIPrefs(userId: string): [AIPrefs, (p: AIPrefs) => void] {
  const [prefs, setPrefs] = _useState<AIPrefs>(() => loadAIPrefs(userId));
  _useEffect(() => {
    const h = (e: Event) => {
      const ce = e as CustomEvent;
      if (ce.detail?.userId === userId) setPrefs(ce.detail.prefs);
    };
    window.addEventListener('mjcc-ai-prefs', h);
    return () => window.removeEventListener('mjcc-ai-prefs', h);
  }, [userId]);
  const save = (p: AIPrefs) => { saveAIPrefs(userId, p); setPrefs(p); };
  return [prefs, save];
}
