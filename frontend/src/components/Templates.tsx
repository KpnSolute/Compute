import { I } from '../lib/icons';
import { DS } from '../lib/services';
import { INSPECTION_Q, FOODREQ_FIELDS } from '../lib/constants';

function buildTemplates() {
  return [
    {
      id: 'temp',
      kind: 'table',
      name: 'HACCP Temperature Log',
      group: 'HACCP',
      icon: 'thermo',
      desc: 'Twice-daily AM/PM appliance temperatures with corrective actions.',
      note:
        'Refrigerators ≤ 41°F · Freezers ≤ 0°F · record twice daily · keep on file one year.',
      columns: [
        'Date',
        'Appliance',
        'Temp °F (AM)',
        'Init',
        'Temp °F (PM)',
        'Init',
        'Corrective action / date reported',
      ],
      rows: 20,
    },
    {
      id: 'sanit',
      kind: 'table',
      name: 'Sanitizer Solution Log',
      group: 'HACCP',
      icon: 'droplet',
      desc: 'AM/PM sanitizer concentration test at the prep sink.',
      note:
        'Quaternary sanitizer 150–400 ppm · complete twice daily · one form per month.',
      columns: ['Date', 'Area / corrective action', 'AM ppm', 'Init', 'PM ppm', 'Init'],
      rows: 20,
    },
    {
      id: 'machine',
      kind: 'table',
      name: 'Warewashing Machine Temp Log',
      group: 'HACCP',
      icon: 'settings',
      desc: 'Dish-machine wash / rinse / final temps & sanitizer ppm.',
      note:
        'Low-temp chemical sanitizer 50–100 ppm · flow 15–25 psi · one reading per meal period.',
      columns: [
        'Date',
        'Time',
        'Meal',
        'Wash °F',
        'Rinse °F',
        'PSI',
        'Final °F',
        'Sanitizer ppm',
        'Init',
      ],
      rows: 18,
    },
    {
      id: 'cooling',
      kind: 'table',
      name: 'Cooling & Reheating Chart',
      group: 'HACCP',
      icon: 'snow',
      desc: 'Time / temperature log for potentially hazardous foods.',
      note:
        '140°F → 70°F ≤ 2h, → 40°F ≤ 6h total · reheat for hot holding to 165°F.',
      columns: [
        'Date',
        'Product',
        'Qty',
        'Start',
        'Temp @2h',
        'Final @6h',
        'Reheat date',
        'Internal °F',
        'Init',
      ],
      rows: 14,
    },
    {
      id: 'meallog',
      kind: 'table',
      name: 'Daily Meal Log',
      group: 'Operations',
      icon: 'users',
      desc: 'Staff & visitor meal sign-in sheet.',
      note:
        'All staff and visitors must sign · dining-hall monitors are not charged for the meal they monitor.',
      columns: [
        '#',
        'Name (please print)',
        'Signature / initials',
        'Type (S/V/M/C)',
        'B',
        'L',
        'D',
        'Ticket #',
      ],
      rows: 25,
      numbered: true,
    },
    {
      id: 'snackbar',
      kind: 'table',
      name: 'Snack Bar Reconciliation',
      group: 'Operations',
      icon: 'coffee',
      desc: 'Daily cash-drawer reconciliation.',
      note:
        'Escort cash to Finance with Safety & Security staff · never transport receipts alone.',
      columns: [
        'Date',
        'Opening cash $',
        'Sales $',
        'Closing cash $',
        'Variance $',
        'Initials',
      ],
      rows: 16,
    },
    {
      id: 'dailyops',
      kind: 'checklist',
      name: 'Daily Opening Checklist',
      group: 'Operations',
      icon: 'checkSquare',
      desc: 'Morning opening tasks, meal schedule & incident lines.',
      note: 'Complete before first meal service · initial each item.',
      items: () => DS.openingChecklist(),
      schedule: () => DS.mealSchedule(),
    },
    {
      id: 'inspection',
      kind: 'rating',
      name: 'Food Services Inspection Sheet',
      group: 'Inspections',
      icon: 'clipboard',
      desc: 'Rate each category GOOD / FAIR / POOR; explain any poor rating.',
      note: 'Turn completed paper copy in to the Food Services Manager.',
      questions: () => INSPECTION_Q,
    },
    {
      id: 'foodreq',
      kind: 'form',
      name: 'Food Request Form',
      group: 'Inspections',
      icon: 'inbox',
      desc: 'Dining Hall / Culinary Arts support request with approvals.',
      note:
        'Submit at least 10 days before the event (2 days for off-Center sack lunches).',
      fields: () => FOODREQ_FIELDS,
    },
  ];
}

const TPL_PRINT_CSS = `
  *{box-sizing:border-box}
  body{font-family:Segoe UI,Arial,sans-serif;color:#181816;padding:26px 28px;margin:0}
  .th{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #181816;padding-bottom:10px;margin-bottom:6px}
  .th h1{font-size:18px;margin:0;letter-spacing:-.2px}
  .th .org{font-size:11px;color:#555;margin-top:3px}
  .th .meta{font-size:10px;color:#555;text-align:right;line-height:1.7}
  .note{font-size:10.5px;color:#7a4800;background:#fef3cd;border-radius:6px;padding:7px 10px;margin:10px 0 14px}
  table{width:100%;border-collapse:collapse;font-size:11px}
  th{background:#0E2148;color:#fff;text-align:left;padding:6px 8px;font-size:9.5px;text-transform:uppercase;letter-spacing:.4px;border:.5px solid #0E2148}
  td{border:.5px solid #bbb;height:26px;padding:3px 8px}
  ul{list-style:none;padding:0;margin:0}
  li{display:flex;align-items:center;gap:10px;padding:8px 2px;border-bottom:.5px solid #ddd;font-size:12px}
  .box{width:15px;height:15px;border:1.5px solid #181816;border-radius:3px;flex-shrink:0}
  .rate{display:flex;gap:6px;margin-left:auto}
  .rate span{border:1px solid #999;border-radius:5px;padding:2px 9px;font-size:9px;font-weight:700;letter-spacing:.3px}
  .q{display:flex;align-items:center;gap:12px;padding:9px 2px;border-bottom:.5px solid #ddd;font-size:11.5px}
  .q .n{width:20px;height:20px;border:1px solid #999;border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;flex-shrink:0}
  .fld{margin-bottom:14px}
  .fld label{display:block;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:#555;margin-bottom:8px}
  .fld .line{border-bottom:1px solid #181816;height:20px}
  .grid{display:grid;grid-template-columns:repeat(12,1fr);gap:12px}
  .sig{display:grid;grid-template-columns:1fr 1fr;gap:30px;margin-top:26px}
  .sig .l{border-top:1px solid #181816;padding-top:5px;font-size:10px;color:#555;margin-top:34px}
  .sub{font-size:11px;color:#555;margin:14px 0 4px;font-weight:700}
`;

function tplDocBody(tpl: any) {
  const header =
    '<div class="th"><div><h1>' +
    tpl.name +
    '</h1><div class="org">Miami Job Corps Cafeteria — Food Services</div></div>' +
    '<div class="meta">Month / Year: ____________<br>Completed by: ____________<br>Reviewed: ____________</div></div>' +
    (tpl.note ? '<div class="note">' + tpl.note + '</div>' : '');
  let body = '';
  if (tpl.kind === 'table') {
    const th = tpl.columns.map((c: string) => '<th>' + c + '</th>').join('');
    let tr = '';
    for (let i = 0; i < tpl.rows; i++) {
      tr +=
        '<tr>' +
        tpl.columns
          .map((_c: string, ci: number) =>
            tpl.numbered && ci === 0 ? '<td>' + (i + 1) + '</td>' : '<td></td>',
          )
          .join('') +
        '</tr>';
    }
    body = '<table><thead><tr>' + th + '</tr></thead><tbody>' + tr + '</tbody></table>';
  } else if (tpl.kind === 'checklist') {
    const items = tpl.items();
    body =
      '<ul>' +
      items
        .map(
          (it: string) =>
            '<li><span class="box"></span> ' +
            it +
            ' <span style="margin-left:auto;color:#999;font-size:10px">Init ____</span></li>',
        )
        .join('') +
      '</ul>';
    const sch = tpl.schedule();
    body +=
      '<div class="sub">Meal schedule</div><table><thead><tr><th>Meal</th><th>Hours</th><th>Lead monitor</th><th>Status</th></tr></thead><tbody>' +
      sch
        .map(
          (s: any) =>
            '<tr><td>' +
            s.meal +
            '</td><td>' +
            s.hours +
            '</td><td>' +
            s.monitor +
            '</td><td></td></tr>',
        )
        .join('') +
      '</tbody></table>';
    body +=
      '<div class="sub">Incident log</div><table><thead><tr><th>Time</th><th>Type</th><th>Details</th><th>Init</th></tr></thead><tbody>' +
      Array.from({ length: 4 })
        .map(() => '<tr><td></td><td></td><td></td><td></td></tr>')
        .join('') +
      '</tbody></table>';
  } else if (tpl.kind === 'rating') {
    const qs = tpl.questions();
    body = qs
      .map(
        (q: string, i: number) =>
          '<div class="q"><span class="n">' +
          (i + 1) +
          '</span><span>' +
          q +
          '</span><span class="rate"><span>GOOD</span><span>FAIR</span><span>POOR</span></span></div>',
      )
      .join('');
    body +=
      '<div class="sub">Comments &amp; recommendations</div><div style="border:.5px solid #bbb;border-radius:6px;height:90px"></div>';
  } else if (tpl.kind === 'form') {
    const fs = tpl.fields();
    body =
      '<div class="grid">' +
      fs
        .map(
          (f: any) =>
            '<div class="fld" style="grid-column:span ' +
            (f.col || 12) +
            '"><label>' +
            f.label +
            '</label><div class="line"' +
            (f.type === 'textarea' ? ' style="height:48px"' : '') +
            '></div></div>',
        )
        .join('') +
      '</div>';
    body +=
      '<div class="sig"><div class="l">Department Manager / Director</div><div class="l">F&amp;A Director</div></div>';
  }
  return header + body;
}

function tplPrint(tpl: any) {
  const w = window.open('', '_blank');
  if (!w) {
    (window as any).toast?.('Allow pop-ups to print');
    return;
  }
  w.document.write(
    '<html><head><title>' +
      tpl.name +
      '</title><style>' +
      TPL_PRINT_CSS +
      '</style></head><body>' +
      tplDocBody(tpl) +
      '</body></html>',
  );
  w.document.close();
  setTimeout(() => w.print(), 250);
}

function tplPrintAll() {
  const all = buildTemplates();
  const w = window.open('', '_blank');
  if (!w) {
    (window as any).toast?.('Allow pop-ups to print');
    return;
  }
  const body = all
    .map(
      (t, i) =>
        '<section' +
        (i < all.length - 1 ? ' style="page-break-after:always"' : '') +
        '>' +
        tplDocBody(t) +
        '</section>',
    )
    .join('');
  w.document.write(
    '<html><head><title>MJCC Food Services — Blank Forms</title><style>' +
      TPL_PRINT_CSS +
      '</style></head><body>' +
      body +
      '</body></html>',
  );
  w.document.close();
  setTimeout(() => w.print(), 300);
}

function tplCSV(tpl: any) {
  let cols: string[], rows: any[][];
  if (tpl.kind === 'table') {
    cols = tpl.columns;
    rows = Array.from({ length: tpl.rows }, (_: any, i: number) =>
      tpl.numbered ? [i + 1] : [],
    );
  } else if (tpl.kind === 'checklist') {
    cols = ['Task', 'Done (Y/N)', 'Initials', 'Notes'];
    rows = tpl.items().map((it: string) => [it]);
  } else if (tpl.kind === 'rating') {
    cols = ['#', 'Category', 'Rating (GOOD/FAIR/POOR)', 'Comments'];
    rows = tpl.questions().map((q: string, i: number) => [i + 1, q]);
  } else {
    cols = ['Field', 'Value'];
    rows = tpl.fields().map((f: any) => [f.label]);
  }
  const esc = (v: any) => {
    v = v == null ? '' : String(v);
    return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  };
  const csv =
    cols.map(esc).join(',') +
    '\n' +
    rows
      .map((r) => cols.map((_, ci) => esc(r[ci] ?? '')).join(','))
      .join('\n');
  DS.download('MJCC_template_' + tpl.id + '.csv', csv);
}

export function TemplatesPanel() {
  const templates = buildTemplates();
  const groups = ['HACCP', 'Operations', 'Inspections'];

  function downloadAll() {
    templates.forEach((t, i) => setTimeout(() => tplCSV(t), i * 150));
  }

  return (
    <div>
      <div className="tpl-bar">
        <div className="form-note" style={{ margin: 0, flex: 1 }}>
          {I.printer({ style: { width: 14, height: 14 } })}
          <span>
            Blank, ready-to-print versions of every SOP log. <b>Print</b> for a
            paper sheet (or Save as PDF); <b>CSV</b> for a spreadsheet template.
          </span>
        </div>
        <div className="tpl-bar-actions">
          <button className="btn" onClick={downloadAll}>
            {I.download()} Download all (CSV)
          </button>
          <button className="btn primary" onClick={tplPrintAll}>
            {I.printer()} Print all forms
          </button>
        </div>
      </div>
      {groups.map((g) => {
        const items = templates.filter((t) => t.group === g);
        return (
          <div key={g} style={{ marginBottom: 20 }}>
            <div className="tpl-group-lbl">{g} logs</div>
            <div className="tpl-grid">
              {items.map((tpl) => (
                <div className="tpl-card" key={tpl.id}>
                  <div className="tpl-top">
                    <div className="tpl-ic">
                      {I[tpl.icon]({ style: { width: 18, height: 18 } })}
                    </div>
                    <span className="tpl-tag">Blank form</span>
                  </div>
                  <div className="tpl-name">{tpl.name}</div>
                  <div className="tpl-desc">{tpl.desc}</div>
                  <div className="tpl-actions">
                    <button className="btn" onClick={() => tplPrint(tpl)}>
                      {I.printer({ style: { width: 14, height: 14 } })} Print
                    </button>
                    <button className="btn primary" onClick={() => tplCSV(tpl)}>
                      {I.download({ style: { width: 14, height: 14 } })} CSV
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export { TemplatesPanel as Templates };
