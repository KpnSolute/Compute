function reportsPage() {
  return {
    repMonth: new Date().getMonth(),
    repYear: new Date().getFullYear(),
    monthNames: [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ],
    years: [2024, 2025, 2026, 2027],

    loading: false,
    error: false,

    activeTab: 'overview',

    // raw data
    summary: {},
    items: [],

    // overview tab
    categoryData: [],
    reorderItems: [],

    // pullsheet tab
    pullWeek: 0, // 0 = all weeks visible

    // costs tab
    costsByCategory: [],

    async initPage() {
      await this.loadReport(this.repMonth, this.repYear);
    },

    async loadReport(month, year) {
      this.loading = true;
      this.error = false;
      try {
        const [sumRes, itemsRes] = await Promise.all([
          API.getSummary(month, year).catch(() => null),
          API.getItems(month, year).catch(() => null),
        ]);

        this.summary = sumRes || {};

        const raw = itemsRes ? (Array.isArray(itemsRes) ? itemsRes : itemsRes.items || []) : [];
        this.items = raw;

        // overview: category breakdown
        const catMap = {};
        raw.forEach((i) => {
          const name = i.category_name || 'Uncategorized';
          if (!catMap[name]) catMap[name] = { name, count: 0, total: 0 };
          catMap[name].count++;
          catMap[name].total += (this.getEndQty(i) || 0) * (i.unit_price || 0);
        });
        this.categoryData = Object.values(catMap).sort((a, b) => b.total - a.total);

        // overview: low stock
        this.reorderItems = raw.filter(
          (i) => i.is_low || (i.on_hand || 0) <= (i.reorder_point || 0),
        );

        // costs tab: category value breakdown
        const grandTotal =
          this.summary.grand_total ||
          raw.reduce((sum, i) => sum + (this.getEndQty(i) || 0) * (i.unit_price || 0), 0);

        this.costsByCategory = Object.values(catMap)
          .map((c) => ({
            ...c,
            pct: grandTotal > 0 ? ((c.total / grandTotal) * 100).toFixed(1) : '0.0',
          }))
          .sort((a, b) => b.total - a.total);
      } catch {
        this.error = true;
        Alpine.store('toast').showToast('Failed to load report', 'error');
      }
      this.loading = false;
    },

    changeMonth() {
      this.loadReport(this.repMonth, this.repYear);
    },

    jumpToCurrent() {
      this.repMonth = new Date().getMonth();
      this.repYear = new Date().getFullYear();
      this.loadReport(this.repMonth, this.repYear);
    },

    // --- helpers ---

    number(v) {
      if (v === null || v === undefined) return '0';
      const n = typeof v === 'string' ? parseFloat(v) : v;
      return isNaN(n) ? '0' : Math.round(n).toLocaleString();
    },

    currency(v) {
      if (v === null || v === undefined) return '$0';
      const n = typeof v === 'string' ? parseFloat(v) : v;
      if (isNaN(n)) return '$0';
      return (
        '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      );
    },

    getEndQty(item) {
      for (let w = 4; w >= 1; w--) {
        const eq = item[`week${w}_ending_qty`];
        if (eq !== undefined && eq !== null) return eq;
      }
      let qty = item.on_hand || 0;
      for (let w = 1; w <= 4; w++) {
        qty += (item[`week${w}_received`] || 0) - (item[`week${w}_issued`] || 0);
      }
      return qty;
    },

    // --- pullsheet helpers ---

    get pullWeeks() {
      return this.pullWeek === 0 ? [1, 2, 3, 4] : [this.pullWeek];
    },

    get pullRows() {
      return this.items.map((i) => {
        const weeks = {};
        for (let w = 1; w <= 4; w++) {
          weeks[w] = {
            received: i[`week${w}_received`] || 0,
            issued: i[`week${w}_issued`] || 0,
            ending: i[`week${w}_ending_qty`] ?? (i.on_hand || 0),
          };
        }
        return { ...i, weeks };
      });
    },

    get pullTotals() {
      const totals = {};
      for (let w = 1; w <= 4; w++) {
        totals[w] = { received: 0, issued: 0, ending: 0 };
      }
      this.items.forEach((i) => {
        for (let w = 1; w <= 4; w++) {
          totals[w].received += i[`week${w}_received`] || 0;
          totals[w].issued += i[`week${w}_issued`] || 0;
          totals[w].ending += i[`week${w}_ending_qty`] ?? (i.on_hand || 0);
        }
      });
      return totals;
    },

    // --- costs helpers ---

    get itemsSortedByCost() {
      return [...this.items]
        .map((i) => ({ ...i, _totalVal: (this.getEndQty(i) || 0) * (i.unit_price || 0) }))
        .sort((a, b) => b._totalVal - a._totalVal);
    },

    get mostExpensiveCategory() {
      return this.costsByCategory.length ? this.costsByCategory[0].name : '—';
    },

    get avgUnitPrice() {
      if (!this.items.length) return 0;
      const sum = this.items.reduce((acc, i) => acc + (i.unit_price || 0), 0);
      return sum / this.items.length;
    },

    get totalInventoryValue() {
      return (
        this.summary.grand_total ||
        this.items.reduce((s, i) => s + (this.getEndQty(i) || 0) * (i.unit_price || 0), 0)
      );
    },
  };
}
