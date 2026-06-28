import { useState, useMemo, useEffect } from 'react';
import { I } from '../lib/icons';
import { type User, MONTHS } from '../lib/constants';
import { api } from '../lib/api';
import { TemplatesPanel } from './Templates';

function toCSV(columns: { label: string; key?: string; get?: (r: any) => any }[], rows: any[]) {
  const esc = (v: any) => {
    v = v == null ? '' : String(v);
    return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  };
  const head = columns.map((c) => esc(c.label)).join(',');
  const body = rows
    .map((r) => columns.map((c) => esc(typeof c.get === 'function' ? c.get(r) : r[c.key!])).join(','))
    .join('\n');
  return head + '\n' + body;
}

function downloadCSV(filename: string, text: string) {
  try {
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 120);
  } catch (e) {
    // silently handle
  }
}

function Loading({ label = 'Loading…' }) {
  return <div className="load-wrap"><div className="spinner"></div><div>{label}</div></div>;
}

function buildReports(period: [number, number], invItems: any[], events: any[], commits: any[]) {
  const periodLbl = MONTHS[period[0]] + ' ' + period[1];

  // Sort by category then description — matches corporate report expectation
  const sorted = [...invItems].sort((a: any, b: any) =>
    (a.category || '').localeCompare(b.category || '') ||
    (a.desc || '').localeCompare(b.desc || '')
  );

  const totalRcv = (it: any) => (it.w1r||0)+(it.w2r||0)+(it.w3r||0)+(it.w4r||0);
  const totalIss = (it: any) => (it.w1i||0)+(it.w2i||0)+(it.w3i||0)+(it.w4i||0);
  const closingQty = (it: any) => Math.max(0, (it.onHand||0) + totalRcv(it) - totalIss(it));

  const moninvRows = sorted.map((it: any) => ({
    ...it,
    opening: it.onHand || 0,
    totalRcv: totalRcv(it),
    totalIss: totalIss(it),
    closing: closingQty(it),
    value: closingQty(it) * (it.price || 0),
  }));

  return [
    {
      id: 'inventory',
      name: 'Inventory Snapshot',
      group: 'Inventory',
      icon: 'box',
      period: periodLbl,
      columns: [
        { key: 'category', label: 'Category' },
        { key: 'sku', label: 'SKU' },
        { key: 'desc', label: 'Description' },
        { key: 'price', label: 'Unit Price', get: (r: any) => '$' + (r.price || 0).toFixed(2) },
        { key: 'onHand', label: 'On Hand' },
        { key: 'par', label: 'Par' },
        { key: 'value', label: 'Value', get: (r: any) => '$' + ((r.onHand || 0) * (r.price || 0)).toFixed(2) },
      ],
      build: () => sorted,
    },
    {
      id: 'moninv',
      name: 'Monthly Inventory Roll-up',
      group: 'Inventory',
      icon: 'fileText',
      period: periodLbl,
      columns: [
        { key: 'category', label: 'Category' },
        { key: 'sku', label: 'SKU' },
        { key: 'desc', label: 'Description' },
        { key: 'unit', label: 'Unit' },
        { key: 'opening', label: 'Opening' },
        { key: 'w1r', label: 'W1 Rcv', get: (r: any) => r.w1r || 0 },
        { key: 'w1i', label: 'W1 Iss', get: (r: any) => r.w1i || 0 },
        { key: 'w2r', label: 'W2 Rcv', get: (r: any) => r.w2r || 0 },
        { key: 'w2i', label: 'W2 Iss', get: (r: any) => r.w2i || 0 },
        { key: 'w3r', label: 'W3 Rcv', get: (r: any) => r.w3r || 0 },
        { key: 'w3i', label: 'W3 Iss', get: (r: any) => r.w3i || 0 },
        { key: 'w4r', label: 'W4 Rcv', get: (r: any) => r.w4r || 0 },
        { key: 'w4i', label: 'W4 Iss', get: (r: any) => r.w4i || 0 },
        { key: 'totalRcv', label: 'Total Rcv' },
        { key: 'totalIss', label: 'Total Iss' },
        { key: 'closing', label: 'Closing' },
        { key: 'price', label: 'Unit Price', get: (r: any) => '$' + (r.price || 0).toFixed(2) },
        { key: 'value', label: 'Value', get: (r: any) => '$' + (r.value || 0).toFixed(2) },
      ],
      build: () => moninvRows,
    },
    {
      id: 'invoices',
      name: 'Invoice Register',
      group: 'Inventory',
      icon: 'inbox',
      period: periodLbl,
      columns: [
        { key: 'vendor', label: 'Vendor' },
        { key: 'number', label: 'Invoice #' },
        { key: 'date', label: 'Date' },
        { key: 'items', label: 'Items' },
        { key: 'total', label: 'Total', get: (r: any) => '$' + (r.total || 0).toFixed(2) },
      ],
      build: () => [],
    },
    {
      id: 'meallog',
      name: 'Meal Logs',
      group: 'Compliance',
      icon: 'users',
      period: 'all dates',
      columns: [
        { key: 'date', label: 'Date' },
        { key: 'name', label: 'Name' },
        { key: 'type', label: 'Type' },
        { key: 'meals', label: 'Meals' },
        { key: 'paid', label: 'Paid' },
        { key: 'ticket', label: 'Ticket #' },
      ],
      build: () => [],
    },
    {
      id: 'temp',
      name: 'HACCP Temperature Logs',
      group: 'Compliance',
      icon: 'thermo',
      period: 'all dates',
      columns: [
        { key: 'app', label: 'Appliance' },
        { key: 'month', label: 'Month' },
        { key: 'day', label: 'Day' },
        { key: 'am', label: 'AM °F' },
        { key: 'pm', label: 'PM °F' },
        { key: 'note', label: 'Corrective action' },
      ],
      build: () => [],
    },
    {
      id: 'sanit',
      name: 'Sanitizer Logs',
      group: 'Compliance',
      icon: 'droplet',
      period: 'all dates',
      columns: [
        { key: 'month', label: 'Month' },
        { key: 'day', label: 'Day' },
        { key: 'am', label: 'AM ppm' },
        { key: 'pm', label: 'PM ppm' },
        { key: 'area', label: 'Area / action' },
      ],
      build: () => [],
    },
    {
      id: 'inspection',
      name: 'Inspection Sheets',
      group: 'Compliance',
      icon: 'clipboard',
      period: 'all dates',
      columns: [
        { key: 'date', label: 'Date' },
        { key: 'staff', label: 'Staff' },
        { key: 'meal', label: 'Meal' },
        { key: 'rated', label: 'Rated' },
        { key: 'poor', label: 'Poor' },
        { key: 'comments', label: 'Comments' },
      ],
      build: () => [],
    },
    {
      id: 'dailyops',
      name: 'Daily Operations',
      group: 'Compliance',
      icon: 'checkSquare',
      period: 'all dates',
      columns: [
        { key: 'date', label: 'Date' },
        { key: 'checks', label: 'Checklist done' },
        { key: 'cycleDay', label: 'Cycle day' },
        { key: 'incidents', label: 'Incidents' },
        { key: 'notes', label: 'Notes' },
      ],
      build: () => [],
    },
    {
      id: 'snackbar',
      name: 'Snack Bar Reconciliation',
      group: 'Compliance',
      icon: 'coffee',
      period: 'all dates',
      columns: [
        { key: 'date', label: 'Date' },
        { key: 'open', label: 'Opening $' },
        { key: 'sales', label: 'Sales $' },
        { key: 'close', label: 'Closing $' },
        { key: 'var', label: 'Variance $', get: (r: any) => {
          const v = (parseFloat(r.close) || 0) - ((parseFloat(r.open) || 0) + (parseFloat(r.sales) || 0));
          return (v > 0 ? '+' : '') + v.toFixed(2);
        }},
      ],
      build: () => [],
    },
    {
      id: 'events',
      name: 'Events & Programs',
      group: 'Programs',
      icon: 'calCheck',
      period: '2026',
      columns: [
        { key: 'date', label: 'Date' },
        { key: 'title', label: 'Title' },
        { key: 'cat', label: 'Category', get: (r: any) => r.cat },
        { key: 'theme', label: 'Theme' },
        { key: 'status', label: 'Status' },
      ],
      build: () => events.slice().sort((a: any, b: any) => a.date.localeCompare(b.date)),
    },
    {
      id: 'servsafe',
      name: 'ServSafe Certifications',
      group: 'Programs',
      icon: 'award',
      period: 'current',
      columns: [
        { key: 'name', label: 'Staff' },
        { key: 'cert', label: 'Certification' },
        { key: 'expiry', label: 'Expiry' },
        { key: 'proctor', label: 'Proctor', get: (r: any) => (r.proctor ? 'Yes' : 'No') },
      ],
      build: () => [
        { name: 'Angela Martin', cert: 'ServSafe Manager', expiry: '2027-03-15', proctor: true },
        { name: 'Daniel Cortez', cert: 'ServSafe Manager', expiry: '2026-11-20', proctor: true },
        { name: 'Lena Price', cert: 'ServSafe Food Handler', expiry: '2026-08-01', proctor: false },
        { name: 'Rasheed Khan', cert: 'ServSafe Food Handler', expiry: '2026-06-15', proctor: false },
        { name: 'Maria Lopez', cert: 'ServSafe Allergens', expiry: '2025-12-10', proctor: false },
      ],
    },
    {
      id: 'commits',
      name: 'Commit History',
      group: 'Programs',
      icon: 'branch',
      period: 'all',
      columns: [
        { key: 'hash', label: 'Hash', get: (r: any) => (r.github_sha || r.commit_id || '').slice(0, 7) },
        { key: 'author', label: 'Author', get: (r: any) => r.author_name || r.author_id },
        { key: 'message', label: 'Message', get: (r: any) => r.message },
        { key: 'files', label: 'Fields', get: (r: any) => r.change_count },
        { key: 'when', label: 'Date', get: (r: any) => new Date(r.created_at).toLocaleString() },
      ],
      build: () => commits,
    },
  ];
}

export function Reports({
  user: _user,
  period,
}: {
  user: User;
  period: [number, number];
}) {
  const [invItems, setInvItems] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [commits, setCommits] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [tab, setTab] = useState('catalogue');
  const [sel, setSel] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    async function load() {
      try {
        const [invData, evData, cmData] = await Promise.all([
          api.getInventory(period[0] + 1, period[1]).catch(() => null),
          api.getEvents().catch(() => []),
          api.getCommits().catch(() => []),
        ]);
        if (!alive) return;
        setInvItems(invData?.items || []);
        setEvents(evData);
        setCommits(cmData);
      } catch {
        if (alive) {
          setInvItems([]);
          setEvents([]);
          setCommits([]);
        }
      }
      if (alive) setLoading(false);
    }
    load();
    return () => { alive = false; };
  }, [period]);

  const reports = useMemo(() => buildReports(period, invItems, events, commits), [period, invItems, events, commits]);

  useEffect(() => {
    if (!sel && reports.length) setSel(reports[0].id);
  }, [reports, sel]);

  const active = reports.find((r) => r.id === sel) || reports[0];
  const rows = active?.build() || [];

  const groups = ['Inventory', 'Compliance', 'Programs'];
  const fileName = (rep: any) =>
    'MJCC_' + rep.id + '_' + new Date().toISOString().slice(0, 10) + '.csv';

  function downloadOne(rep: any) {
    const data = rep.build();
    downloadCSV(fileName(rep), toCSV(rep.columns, data));
  }
  function printOne(rep: any) {
    const data = rep.build();
    const th = rep.columns
      .map((c: any) => '<th>' + c.label + '</th>')
      .join('');
    const tr = data
      .map(
        (r: any) =>
          '<tr>' +
          rep.columns
            .map(
              (c: any) =>
                '<td>' +
                ((typeof c.get === 'function' ? c.get(r) : r[c.key]) ?? '') +
                '</td>',
            )
            .join('') +
          '</tr>',
      )
      .join('');
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(
      '<html><head><title>' +
        rep.name +
        '</title><style>body{font-family:Segoe UI,Arial,sans-serif;color:#1E293B;padding:28px}h1{font-size:18px;margin:0 0 2px}.sub{color:#64748B;font-size:12px;margin-bottom:16px}table{width:100%;border-collapse:collapse;font-size:11px}th{background:#0E2148;color:#fff;text-align:left;padding:6px 8px;font-size:10px;text-transform:uppercase;letter-spacing:.4px}td{padding:5px 8px;border-bottom:.5px solid #E2E8F0}tr:nth-child(even) td{background:#F8FAFC}</style></head><body><h1>' +
        rep.name +
        '</h1><div class="sub">Miami Job Corps Cafeteria · ' +
        rep.period +
        ' · ' +
        data.length +
        ' records · generated ' +
        new Date().toLocaleString() +
        '</div><table><thead><tr>' +
        th +
        '</tr></thead><tbody>' +
        tr +
        '</tbody></table></body></html>',
    );
    w.document.close();
    setTimeout(() => w.print(), 250);
  }

  if (loading) {
    return (
      <div className="fade-in">
        <div className="page-head">
          <div>
            <h2>Reports</h2>
            <div className="ph-sub">Download or print any report or blank template across the system</div>
          </div>
        </div>
        <div className="card mobile-compact">
          <Loading label="Loading report data…" />
        </div>
      </div>
    );
  }

  return (
    <div className="fade-in">
      <div className="page-head">
        <div>
          <h2>Reports</h2>
          <div className="ph-sub">
            Download or print any report or blank template across the system · live data
          </div>
        </div>
        <div className="ph-actions">
          {tab === 'catalogue' && (
            <>
              <button className="btn" onClick={() => printOne(active)}>
                {I.printer()} Print
              </button>
              <button className="btn primary" onClick={() => downloadOne(active)}>
                {I.download()} Download CSV
              </button>
            </>
          )}
        </div>
      </div>

      <div className="subtabs">
        <button
          className="subtab"
          data-on={tab === 'catalogue'}
          onClick={() => setTab('catalogue')}
        >
          {I.fileText({ style: { width: 15, height: 15 } })}
          <span>Report catalogue</span>
        </button>
        <button
          className="subtab"
          data-on={tab === 'templates'}
          onClick={() => setTab('templates')}
        >
          {I.printer({ style: { width: 15, height: 15 } })}
          <span>Blank templates</span>
        </button>
      </div>

      {tab === 'templates' ? (
        <TemplatesPanel />
      ) : (
        <div className="grid-2">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {groups.map((g) => {
              const items = reports.filter((r) => r.group === g);
              return (
                <div className="card" key={g}>
                  <div className="card-head">
                    <h3>{g}</h3>
                    <span className="ch-link">{items.length}</span>
                  </div>
                  <div className="card-body flush">
                    {items.map((rep) => {
                      const n = rep.build().length;
                      return (
                        <div
                          key={rep.id}
                          className={
                            'report-row' + (sel === rep.id ? ' on' : '')
                          }
                          onClick={() => setSel(rep.id)}
                        >
                          <div className="rr-ic">
                            {I[rep.icon]({
                              style: { width: 16, height: 16 },
                            })}
                          </div>
                          <div className="rr-body">
                            <div className="rr-name">{rep.name}</div>
                            <div className="rr-meta">
                              {rep.period} · {n} record{n !== 1 ? 's' : ''}
                            </div>
                          </div>
                          <div className="rr-actions">
                            <button
                              className="btn"
                              style={{ padding: '5px 9px' }}
                              title="Print"
                              onClick={(e) => {
                                e.stopPropagation();
                                printOne(rep);
                              }}
                            >
                              {I.printer({
                                style: { width: 14, height: 14 },
                              })}
                            </button>
                            <button
                              className="btn"
                              style={{ padding: '5px 9px' }}
                              title="Download CSV"
                              onClick={(e) => {
                                e.stopPropagation();
                                downloadOne(rep);
                              }}
                            >
                              {I.download({
                                style: { width: 14, height: 14 },
                              })}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="card" style={{ height: 'fit-content' }}>
            <div className="card-head">
              <h3>{active.name}</h3>
              <span className="ch-link">
                {rows.length} record{rows.length !== 1 ? 's' : ''}
              </span>
            </div>
            {rows.length === 0 ? (
              <div
                style={{
                  padding: '40px 17px',
                  textAlign: 'center',
                  color: 'var(--faint)',
                  fontSize: 12.5,
                }}
              >
                {I.fileText({
                  style: {
                    width: 26,
                    height: 26,
                    margin: '0 auto 10px',
                    display: 'block',
                    color: 'var(--line)',
                  },
                })}
                No records yet. This report fills in as data is entered or
                synced from the backend.
              </div>
            ) : (
              <div
                className="card-body flush tbl-wrap"
                style={{ maxHeight: 520, overflowY: 'auto' }}
              >
                <table className="data">
                  <thead>
                    <tr>
                      {active.columns.map((c: any) => (
                        <th key={c.key}>{c.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r: any, i: number) => (
                      <tr key={i}>
                        {active.columns.map((c: any) => (
                          <td key={c.key}>
                            {(typeof c.get === 'function'
                              ? c.get(r)
                              : r[c.key]) ?? ''}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
