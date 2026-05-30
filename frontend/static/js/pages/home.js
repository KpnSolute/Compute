function homePage() {
  return {
    currentMonth: new Date().getMonth(),
    currentYear: new Date().getFullYear(),
    summary: {},
    lowStock: 0,
    pendingCount: 0,
    recentCommits: [],
    recentStaged: [],
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
      this.summary = sumRes;
      const items = Array.isArray(itemsRes) ? itemsRes : itemsRes.items || [];
      this.lowStock = items.filter((i) => (i.on_hand || 0) <= (i.reorder_point || 0)).length;
      const staged = Array.isArray(stagedRes) ? stagedRes : stagedRes.entries || [];
      this.pendingCount = staged.length;
      this.recentStaged = staged.slice(-3);
      const commits = Array.isArray(commitsRes) ? commitsRes : commitsRes.commits || [];
      this.recentCommits = commits.slice(-5).reverse();
      this.loading = false;
    },
    navigate(page) {
      Alpine.store('sidebar').setActive(page);
    },
    number(v) {
      return typeof v === 'number' ? Math.round(v).toLocaleString() : v || '0';
    },
    timeAgo(ts) {
      if (!ts) return '';
      const diff = Date.now() - new Date(ts).getTime();
      const mins = Math.floor(diff / 60000);
      if (mins < 1) return 'just now';
      if (mins < 60) return mins + 'm ago';
      const hrs = Math.floor(mins / 60);
      if (hrs < 24) return hrs + 'h ago';
      const days = Math.floor(hrs / 24);
      return days + 'd ago';
    },
  };
}
