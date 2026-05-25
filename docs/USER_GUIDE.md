# User Guide — MJC Inventory Dashboard

## Tabs Overview

### 📊 Dashboard

- Shows total inventory value, starting on-hand, week-by-week received totals
- Category breakdown with color-coded reorder alerts
- Month/year selector — switch to any prior month to view historical data
- ◀ Prev / Next ▶ buttons to step through months

### 📋 Inventory

- Full editable item table organized by category
- Columns: Item Name | On Hand | Par | W1–W4 Issued | W1–W4 Received | Unit Price | Total
- Green rows = items received this week
- Click any cell to edit directly
- Add Row button at bottom of each category

### 📄 Invoice Entry

- Paste invoice text → click "Parse with AI" → review matches → Apply
- Alternatively: upload a PDF invoice for AI extraction
- Choose which week to apply (Week 1–4)
- Confirmed invoices update received quantities instantly

### 📈 Monthly Report

- Full printable report with all categories and line items
- Shows: starting inventory, total received by week, total issued, ending value
- "Print / Save PDF" button — use browser's Save as PDF option

### 📅 History

- 76 months of pre-loaded data (Jan 2020 – Apr 2026)
- Bar chart timeline showing inventory value trends
- Month-over-month and year-over-year comparisons
- 💾 Save Month button — snapshots the current month

### 🔲 Barcodes

- Generates barcodes for any inventory item
- Print barcode sheets for shelf labeling

### 📡 Mobile Sync

- Optional Supabase cloud sync
- Export / Import JSON for cross-device data transfer

---

## Monthly Workflow (Step by Step)

### Start of Month

1. Open dashboard — starting value auto-populates from prior month ending total
2. Verify on-hand quantities match your physical count
3. Adjust any discrepancies in the Inventory tab

### Each Week (as invoices arrive)

1. Go to **Invoice Entry** tab
2. Upload the PDF or paste invoice text
3. Select the correct week (W1, W2, W3, W4)
4. Click **Parse with AI** — review matched items
5. Click **Apply to Inventory** — received quantities update automatically
6. Check Inventory tab to confirm green-highlighted items

### End of Month

1. Go to **Monthly Report** tab
2. Review all totals — starting value, received, issued, ending value
3. Click **Print / Save PDF**
4. Go back to Dashboard → click **💾 Save Month**
5. Click **⬇ Export Data** and save the JSON to the `/backups` folder
6. Change month/year selector to the new month to begin

---

## Syncing Between Devices

### App → Desktop

1. On the app: click **⬇ Export Data** → save the `.json` file
2. On desktop: open dashboard → click **⬆ Import Data** → select the file

### Desktop → App

Same process in reverse.

---

## Reorder Alerts

- 🔴 Red = on-hand below par level (reorder needed)
- 🟡 Yellow = on-hand at par level (order soon)
- 🟢 Green = adequately stocked

---

## Tips

- Always **Export Data** before closing a session on a public/shared computer
- Use Chrome or Edge for best compatibility
- The barcode tab works best on a desktop browser with a connected printer
- Historical months are read-only — only May 2026 (current) is editable
