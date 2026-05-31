function homePage() {
  return {
    currentMonth: Alpine.store('now').month,
    currentYear: Alpine.store('now').year,
    summary: {},
    items: [],
    lowStock: 0,
    pendingCount: 0,
    recentCommits: [],
    recentStaged: [],
    categoryData: [],
    loading: true,
    liveInterval: null,
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

    async initPage() {
      await this.loadAll();
      this.liveInterval = setInterval(() => this.loadAll(), 60000);
    },
    destroy() {
      if (this.liveInterval) clearInterval(this.liveInterval);
    },

    async loadAll() {
      this.loading = true;
      const [sumRes, itemsRes, stagedRes, commitsRes] = await Promise.all([
        API.getSummary(this.currentMonth, this.currentYear).catch(() => ({})),
        API.getItems(this.currentMonth, this.currentYear, 500).catch(() => ({ items: [] })),
        API.getStaged().catch(() => ({ entries: [] })),
        API.getCommits(this.currentMonth, this.currentYear, 1).catch(() => ({ commits: [] })),
      ]);

      this.summary = sumRes || {};
      const raw = Array.isArray(itemsRes) ? itemsRes : itemsRes.items || [];
      this.items = raw;

      this.lowStock = raw.filter(
        (i) => parseFloat(i.on_hand || 0) < parseFloat(i.par_level || 0),
      ).length;

      const staged = Array.isArray(stagedRes) ? stagedRes : stagedRes.entries || [];
      this.pendingCount = staged.length;
      this.recentStaged = staged.slice(-3);

      const commits = Array.isArray(commitsRes) ? commitsRes : commitsRes.commits || [];
      this.recentCommits = commits.slice(-5).reverse();

      // Category breakdown
      const catMap = {};
      raw.forEach((i) => {
        const name = i.category || 'Uncategorized';
        if (!catMap[name])
          catMap[name] = { name, count: 0, total: 0, belowPar: 0, wk1: 0, wk2: 0, wk3: 0, wk4: 0 };
        catMap[name].count++;
        catMap[name].total += (parseFloat(i.on_hand) || 0) * (parseFloat(i.unit_price) || 0);
        catMap[name].wk1 += parseFloat(i.w1_received) || 0;
        catMap[name].wk2 += parseFloat(i.w2_received) || 0;
        catMap[name].wk3 += parseFloat(i.w3_received) || 0;
        catMap[name].wk4 += parseFloat(i.w4_received) || 0;
        if (parseFloat(i.on_hand || 0) < parseFloat(i.par_level || 0)) catMap[name].belowPar++;
      });
      this.categoryData = Object.values(catMap).sort((a, b) => b.total - a.total);

      this.loading = false;
    },

    // Alerts: items critically low (on_hand === 0)
    get criticalAlerts() {
      return this.items
        .filter((i) => parseFloat(i.on_hand || 0) === 0 && parseFloat(i.par_level || 0) > 0)
        .slice(0, 8);
    },

    // Week summary — how much received each week this month
    get weeklyTotals() {
      return [1, 2, 3, 4].map((w) => ({
        week: w,
        total: this.summary[`wk${w}_total`] || 0,
      }));
    },

    navigate(page, tab) {
      Alpine.store('sidebar').setActive(page);
      if (tab) {
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('set-report-tab', { detail: tab }));
        }, 150);
      }
    },

    currency(v) {
      const n = parseFloat(v) || 0;
      return (
        '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      );
    },
    number(v) {
      const n = parseFloat(v) || 0;
      return Math.round(n).toLocaleString();
    },
    timeAgo(ts) {
      if (!ts) return '';
      const diff = Date.now() - new Date(ts).getTime();
      const mins = Math.floor(diff / 60000);
      if (mins < 1) return 'just now';
      if (mins < 60) return mins + 'm ago';
      const hrs = Math.floor(mins / 60);
      if (hrs < 24) return hrs + 'h ago';
      return Math.floor(hrs / 24) + 'd ago';
    },
  };
}
