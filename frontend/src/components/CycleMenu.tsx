import { useState, useEffect } from 'react';
import type { User } from '../lib/constants';
import { DOW_KEYS, DOW_FULL } from '../lib/constants';
import { I } from '../lib/icons';
import { api } from '../lib/api';

const MEAL_ORDER = ['Breakfast', 'Brunch', 'Lunch', 'Dinner', 'Snack'];
const MEAL_TINT: Record<string, string> = {
  Breakfast: '#D97706', Brunch: '#CA8A04', Lunch: '#1E73E8', Dinner: '#6D28D9', Snack: '#059669',
};

const EMPTY_MENU: Record<string, any> = {};
const EMPTY_SIDES: Record<string, any> = {};

function Loading({ label = 'Loading\u2026' }) {
  return <div className="load-wrap"><div className="spinner"></div><div>{label}</div></div>;
}

export function CycleMenu({ user: _user }: { user: User }) {
  const todayKey = DOW_KEYS[new Date().getDay()];
  const [day, setDay] = useState(todayKey);
  const [menuData, setMenuData] = useState<Record<string, any>>(EMPTY_MENU);
  const [sidesData, setSidesData] = useState<Record<string, any>>(EMPTY_SIDES);
  const [loading, setLoading] = useState(true);

  const dayIdx = DOW_KEYS.indexOf(day);

  useEffect(() => {
    let alive = true;
    async function loadAll() {
      setLoading(true);
      const dayMap: Record<string, any> = {};
      const sidesMap: Record<string, any> = {};
      const days = DOW_KEYS.map((k) => k.charAt(0).toUpperCase() + k.slice(1));
      for (const d of days) {
        try {
          const result = await api.getMenu(d);
          if (alive && result?.data) {
            dayMap[d.toLowerCase()] = result.data.meals || result.data;
            sidesMap[d.toLowerCase()] = result.data.sides || {};
          }
        } catch {
          // day has no menu data
        }
      }
      if (alive) {
        setMenuData(dayMap);
        setSidesData(sidesMap);
        setLoading(false);
      }
    }
    loadAll();
    return () => { alive = false; };
  }, []);

  const data = menuData[day] || {};
  const sides = sidesData[day] || {};
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

      {loading ? (
        <div className="card" style={{ padding: '40px' }}>
          <Loading label="Loading menu\u2026" />
        </div>
      ) : (
        <>
          <div className="day-pills">
            {DOW_KEYS.slice(1).concat('Sun').map(d => (
              <button key={d} className="day-pill" data-on={day === d} onClick={() => setDay(d)}>
                {DOW_FULL[DOW_KEYS.indexOf(d) >= 0 ? DOW_KEYS.indexOf(d) : 0]}{d === todayKey && <span className="dp-today">Today</span>}
              </button>
            ))}
          </div>

          <div className="menu-grid">
            {meals.length === 0 && !loading && (
              <div style={{ padding: '40px 17px', textAlign: 'center', color: 'var(--faint)', fontSize: 12.5, gridColumn: '1 / -1' }}>
                No menu items loaded for this day.
              </div>
            )}
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
                            {o.qty && <span className="ml-qty">{'\u00D7'}{o.qty}</span>}
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
            <span>Source: <b>Cafeteria_Cycle_Menu_March_2026.xlsm</b> \u2014 Miami Job Corps. Two protein entrees are offered at every lunch and dinner per the SOP, with a vegetarian option always available.</span>
          </div>
        </>
      )}
    </div>
  );
}
