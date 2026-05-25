# Miami Job Corps Cafeteria — Inventory Management Dashboard

**Version:** May 2026  
**Maintained by:** Food Service Manager / Administrator

---

## Overview

A standalone HTML-based inventory dashboard for tracking monthly cafeteria inventory, processing US Foods and Multi-Flow invoices, and generating printable monthly reports.

---

## Project Structure

```
mjc_inventory_project/
├── inventory_dashboard.html     ← Main application (open this in browser)
├── inventory_dashboard_offline.html  ← Offline version (uses local libs)
├── libs/                        ← Local library files (run setup script first)
│   ├── JsBarcode.all.min.js
│   ├── lz-string.min.js
│   ├── qrcode.min.js
│   └── supabase.min.js
├── docs/
│   ├── USER_GUIDE.md            ← How to use the dashboard
│   └── INVOICE_PROCEDURE.md     ← Step-by-step invoice entry
├── backups/                     ← Store exported JSON backups here
├── setup.sh                     ← Mac/Linux setup script
├── setup.bat                    ← Windows setup script
├── package.json                 ← Optional local dev server
└── README.md                    ← This file
```

---

## Quick Start

### Option 1 — Online (simplest)

1. Open `inventory_dashboard.html` in **Chrome** or **Edge**
2. The dashboard loads with all May 2026 data pre-loaded
3. No installation needed

### Option 2 — Fully Offline

1. Run the setup script to download library files:
   - **Mac/Linux:** `bash setup.sh`
   - **Windows:** Double-click `setup.bat`
2. Open `inventory_dashboard_offline.html` in your browser

### Option 3 — Local Dev Server (optional)

```bash
npm install
npm start
# Opens at http://localhost:3000
```

---

## Dependencies (CDN)

| Library     | Version | Purpose                     |
| ----------- | ------- | --------------------------- |
| JsBarcode   | 3.11.5  | Barcode generation          |
| lz-string   | 1.4.4   | Data compression for export |
| qrcodejs    | 1.0.0   | QR code generation          |
| Supabase JS | 2.x     | Optional cloud sync         |

---

## Data & Storage

- All inventory data is stored in **browser localStorage**
- Use **⬇ Export Data** button to save a `.json` backup
- Use **⬆ Import Data** to restore or sync between devices
- Store exported backups in the `/backups` folder

---

## Monthly Workflow

1. At start of month: open dashboard — starting value auto-loads from prior month
2. Upload Week 1 invoice → Invoice Entry tab → Parse & Apply
3. Repeat for Weeks 2, 3, 4 as invoices arrive
4. Update issued quantities weekly
5. End of month: Monthly Report tab → Print / Save PDF
6. Click **💾 Save Month** to snapshot the month before rolling over

---

## Inventory Categories

1. Dairy
2. Cereal
3. Beverages
4. Snacks
5. Dry Goods
6. Produce & Fresh
7. Protein & Meat
8. Frozen Foods
9. Supplies

---

## Login (when re-enabled)

| Role    | Username        | Credential      |
| ------- | --------------- | --------------- |
| Admin   | admin           | Admin@MJC2026   |
| Manager | fs_manager      | Manager@MJC2026 |
| Staff   | staff1 / staff2 | PIN: 1234       |

_Login system is currently disabled. Contact admin to re-enable._

---

## Support

Built and maintained via Claude AI (Anthropic).  
For issues, re-open your conversation and upload the HTML file.
