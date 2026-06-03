import { useState } from 'react';
import type { User } from '../lib/constants';
import { DOW_KEYS, DOW_FULL } from '../lib/constants';
import { I } from '../lib/icons';
import { DS } from '../lib/services';

const MEAL_ORDER = ['Breakfast', 'Brunch', 'Lunch', 'Dinner', 'Snack'];
const MEAL_TINT: Record<string, string> = {
  Breakfast: '#D97706', Brunch: '#CA8A04', Lunch: '#1E73E8', Dinner: '#6D28D9', Snack: '#059669',
};

interface CycleMenuProps {
  user: User;
  period?: [number, number];
  connected?: boolean;
}

export function CycleMenu(_props: CycleMenuProps) {
  const todayKey = DOW_KEYS[new Date().getDay()];
  const [day, setDay] = useState(todayKey);
  const dayIdx = DOW_KEYS.indexOf(day);
  const data = DS.cycleMenu()[day] || {};
  const sides = DS.menuSides()[day] || {};
  const meals = MEAL_ORDER.filter(m => data[m] && data[m].length);

  const totalItems = meals.reduce((s, m) => s + data[m].length, 0);

  return (
    <div className="fade-in">
      <div className="page-head">
        <div>
          <h2>28-Day Cycle Menu</h2>
          <div className="ph-sub">Rotating week template \u00B7 {DOW_FULL[dayIdx >= 0 ? dayIdx : 0]} \u00B7 {totalItems} line items</div>
        </div>
        <div className="ph-actions">
          <button className="btn">{I.printer()} Print menu</button>
          <button className="btn primary">{I.edit()} Edit menu</button>
        </div>
      </div>

      <div className="day-pills">
        {DOW_KEYS.slice(1).concat('Sun').map(d => (
          <button key={d} className="day-pill" data-on={day === d} onClick={() => setDay(d)}>
            {DOW_FULL[DOW_KEYS.indexOf(d) >= 0 ? DOW_KEYS.indexOf(d) : 0]}{d === todayKey && <span className="dp-today">Today</span>}
          </button>
        ))}
      </div>

      <div className="menu-grid">
        {meals.map(meal => {
          const tint = MEAL_TINT[meal] || 'var(--navy)';
          const list = data[meal];
          const sd = sides[meal];
          return (
            <div className="card menu-card" key={meal}>
              <div className="menu-card-head" style={{ borderColor: tint }}>
                <span className="mc-dot" style={{ background: tint }}></span>
                <span className="mc-name">{meal}</span>
                <span className="mc-count">{list.length} {meal === 'Snack' ? 'options' : 'items'}</span>
              </div>
              <div className="card-body flush">
                {meal === 'Snack'
                  ? <div className="snack-row">
                    {list.map((s: string, i: number) => <span className="snack-chip" key={i}>{s}</span>)}
                  </div>
                  : list.map((it: any, i: number) => {
                    const o = typeof it === 'string' ? { item: it } : it;
                    return (
                      <div className="menu-line" key={i}>
                        <div className="ml-main">
                          <span className="ml-item">{o.item}</span>
                          {o.desc && <span className="ml-desc">{o.desc}</span>}
                        </div>
                        {o.qty && <span className="ml-qty">\u00D7{o.qty}</span>}
                      </div>
                    );
                  })}
                {sd && (
                  <div className="menu-sides">
                    <span className="ms-label">Sides</span>
                    <span className="ms-list">{sd.join(' \u00B7 ')}</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="form-note" style={{ marginTop: 4 }}>
        {I.alert({ style: { width: 13, height: 13 } })}
        <span>Source: <b>Cafeteria_Cycle_Menu_March_2026.xlsm</b> \u2014 Miami Job Corps. Two protein entr\u00E9es are offered at every lunch and dinner per the SOP, with a vegetarian option always available.</span>
      </div>
    </div>
  );
}
