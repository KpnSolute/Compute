import { useState, useEffect, useRef } from 'react';
import type { User } from '../lib/constants';
import { ROLE_LEVEL, MONTHS, COOKING_TEMPS, TASTE_CODES } from '../lib/constants';
import { I } from '../lib/icons';
import { api } from '../lib/api';
import { StatusPill } from './ui/StatusPill';
import { SaveBar as SharedSaveBar } from './ui/ActionBars';

interface TempRow {
  am?: string;
  pm?: string;
  ami?: string;
  pmi?: string;
  note?: string;
}

interface SanitRow {
  am?: string;
  pm?: string;
  ami?: string;
  pmi?: string;
  area?: string;
}

interface TasteItem {
  id: string;
  product: string;
  temp: string;
  code: string;
  notes: string;
}

interface SubTabProps {
  user: User;
  period: [number, number];
  setPeriod: (p: [number, number]) => void;
  canEdit: boolean;
}

type Appliance = { id: string; name: string; type: 'refrigerator' | 'freezer' };

const APPLIANCES: Appliance[] = [
  { id: 'walkin-cooler', name: 'Walk-in Cooler', type: 'refrigerator' },
  { id: 'reach-in-1', name: 'Reach-in Refrigerator #1', type: 'refrigerator' },
  { id: 'milk-cooler', name: 'Milk Cooler', type: 'refrigerator' },
  { id: 'walkin-freezer', name: 'Walk-in Freezer', type: 'freezer' },
  { id: 'reach-in-freezer', name: 'Reach-in Freezer #1', type: 'freezer' },
];

const HACCP_TABS = [
  { key: 'temp', label: 'Temperature Log', icon: 'thermo' },
  { key: 'sanit', label: 'Sanitizer Log', icon: 'droplet' },
  { key: 'taste', label: 'Taste Panel', icon: 'flame' },
];

const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function daysInMonth(m: number, y: number): number {
  return new Date(y, m + 1, 0).getDate();
}

// Typed persistence for the blob-shaped compliance docs (sanitizer log, taste
// panel) that have no dedicated table — backed by daily_operations_logs via
// entry_type + title. No localStorage: a failed save must be visible, not
// silently reported as "Saved".
function useComplianceDoc<T>(entryType: string, title: string, initial: T) {
  const [data, setData] = useState<T>(initial);
  const [saved, setSaved] = useState(true);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const initialRef = useRef(initial);

  useEffect(() => {
    setData(initialRef.current);
    setSaved(true);
    setSaveError(null);
    setLoadError(null);
    let alive = true;
    api.getComplianceDoc<T>(entryType, title).then(found => {
      if (alive && found) setData(found);
    }).catch(e => {
      if (alive) setLoadError(e?.message || 'Failed to load saved data');
    });
    return () => { alive = false; };
    // eslint-disable-next-line
  }, [entryType, title]);

  const update = (u: T | ((d: T) => T)) => {
    setData(d => (typeof u === 'function' ? (u as (d: T) => T)(d) : u));
    setSaved(false);
  };

  const save = async (saveData: T = data) => {
    try {
      await api.saveComplianceDoc(entryType, title, saveData);
      setSaved(true);
      setSavedAt(new Date());
      setSaveError(null);
    } catch (e: any) {
      setSaveError(e?.message || 'Save failed — backend unreachable. Retry.');
      throw e;
    }
  };

  return { data, update, saved, save, savedAt, saveError, loadError };
}

// Typed persistence for the HACCP temperature grid. Unlike the doc types
// above, readings have a real dedicated table (haccp_logs) — one row per
// AM/PM reading — so the month x appliance grid is reconstructed from those
// rows rather than a single blob.
function useTempGrid(applianceName: string, year: number, month: number) {
  const [rows, setRows] = useState<Record<number, TempRow>>({});
  const [saved, setSaved] = useState(true);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    setRows({});
    setSaved(true);
    setSaveError(null);
    setLoadError(null);
    let alive = true;
    api.getHaccpTempGrid(applianceName, year, month).then(found => {
      if (alive) setRows(found);
    }).catch(e => {
      if (alive) setLoadError(e?.message || 'Failed to load saved data');
    });
    return () => { alive = false; };
  }, [applianceName, year, month]);

  const update = (u: Record<number, TempRow> | ((d: Record<number, TempRow>) => Record<number, TempRow>)) => {
    setRows(d => (typeof u === 'function' ? (u as (d: Record<number, TempRow>) => Record<number, TempRow>)(d) : u));
    setSaved(false);
  };

  const save = async () => {
    try {
      await api.saveHaccpTempGrid(applianceName, year, month, rows);
      setSaved(true);
      setSavedAt(new Date());
      setSaveError(null);
    } catch (e: any) {
      setSaveError(e?.message || 'Save failed — backend unreachable. Retry.');
      throw e;
    }
  };

  return { rows, update, saved, save, savedAt, saveError, loadError };
}

function tempCell(
  val: string | undefined,
  onChange: (v: string) => void,
  bad: boolean,
  canEdit: boolean,
): React.ReactNode {
  if (!canEdit)
    return (
      <span
        className="num"
        style={{ color: bad ? 'var(--red)' : 'inherit', fontWeight: bad ? 800 : 400 }}
      >
        {val || '—'}
      </span>
    );
  return (
    <input
      className={'sheet-inp' + (bad ? ' bad' : '')}
      style={{ width: 60 }}
      type="number"
      step="0.1"
      value={val ?? ''}
      onChange={e => onChange(e.target.value)}
    />
  );
}

function textCell(
  val: string | undefined,
  onChange: (v: string) => void,
  canEdit: boolean,
  kind: string,
  ph = '',
): React.ReactNode {
  const w = kind === 'init' ? 60 : undefined;
  if (!canEdit)
    return (
      <span style={{ fontSize: kind === 'note' ? 11.5 : 12 }}>
        {val || (kind === 'init' ? '' : '—')}
      </span>
    );
  return (
    <input
      className={'sheet-inp txt' + (kind === 'init' ? ' initc' : '')}
      style={
        w
          ? { width: w }
          : { width: '100%', minWidth: kind === 'note' ? 160 : 90 }
      }
      value={val ?? ''}
      placeholder={ph}
      onChange={e => onChange(e.target.value)}
    />
  );
}

// ponytail: alias keeps call sites unchanged; dirtyCount=1 when !saved (ComplianceHub tracks saved as bool not count)
function SaveBar({ saved, savedAt, onSave, canEdit, note, saveError }: {
  saved: boolean; savedAt: Date | null; onSave: () => void; canEdit: boolean; note?: React.ReactNode;
  saveError?: string | null;
}) {
  const syncNote = saveError ? (
    <span style={{ color: 'var(--red, #dc2626)', fontWeight: 700, fontSize: 12 }}>
      ⚠ {saveError}
    </span>
  ) : null;
  return (
    <SharedSaveBar
      dirtyCount={saved ? 0 : 1}
      saved={saved}
      savedAt={savedAt}
      onSave={onSave}
      canEdit={canEdit}
      saveLabel="Save"
      savePrimary
      note={syncNote ? <>{syncNote}{note ? <> · {note}</> : null}</> : note}
    />
  );
}

function MonthNav({
  period,
  setPeriod,
}: {
  period: [number, number];
  setPeriod: (p: [number, number]) => void;
}) {
  const [m, y] = period;
  function shift(d: number) {
    let nm = m + d;
    let ny = y;
    if (nm < 0) {
      nm = 11;
      ny--;
    }
    if (nm > 11) {
      nm = 0;
      ny++;
    }
    setPeriod([nm, ny]);
  }
  return (
    <div className="monthnav">
      <button className="btn" onClick={() => shift(-1)}>
        {I.chevL({ style: { width: 15, height: 15 } })}
      </button>
      <span className="mn-label">
        {MONTHS[m]} {y}
      </span>
      <button className="btn" onClick={() => shift(1)}>
        {I.chevR({ style: { width: 15, height: 15 } })}
      </button>
    </div>
  );
}

function TemperatureLog({
  period,
  setPeriod,
  canEdit,
}: SubTabProps) {
  const [appId, setAppId] = useState(APPLIANCES[0].id);
  const app = APPLIANCES.find(a => a.id === appId) ?? APPLIANCES[0];
  const limit = app.type === 'freezer' ? 0 : 41;
  const [m, y] = period;
  const ndays = daysInMonth(m, y);
  const { rows, update, saved, save, savedAt, saveError, loadError } = useTempGrid(app.name, y, m);

  function setCell(day: number, field: string, val: string) {
    update(d => ({
      ...d,
      [day]: { ...(d[day] || {}), [field]: val },
    }));
  }

  function flag(v: string | undefined) {
    const n = parseFloat(v ?? '');
    return !isNaN(n) && n > limit;
  }

  const violations = Object.values(rows).filter(
    r => flag(r.am) || flag(r.pm),
  ).length;

  return (
    <div>
      <div className="form-toolbar">
        <div className="ft-l">
          <label className="ft-field">
            <span>Appliance</span>
            <select
              className="ipt sel"
              value={appId}
              onChange={e => setAppId(e.target.value)}
            >
              {APPLIANCES.map(a => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <span
            className={'thresh-chip ' + (app.type === 'freezer' ? 'frz' : 'rfg')}
          >
            {app.type === 'freezer'
              ? I.snow({ style: { width: 13, height: 13 } })
              : I.thermo({ style: { width: 13, height: 13 } })}
            {app.type === 'freezer'
              ? 'Freezer · 0°F or lower'
              : 'Refrigerator · 41°F or lower'}
          </span>
        </div>
        <MonthNav period={period} setPeriod={setPeriod} />
      </div>

      <div className="form-note">
        Record temperatures <b>twice daily (AM / PM)</b> with staff initials.
        Notify management immediately if a refrigerator is above 41°F or a
        freezer is above 0°F. Keep on file for one year.
        {violations > 0 && (
          <StatusPill warn style={{ marginLeft: 'auto' }}>
            {I.alert({ style: { width: 13, height: 13 } })} {violations}{' '}
            out-of-range {violations === 1 ? 'day' : 'days'}
          </StatusPill>
        )}
      </div>

      {loadError && (
        <div className="form-note" style={{ color: 'var(--red, #dc2626)', fontWeight: 700 }}>
          {I.alert({ style: { width: 13, height: 13 } })} Could not load saved readings: {loadError}
        </div>
      )}

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="tbl-wrap">
          <table className="data logtbl">
            <thead>
              <tr>
                <th style={{ width: 54 }}>Day</th>
                <th className="r">Temp AM</th>
                <th style={{ width: 70 }}>Init</th>
                <th className="r">Temp PM</th>
                <th style={{ width: 70 }}>Init</th>
                <th>Action / comment (date reported)</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: ndays }, (_, i) => i + 1).map(day => {
                const r = rows[day] || {};
                const dow = DOW[new Date(y, m, day).getDay()];
                const amBad = flag(r.am);
                const pmBad = flag(r.pm);
                return (
                  <tr key={day} className={amBad || pmBad ? 'row-low' : ''}>
                    <td className="num daycell">
                      <b>{day}</b> <span className="dow">{dow}</span>
                    </td>
                    <td className="r">
                      {tempCell(r.am, v => setCell(day, 'am', v), amBad, canEdit)}
                    </td>
                    <td>
                      {textCell(
                        r.ami,
                        v => setCell(day, 'ami', v),
                        canEdit,
                        'init',
                      )}
                    </td>
                    <td className="r">
                      {tempCell(r.pm, v => setCell(day, 'pm', v), pmBad, canEdit)}
                    </td>
                    <td>
                      {textCell(
                        r.pmi,
                        v => setCell(day, 'pmi', v),
                        canEdit,
                        'init',
                      )}
                    </td>
                    <td>
                      {textCell(
                        r.note,
                        v => setCell(day, 'note', v),
                        canEdit,
                        'note',
                        amBad || pmBad
                          ? 'Out-of-compliance — record corrective action'
                          : '',
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <SaveBar
        saved={saved}
        saveError={saveError}
        savedAt={savedAt}
        onSave={() => save()}
        canEdit={canEdit}
        note={
          <span className="formbar-meta">
            {app.name} · {MONTHS[m]} {y}
          </span>
        }
      />
    </div>
  );
}

function SanitizerLog({
  period,
  setPeriod,
  canEdit,
}: SubTabProps) {
  const [m, y] = period;
  const title = `sanit:${y}-${m}`;
  const ndays = daysInMonth(m, y);
  const { data, update, saved, save, savedAt, saveError, loadError } = useComplianceDoc('sanitizer_log', title, {
    rows: {} as Record<number, SanitRow>,
    conc: 'Oasis 146',
  });
  const rows: Record<number, SanitRow> = (data as any).rows ?? {};

  function setCell(day: number, field: string, val: string) {
    update(d => {
      const dd = d as any;
      return {
        ...dd,
        rows: {
          ...dd.rows,
          [day]: { ...(dd.rows?.[day] || {}), [field]: val },
        },
      };
    });
  }

  function flagPpm(v: string | undefined) {
    if (v == null || v === '') return false;
    const n = parseFloat(v);
    return isNaN(n) || n < 150 || n > 400;
  }

  const viol = Object.values(rows).filter(
    r => flagPpm(r.am) || flagPpm(r.pm),
  ).length;

  return (
    <div>
      <div className="form-toolbar">
        <div className="ft-l">
          <span className="thresh-chip rfg">
            {I.droplet({ style: { width: 13, height: 13 } })} {(data as any).conc}: 150–400 ppm
          </span>
        </div>
        <MonthNav period={period} setPeriod={setPeriod} />
      </div>
      <div className="form-note">
        Complete <b>twice daily</b> (AM / PM) for sample testing — a
        single prep site (e.g. third-compartment pot sink) is recommended. One
        form per month.
        {viol > 0 && (
          <StatusPill warn style={{ marginLeft: 'auto' }}>
            {I.alert({ style: { width: 13, height: 13 } })} {viol} out-of-range
          </StatusPill>
        )}
      </div>
      {loadError && (
        <div className="form-note" style={{ color: 'var(--red, #dc2626)', fontWeight: 700 }}>
          {I.alert({ style: { width: 13, height: 13 } })} Could not load saved data: {loadError}
        </div>
      )}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="tbl-wrap">
          <table className="data logtbl">
            <thead>
              <tr>
                <th style={{ width: 54 }}>Date</th>
                <th>Area / corrective action</th>
                <th className="r" style={{ width: 84 }}>
                  AM ppm
                </th>
                <th style={{ width: 70 }}>Init</th>
                <th className="r" style={{ width: 84 }}>
                  PM ppm
                </th>
                <th style={{ width: 70 }}>Init</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: ndays }, (_, i) => i + 1).map(day => {
                const r = rows[day] || {};
                const amBad = flagPpm(r.am);
                const pmBad = flagPpm(r.pm);
                return (
                  <tr key={day} className={amBad || pmBad ? 'row-low' : ''}>
                    <td className="num">
                      <b>{day}</b>
                    </td>
                    <td>
                      {textCell(
                        r.area,
                        v => setCell(day, 'area', v),
                        canEdit,
                        'note',
                      )}
                    </td>
                    <td className="r">
                      {tempCell(r.am, v => setCell(day, 'am', v), amBad, canEdit)}
                    </td>
                    <td>
                      {textCell(
                        r.ami,
                        v => setCell(day, 'ami', v),
                        canEdit,
                        'init',
                      )}
                    </td>
                    <td className="r">
                      {tempCell(r.pm, v => setCell(day, 'pm', v), pmBad, canEdit)}
                    </td>
                    <td>
                      {textCell(
                        r.pmi,
                        v => setCell(day, 'pmi', v),
                        canEdit,
                        'init',
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <SaveBar
        saved={saved}
        saveError={saveError}
        savedAt={savedAt}
        onSave={() => save()}
        canEdit={canEdit}
        note={
          <span className="formbar-meta">
            Sanitizer · {MONTHS[m]} {y}
          </span>
        }
      />
    </div>
  );
}

function TastePanel({
  period: _period,
  canEdit,
}: SubTabProps) {
  const today = new Date().toISOString().slice(0, 10);
  const title = `taste:${today}`;

  function blankTaste(): TasteItem {
    return {
      id: 't' + Math.random().toString(36).slice(2, 7),
      product: '',
      temp: '',
      code: '',
      notes: '',
    };
  }

  const { data, update, saved, save, savedAt, saveError, loadError } = useComplianceDoc('taste_panel', title, {
    items: [blankTaste()],
  });
  const items: TasteItem[] = (data as any).items ?? [];

  function setItem(id: string, field: string, val: string) {
    update(d => {
      const dd = d as any;
      return {
        ...dd,
        items: dd.items.map((it: TasteItem) =>
          it.id === id ? { ...it, [field]: val } : it,
        ),
      };
    });
  }

  function addItem() {
    update(d => {
      const dd = d as any;
      return { ...dd, items: [...dd.items, blankTaste()] };
    });
  }

  function delItem(id: string) {
    update(d => {
      const dd = d as any;
      return { ...dd, items: dd.items.filter((it: TasteItem) => it.id !== id) };
    });
  }

  return (
    <div>
      <div
        className="grid-2"
        style={{ gridTemplateColumns: '1.4fr 1fr', marginBottom: 14 }}
      >
        <div className="card">
          <div className="card-head">
            <h3>Minimum internal cooking temperatures</h3>
          </div>
          <div className="card-body flush tbl-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Temp</th>
                  <th>Hold</th>
                  <th>Foods</th>
                </tr>
              </thead>
              <tbody>
                {COOKING_TEMPS.map((t, i) => (
                  <tr key={i}>
                    <td
                      className="num"
                      style={{
                        fontWeight: 800,
                        color: 'var(--red)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {t.temp}
                    </td>
                    <td className="num" style={{ whiteSpace: 'nowrap' }}>
                      {t.hold}
                    </td>
                    <td style={{ fontSize: 11.5 }}>{t.foods}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <div className="card-head">
            <h3>Taste panel evaluation codes</h3>
          </div>
          <div
            className="card-body"
            style={{ display: 'flex', flexDirection: 'column', gap: 9 }}
          >
            {TASTE_CODES.map(c => (
              <div
                key={c.code}
                className="tastecode"
                style={{ background: c.bg }}
              >
                <span className="tc-badge" style={{ background: c.tint }}>
                  {c.code}
                </span>
                <span
                  style={{ color: c.tint, fontWeight: 700, fontSize: 12.5 }}
                >
                  {c.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {loadError && (
        <div className="form-note" style={{ color: 'var(--red, #dc2626)', fontWeight: 700 }}>
          {I.alert({ style: { width: 13, height: 13 } })} Could not load saved data: {loadError}
        </div>
      )}

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head">
          <h3>
            Today’s taste panel —{' '}
            {new Date().toLocaleDateString()}
          </h3>
          {canEdit && (
            <button className="btn-addrow" onClick={addItem}>
              {I.plus({ style: { width: 13, height: 13 } })} Add item
            </button>
          )}
        </div>
        <div className="card-body flush tbl-wrap">
          <table className="data logtbl">
            <thead>
              <tr>
                <th>Menu item</th>
                <th className="r" style={{ width: 96 }}>
                  Internal °F
                </th>
                <th style={{ width: 120 }}>Code</th>
                <th>Notes</th>
                {canEdit && <th></th>}
              </tr>
            </thead>
            <tbody>
              {items.map(it => (
                <tr key={it.id}>
                  <td>
                    {textCell(
                      it.product,
                      v => setItem(it.id, 'product', v),
                      canEdit,
                      'note',
                      'e.g. Baked Chicken',
                    )}
                  </td>
                  <td className="r">
                    {tempCell(
                      it.temp,
                      v => setItem(it.id, 'temp', v),
                      false,
                      canEdit,
                    )}
                  </td>
                  <td>
                    {canEdit ? (
                      <select
                        className="ipt sel sm"
                        value={it.code}
                        onChange={e => setItem(it.id, 'code', e.target.value)}
                      >
                        <option value="">—</option>
                        {TASTE_CODES.map(c => (
                          <option key={c.code} value={c.code}>
                            {c.code} · {c.label.split(' —')[0]}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span>{it.code}</span>
                    )}
                  </td>
                  <td>
                    {textCell(
                      it.notes,
                      v => setItem(it.id, 'notes', v),
                      canEdit,
                      'note',
                    )}
                  </td>
                  {canEdit && (
                    <td>
                      <button
                        className="row-del"
                        onClick={() => delItem(it.id)}
                      >
                        {I.del({ style: { width: 14, height: 14 } })}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <SaveBar
        saved={saved}
        saveError={saveError}
        savedAt={savedAt}
        onSave={() => save()}
        canEdit={canEdit}
        note={
          <span className="formbar-meta">
            Taste panel · {new Date().toLocaleDateString()}
          </span>
        }
      />
    </div>
  );
}

export function ComplianceHub({
  user,
}: {
  user: User;
}) {
  const lvl = ROLE_LEVEL[user.role] || 0;
  const canEdit = lvl >= 10;
  const [tab, setTab] = useState('temp');
  const [period, setPeriod] = useState<[number, number]>(() => {
    const d = new Date();
    return [d.getMonth(), d.getFullYear()];
  });

  const props: SubTabProps = { user, period, setPeriod, canEdit };

  let body: React.ReactNode;
  if (tab === 'temp') body = <TemperatureLog {...props} />;
  else if (tab === 'sanit') body = <SanitizerLog {...props} />;
  else body = <TastePanel {...props} />;

  return (
    <div className="fade-in">
      <div className="page-head">
        <div>
          <h2>Compliance &amp; HACCP Logs</h2>
          <div className="ph-sub">
            Digital temperature, sanitation and food-safety records
          </div>
        </div>
      </div>
      <div className="subtabs">
        {HACCP_TABS.map(t => (
          <button
            key={t.key}
            className="subtab"
            data-on={tab === t.key}
            onClick={() => setTab(t.key)}
          >
            {I[t.icon]({ style: { width: 15, height: 15 } })}
            <span>{t.label}</span>
          </button>
        ))}
      </div>
      {body}
    </div>
  );
}
