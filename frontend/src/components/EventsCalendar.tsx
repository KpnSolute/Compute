import { useState, useEffect } from 'react';
import type { User } from '../lib/constants';
import { ROLE_LEVEL, MONTHS } from '../lib/constants';
import { I } from '../lib/icons';
import { api } from '../lib/api';

const t = (msg: string) => (window as any).toast?.(msg);

const EV_DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

const CAT_META: Record<string, { bg: string; color: string; dot: string; label: string }> = {
  cultural: { bg: '#FEF3C7', color: '#92400E', dot: '#D97706', label: 'Cultural / Heritage' },
  special: { bg: '#E0E7FF', color: '#3730A3', dot: '#6366F1', label: 'Special Event' },
  training: { bg: '#D1FAE5', color: '#065F46', dot: '#059669', label: 'ServSafe Training' },
  heals: { bg: '#FCE7F3', color: '#9D174D', dot: '#DB2777', label: 'HEALs Program' },
};

const SERVSAFE_STAFF = [
  { name: 'Angela Martin', cert: 'ServSafe Manager', expiry: '2027-03-15', proctor: true },
  { name: 'Daniel Cortez', cert: 'ServSafe Manager', expiry: '2026-11-20', proctor: true },
  { name: 'Lena Price', cert: 'ServSafe Food Handler', expiry: '2026-08-01', proctor: false },
  { name: 'Rasheed Khan', cert: 'ServSafe Food Handler', expiry: '2026-06-15', proctor: false },
  { name: 'Maria Lopez', cert: 'ServSafe Allergens', expiry: '2025-12-10', proctor: false },
];

function fmtEvDate(iso: string): string {
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

interface CalendarEvent {
  id: number;
  date: string;
  cat: string;
  title: string;
  theme?: string;
  desc?: string;
  suggestedMenu?: string;
}

interface CertStatus {
  cls: string;
  txt: string;
}

interface ServSafeStaff {
  name: string;
  cert: string;
  expiry?: string;
  proctor?: boolean;
}

function Loading({ label = 'Loading\u2026' }) {
  return <div className="load-wrap"><div className="spinner"></div><div>{label}</div></div>;
}

export function EventsCalendar({ user }: { user: User }) {
  const lvl = ROLE_LEVEL[user.role] || 0;
  const canEdit = lvl >= 20;
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [cur, setCur] = useState(() => new Date(2026, 4, 1));
  const [cat, setCat] = useState('all');
  const [selDay, setSelDay] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const data = await api.getEvents();
        if (alive) setEvents(data);
      } catch {
        if (alive) setEvents([]);
      }
      if (alive) setLoading(false);
    }
    load();
    return () => { alive = false; };
  }, []);

  const y = cur.getFullYear(), m = cur.getMonth();
  const monthStr = y + '-' + String(m + 1).padStart(2, '0');

  function shift(d: number) { setCur(new Date(y, m + d, 1)); setSelDay(null); }
  function goToday() { setCur(new Date()); setSelDay(null); }

  const monthEvents = events
    .filter(e => e.date.startsWith(monthStr) && (cat === 'all' || e.cat === cat))
    .sort((a, b) => a.date.localeCompare(b.date));

  const listEvents = selDay
    ? events.filter(e => e.date === selDay).sort((a, b) => a.date.localeCompare(b.date))
    : monthEvents;

  const firstDow = new Date(y, m, 1).getDay();
  const ndays = new Date(y, m + 1, 0).getDate();
  const today = new Date();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= ndays; d++) cells.push(d);

  function dateStr(d: number) { return monthStr + '-' + String(d).padStart(2, '0'); }
  function dayEvents(d: number) {
    return events.filter(e => e.date === dateStr(d) && (cat === 'all' || e.cat === cat));
  }
  function removeEvent(id: number) { setEvents(es => es.filter(e => e.id !== id)); }

  function certStatus(s: ServSafeStaff): CertStatus {
    if (!s.expiry) return { cls: 'warn', txt: 'Pending' };
    const days = Math.ceil((new Date(s.expiry + 'T12:00:00').getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (days < 0) return { cls: 'off', txt: 'Expired' };
    if (days < 60) return { cls: 'warn', txt: days + 'd left' };
    return { cls: 'ok', txt: 'Valid' };
  }

  const nextCultural = events
    .filter(e => e.cat === 'cultural' && e.date >= today.toISOString().slice(0, 10))
    .sort((a, b) => a.date.localeCompare(b.date))[0];

  const counts = ['cultural', 'special', 'training', 'heals'].map(c => ({
    c, n: events.filter(e => e.cat === c && e.date.startsWith(monthStr)).length
  }));

  return (
    <div className="fade-in">
      <div className="page-head">
        <div>
          <h2>Events &amp; Programs</h2>
          <div className="ph-sub">Cultural meals · special events · ServSafe training · HEALs program</div>
        </div>
        <div className="ph-actions">
          {canEdit && <button className="btn primary" onClick={() => setAdding(true)}>{I.plus()} Add event</button>}
        </div>
      </div>

      {loading ? (
        <div className="card" style={{ padding: '40px' }}>
          <Loading label="Loading events\u2026" />
        </div>
      ) : (
        <>
          <div className="cal-toolbar">
            <div className="monthnav">
              <button className="btn" onClick={() => shift(-1)}>{I.chevL({ style: { width: 15, height: 15 } })}</button>
              <span className="mn-label">{MONTHS[m]} {y}</span>
              <button className="btn" onClick={() => shift(1)}>{I.chevR({ style: { width: 15, height: 15 } })}</button>
            </div>
            <button className="btn" onClick={goToday}>{I.calendar({ style: { width: 15, height: 15 } })} Today</button>
            <div className="cal-filters">
              <button className="evchip" data-on={cat === 'all'} onClick={() => setCat('all')}>All</button>
              {Object.keys(CAT_META).filter(k => k !== 'other').map(k => (
                <button key={k} className="evchip" data-on={cat === k} onClick={() => setCat(k)}
                  style={cat === k ? { background: CAT_META[k].bg, color: CAT_META[k].color, borderColor: CAT_META[k].dot } : undefined}>
                  <span className="evchip-dot" style={{ background: CAT_META[k].dot }}></span>{CAT_META[k].label.split(' /')[0].split(' Program')[0]}
                </button>
              ))}
            </div>
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="cal-grid">
              {EV_DOW.map(d => <div className="cal-dow" key={d}>{d}</div>)}
              {cells.map((d, i) => {
                if (d == null) return <div className="cal-cell empty" key={'e' + i}></div>;
                const ds = dateStr(d);
                const evs = dayEvents(d);
                const isToday = today.getFullYear() === y && today.getMonth() === m && today.getDate() === d;
                const isSel = selDay === ds;
                return (
                  <div key={d} className={'cal-cell' + (isToday ? ' today' : '') + (isSel ? ' sel' : '') + (evs.length ? ' has' : '')}
                    onClick={() => setSelDay(isSel ? null : (evs.length ? ds : null))}>
                    <span className="cal-num">{d}</span>
                    <div className="cal-dots">
                      {evs.slice(0, 3).map(e => (
                        <span className="cal-ev" key={e.id} style={{ background: CAT_META[e.cat].bg, color: CAT_META[e.cat].color }} title={e.title}>
                          <span className="ce-dot" style={{ background: CAT_META[e.cat].dot }}></span>{e.title}
                        </span>
                      ))}
                      {evs.length > 3 && <span className="cal-more">+{evs.length - 3} more</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid-2">
            <div className="card">
              <div className="card-head">
                <h3>{selDay ? fmtEvDate(selDay) : 'Events \u2014 ' + MONTHS[m] + ' ' + y}</h3>
                <span className="ch-link" onClick={() => setSelDay(null)} style={{ cursor: 'pointer' }}>
                  {selDay ? '\u2190 Back to month' : listEvents.length + ' event' + (listEvents.length !== 1 ? 's' : '')}
                </span>
              </div>
              <div className="card-body flush">
                {listEvents.length === 0 && <div style={{ padding: '28px 17px', textAlign: 'center', color: 'var(--faint)', fontSize: 12.5 }}>No events {cat !== 'all' ? 'in this category ' : ''}this month.</div>}
                {listEvents.map(e => {
                  const meta = CAT_META[e.cat];
                  return (
                    <div className="ev-item" key={e.id}>
                      <div className="ev-date" style={{ background: meta.bg, color: meta.color }}>
                        <span className="evd-m">{MONTHS[+e.date.slice(5, 7) - 1].slice(0, 3)}</span>
                        <span className="evd-d">{e.date.slice(8, 10)}</span>
                      </div>
                      <div className="ev-body">
                        <div className="ev-top">
                          <span className="ev-title">{e.title}</span>
                          <span className="ev-cat" style={{ background: meta.bg, color: meta.color }}>{meta.label}</span>
                        </div>
                        {e.theme && <div className="ev-theme">{e.theme}</div>}
                        <div className="ev-desc">{e.desc}</div>
                        {e.suggestedMenu && <div className="ev-menu" style={{ borderColor: meta.dot }}><b style={{ color: meta.color }}>Menu</b> {e.suggestedMenu}</div>}
                      </div>
                      {canEdit && <button className="row-del" onClick={() => removeEvent(e.id)} title="Remove">{I.del({ style: { width: 14, height: 14 } })}</button>}
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              {nextCultural && (
                <div className="card" style={{ marginBottom: 16 }}>
                  <div className="card-head"><h3>Next cultural meal</h3></div>
                  <div className="card-body">
                    <div className="ev-title" style={{ fontSize: 14, fontWeight: 800 }}>{nextCultural.title}</div>
                    <div style={{ margin: '7px 0' }}>
                      <span className="ev-cat" style={{ background: CAT_META.cultural.bg, color: CAT_META.cultural.color }}>{nextCultural.theme}</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 7, marginBottom: 9 }}>
                      {I.calendar({ style: { width: 14, height: 14 } })}{fmtEvDate(nextCultural.date)}
                    </div>
                    <div className="ev-menu" style={{ borderColor: CAT_META.cultural.dot, margin: 0 }}><b style={{ color: CAT_META.cultural.color }}>Menu</b> {nextCultural.suggestedMenu}</div>
                  </div>
                </div>
              )}

              <div className="card" style={{ marginBottom: 16 }}>
                <div className="card-head"><h3>This month</h3></div>
                <div className="card-body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  {counts.map(({ c, n }) => (
                    <div key={c} className="ev-stat" style={{ background: CAT_META[c].bg }}>
                      <span className="evs-n" style={{ color: CAT_META[c].color }}>{n}</span>
                      <span className="evs-l" style={{ color: CAT_META[c].color }}>{CAT_META[c].label.split(' /')[0].split(' Program')[0]}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="card">
                <div className="card-head">
                  <h3>ServSafe tracker</h3>
                  <span className="ch-link">{SERVSAFE_STAFF.length} staff</span>
                </div>
                <div className="card-body flush">
                  {SERVSAFE_STAFF.map((s: ServSafeStaff, i: number) => {
                    const st = certStatus(s);
                    return (
                      <div className="ss-row" key={i}>
                        <div className="ss-info">
                          <div className="ss-name">{s.name}{s.proctor && <span className="ss-proctor">{I.award({ style: { width: 11, height: 11 } })} Proctor</span>}</div>
                          <div className="ss-cert">{s.cert}{s.expiry && ' · exp ' + s.expiry}</div>
                        </div>
                        <span className={'pill ' + st.cls}>{st.txt}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {adding && (
        <AddEventModal
          CAT_META={CAT_META} defaultMonth={monthStr} onClose={() => setAdding(false)}
          onAdd={async (ev) => {
            try {
              await api.stageChange(
                'event_create', 'event', ev.title,
                { title: ev.title, date: ev.date, cat: ev.cat, theme: ev.theme, description: ev.desc },
                `New event: ${ev.title}`
              );
              t('Event submitted for review');
            } catch {
              t('Failed to submit event');
            }
            setAdding(false);
          }}
        />
      )}
    </div>
  );
}

interface AddEventModalProps {
  CAT_META: Record<string, { bg: string; color: string; dot: string; label: string }>;
  defaultMonth: string;
  onClose: () => void;
  onAdd: (ev: { title: string; cat: string; date: string; theme: string; desc: string }) => void;
}

function AddEventModal({ CAT_META, defaultMonth, onClose, onAdd }: AddEventModalProps) {
  const [f, setF] = useState({ title: '', cat: 'cultural' as string, date: defaultMonth + '-15', theme: '', desc: '' });
  const set = (k: string, v: string) => setF(s => ({ ...s, [k]: v }));
  const valid = f.title.trim() && f.date;
  return (
    <div className="overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <div className="modal-head">
          <div><h3>{I.calCheck()} Add event</h3>
            <div className="sub">Add to the food-services calendar for the session.</div></div>
          <button className="modal-x" onClick={onClose}>{I.x()}</button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
          <div className="ft-field"><span style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5, color: 'var(--faint)' }}>Title *</span>
            <input className="ipt sel" value={f.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Haitian Flag Day Dinner" /></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="ft-field"><span style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5, color: 'var(--faint)' }}>Category</span>
              <select className="ipt sel" value={f.cat} onChange={e => set('cat', e.target.value)}>
                {Object.keys(CAT_META).map(k => <option key={k} value={k}>{CAT_META[k].label}</option>)}
              </select></div>
            <div className="ft-field"><span style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5, color: 'var(--faint)' }}>Date</span>
              <input className="ipt sel" type="date" value={f.date} onChange={e => set('date', e.target.value)} /></div>
          </div>
          <div className="ft-field"><span style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5, color: 'var(--faint)' }}>Theme (optional)</span>
            <input className="ipt sel" value={f.theme} onChange={e => set('theme', e.target.value)} placeholder="e.g. Black History Month" /></div>
          <div className="ft-field"><span style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5, color: 'var(--faint)' }}>Notes</span>
            <textarea className="ipt sel" rows={3} style={{ resize: 'vertical' }} value={f.desc} onChange={e => set('desc', e.target.value)} placeholder="Menu highlights, coordination notes, SOP references\u2026"></textarea></div>
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!valid} onClick={() => onAdd(f)}>{I.plus()} Add event</button>
        </div>
      </div>
    </div>
  );
}
