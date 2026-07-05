import { useState, useEffect, useRef, useMemo } from 'react';
import type { User } from '../lib/constants';
import { I } from '../lib/icons';
import { api } from '../lib/api';
import type { MenuCycleOverview, MenuCycleDay, MenuSlot, MenuSuggestion } from '../lib/api';

const t = (msg: string) => (window as any).toast?.(msg);

// meal_period → meal_group the backend expects when creating a new slot
const GROUP_FOR_PERIOD: Record<string, string> = {
  Breakfast: 'Morning',
  Brunch: 'Morning',
  'Short Order': 'Short Order',
  Lunch: 'Midday',
  Dinner: 'Evening',
};
const PERIOD_ORDER = ['Breakfast', 'Brunch', 'Short Order', 'Lunch', 'Dinner'];

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

export function CycleMenu({ user: _user }: { user: User }) {
  const [overview, setOverview] = useState<MenuCycleOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<MenuSuggestion[]>([]);

  async function loadOverview() {
    setLoading(true);
    setErr(null);
    try {
      const data = await api.getMenuCycleOverview();
      setOverview(data);
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

  if (selectedDay !== null) {
    return (
      <DayEditor
        cycleDay={selectedDay}
        onBack={() => setSelectedDay(null)}
      />
    );
  }

  return (
    <div className="fade-in">
      <div className="page-head">
        <div>
          <h2>28-Day Cycle Menu</h2>
          <div className="ph-sub">
            {overview ? `Today — Day ${overview.today.cycle_day} of 28` : 'Rotating 4-week template'}
          </div>
        </div>
        <div className="ph-actions">
          <button className="btn" onClick={() => setSuggestOpen(true)}>
            {I.inbox()} Suggestions
            {suggestions.length > 0 && <span className="pill warn" style={{ marginLeft: 6 }}>{suggestions.length}</span>}
          </button>
          <button className="btn" onClick={() => setSettingsOpen(true)}>{I.settings()} Settings</button>
        </div>
      </div>

      {loading && (
        <div className="card" style={{ padding: '40px' }}><Loading label="Loading cycle menu…" /></div>
      )}
      {!loading && err && <ErrorBox msg={err} onRetry={loadOverview} />}
      {!loading && !err && overview && (
        <CycleOverviewGrid overview={overview} onSelectDay={setSelectedDay} />
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
    </div>
  );
}

function CycleOverviewGrid({ overview, onSelectDay }: { overview: MenuCycleOverview; onSelectDay: (n: number) => void }) {
  const weeks = [1, 2, 3, 4].map(w => overview.days.filter(d => d.cycle_week === w));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {weeks.map((week, i) => (
        <div className="card" key={i}>
          <div className="card-head"><h3>Week {i + 1}</h3></div>
          <div className="card-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 10 }}>
            {week.map(d => {
              const isToday = d.cycle_day === overview.today.cycle_day;
              return (
                <button
                  key={d.cycle_day}
                  onClick={() => onSelectDay(d.cycle_day)}
                  style={{
                    textAlign: 'left', border: isToday ? '2px solid var(--accent)' : '1px solid var(--line)',
                    borderRadius: 'var(--radius)', padding: '10px 11px', background: d.active ? 'var(--surface)' : 'var(--surface-2)',
                    cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 4, opacity: d.active ? 1 : 0.55,
                    boxShadow: isToday ? '0 0 0 3px var(--accent-soft)' : 'none',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--faint)' }}>Day {d.cycle_day}</span>
                    {isToday && <span className="pill ok">Today</span>}
                    {!isToday && d.zone === 2 && <span className="pill warn">Zone 2</span>}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{d.day_of_week}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                    {d.zone === 2
                      ? `${d.morning_service} / ${d.evening_service}`
                      : `${d.morning_service} / ${d.midday_service} / ${d.evening_service}`}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
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

  return (
    <div className="fade-in">
      <div className="page-head">
        <div>
          <button className="btn" onClick={onBack} style={{ marginBottom: 8 }}>{I.chevL()} Back to cycle</button>
          <h2>{day ? `Day ${day.cycle_day} — ${day.day_of_week} (Week ${day.cycle_week})` : `Day ${cycleDay}`}</h2>
        </div>
      </div>

      {loading && <div className="card" style={{ padding: '40px' }}><Loading label="Loading day…" /></div>}
      {!loading && err && <ErrorBox msg={err} onRetry={load} />}
      {!loading && !err && day && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {sections.map(({ period, slots }) => (
            <div className="card" key={period}>
              <div className="card-head">
                <h3>{period}</h3>
                <span className="ch-link" onClick={() => setAddingPeriod(period)}>+ Add slot</span>
              </div>
              <div className="card-body flush">
                {slots.map(slot => (
                  <SlotRow key={slot.record_id} slot={slot} onUpdated={updateSlotLocal} />
                ))}
                {slots.length === 0 && (
                  <div style={{ padding: '16px 17px', fontSize: 12, color: 'var(--faint)' }}>No slots yet.</div>
                )}
              </div>
            </div>
          ))}

          {addingPeriod && (
            <AddSlotModal
              cycleDay={day.cycle_day}
              period={addingPeriod}
              onClose={() => setAddingPeriod(null)}
              onAdded={(s) => { addSlotLocal(s); setAddingPeriod(null); }}
            />
          )}
        </div>
      )}
    </div>
  );
}

function SlotRow({ slot, onUpdated }: { slot: MenuSlot; onUpdated: (s: MenuSlot) => void }) {
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
    <div
      className="menu-line"
      style={{ padding: '10px 17px', borderBottom: '1px solid var(--line-soft)', opacity: slot.active ? 1 : 0.5 }}
    >
      <div className="ml-main" style={{ cursor: 'pointer', flex: 1 }} onClick={() => setEditing(true)}>
        <span className="ml-item" style={{ fontWeight: 700, fontSize: 11, color: 'var(--muted)', display: 'block' }}>{slot.slot_name}</span>
        <span className="ml-desc" style={{ fontSize: 13 }}>{slot.item_name || <em style={{ color: 'var(--faint)' }}>Not set</em>}</span>
      </div>
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

function ItemAutocomplete({ value, onChange, onPick, placeholder }: {
  value: string;
  onChange: (v: string) => void;
  onPick: (item: { id: string; name: string }) => void;
  placeholder?: string;
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
        className="ipt sel"
        value={value}
        placeholder={placeholder || 'Type a dish name…'}
        onChange={e => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
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
      <div className="modal">
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
      <div className="modal">
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
      <div className="modal" style={{ maxWidth: 560 }}>
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
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await api.saveMenuSettings(date);
      t('Cycle anchor date saved');
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
