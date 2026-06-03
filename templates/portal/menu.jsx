/* ══════════════════════════════════════════════════════════════
   28-Day Cycle Menu — read-only weekly view of the rotating menu
   (Miami JCC). Day selector + meal cards with quantities & sides.
═══════════════════════════════════════════════════════════════ */

const MEAL_ORDER = ['Breakfast','Brunch','Lunch','Dinner','Snack'];
const MEAL_TINT = {
  Breakfast:'#D97706', Brunch:'#CA8A04', Lunch:'#1E73E8', Dinner:'#6D28D9', Snack:'#059669',
};

function CycleMenu({ user, period }){
  const todayKey = window.DOW_KEYS[new Date().getDay()];
  const [day, setDay] = React.useState(todayKey);
  const data = window.DS.cycleMenu()[day] || {};
  const sides = window.DS.menuSides()[day] || {};
  const meals = MEAL_ORDER.filter(m=>data[m] && data[m].length);

  const totalItems = meals.reduce((s,m)=>s+data[m].length,0);

  return (
    <div className="fade-in">
      <div className="page-head">
        <div>
          <h2>28-Day Cycle Menu</h2>
          <div className="ph-sub">Rotating week template · {window.DOW_FULL[day]} · {totalItems} line items</div>
        </div>
        <div className="ph-actions">
          <button className="btn">{window.I.printer()} Print menu</button>
          <button className="btn primary">{window.I.edit()} Edit menu</button>
        </div>
      </div>

      <div className="day-pills">
        {window.DOW_KEYS.slice(1).concat('Sun').map(d=>(
          <button key={d} className="day-pill" data-on={day===d} onClick={()=>setDay(d)}>
            {window.DOW_FULL[d]}{d===todayKey && <span className="dp-today">Today</span>}
          </button>
        ))}
      </div>

      <div className="menu-grid">
        {meals.map(meal=>{
          const tint = MEAL_TINT[meal] || 'var(--navy)';
          const list = data[meal];
          const sd = sides[meal];
          return (
            <div className="card menu-card" key={meal}>
              <div className="menu-card-head" style={{borderColor:tint}}>
                <span className="mc-dot" style={{background:tint}}></span>
                <span className="mc-name">{meal}</span>
                <span className="mc-count">{list.length} {meal==='Snack'?'options':'items'}</span>
              </div>
              <div className="card-body flush">
                {meal==='Snack'
                  ? <div className="snack-row">
                      {list.map((s,i)=><span className="snack-chip" key={i}>{s}</span>)}
                    </div>
                  : list.map((it,i)=>{
                      const o = typeof it==='string' ? { item:it } : it;
                      return (
                        <div className="menu-line" key={i}>
                          <div className="ml-main">
                            <span className="ml-item">{o.item}</span>
                            {o.desc && <span className="ml-desc">{o.desc}</span>}
                          </div>
                          {o.qty && <span className="ml-qty">×{o.qty}</span>}
                        </div>
                      );
                    })}
                {sd && (
                  <div className="menu-sides">
                    <span className="ms-label">Sides</span>
                    <span className="ms-list">{sd.join(' · ')}</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="form-note" style={{marginTop:4}}>
        {window.I.alert({style:{width:13,height:13}})}
        <span>Source: <b>Cafeteria_Cycle_Menu_March_2026.xlsm</b> — Miami Job Corps. Two protein entrées are offered at every lunch and dinner per the SOP, with a vegetarian option always available.</span>
      </div>
    </div>
  );
}

window.CycleMenu = CycleMenu;
