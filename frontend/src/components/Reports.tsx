import { useState, useMemo, useEffect, useRef } from 'react';
import { I } from '../lib/icons';
import { type User, MONTHS, ROLE_LEVEL, MEAL_LOG_TYPES } from '../lib/constants';
import { api, type PublicMenuCycle } from '../lib/api';
import { itemTotals } from '../lib/inventoryFormulas';
import { TemplatesPanel } from './Templates';
import { StatusPill } from './ui/StatusPill';
import { cycleDayForDate, PERIOD_ORDER, SIDE_SLOTS, shortSideLabel } from './CycleMenu';

type ReportColumn = { label: string; key?: string; get?: (r: any) => any };
type ReviewCellType = 'text' | 'number' | 'money';
type ReviewSection = { title: string; columns: string[]; columnTypes: ReviewCellType[]; rows: any[][] };

// Internal metadata keys the backend stores for weekly_invoice_totals.source —
// a manager should never see the raw key, only a readable label.
const SOURCE_LABELS: Record<string, string> = {
  review_weekly_invoice_totals: 'Workbook Review tab',
  manager_entered: 'Manager entered',
  monthly_snapshots: 'Monthly snapshot (legacy)',
};
function friendlySourceLabel(source: string | undefined | null): string {
  if (!source) return '';
  return SOURCE_LABELS[source] || source;
}
function reviewCell(value: any, type: ReviewCellType): string {
  if (type === 'money') return fmtMoney(num(value));
  if (type === 'number') return typeof value === 'number' ? fmtNumber(value) : String(value ?? '');
  return String(value ?? '');
}

function csvEscape(v: any) {
  v = v == null ? '' : String(v);
  return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

function rowsToCSV(rows: any[][]) {
  return rows.map((row) => row.map(csvEscape).join(',')).join('\n');
}

function toCSV(columns: ReportColumn[], rows: any[]) {
  const head = columns.map((c) => csvEscape(c.label)).join(',');
  const body = rows
    .map((r) => columns.map((c) => csvEscape(typeof c.get === 'function' ? c.get(r) : r[c.key!])).join(','))
    .join('\n');
  return head + '\n' + body;
}

function htmlEscape(v: any) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

const num = (v: any) => Number.isFinite(Number(v)) ? Number(v) : 0;
const itemDesc = (it: any) => String(it.desc || it.description || it.item_description || it.name || it.sku || '');
const itemCat = (it: any) => String(it.category || it.cat || it.category_name || 'Uncategorized');
const itemUnit = (it: any) => String(it.unit || it.uom || it.unit_of_measure || '-');
const itemPar = (it: any) => num(it.par ?? it.par_level ?? it.parLevel);
const itemPrice = (it: any) => num(it.price ?? it.unit_price);
const itemOpeningValue = (it: any) => num(it.openingValue ?? it.opening_value);
const itemReceivedValue = (it: any) => num(it.receivedValue ?? it.received_value);
const itemPulledValue = (it: any) => num(it.pulledValue ?? it.pulled_value);
const itemEndingValue = (it: any) => num(it.endingValue ?? it.ending_value ?? it.value);
const fmtMoney = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtNumber = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });
const paidMealLogTypes = new Set(MEAL_LOG_TYPES.filter((type) => type.paid).map((type) => type.key));

function weeklyInvoiceSchedule(metadata: any) {
  const totals = metadata?.weekly_invoice_totals;
  const weeks = totals?.weeks && typeof totals.weeks === 'object' ? totals.weeks : null;
  if (!weeks) return null;
  const normalized = [1, 2, 3, 4, 5]
    .map((week) => ({ week, value: num(weeks[String(week)] ?? weeks[week]) }))
    .filter((row) => row.value > 0);
  if (!normalized.length) return null;
  const notes = totals.notes && typeof totals.notes === 'object' ? totals.notes : {};
  return {
    weeks: normalized,
    total: num(totals.total) || normalized.reduce((sum, row) => sum + row.value, 0),
    source: totals.source || 'monthly_snapshots',
    noteFor: (week: number) => String(notes[String(week)] ?? notes[week] ?? '').trim(),
  };
}

function metadataMoneyTotals(metadata: any) {
  const invoiceSchedule = weeklyInvoiceSchedule(metadata);
  return {
    opening: num(metadata?.opening_value),
    received: invoiceSchedule?.total ?? num(metadata?.received_value),
    pulled: num(metadata?.pulled_value),
    closing: num(metadata?.closing_value),
  };
}

function csvValue(v: number, money = false) {
  return money ? Number(v.toFixed(2)) : Number.isInteger(v) ? v : Number(v.toFixed(2));
}

function categorySummaryRows(rows: any[]) {
  const order = ['Dairy', 'Cereal', 'Beverages', 'Snacks', 'Meats', 'Frozen Food', 'Dry Goods', 'Produce', 'Disposables'];
  const seen = new Set(order);
  rows.forEach((row) => {
    const cat = itemCat(row);
    if (!seen.has(cat)) {
      seen.add(cat);
      order.push(cat);
    }
  });
  return order
    .map((cat) => {
      const catRows = rows.filter((row) => itemCat(row) === cat);
      return [
        cat,
        catRows.length,
        catRows.reduce((s, r) => s + num(r.opening), 0),
        catRows.reduce((s, r) => s + num(r.totalRcv), 0),
        catRows.reduce((s, r) => s + num(r.totalIss), 0),
        catRows.reduce((s, r) => s + num(r.closing), 0),
        csvValue(catRows.reduce((s, r) => s + itemOpeningValue(r), 0), true),
        csvValue(catRows.reduce((s, r) => s + itemReceivedValue(r), 0), true),
        csvValue(catRows.reduce((s, r) => s + itemPulledValue(r), 0), true),
        csvValue(catRows.reduce((s, r) => s + itemEndingValue(r), 0), true),
      ];
    })
    .filter((row) => Number(row[1]) > 0);
}

function buildMonthlyReviewSections(periodLabel: string, rows: any[], metadata: any): ReviewSection[] {
  const metaTotals = metadataMoneyTotals(metadata);
  const invoiceSchedule = weeklyInvoiceSchedule(metadata);
  const openingQty = rows.reduce((s, r) => s + num(r.opening), 0);
  const receivedQty = rows.reduce((s, r) => s + num(r.totalRcv), 0);
  const pulledQty = rows.reduce((s, r) => s + num(r.totalIss), 0);
  const endingQty = rows.reduce((s, r) => s + num(r.closing), 0);
  const tempItems = rows.filter((r) => String(r.sku || '').toUpperCase().startsWith('TEMP')).length;
  const invoiceTotal = invoiceSchedule?.total ?? 0;
  const categoryRows = categorySummaryRows(rows);
  const categoryTotal = [
    'TOTAL',
    categoryRows.reduce((s, r) => s + num(r[1]), 0),
    categoryRows.reduce((s, r) => s + num(r[2]), 0),
    categoryRows.reduce((s, r) => s + num(r[3]), 0),
    categoryRows.reduce((s, r) => s + num(r[4]), 0),
    categoryRows.reduce((s, r) => s + num(r[5]), 0),
    csvValue(categoryRows.reduce((s, r) => s + num(r[6]), 0), true),
    csvValue(categoryRows.reduce((s, r) => s + num(r[7]), 0), true),
    csvValue(categoryRows.reduce((s, r) => s + num(r[8]), 0), true),
    csvValue(categoryRows.reduce((s, r) => s + num(r[9]), 0), true),
  ];

  const weekSource = (week: number) =>
    invoiceSchedule?.noteFor(week) || friendlySourceLabel(invoiceSchedule?.source);

  return [
    {
      title: `${periodLabel} Inventory Review`,
      columns: ['Quantity Control', 'Verified Total', '', 'Financial Control', 'Verified Amount'],
      columnTypes: ['text', 'number', 'text', 'text', 'money'],
      rows: [
        ['Inventory Items', rows.length, '', 'Opening Inventory Value', csvValue(metaTotals.opening, true)],
        ['Invoice SKUs', rows.length - tempItems, '', 'Product Receipt Value', csvValue(num(metadata?.received_value), true)],
        ['Opening/Temp Items', tempItems, '', 'Net Invoice / Receipt Value', csvValue(num(metadata?.received_value), true)],
        ['Opening OH', openingQty, '', 'Credits & Surcharge Net', 0],
        ['Total Received', receivedQty, '', 'Ending Inventory Value', csvValue(metaTotals.closing, true)],
        ['Total Pulled', pulledQty, '', 'Inventory Flow Value', csvValue(metaTotals.pulled, true)],
        ['Ending OH', endingQty, '', 'Ending Difference Check', csvValue(metaTotals.opening + num(metadata?.received_value) - metaTotals.closing - metaTotals.pulled, true)],
        ['Negative Ending Rows', rows.filter((r) => num(r.closing) < 0).length, '', '', ''],
      ],
    },
    {
      title: 'Weekly Invoice Totals (Product Value, Excl. Tax)',
      columns: ['Metric', 'Verified Amount', 'Source'],
      columnTypes: ['text', 'money', 'text'],
      rows: [
        ['Week 1 Invoice Total', csvValue(invoiceSchedule?.weeks.find((w) => w.week === 1)?.value ?? 0, true), weekSource(1)],
        ['Week 2 Invoice Total', csvValue(invoiceSchedule?.weeks.find((w) => w.week === 2)?.value ?? 0, true), weekSource(2)],
        ['Week 3 Invoice Total', csvValue(invoiceSchedule?.weeks.find((w) => w.week === 3)?.value ?? 0, true), weekSource(3)],
        ['Total Invoice Value (Wk1+Wk2+Wk3)', csvValue(invoiceTotal, true), ''],
        ['Variance vs. Catalog-Priced Receipt Value', csvValue(num(metadata?.received_value) - invoiceTotal, true), 'Product Receipt Value minus invoice total'],
      ],
    },
    // Same data model as the live Invoice register: goods (valuation) vs
    // payable (net) per week, with the explained bridge and residual status.
    ...(metadata?.weekly_reconciliation
      ? [{
          title: 'Invoice Register Reconciliation (Goods vs Payable)',
          columns: ['Week', 'Goods Subtotal', 'GPO Discount', 'Fuel', 'Tax', 'Payable (Net)', 'Invoices', 'Line Items', 'Residual', 'Status'],
          columnTypes: ['text', 'money', 'money', 'money', 'money', 'money', 'number', 'number', 'money', 'text'] as ReviewCellType[],
          rows: Object.entries(metadata.weekly_reconciliation as Record<string, any>)
            .sort(([a], [b]) => Number(a) - Number(b))
            .map(([wk, r]: [string, any]) => [
              `Week ${wk}`,
              csvValue(num(r.register_goods ?? r.headline_goods), true),
              csvValue(num(r.vizient_discount), true),
              csvValue(num(r.fuel_surcharge), true),
              csvValue(num(r.tax), true),
              csvValue(num(r.register_net), true),
              num(r.invoice_count),
              num(r.line_item_count),
              csvValue(num(r.residual), true),
              r.reconciled ? 'RECONCILED' : 'REVIEW REQUIRED',
            ]),
        }]
      : []),
    {
      title: 'Category Summary',
      columns: ['Category', 'Items', 'Opening OH', 'Received', 'Pulled', 'Ending OH', 'Opening Value', 'Received Value', 'Inventory Flow Value', 'Ending Value'],
      columnTypes: ['text', 'number', 'number', 'number', 'number', 'number', 'money', 'money', 'money', 'money'],
      rows: [...categoryRows, categoryTotal],
    },
    {
      title: 'Review Detail',
      columns: ['Category', 'SKU', 'Description', 'Opening OH', 'Opening Unit Cost', 'Opening Value', 'Total Received', 'Received Value', 'Total Pulled', 'Ending OH', 'Ending Value', 'Inventory Flow Value', 'Status'],
      columnTypes: ['text', 'text', 'text', 'number', 'money', 'money', 'number', 'money', 'number', 'number', 'money', 'money', 'text'],
      rows: rows.map((r) => [
        itemCat(r),
        r.sku || '',
        itemDesc(r),
        num(r.opening),
        csvValue(num(r.openingUnitCost ?? r.opening_unit_cost ?? itemPrice(r)), true),
        csvValue(itemOpeningValue(r), true),
        num(r.totalRcv),
        csvValue(itemReceivedValue(r), true),
        num(r.totalIss),
        num(r.closing),
        csvValue(itemEndingValue(r), true),
        csvValue(itemPulledValue(r), true),
        num(r.closing) < 0 ? 'NEGATIVE ENDING' : 'OK',
      ]),
    },
  ];
}

function monthlyTemplateColumns(): ReportColumn[] {
  return [
    { key: 'category', label: 'Category' },
    { key: 'sku', label: 'SKU' },
    { key: 'desc', label: 'Description' },
    { key: 'opening', label: 'Opening OH' },
    { key: 'w1r', label: 'Received Wk1', get: (r: any) => r.w1r || 0 },
    { key: 'w1p', label: 'Pulled Wk1', get: (r: any) => r.w1p || 0 },
    { key: 'w2r', label: 'Received Wk2', get: (r: any) => r.w2r || 0 },
    { key: 'w2p', label: 'Pulled Wk2', get: (r: any) => r.w2p || 0 },
    { key: 'w3r', label: 'Received Wk3', get: (r: any) => r.w3r || 0 },
    { key: 'w3p', label: 'Pulled Wk3', get: (r: any) => r.w3p || 0 },
    { key: 'totalRcv', label: 'Total Received' },
    { key: 'totalIss', label: 'Total Pulled' },
    { key: 'closing', label: 'Ending OH' },
    { key: 'price', label: 'Unit Price', get: (r: any) => csvValue(itemPrice(r), true) },
  ];
}

function buildMonthlyTemplateCSV(rep: any, rows: any[]) {
  const sections = rep.reviewSections ? rep.reviewSections(rows) : [];
  const parts = sections.map((section: ReviewSection) =>
    rowsToCSV([[section.title], section.columns, ...section.rows]),
  );
  const inventoryColumns = rep.templateColumns || rep.columns;
  parts.push(rowsToCSV([['Inventory'], inventoryColumns.map((c: ReportColumn) => c.label)]));
  parts.push(toCSV(inventoryColumns, rows).split('\n').slice(1).join('\n'));
  parts.push(rowsToCSV([
    ['Template Notes'],
    ['Use this export as the monthly report view of the live data.'],
    ['The Review sections above mirror Monthly Inventory Template.xlsx controls.'],
    ['Weekly invoice totals come from workbook Review metadata when present, not unit-price guesses.'],
  ]));
  return parts.filter(Boolean).join('\n\n');
}

function parseLogData(log: any) {
  if (!log?.data) return {};
  if (typeof log.data === 'object') return log.data;
  try {
    return JSON.parse(log.data);
  } catch {
    return {};
  }
}

function logDate(log: any, data: any) {
  return String(data.date || log.date || log.created_at || '').slice(0, 10);
}

function buildMealLogRows(mealLogs: any[], period: [number, number]) {
  const rows: any[] = [];
  mealLogs.forEach((log) => {
    const data = parseLogData(log);
    const date = logDate(log, data);
    if (date) {
      const parsed = new Date(date + 'T12:00:00');
      if (parsed.getFullYear() !== period[1] || parsed.getMonth() !== period[0]) return;
    }
    const entries = Array.isArray(data.rows) ? data.rows : [];
    entries.forEach((entry: any) => {
      const meals = ['B', 'L', 'D'].filter((key) => !!entry[key]);
      if (!meals.length) return;
      const type = String(entry.type || 'Staff');
      const paid = paidMealLogTypes.has(type);
      rows.push({
        date,
        name: entry.name || '',
        type,
        meals: meals.join(', '),
        mealCount: meals.length,
        paid: paid ? 'Yes' : 'No',
        paidCount: paid ? meals.length : 0,
        compCount: paid ? 0 : meals.length,
        ticket: entry.ticket || '',
      });
    });
  });
  return rows.sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.name.localeCompare(b.name));
}

// PublicMenuCycleDay only carries cycle_day/day_of_week/meals — never a
// calendar date — so every date in the report is derived from the cycle's
// anchor_date + cycleDayForDate, the same math CycleMenu.tsx uses for print.
function buildMenuScheduleRows(menuCycle: PublicMenuCycle | null, period: [number, number]) {
  if (!menuCycle) return [];
  const [monthIdx, year] = period;
  const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();
  const dayMap = new Map(menuCycle.days.map((d) => [d.cycle_day, d]));
  const rows: Array<{ date: string; dow: string; cycleDay: number; cells: Record<string, string> }> = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const iso = `${year}-${String(monthIdx + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const cycleDay = cycleDayForDate(iso, menuCycle.anchor_date);
    const meals = dayMap.get(cycleDay);
    const dow = new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short' });
    const cells: Record<string, string> = {};
    for (const p of PERIOD_ORDER) {
      const items = meals?.meals[p] || [];
      if (!items.length) { cells[p] = ''; continue; }
      const entrees = items.filter((s) => !SIDE_SLOTS.has(s.slot_name)).map((s) => s.item_name);
      const sides = items.filter((s) => SIDE_SLOTS.has(s.slot_name)).map((s) => `${shortSideLabel(s.slot_name)}: ${s.item_name}`);
      cells[p] = [entrees.join(', '), sides.join(', ')].filter(Boolean).join(' — ');
    }
    rows.push({ date: iso, dow, cycleDay, cells });
  }
  return rows;
}

function ReportPeriodSelect({
  value,
  onChange,
  options,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  options: { value: number; label: string }[];
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutside);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutside);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  return (
    <div className="report-period-select" ref={ref}>
      <button
        type="button"
        className="report-period-btn"
        onClick={() => setOpen((current) => !current)}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span>{selected?.label ?? value}</span>
        {I.down({ style: { width: 12, height: 12 } })}
      </button>
      {open && (
        <div className="report-period-menu" role="listbox" aria-label={label}>
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              className="report-period-option"
              data-active={option.value === value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function buildReports(period: [number, number], invItems: any[], events: any[], commits: any[], mealLogs: any[], inventoryMeta: any, menuCycle: PublicMenuCycle | null) {
  const periodLbl = MONTHS[period[0]] + ' ' + period[1];
  const invoiceSchedule = weeklyInvoiceSchedule(inventoryMeta);

  // Sort by category then description — matches corporate report expectation
  const sorted = [...invItems].sort((a: any, b: any) =>
    itemCat(a).localeCompare(itemCat(b)) ||
    itemDesc(a).localeCompare(itemDesc(b))
  );

  const totalRcv = (it: any) => itemTotals(it).received;
  const totalIss = (it: any) => itemTotals(it).pulled;
  const closingQty = (it: any) => itemTotals(it).ending;

  const inventoryRows = sorted.map((it: any) => {
    const totals = itemTotals(it);
    const price = itemPrice(it);
    return {
      ...it,
      category: itemCat(it),
      sku: it.sku || it.id || '',
      desc: itemDesc(it),
      unit: itemUnit(it),
      price,
      par: itemPar(it),
      onHand: totals.ending,
      totalRcv: totals.received,
      totalIss: totals.pulled,
      closing: totals.ending,
      value: itemEndingValue(it),
    };
  });

  const moninvRows = sorted.map((it: any) => ({
    ...it,
    category: itemCat(it),
    sku: it.sku || it.id || '',
    desc: itemDesc(it),
    unit: itemUnit(it),
    price: itemPrice(it),
    par: itemPar(it),
    opening: it.onHand || 0,
    totalRcv: totalRcv(it),
    totalIss: totalIss(it),
    closing: closingQty(it),
    openingValue: itemOpeningValue(it),
    receivedValue: itemReceivedValue(it),
    pulledValue: itemPulledValue(it),
    value: itemEndingValue(it),
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
        { key: 'value', label: 'Value', get: (r: any) => fmtMoney(itemEndingValue(r)) },
      ],
      build: () => inventoryRows,
      exportBuild: () => moninvRows,
      templateColumns: monthlyTemplateColumns(),
      reviewSections: (_rows?: any[]) => buildMonthlyReviewSections(periodLbl, moninvRows, inventoryMeta),
    },
    {
      id: 'moninv',
      name: 'Monthly Inventory Roll-up',
      group: 'Inventory',
      icon: 'fileText',
      period: periodLbl,
      columns: [
        { key: 'category', label: 'Category' },
        { key: 'desc', label: 'Item Description' },
        { key: 'unit', label: 'UOM' },
        { key: 'price', label: 'Unit Price', get: (r: any) => fmtMoney(itemPrice(r)) },
        { key: 'par', label: 'Par Level', get: (r: any) => itemPar(r) },
        { key: 'opening', label: 'Beginning Inv.' },
        { key: 'w1r', label: 'W1 Rcv', get: (r: any) => r.w1r || 0 },
        { key: 'w2r', label: 'W2 Rcv', get: (r: any) => r.w2r || 0 },
        { key: 'w3r', label: 'W3 Rcv', get: (r: any) => r.w3r || 0 },
        { key: 'totalRcv', label: 'Total Rcv' },
        { key: 'w1p', label: 'Pulled W1', get: (r: any) => r.w1p || 0 },
        { key: 'w2p', label: 'Pulled W2', get: (r: any) => r.w2p || 0 },
        { key: 'w3p', label: 'Pulled W3', get: (r: any) => r.w3p || 0 },
        { key: 'totalIss', label: 'Total Pulled' },
        { key: 'closing', label: 'Ending Inv.' },
        { key: 'value', label: 'Ending Value', get: (r: any) => fmtMoney(r.value || 0) },
      ],
      build: () => moninvRows,
      exportBuild: () => moninvRows,
      templateColumns: monthlyTemplateColumns(),
      reviewSections: (_rows?: any[]) => buildMonthlyReviewSections(periodLbl, moninvRows, inventoryMeta),
      summary: (_rows: any[]) => {
        const metaTotals = metadataMoneyTotals(inventoryMeta);
        const summary = [
          { label: 'Starting Balance', value: fmtMoney(metaTotals.opening) },
          { label: invoiceSchedule ? 'Invoice Received' : 'Total Received', value: fmtMoney(metaTotals.received) },
          { label: 'Total Pulled',     value: fmtMoney(metaTotals.pulled) },
          { label: 'Ending Balance',   value: fmtMoney(metaTotals.closing) },
        ];
        if (invoiceSchedule) {
          invoiceSchedule.weeks.forEach((week) => {
            summary.push({ label: `Invoice W${week.week}`, value: fmtMoney(week.value) });
          });
          summary.push({ label: 'Invoice Total', value: fmtMoney(invoiceSchedule.total) });
        }
        return summary;
      },
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
      period: periodLbl,
      columns: [
        { key: 'date', label: 'Date' },
        { key: 'name', label: 'Name' },
        { key: 'type', label: 'Type' },
        { key: 'meals', label: 'Meals' },
        { key: 'paid', label: 'Paid' },
        { key: 'ticket', label: 'Ticket #' },
      ],
      build: () => buildMealLogRows(mealLogs, period),
      summary: (rows: any[]) => [
        { label: 'Signed Entries', value: rows.length.toLocaleString() },
        { label: 'Meals Served', value: rows.reduce((s, r) => s + num(r.mealCount), 0).toLocaleString() },
        { label: 'Paid Meals', value: rows.reduce((s, r) => s + num(r.paidCount), 0).toLocaleString() },
        { label: 'Complimentary Meals', value: rows.reduce((s, r) => s + num(r.compCount), 0).toLocaleString() },
      ],
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
      name: 'Flow',
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
      id: 'menu',
      name: 'Menu Schedule',
      group: 'Programs',
      icon: 'calendar',
      period: periodLbl,
      columns: [
        { key: 'date', label: 'Date', get: (r: any) => r.date },
        { key: 'dow', label: 'Day', get: (r: any) => r.dow },
        { key: 'cycleDay', label: 'Cycle Day', get: (r: any) => r.cycleDay },
        ...PERIOD_ORDER.map((p) => ({ key: p, label: p, get: (r: any) => r.cells[p] || '' })),
      ],
      build: () => buildMenuScheduleRows(menuCycle, period),
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
  user,
  period: selectedPeriod,
}: {
  user: User;
  period: [number, number];
}) {
  const [period, setPeriod] = useState<[number, number]>(selectedPeriod);

  const [invItems, setInvItems] = useState<any[]>([]);
  const [inventoryMeta, setInventoryMeta] = useState<any>({});
  const [events, setEvents] = useState<any[]>([]);
  const [commits, setCommits] = useState<any[]>([]);
  const [mealLogs, setMealLogs] = useState<any[]>([]);
  const [menuCycle, setMenuCycle] = useState<PublicMenuCycle | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [liveTick, setLiveTick] = useState(0);

  const [tab, setTab] = useState('catalogue');
  const [sel, setSel] = useState('');

  useEffect(() => {
    setPeriod(selectedPeriod);
  }, [selectedPeriod]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadErr(null);
    async function load() {
      try {
        const [invData, evData, cmData, mealData, menuData] = await Promise.all([
          api.getInventory(period[0] + 1, period[1]),
          api.getEvents().catch(() => []),
          api.getCommits().catch(() => []),
          api.getDailyLogs(500, 'meal_log').catch(() => []),
          api.getPublicMenuCycle().catch(() => null),
        ]);
        if (!alive) return;
        setInvItems(invData?.items || []);
        setInventoryMeta(invData?.metadata || {});
        setEvents(evData);
        setCommits(cmData);
        setMealLogs(mealData);
        setMenuCycle(menuData);
      } catch {
        if (alive) {
          setInvItems([]);
          setInventoryMeta({});
          setEvents([]);
          setCommits([]);
          setMealLogs([]);
          setMenuCycle(null);
          setLoadErr('Report data could not be loaded from the production API.');
        }
      }
      if (alive) setLoading(false);
    }
    load();
    return () => { alive = false; };
  }, [period, liveTick]);

  useEffect(() => {
    const refresh = () => setLiveTick((tick) => tick + 1);
    window.addEventListener('mjcc:live-data-changed', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener('mjcc:live-data-changed', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, []);

  const reports = useMemo(
    () => buildReports(period, invItems, events, commits, mealLogs, inventoryMeta, menuCycle),
    [period, invItems, events, commits, mealLogs, inventoryMeta, menuCycle],
  );
  const canSeeAllReports = ROLE_LEVEL[user.role] >= 30;
  const availableReports = useMemo(
    () => canSeeAllReports ? reports : reports.filter((r) => r.id === 'moninv'),
    [canSeeAllReports, reports],
  );

  useEffect(() => {
    if (!availableReports.length) return;
    if (!sel || !availableReports.some((r) => r.id === sel)) {
      setSel(availableReports[0].id);
    }
  }, [availableReports, sel]);

  const active = availableReports.find((r) => r.id === sel) || availableReports[0];
  const rows = active?.build() || [];
  const activeReviewSections = active?.reviewSections
    ? active.reviewSections(active.exportBuild ? active.exportBuild() : rows)
    : null;
  // When a report carries Review sections (workbook-shaped monthly reports), the
  // line-item table below them must use the same template shape the CSV export
  // uses -- not the simpler dashboard-snapshot columns -- so preview, print, and
  // download all show one consistent report instead of three different ones.
  const displayColumns: ReportColumn[] = active?.templateColumns || active?.columns || [];
  const displayRows = active?.templateColumns
    ? (active.exportBuild ? active.exportBuild() : rows)
    : rows;
  const showInventoryStats = rows.length > 0 && ['inventory', 'moninv'].includes(active?.id);
  const reportStats = (() => {
    const receivedUnits = rows.reduce((s: number, r: any) => {
      if (r.totalRcv != null || r.totalReceived != null) return s + num(r.totalRcv ?? r.totalReceived);
      return s + num(r.w1r) + num(r.w2r) + num(r.w3r);
    }, 0);
    const issuedUnits = rows.reduce((s: number, r: any) => {
      if (r.totalIss != null || r.totalPulled != null) return s + num(r.totalIss ?? r.totalPulled);
      return s + num(r.w1p) + num(r.w2p) + num(r.w3p);
    }, 0);
    const metaTotals = metadataMoneyTotals(inventoryMeta);
    const endingValue = metaTotals.closing;
    const reorderNeeded = num(inventoryMeta?.reorder_count);
    return [
      { label: 'Items', value: rows.length.toLocaleString(), icon: I.box },
      { label: 'Categories', value: new Set(rows.map((r: any) => itemCat(r))).size.toLocaleString(), icon: I.archive },
      { label: 'Received Units', value: receivedUnits.toLocaleString(), icon: I.trend },
      { label: 'Issued Units', value: issuedUnits.toLocaleString(), icon: I.down },
      { label: 'Ending Value', value: fmtMoney(endingValue), icon: I.dollar, tone: 'accent' },
      { label: 'Reorder Needed', value: reorderNeeded.toLocaleString(), icon: I.alert, tone: reorderNeeded > 0 ? 'danger' : 'muted' },
    ];
  })();

  const groups = canSeeAllReports ? ['Inventory', 'Compliance', 'Programs'] : ['Inventory'];
  const fileName = (rep: any) => {
    const periodSlug = `${period[1]}-${String(period[0] + 1).padStart(2, '0')}`;
    return `MJCC_${rep.id}_${periodSlug}_${new Date().toISOString().slice(0, 10)}.csv`;
  };

  function downloadOne(rep: any) {
    const data = rep.exportBuild ? rep.exportBuild() : rep.build();
    if (rep.reviewSections || rep.templateColumns) {
      downloadCSV(fileName(rep), buildMonthlyTemplateCSV(rep, data));
      return;
    }
    let csv = toCSV(rep.columns, data);
    if (rep.summary) {
      const summary = rep.summary(data);
      csv += '\n\n' + toCSV(
        [
          { label: 'Metric', key: 'label' },
          { label: 'Value', key: 'value' },
        ],
        summary,
      );
    }
    downloadCSV(fileName(rep), csv);
  }
  function printOne(rep: any) {
    const built = rep.build();
    // Same model the CSV export uses: workbook-shaped template columns + the
    // exportBuild dataset when present, instead of the simpler dashboard
    // snapshot columns (fixes the v4.26.22 preview/print mismatch).
    const columns = rep.templateColumns || rep.columns;
    const data = rep.templateColumns ? (rep.exportBuild ? rep.exportBuild() : built) : built;
    const th = columns
      .map((c: any) => '<th>' + htmlEscape(c.label) + '</th>')
      .join('');
    const tr = data
      .map(
        (r: any) =>
          '<tr>' +
          columns
            .map(
              (c: any) =>
                '<td>' +
                htmlEscape((typeof c.get === 'function' ? c.get(r) : r[c.key]) ?? '') +
                '</td>',
            )
            .join('') +
          '</tr>',
      )
      .join('');

    // Summary block for inventory reports with opening/received/issued/closing values
    const summary = rep.summary ? rep.summary(built) : null;
    const summaryHtml = summary
      ? '<div style="margin-top:20px;border-top:2px solid #0E2148;padding-top:14px">' +
          '<table style="width:auto;border-collapse:collapse;font-size:12px">' +
          '<tr>' +
          summary.map((s: { label: string; value: string }) =>
            '<td style="padding:6px 20px 6px 0;font-weight:700;color:#0E2148;white-space:nowrap">' +
            htmlEscape(s.label) + '</td><td style="padding:6px 20px 6px 0;font-size:14px;font-weight:700">' +
            htmlEscape(s.value) + '</td>'
          ).join('</tr><tr>') +
          '</tr></table></div>'
      : '';
    const reviewSections = rep.reviewSections ? rep.reviewSections(rep.exportBuild ? rep.exportBuild() : built) : null;
    // Stack sections in workbook order (Inventory Review, Weekly Invoice
    // Totals, Category Summary, Review Detail) — one column, not a 2-up grid
    // that squeezes wide tables side by side like debug output.
    const reviewHtml = reviewSections
      ? '<div style="margin:14px 0 18px;display:flex;flex-direction:column;gap:10px">' +
          reviewSections.slice(0, 3).map((section: ReviewSection) => {
            const head = section.columns
              .map((label) => '<th style="background:#E2E8F0;color:#0E2148">' + htmlEscape(label) + '</th>')
              .join('');
            const body = section.rows
              .map((row) => '<tr>' + row.map((cell, idx) => {
                const type = section.columnTypes[idx] || 'text';
                const align = type === 'money' || type === 'number' ? ' style="text-align:right"' : '';
                return '<td' + align + '>' + htmlEscape(reviewCell(cell, type)) + '</td>';
              }).join('') + '</tr>')
              .join('');
            return '<div style="break-inside:avoid"><h2 style="font-size:12px;margin:0 0 4px;color:#0E2148">' +
              htmlEscape(section.title) +
              '</h2><table><thead><tr>' +
              head +
              '</tr></thead><tbody>' +
              body +
              '</tbody></table></div>';
          }).join('') +
          '</div>'
      : '';

    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(
      '<html><head><title>' +
        htmlEscape(rep.name) +
        '</title><style>@page{size:landscape;margin:14mm}body{font-family:Segoe UI,Arial,sans-serif;color:#1E293B;padding:0}h1{font-size:18px;margin:0 0 2px}.sub{color:#64748B;font-size:12px;margin-bottom:16px}table{width:100%;border-collapse:collapse;font-size:10.5px}th{background:#0E2148;color:#fff;text-align:left;padding:6px 7px;font-size:9px;text-transform:uppercase;letter-spacing:.3px;white-space:nowrap}td{padding:4px 7px;border:.5px solid #CBD5E1;vertical-align:top}td:nth-child(n+4){text-align:right;font-variant-numeric:tabular-nums}tr:nth-child(even) td{background:#F8FAFC}</style></head><body><h1>' +
        htmlEscape(rep.name) +
        '</h1><div class="sub">Miami Job Corps Cafeteria · ' +
        htmlEscape(rep.period) +
        ' · ' +
        data.length +
        ' records · generated ' +
        htmlEscape(new Date().toLocaleString()) +
        '</div>' +
        reviewHtml +
        '<table><thead><tr>' +
        th +
        '</tr></thead><tbody>' +
        tr +
        '</tbody></table>' +
        summaryHtml +
        '</body></html>',
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
          <div className="ph-sub" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <StatusPill><strong>{invItems.length}</strong>&nbsp;inventory items</StatusPill>
            <StatusPill><strong>{events.length}</strong>&nbsp;events</StatusPill>
            <StatusPill><strong>{commits.length}</strong>&nbsp;commits</StatusPill>
            <StatusPill ok>live data</StatusPill>
          </div>
        </div>
        <div className="ph-actions">
          <ReportPeriodSelect
            label="Report month"
            value={period[0]}
            onChange={(v) => setPeriod([v, period[1]])}
            options={MONTHS.map((m, i) => ({ value: i, label: m }))}
          />
          <ReportPeriodSelect
            label="Report year"
            value={period[1]}
            onChange={(v) => setPeriod([period[0], v])}
            options={[new Date().getFullYear() - 1, new Date().getFullYear()].map((y) => ({
              value: y,
              label: String(y),
            }))}
          />
        </div>
      </div>

      {loadErr && (
        <div className="banner warn">
          {I.alert()}
          <span>{loadErr}</span>
          <span className="bx" onClick={() => setLiveTick((tick) => tick + 1)}>Retry</span>
        </div>
      )}

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
        <div className="reports-workspace">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {groups.map((g) => {
              const items = availableReports.filter((r) => r.group === g);
              if (!items.length) return null;
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
                              title={sel === rep.id ? 'Previewing' : 'Preview report'}
                              onClick={(e) => {
                                e.stopPropagation();
                                setSel(rep.id);
                              }}
                            >
                              {I.eye({
                                style: { width: 14, height: 14 },
                              })}
                              <span>{sel === rep.id ? 'Previewing' : 'Preview'}</span>
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

          <div className="card report-preview-card">
            <div className="card-head report-preview-head">
              <div className="report-preview-title">
                <span className="tpl-tag">Selected report preview</span>
                <h3>{active.name}</h3>
                <div className="rr-meta">
                  {active.period} · {rows.length} record{rows.length !== 1 ? 's' : ''}
                </div>
              </div>
              <div className="report-preview-actions">
                <button className="btn" onClick={() => printOne(active)}>
                  {I.printer()} Print
                </button>
                <button className="btn primary" onClick={() => downloadOne(active)}>
                  {I.download()} Download current CSV
                </button>
              </div>
            </div>
            {showInventoryStats && (
              <div className="report-kpi-grid">
                {reportStats.map((stat) => {
                  const Icon = stat.icon;
                  return (
                    <div className="report-kpi-card" data-tone={stat.tone || 'default'} key={stat.label}>
                      <div className="report-kpi-label">
                        <Icon />
                        <span>{stat.label}</span>
                      </div>
                      <div className="report-kpi-value">{stat.value}</div>
                    </div>
                  );
                })}
              </div>
            )}
            {activeReviewSections && (
              <div className="report-review-preview">
                {activeReviewSections.slice(0, 3).map((section: ReviewSection) => (
                  <div className="report-review-section" key={section.title}>
                    <div className="report-review-title">{section.title}</div>
                    <div className="tbl-wrap">
                      <table className="data mini">
                        <thead>
                          <tr>
                            {section.columns.map((column, idx) => (
                              <th key={`${column}-${idx}`}>{column}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {section.rows.map((row, idx) => (
                            <tr key={idx}>
                              {row.map((cell, cellIdx) => {
                                const type = section.columnTypes[cellIdx] || 'text';
                                return (
                                  <td key={cellIdx} data-type={type}>{reviewCell(cell, type)}</td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {displayRows.length === 0 ? (
              <div
                style={{
                  padding: '40px 17px',
                  textAlign: 'center',
                  color: 'var(--muted)',
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
                className="card-body flush tbl-wrap report-preview-table"
              >
                <table className={showInventoryStats ? 'data sheet report-sheet' : 'data'}>
                  <thead>
                    <tr>
                      {displayColumns.map((c: any) => (
                        <th key={c.key}>{c.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {displayRows.map((r: any, i: number) => (
                      <tr key={i}>
                        {displayColumns.map((c: any) => (
                          <td key={c.key}>
                            {(typeof c.get === 'function'
                              ? c.get(r)
                              : r[c.key]) ?? ''}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                  {active.summary && (() => {
                    const summary = active.summary(rows);
                    return (
                      <tfoot>
                        <tr>
                          <td
                            colSpan={displayColumns.length}
                            style={{ padding: 0, border: 'none' }}
                          >
                            <div style={{
                              display: 'flex',
                              gap: 24,
                              padding: '12px 14px',
                              borderTop: '2px solid var(--navy)',
                              background: 'var(--surface-2)',
                              flexWrap: 'wrap',
                            }}>
                              {summary.map((s: { label: string; value: string }) => (
                                <div key={s.label} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                  <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--muted)' }}>{s.label}</span>
                                  <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--navy)' }}>{s.value}</span>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      </tfoot>
                    );
                  })()}
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
