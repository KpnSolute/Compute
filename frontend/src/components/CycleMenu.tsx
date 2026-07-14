import { useState, useEffect, useRef, useMemo } from 'react';
import type { User } from '../lib/constants';
import { I } from '../lib/icons';
import { api } from '../lib/api';
import type {
  MenuCycleOverview,
  MenuCycleDay,
  MenuSlot,
  MenuSuggestion,
  PublicMenuCycle,
  PublicMenuCycleDay,
  PublicMenuStats,
  MenuFeedbackRow,
  MealPeriod,
} from '../lib/api';
import { buildTablePdf, downloadBlob, type PdfTableColumn, type PdfTableSection } from '../lib/pdfTable';

const t = (msg: string) => (window as any).toast?.(msg);

// meal_period → meal_group the backend expects when creating a new slot
const GROUP_FOR_PERIOD: Record<string, string> = {
  Breakfast: 'Morning',
  Brunch: 'Morning',
  'Short Order': 'Short Order',
  Lunch: 'Midday',
  Dinner: 'Evening',
};
export const PERIOD_ORDER = ['Breakfast', 'Brunch', 'Short Order', 'Lunch', 'Dinner'];

// Public cycle "meals" period keys → preview tint bucket
const TINT_FOR_PERIOD: Record<string, 'morning' | 'midday' | 'evening'> = {
  Breakfast: 'morning', Brunch: 'morning', 'Short Order': 'midday', Lunch: 'midday', Dinner: 'evening',
};

export const SIDE_SLOTS = new Set(['Vegetable 1', 'Vegetable 2', 'Starch 1', 'Starch 2', 'Accompaniment / Sauce']);

export function shortSideLabel(slot: string): string {
  if (slot.startsWith('Vegetable')) return 'Veg';
  if (slot.startsWith('Starch')) return 'Starch';
  if (slot.includes('Sauce')) return 'Sauce';
  return 'Side';
}

// Template mealSummary logic — primary = first Entree slot (or first non-Soup/Vegetarian), secondary = second Entree
export function mealSummary(items: import('../lib/api').PublicMenuCycleSlot[]) {
  const entrees = items.filter(s => s.slot_name.startsWith('Entree'));
  const primary = entrees[0]?.item_name
    || items.find(s => !['Soup', 'Vegetarian'].includes(s.slot_name))?.item_name
    || null;
  const secondary = entrees[1]?.item_name || null;
  const sides = items.filter(s => SIDE_SLOTS.has(s.slot_name));
  // remaining = total minus what's shown (primary + secondary + sides, but only if shown)
  const shown = new Set<string>();
  if (primary) shown.add(primary);
  if (secondary) shown.add(secondary);
  sides.forEach(s => shown.add(s.item_name));
  const remaining = items.length - shown.size;
  return { primary, secondary, sides, remaining: Math.max(0, remaining) };
}

function Loading({ label = 'Loading…' }) {
  return <div className="load-wrap"><div className="spinner"></div><div>{label}</div></div>;
}

function ErrorBox({ msg, onRetry }: { msg: string; onRetry: () => void }) {
  return (
    <div className="banner warn">
      {I.alert()}
      <span>{msg}</span>
      <span className="bx" onClick={onRetry}>Retry</span>
    </div>
  );
}

function formatRating(value?: number | null): string {
  const n = Number(value || 0);
  return n > 0 ? n.toFixed(1) : 'N/A';
}

export function CycleMenu({ user: _user }: { user: User }) {
  const [overview, setOverview] = useState<MenuCycleOverview | null>(null);
  const [pub, setPub] = useState<PublicMenuCycle | null>(null);
  const [feedbackStats, setFeedbackStats] = useState<PublicMenuStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<MenuSuggestion[]>([]);
  const [q, setQ] = useState('');

  async function loadOverview() {
    setLoading(true);
    setErr(null);
    try {
      const [data, pubData, statsData] = await Promise.all([
        api.getMenuCycleOverview(),
        api.getPublicMenuCycle().catch(() => null),
        api.getPublicMenuStats(8).catch(() => null),
      ]);
      setOverview(data);
      setPub(pubData);
      setFeedbackStats(statsData);
    } catch (e: any) {
      setErr(e?.message || 'Failed to load cycle menu');
    }
    setLoading(false);
  }

  async function loadSuggestions() {
    try {
      const data = await api.getMenuSuggestions('new');
      setSuggestions(data);
    } catch {
      // non-fatal
    }
  }

  useEffect(() => { loadOverview(); loadSuggestions(); }, []);

  const mealsByDay = useMemo(() => {
    const map = new Map<number, PublicMenuCycleDay>();
    for (const d of pub?.days || []) map.set(d.cycle_day, d);
    return map;
  }, [pub]);

  // dish search — filter cycle_day set matching any dish name (case-insensitive)
  const matchedDays = useMemo(() => {
    if (!q.trim()) return null;
    const needle = q.trim().toLowerCase();
    const hit = new Set<number>();
    for (const d of pub?.days || []) {
      const names = Object.values(d.meals).flat().map(s => s.item_name.toLowerCase());
      if (names.some(n => n.includes(needle))) hit.add(d.cycle_day);
    }
    return hit;
  }, [q, pub]);

  function jumpToDate(dateStr: string) {
    if (!dateStr || !overview?.anchor_date) return;
    setSelectedDay(cycleDayForDate(dateStr, overview.anchor_date));
  }

  const [printOpen, setPrintOpen] = useState(false);
  const [printJob, setPrintJob] = useState<{ title: string; sections: PrintSection[]; periods: string[] } | null>(null);
  useEffect(() => {
    if (!printJob) return;
    const id = requestAnimationFrame(() => window.print());
    return () => cancelAnimationFrame(id);
  }, [printJob]);

  const newSuggestions = suggestions.length;
  const feedbackRows = feedbackStats?.rows || [];
  const feedbackByDay = useMemo(() => {
    const map = new Map<number, MenuFeedbackRow[]>();
    for (const row of feedbackRows) {
      map.set(row.cycle_day, [...(map.get(row.cycle_day) || []), row]);
    }
    return map;
  }, [feedbackRows]);
  const totalFeedbackResponses = feedbackRows.reduce((sum, row) => sum + Number(row.response_count || 0), 0);
  const topFeedback = feedbackStats?.top_meals?.[0] || null;

  return (
    <>
    <div className="fade-in no-print">
      <div className="cm-hero">
        <div className="cm-hero-row">
          <div>
            <p className="cm-eyebrow">28-Day Cycle Menu</p>
            <h1>MJCC Menu Dashboard</h1>
            <p className="cm-hero-copy">Every rotation, every dish, one place — browse the 4-week cycle, jump to any calendar date, and keep slots in sync.</p>
          </div>
          <div className="cm-hero-actions">
            <button className="btn" onClick={() => setSuggestOpen(true)}>
              {I.inbox()} Suggestions
              {newSuggestions > 0 && <span className="pill warn" style={{ marginLeft: 6 }}>{newSuggestions}</span>}
            </button>
            {overview && (
              <button className="btn" onClick={() => setPrintOpen(true)}>{I.printer()} Print</button>
            )}
            <button className="btn" onClick={() => setSettingsOpen(true)}>{I.settings()} Settings</button>
          </div>
        </div>
        {overview && (
          <div className="cm-status-row">
            <span className="cm-status-pill"><strong>Day {overview.today.cycle_day}</strong> of 28 · {dowFromOverview(overview)}</span>
            <span className="cm-status-pill">Anchor <strong>{overview.anchor_date}</strong></span>
            <span className="cm-status-pill">{Math.max(...overview.days.map(d => d.cycle_week))} weeks · {overview.days.length} days</span>
            <span className={`cm-status-pill${newSuggestions > 0 ? ' warn' : ''}`}><strong>{newSuggestions}</strong> new suggestions</span>
            <span className="cm-status-pill"><strong>{totalFeedbackResponses}</strong> LionCafe responses</span>
          </div>
        )}
      </div>

      {feedbackStats && (
        <div className="cm-lion-strip">
          <div className="cm-lion-summary">
            <span className="cm-lion-kicker">LionCafe stats</span>
            <strong>{topFeedback?.dish_name || 'No ratings yet'}</strong>
            <span>
              {topFeedback
                ? `Top feedback: ${formatRating(topFeedback.avg_rating)} avg from ${topFeedback.response_count || 0} response${topFeedback.response_count === 1 ? '' : 's'}`
                : 'Feedback appears here as students submit ratings.'}
            </span>
          </div>
          <div className="cm-lion-list">
            {(feedbackStats.top_meals || []).slice(0, 4).map(row => (
              <div className="cm-lion-card" key={row.id}>
                <span>Day {row.cycle_day} - {row.slot}</span>
                <strong>{row.dish_name}</strong>
                <em>{formatRating(row.avg_rating)} avg - {row.response_count || 0} votes</em>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading && (
        <div className="card" style={{ padding: '40px' }}><Loading label="Loading cycle menu…" /></div>
      )}
      {!loading && err && <ErrorBox msg={err} onRetry={loadOverview} />}
      {!loading && !err && overview && (
        <>
          <div className="cm-controls">
            <div className="cm-search">
              {I.search()}
              <input
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Search dishes across the cycle…"
              />
            </div>
            <div className="cm-jump">
              <label>Jump to date</label>
              <input type="date" onChange={e => jumpToDate(e.target.value)} />
            </div>
            {matchedDays && <span className="cm-result-count">{matchedDays.size} day{matchedDays.size === 1 ? '' : 's'}</span>}
            <div className="cm-weeknav">
              {[1, 2, 3, 4].map(w => (
                <a key={w} onClick={() => document.getElementById(`cm-week-${w}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>W{w}</a>
              ))}
            </div>
          </div>

          <CycleOverviewGrid
            overview={overview}
            mealsByDay={mealsByDay}
            feedbackByDay={feedbackByDay}
            matchedDays={matchedDays}
            onSelectDay={setSelectedDay}
          />
        </>
      )}

      {suggestOpen && (
        <SuggestionsPanel
          suggestions={suggestions}
          onClose={() => setSuggestOpen(false)}
          onChanged={loadSuggestions}
        />
      )}
      {settingsOpen && (
        <SettingsModal
          anchorDate={overview?.anchor_date}
          todayCycleDay={overview?.today.cycle_day}
          onClose={() => setSettingsOpen(false)}
          onSaved={loadOverview}
        />
      )}
      {selectedDay !== null && (
        <DayEditor
          cycleDay={selectedDay}
          onBack={() => setSelectedDay(null)}
        />
      )}
      {printOpen && overview && (
        <PrintModal
          overview={overview}
          onClose={() => setPrintOpen(false)}
          onPrint={(title, sections, periods) => { setPrintJob({ title, sections, periods }); setPrintOpen(false); }}
          onDownloadPdf={(title, sections, periods) => { downloadMenuPdf(title, sections, periods, mealsByDay); setPrintOpen(false); }}
        />
      )}
    </div>
    {printJob && (
      <PrintSheet title={printJob.title} sections={printJob.sections} periods={printJob.periods} mealsByDay={mealsByDay} />
    )}
    </>
  );
}

function dowFromOverview(overview: MenuCycleOverview): string {
  const d = overview.days.find(d => d.cycle_day === overview.today.cycle_day);
  return d?.day_of_week || '';
}

// 1-28 cycle day for any calendar date, given the rotation's anchor (Day 1) date.
export function cycleDayForDate(dateStr: string, anchorDate: string): number {
  const anchor = new Date(anchorDate + 'T00:00:00');
  const target = new Date(dateStr + 'T00:00:00');
  const diffDays = Math.round((target.getTime() - anchor.getTime()) / 86400000);
  return (((diffDays % 28) + 28) % 28) + 1;
}

// Calendar date this cycle day occurs on in the current 4-week rotation
function calendarDateFor(cycleDay: number, anchorDate: string): string {
  const anchor = new Date(anchorDate + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysSinceAnchor = Math.round((today.getTime() - anchor.getTime()) / 86400000);
  const currentRotationStart = daysSinceAnchor - (((daysSinceAnchor % 28) + 28) % 28);
  const occurrence = new Date(anchor.getTime() + (currentRotationStart + (cycleDay - 1)) * 86400000);
  return occurrence.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function CycleOverviewGrid({ overview, mealsByDay, feedbackByDay, matchedDays, onSelectDay }: {
  overview: MenuCycleOverview;
  mealsByDay: Map<number, PublicMenuCycleDay>;
  feedbackByDay: Map<number, MenuFeedbackRow[]>;
  matchedDays: Set<number> | null;
  onSelectDay: (n: number) => void;
}) {
  const weeks = [1, 2, 3, 4].map(w => overview.days.filter(d => d.cycle_week === w));
  return (
    <>
      {weeks.map((week, i) => {
        const visible = matchedDays ? week.filter(d => matchedDays.has(d.cycle_day)) : week;
        return (
          <div className="cm-week-section" id={`cm-week-${i + 1}`} key={i}>
            <div className="cm-week-head">
              <h3>Week {i + 1}</h3>
              <span className="cm-week-count">{visible.length} of {week.length} days</span>
            </div>
            <div className="cm-day-grid">
              {visible.length === 0 && <div className="cm-no-results">No dishes match your search this week.</div>}
              {visible.map(d => (
                <DayCard
                  key={d.cycle_day}
                  day={d}
                  meals={mealsByDay.get(d.cycle_day)}
                  feedback={feedbackByDay.get(d.cycle_day) || []}
                  isToday={d.cycle_day === overview.today.cycle_day}
                  anchorDate={overview.anchor_date}
                  onClick={() => onSelectDay(d.cycle_day)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}

function DayCard({ day, meals, feedback, isToday, anchorDate, onClick }: {
  day: MenuCycleOverview['days'][number];
  meals?: PublicMenuCycleDay;
  feedback: MenuFeedbackRow[];
  isToday: boolean;
  anchorDate: string;
  onClick: () => void;
}) {
  const periods = meals ? Object.keys(meals.meals) : [];
  const topFeedback = feedback[0];
  return (
    <button className={`cm-day-card${isToday ? ' today' : ''}`} onClick={onClick}>
      <div className="cm-day-card-head">
        <div>
          <span className="cm-day-kicker">Day {day.cycle_day}</span>
          <span className="cm-day-weekday">{day.day_of_week}</span>
          <span className="cm-day-date">{calendarDateFor(day.cycle_day, anchorDate)}</span>
        </div>
        <div className="cm-day-badges">
          {isToday && <span className="pill ok">Today</span>}
          {!isToday && day.zone === 2 && <span className="pill warn">Zone 2</span>}
        </div>
      </div>

      {periods.length === 0 && (
        <div style={{ fontSize: 11, color: 'var(--faint)' }}>
          {day.zone === 2 ? `${day.morning_service} / ${day.evening_service}` : `${day.morning_service} / ${day.midday_service} / ${day.evening_service}`}
        </div>
      )}
      {topFeedback && (
        <div className="cm-feedback-chip">
          <span>LionCafe</span>
          <strong>{formatRating(topFeedback.avg_rating)}</strong>
          <em>{topFeedback.dish_name}</em>
        </div>
      )}
      {periods.map(period => {
        const items = meals!.meals[period];
        const tint = TINT_FOR_PERIOD[period] || 'morning';
        const { primary, secondary, sides, remaining } = mealSummary(items);
        return (
          <div className={`cm-meal ${tint}`} key={period}>
            <div className="cm-meal-label">
              <span>{period}</span>
              <span className="cm-meal-count">{items.length}</span>
            </div>
            {primary && <div className="cm-main-dish">{primary}</div>}
            {secondary && <div className="cm-alt-dish">{secondary}</div>}
            {remaining > 0 && <div className="cm-more-line">+{remaining} more</div>}
            <div className="cm-side-panel">
              <span className="cm-side-title">Sides</span>
              {sides.length === 0
                ? <span className="cm-side-empty">No sides listed</span>
                : <div className="cm-side-chips">
                    {sides.map(s => (
                      <span key={s.slot_name} className="cm-side-chip" title={s.slot_name}>
                        <span className="cm-side-kind">{shortSideLabel(s.slot_name)}</span>
                        {s.item_name}
                      </span>
                    ))}
                  </div>
              }
            </div>
          </div>
        );
      })}
    </button>
  );
}

// ── Print ────────────────────────────────────────────────────────────────────

interface PrintEntry { cycleDay: number; dow: string; dateLabel: string; zone?: number }
interface PrintSection { label: string; entries: PrintEntry[] }

// Split a flat entry list into calendar-week sections (Sunday-start, matching
// day 1 of the rotation) so a multi-week print reads as distinct pages with
// their own "Week N" header instead of one undifferentiated scroll — each
// section gets its own printed page via CSS break-before.
function groupIntoWeeks(entries: PrintEntry[]): PrintSection[] {
  const sections: PrintSection[] = [];
  let current: PrintEntry[] = [];
  for (const entry of entries) {
    if (entry.dow === 'Sunday' && current.length) {
      sections.push({ label: `Week ${sections.length + 1}`, entries: current });
      current = [];
    }
    current.push(entry);
  }
  if (current.length) sections.push({ label: `Week ${sections.length + 1}`, entries: current });
  return sections;
}

function buildDayEntry(overview: MenuCycleOverview, cycleDay: number, dateLabel?: string): PrintEntry {
  const meta = overview.days.find(d => d.cycle_day === cycleDay);
  return {
    cycleDay,
    dow: meta?.day_of_week || '',
    dateLabel: dateLabel ?? calendarDateFor(cycleDay, overview.anchor_date),
    zone: meta?.zone,
  };
}

function PrintModal({ overview, onClose, onPrint, onDownloadPdf }: {
  overview: MenuCycleOverview;
  onClose: () => void;
  onPrint: (title: string, sections: PrintSection[], periods: string[]) => void;
  onDownloadPdf: (title: string, sections: PrintSection[], periods: string[]) => void;
}) {
  type Scope = 'day' | 'week' | 'cycle' | 'custom';
  const [scope, setScope] = useState<Scope>('week');
  const [day, setDay] = useState(overview.today.cycle_day);
  const todayWeek = overview.days.find(d => d.cycle_day === overview.today.cycle_day)?.cycle_week || 1;
  const [week, setWeek] = useState(todayWeek);
  const today = new Date().toISOString().slice(0, 10);
  const [customStart, setCustomStart] = useState(today);
  const [customEnd, setCustomEnd] = useState(today);
  const [periods, setPeriods] = useState<string[]>([...PERIOD_ORDER]);

  function togglePeriod(period: string) {
    setPeriods(current => current.includes(period)
      ? current.filter(item => item !== period)
      : [...current, period]);
  }

  function buildJob(): { title: string; sections: PrintSection[] } | null {
    if (!periods.length) {
      t('Select at least one meal period.');
      return null;
    }
    if (scope === 'day') {
      const meta = overview.days.find(d => d.cycle_day === day);
      return { title: `Day ${day} Menu — ${meta?.day_of_week || ''}`, sections: [{ label: '', entries: [buildDayEntry(overview, day)] }] };
    } else if (scope === 'week') {
      const entries = overview.days.filter(d => d.cycle_week === week).map(d => buildDayEntry(overview, d.cycle_day));
      return { title: `Week ${week} Menu`, sections: [{ label: '', entries }] };
    } else if (scope === 'cycle') {
      const entries = overview.days.map(d => buildDayEntry(overview, d.cycle_day));
      return { title: 'Full 28-Day Cycle Menu', sections: groupIntoWeeks(entries) };
    }
    if (!customStart || !customEnd || customEnd < customStart) {
      t('Choose a valid custom date range.');
      return null;
    }
    const entries: PrintEntry[] = [];
    for (let cursor = new Date(customStart + 'T00:00:00'); cursor <= new Date(customEnd + 'T00:00:00'); cursor.setDate(cursor.getDate() + 1)) {
      const iso = cursor.toISOString().slice(0, 10);
      const label = cursor.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
      entries.push(buildDayEntry(overview, cycleDayForDate(iso, overview.anchor_date), label));
    }
    return { title: `Custom Menu — ${customStart} to ${customEnd}`, sections: groupIntoWeeks(entries) };
  }

  function handlePrint() {
    const job = buildJob();
    if (job) onPrint(job.title, job.sections, periods);
  }

  function handleDownloadPdf() {
    const job = buildJob();
    if (job) onDownloadPdf(job.title, job.sections, periods);
  }

  return (
    <div className="overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal mid">
        <div className="modal-head">
          <div><h3>{I.printer()} Print / export menu</h3><div className="sub">Choose what to include, then print it or download a PDF file.</div></div>
          <button className="modal-x" onClick={onClose}>{I.x()}</button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(['day', 'week', 'cycle', 'custom'] as const).map(s => (
              <button
                key={s}
                type="button"
                className={'sc-nav-btn' + (scope === s ? ' active' : '')}
                onClick={() => setScope(s)}
              >
                {s === 'day' ? 'Day' : s === 'week' ? 'Week' : s === 'cycle' ? 'Full Cycle' : 'Custom'}
              </button>
            ))}
          </div>
          {scope === 'day' && (
            <div className="ft-field">
              <span>Day</span>
              <select className="ipt sel" value={day} onChange={e => setDay(Number(e.target.value))}>
                {overview.days.map(d => (
                  <option key={d.cycle_day} value={d.cycle_day}>Day {d.cycle_day} — {d.day_of_week}</option>
                ))}
              </select>
            </div>
          )}
          {scope === 'week' && (
            <div className="ft-field">
              <span>Week</span>
              <div style={{ display: 'flex', gap: 6 }}>
                {[1, 2, 3, 4].map(w => (
                  <button
                    key={w}
                    type="button"
                    className={'sc-nav-btn' + (week === w ? ' active' : '')}
                    onClick={() => setWeek(w)}
                  >
                    Week {w}
                  </button>
                ))}
              </div>
            </div>
          )}
          {scope === 'custom' && (
            <div className="ft-field">
              <span>Date range</span>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input className="ipt sel" type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} aria-label="Custom menu start date" />
                <span style={{ alignSelf: 'center', color: 'var(--muted)' }}>to</span>
                <input className="ipt sel" type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} aria-label="Custom menu end date" />
              </div>
            </div>
          )}
          <div className="ft-field">
            <span>Meal periods</span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {PERIOD_ORDER.map(period => (
                <button key={period} type="button" className={'sc-nav-btn' + (periods.includes(period) ? ' active' : '')} onClick={() => togglePeriod(period)}>
                  {period}
                </button>
              ))}
            </div>
          </div>
          {scope === 'cycle' && (
            <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>Prints all 28 days, grouped by week.</p>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn" onClick={handleDownloadPdf}>{I.download({ style: { width: 13, height: 13 } })} Download PDF</button>
          <button className="btn primary" onClick={handlePrint}>{I.printer({ style: { width: 13, height: 13 } })} Print</button>
        </div>
      </div>
    </div>
  );
}

// Compact spreadsheet/table layout — one row per day, one column per meal
// period — instead of a card-per-day grid, so a multi-week print fits far
// fewer pages.
function PrintTable({ title, section, periods, mealsByDay }: {
  title: string;
  section: PrintSection;
  periods: string[];
  mealsByDay: Map<number, PublicMenuCycleDay>;
}) {
  const visiblePeriods = PERIOD_ORDER.filter(p => periods.includes(p));
  return (
    <div className="cm-print-section">
      <div className="cm-print-head">
        <h2>{title}</h2>
        {section.label && <span className="cm-print-week-label">{section.label}</span>}
        <span>MJCC Cafeteria — {periods.join(', ')} — printed {new Date().toLocaleDateString()}</span>
      </div>
      <table className="cm-print-table">
        <thead>
          <tr>
            <th className="cm-print-col-day">Day</th>
            {visiblePeriods.map(period => <th key={period}>{period}</th>)}
          </tr>
        </thead>
        <tbody>
          {section.entries.map((entry, i) => {
            const meals = mealsByDay.get(entry.cycleDay);
            return (
              <tr key={`${entry.cycleDay}-${entry.dateLabel}-${i}`}>
                <td className="cm-print-daycell">
                  <span className="cm-print-day-kicker">Day {entry.cycleDay}</span>
                  <strong>{entry.dow}</strong>
                  {entry.dateLabel && <span>{entry.dateLabel}</span>}
                  {entry.zone === 2 && <span className="cm-print-badge">Zone 2</span>}
                </td>
                {visiblePeriods.map(period => {
                  const items = meals?.meals[period] || [];
                  if (!items.length) return <td className="cm-print-empty-cell" key={period}>—</td>;
                  const entrees = items.filter(s => !SIDE_SLOTS.has(s.slot_name));
                  const sides = items.filter(s => SIDE_SLOTS.has(s.slot_name));
                  return (
                    <td key={period}>
                      {entrees.map(s => s.item_name).join(', ')}
                      {sides.length > 0 && (
                        <div className="cm-print-sides-line">
                          {sides.map(s => `${shortSideLabel(s.slot_name)}: ${s.item_name}`).join(' · ')}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PrintSheet({ title, sections, periods, mealsByDay }: {
  title: string;
  sections: PrintSection[];
  periods: string[];
  mealsByDay: Map<number, PublicMenuCycleDay>;
}) {
  return (
    <div className="cm-print-only">
      {sections.map((section, si) => (
        <PrintTable title={title} section={section} periods={periods} mealsByDay={mealsByDay} key={section.label || si} />
      ))}
    </div>
  );
}

// Builds the same rows the printable table shows, then hands them to the
// generic PDF table writer — a real client-side file, not a print-dialog alias.
function downloadMenuPdf(title: string, sections: PrintSection[], periods: string[], mealsByDay: Map<number, PublicMenuCycleDay>) {
  const visiblePeriods = PERIOD_ORDER.filter(p => periods.includes(p));
  const dayColWidth = 108;
  const tableWidth = 792 - 28 * 2; // matches the Letter-landscape page body in pdfTable.ts
  const periodColWidth = Math.max(90, (tableWidth - dayColWidth) / Math.max(1, visiblePeriods.length));
  const columns: PdfTableColumn[] = [
    { header: 'Day', width: dayColWidth },
    ...visiblePeriods.map(period => ({ header: period, width: periodColWidth })),
  ];

  const pdfSections: PdfTableSection[] = sections.map(section => ({
    label: section.label,
    rows: section.entries.map(entry => {
      const meals = mealsByDay.get(entry.cycleDay);
      const dayCell = `Day ${entry.cycleDay}\n${entry.dow}${entry.dateLabel ? ' - ' + entry.dateLabel : ''}${entry.zone === 2 ? ' (Zone 2)' : ''}`;
      const periodCells = visiblePeriods.map(period => {
        const items = meals?.meals[period] || [];
        if (!items.length) return '-';
        const entrees = items.filter(s => !SIDE_SLOTS.has(s.slot_name)).map(s => s.item_name);
        const sides = items.filter(s => SIDE_SLOTS.has(s.slot_name)).map(s => `${shortSideLabel(s.slot_name)}: ${s.item_name}`);
        return [entrees.join(', '), sides.join(', ')].filter(Boolean).join('\n');
      });
      return [dayCell, ...periodCells];
    }),
  }));

  const blob = buildTablePdf({
    title,
    meta: `MJCC Cafeteria - ${periods.join(', ')} - generated ${new Date().toLocaleDateString()}`,
    columns,
    sections: pdfSections,
  });
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'menu';
  downloadBlob(`mjcc-${slug}.pdf`, blob);
}

// ── Day editor ──────────────────────────────────────────────────────────────

function DayEditor({ cycleDay, onBack }: { cycleDay: number; onBack: () => void }) {
  const [day, setDay] = useState<MenuCycleDay | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [addingPeriod, setAddingPeriod] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const data = await api.getMenuCycleDay(cycleDay);
      setDay(data);
    } catch (e: any) {
      setErr(e?.message || 'Failed to load day');
    }
    setLoading(false);
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [cycleDay]);

  const sections = useMemo(() => {
    if (!day) return [];
    const byPeriod = new Map<string, MenuSlot[]>();
    for (const s of day.slots) {
      if (!byPeriod.has(s.meal_period)) byPeriod.set(s.meal_period, []);
      byPeriod.get(s.meal_period)!.push(s);
    }
    for (const list of byPeriod.values()) list.sort((a, b) => a.service_order - b.service_order || a.slot_order - b.slot_order);
    const known = PERIOD_ORDER.filter(p => byPeriod.has(p));
    const unknown = [...byPeriod.keys()].filter(p => !PERIOD_ORDER.includes(p));
    return [...known, ...unknown].map(p => ({ period: p, slots: byPeriod.get(p)! }));
  }, [day]);

  function updateSlotLocal(updated: MenuSlot) {
    setDay(d => d ? { ...d, slots: d.slots.map(s => s.record_id === updated.record_id ? updated : s) } : d);
  }

  function addSlotLocal(created: MenuSlot) {
    setDay(d => d ? { ...d, slots: [...d.slots, created] } : d);
  }

  const assignmentCount = day?.slots.filter(slot => slot.active).length || 0;

  return (
    <div className="overlay cm-editor-overlay" onClick={e => { if (e.target === e.currentTarget) onBack(); }}>
      <div className="cm-day-editor-modal" role="dialog" aria-modal="true" aria-label="Menu day editor">
        <div className="cm-day-editor-head">
          <div>
            <p className="cm-editor-kicker">
              {day ? `Week ${day.cycle_week} - Cycle Day ${day.cycle_day}` : `Cycle Day ${cycleDay}`}
            </p>
            <h2>{day?.day_of_week || 'Loading day'}</h2>
            <span>{assignmentCount} menu assignment{assignmentCount === 1 ? '' : 's'}</span>
          </div>
          <button className="cm-editor-close" onClick={onBack} aria-label="Close day editor">{I.x()}</button>
        </div>

        <div className="cm-day-editor-body">
          {loading && <Loading label="Loading day..." />}
          {!loading && err && <ErrorBox msg={err} onRetry={load} />}
          {!loading && !err && day && (
            <>
              {sections.map(({ period, slots }) => (
                <div className="cm-assignment-section" key={period}>
                  <div className="cm-assignment-period">
                    <span>{period}</span>
                    <button type="button" onClick={() => setAddingPeriod(period)}>Add slot - {slots.length}</button>
                  </div>
                  {slots.map(slot => (
                    <AssignmentRow key={slot.record_id} slot={slot} onUpdated={updateSlotLocal} />
                  ))}
                  {slots.length === 0 && (
                    <div className="cm-assignment-empty">No slots yet.</div>
                  )}
                </div>
              ))}
            </>
          )}
        </div>

        {addingPeriod && day && (
          <AddSlotModal
            cycleDay={day.cycle_day}
            period={addingPeriod}
            onClose={() => setAddingPeriod(null)}
            onAdded={(s) => { addSlotLocal(s); setAddingPeriod(null); }}
          />
        )}
      </div>
    </div>
  );

}

function AssignmentRow({ slot, onUpdated }: { slot: MenuSlot; onUpdated: (s: MenuSlot) => void }) {
  const [text, setText] = useState(slot.item_name || '');
  const [pickedId, setPickedId] = useState<string | null>(slot.item_id || null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const savingRef = useRef(false);

  useEffect(() => {
    setText(slot.item_name || '');
    setPickedId(slot.item_id || null);
    setErr(null);
  }, [slot.item_id, slot.item_name]);

  async function save(nextText = text, nextId = pickedId) {
    const clean = nextText.trim();
    if (!clean || savingRef.current) return;
    if (clean === (slot.item_name || '') && nextId === (slot.item_id || null)) return;
    savingRef.current = true;
    setBusy(true);
    setErr(null);
    try {
      const updated = await api.updateMenuSlot(slot.record_id, nextId ? { item_id: nextId } : { item_name: clean });
      onUpdated(updated);
    } catch (e: any) {
      setErr(e?.message || 'Failed to save');
    }
    savingRef.current = false;
    setBusy(false);
  }

  async function toggleActive() {
    setBusy(true);
    setErr(null);
    try {
      const updated = await api.updateMenuSlot(slot.record_id, { active: !slot.active });
      onUpdated(updated);
    } catch (e: any) {
      setErr(e?.message || 'Failed to update slot');
    }
    setBusy(false);
  }

  return (
    <div className={`cm-assignment-row${slot.active ? '' : ' inactive'}`}>
      <div className="cm-assignment-label">
        <span>{slot.slot_name}</span>
        {SIDE_SLOTS.has(slot.slot_name) && <em>{shortSideLabel(slot.slot_name)}</em>}
      </div>
      <div className="cm-assignment-input">
        <ItemAutocomplete
          value={text}
          inputClassName="cm-menu-input"
          onChange={v => { setText(v); setPickedId(null); }}
          onPick={item => {
            setText(item.name);
            setPickedId(item.id);
            save(item.name, item.id);
          }}
          onCommit={() => save()}
          placeholder="Search or type menu item"
        />
        {err && <span className="cm-assignment-error">{err}</span>}
      </div>
      <button className="cm-assignment-toggle" disabled={busy} onClick={toggleActive}>
        {slot.active ? 'On' : 'Off'}
      </button>
    </div>
  );
}

export function LegacySlotRow({ slot, onUpdated }: { slot: MenuSlot; onUpdated: (s: MenuSlot) => void }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  async function toggleActive() {
    setBusy(true);
    try {
      const updated = await api.updateMenuSlot(slot.record_id, { active: !slot.active });
      onUpdated(updated);
    } catch (e: any) {
      t(e?.message || 'Failed to update slot');
    }
    setBusy(false);
  }

  return (
    <div className="cm-slot-row" style={{ opacity: slot.active ? 1 : 0.5 }}>
      <span className="cm-slot-name">
        {slot.slot_name}
        {SIDE_SLOTS.has(slot.slot_name) && <span className="cm-side-tag">{shortSideLabel(slot.slot_name)}</span>}
      </span>
      <span className="cm-slot-item" style={{ cursor: 'pointer' }} onClick={() => setEditing(true)}>
        {slot.item_name || <em style={{ color: 'var(--faint)', fontStyle: 'normal' }}>Not set</em>}
      </span>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button className="btn" style={{ padding: '5px 10px' }} onClick={() => setEditing(true)}>{I.edit({ style: { width: 13, height: 13 } })}</button>
        <button className="btn" disabled={busy} style={{ padding: '5px 10px' }} onClick={toggleActive}>
          {slot.active ? 'Deactivate' : 'Activate'}
        </button>
      </div>
      {editing && (
        <SlotEditModal
          slot={slot}
          onClose={() => setEditing(false)}
          onSaved={(s) => { onUpdated(s); setEditing(false); }}
        />
      )}
    </div>
  );
}

// ── Item autocomplete ───────────────────────────────────────────────────────

function ItemAutocomplete({ value, onChange, onPick, placeholder, onCommit, inputClassName }: {
  value: string;
  onChange: (v: string) => void;
  onPick: (item: { id: string; name: string }) => void;
  placeholder?: string;
  onCommit?: () => void;
  inputClassName?: string;
}) {
  const [results, setResults] = useState<Array<{ id: string; name: string; active: boolean }>>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!value.trim()) { setResults([]); return; }
    timer.current = setTimeout(async () => {
      try {
        const r = await api.searchMenuItems(value.trim());
        setResults(r);
      } catch { setResults([]); }
    }, 250);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [value]);

  return (
    <div style={{ position: 'relative' }}>
      <input
        className={inputClassName || 'ipt sel'}
        value={value}
        placeholder={placeholder || 'Type a dish name…'}
        onChange={e => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setTimeout(() => setOpen(false), 150);
          onCommit?.();
        }}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onCommit?.();
            e.currentTarget.blur();
          }
        }}
      />
      {open && results.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, marginTop: 4,
          background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8,
          boxShadow: 'var(--shadow-lg)', maxHeight: 220, overflowY: 'auto',
        }}>
          {results.map(r => (
            <div
              key={r.id}
              style={{ padding: '8px 12px', fontSize: 12.5, cursor: 'pointer' }}
              onMouseDown={() => { onPick(r); setOpen(false); }}
              onMouseOver={e => (e.currentTarget.style.background = 'var(--surface-2)')}
              onMouseOut={e => (e.currentTarget.style.background = 'transparent')}
            >
              {r.name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SlotEditModal({ slot, onClose, onSaved }: { slot: MenuSlot; onClose: () => void; onSaved: (s: MenuSlot) => void }) {
  const [text, setText] = useState(slot.item_name || '');
  const [pickedId, setPickedId] = useState<string | null>(slot.item_id || null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!text.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const body = pickedId ? { item_id: pickedId } : { item_name: text.trim() };
      const updated = await api.updateMenuSlot(slot.record_id, body);
      onSaved(updated);
    } catch (e: any) {
      setErr(e?.message || 'Failed to save');
    }
    setBusy(false);
  }

  return (
    <div className="overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal mid">
        <div className="modal-head">
          <div><h3>{I.edit()} Edit slot</h3><div className="sub">{slot.slot_name}</div></div>
          <button className="modal-x" onClick={onClose}>{I.x()}</button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {err && <div className="banner warn">{I.alert()}<span>{err}</span></div>}
          <div className="ft-field">
            <span>Dish</span>
            <ItemAutocomplete
              value={text}
              onChange={v => { setText(v); setPickedId(null); }}
              onPick={item => { setText(item.name); setPickedId(item.id); }}
              placeholder="Search existing dishes or type a new one"
            />
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy || !text.trim()} onClick={save}>{I.save()} Save</button>
        </div>
      </div>
    </div>
  );
}

function AddSlotModal({ cycleDay, period, onClose, onAdded }: {
  cycleDay: number; period: string; onClose: () => void; onAdded: (s: MenuSlot) => void;
}) {
  const [slotName, setSlotName] = useState('');
  const [text, setText] = useState('');
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const valid = slotName.trim() && text.trim();

  async function save() {
    if (!valid) return;
    setBusy(true);
    setErr(null);
    try {
      const body: any = {
        meal_group: GROUP_FOR_PERIOD[period] || period,
        meal_period: period,
        slot_name: slotName.trim(),
      };
      if (pickedId) body.item_id = pickedId; else body.item_name = text.trim();
      const created = await api.addMenuSlot(cycleDay, body);
      onAdded(created);
    } catch (e: any) {
      setErr(e?.message || 'Failed to add slot');
    }
    setBusy(false);
  }

  return (
    <div className="overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal mid">
        <div className="modal-head">
          <div><h3>{I.plus()} Add slot</h3><div className="sub">{period} — Day {cycleDay}</div></div>
          <button className="modal-x" onClick={onClose}>{I.x()}</button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {err && <div className="banner warn">{I.alert()}<span>{err}</span></div>}
          <div className="ft-field">
            <span>Slot name</span>
            <input className="ipt sel" value={slotName} onChange={e => setSlotName(e.target.value)} placeholder="e.g. Entree 2" />
          </div>
          <div className="ft-field">
            <span>Dish</span>
            <ItemAutocomplete
              value={text}
              onChange={v => { setText(v); setPickedId(null); }}
              onPick={item => { setText(item.name); setPickedId(item.id); }}
            />
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy || !valid} onClick={save}>{I.plus()} Add slot</button>
        </div>
      </div>
    </div>
  );
}

// ── Suggestions panel ────────────────────────────────────────────────────────

function SuggestionsPanel({ suggestions, onClose, onChanged }: {
  suggestions: MenuSuggestion[]; onClose: () => void; onChanged: () => void;
}) {
  async function act(id: string, status: MenuSuggestion['status']) {
    try {
      await api.updateMenuSuggestion(id, status);
      t(`Suggestion marked ${status}`);
      onChanged();
    } catch (e: any) {
      t(e?.message || 'Failed to update suggestion');
    }
  }

  return (
    <div className="overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal wide">
        <div className="modal-head">
          <div><h3>{I.inbox()} Menu suggestions</h3><div className="sub">Submitted dish ideas awaiting review.</div></div>
          <button className="modal-x" onClick={onClose}>{I.x()}</button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {suggestions.length === 0 && (
            <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--faint)', fontSize: 12.5 }}>No pending suggestions.</div>
          )}
          {suggestions.map(s => (
            <div key={s.id} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <strong style={{ fontSize: 13 }}>{s.suggested_item}</strong>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>Day {s.cycle_day} · {s.meal_period}</span>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{s.slot_name}{s.notes ? ` — ${s.notes}` : ''}</div>
              <div style={{ fontSize: 10.5, color: 'var(--faint)' }}>From {s.submitted_by} ({s.source}) · {new Date(s.created_at).toLocaleDateString()}</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button className="btn" style={{ flex: 1, justifyContent: 'center' }} onClick={() => act(s.id, 'reviewed')}>Reviewed</button>
                <button className="btn primary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => act(s.id, 'applied')}>Applied</button>
                <button className="btn" style={{ flex: 1, justifyContent: 'center' }} onClick={() => act(s.id, 'dismissed')}>Dismiss</button>
              </div>
            </div>
          ))}
        </div>
        <div className="modal-foot">
          <button className="btn" style={{ flex: 1 }} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ── Settings modal ───────────────────────────────────────────────────────────

function SettingsModal({ anchorDate, todayCycleDay, onClose, onSaved }: {
  anchorDate?: string; todayCycleDay?: number; onClose: () => void; onSaved: () => void;
}) {
  const [date, setDate] = useState(anchorDate || '');
  const [periods, setPeriods] = useState<MealPeriod[]>([]);
  const [periodsLoading, setPeriodsLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.getMealPeriods()
      .then(rows => { if (alive) setPeriods(rows); })
      .catch(() => { if (alive) setPeriods([]); })
      .finally(() => { if (alive) setPeriodsLoading(false); });
    return () => { alive = false; };
  }, []);

  function updatePeriod(id: string, patch: Partial<MealPeriod>) {
    setPeriods(prev => prev.map(row => row.id === id ? { ...row, ...patch } : row));
  }

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await api.saveMenuSettings(date);
      for (const row of periods) {
        await api.updateMealPeriod(row.id, {
          label: row.label,
          open_hour: Number(row.open_hour),
          close_hour: Number(row.close_hour),
          sort_order: Number(row.sort_order || 0),
        });
      }
      t('Menu settings saved');
      onSaved();
      onClose();
    } catch (e: any) {
      setErr(e?.message || 'Failed to save settings');
    }
    setBusy(false);
  }

  return (
    <div className="overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <div className="modal-head">
          <div><h3>{I.settings()} Cycle menu settings</h3><div className="sub">The anchor date sets Day 1 of the rotation (must be a Sunday).</div></div>
          <button className="modal-x" onClick={onClose}>{I.x()}</button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {err && <div className="banner warn">{I.alert()}<span>{err}</span></div>}
          <div className="ft-field">
            <span>Anchor date (Day 1)</span>
            <input className="ipt sel" type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div className="cm-adjustments-panel">
            <div className="cm-adjustments-head">
              <strong>Adjustments</strong>
              <span>Student service windows</span>
            </div>
            {periodsLoading ? (
              <div className="cm-adjustments-empty">Loading service windows...</div>
            ) : periods.length === 0 ? (
              <div className="cm-adjustments-empty">No meal periods are configured.</div>
            ) : (
              <div className="cm-adjustment-rows">
                {periods.map(row => (
                  <div className="cm-adjustment-row" key={row.id}>
                    <label>
                      <span>Label</span>
                      <input
                        className="ipt sel"
                        value={row.label || ''}
                        onChange={e => updatePeriod(row.id, { label: e.target.value })}
                      />
                    </label>
                    <label>
                      <span>Open</span>
                      <input
                        className="ipt sel"
                        type="number"
                        min="0"
                        max="23"
                        value={row.open_hour ?? 0}
                        onChange={e => updatePeriod(row.id, { open_hour: Number(e.target.value) })}
                      />
                    </label>
                    <label>
                      <span>Close</span>
                      <input
                        className="ipt sel"
                        type="number"
                        min="1"
                        max="24"
                        value={row.close_hour ?? 1}
                        onChange={e => updatePeriod(row.id, { close_hour: Number(e.target.value) })}
                      />
                    </label>
                  </div>
                ))}
              </div>
            )}
          </div>
          {typeof todayCycleDay === 'number' && (
            <div className="form-note">{I.alert({ style: { width: 13, height: 13 } })}<span>Today = Day {todayCycleDay}</span></div>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy || !date} onClick={save}>{I.save()} Save</button>
        </div>
      </div>
    </div>
  );
}
