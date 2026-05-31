function sourceControlPage() {
  return {
    staged: [],
    commits: [],
    pushMessage: '',
    canWrite: false,
    stagedLoading: true,
    stagedError: false,
    commitsLoading: true,
    commitsError: false,
    currentMonth: Alpine.store('now').month,
    currentYear: Alpine.store('now').year,
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
    diffModalOpen: false,
    diffData: null,
    diffLoading: false,
    publishLoading: false,
    pollInterval: null,
    async initPage() {
      this.canWrite = ['admin', 'manager', 'assistant'].includes(
        Alpine.store('auth')?.user?.role || '',
      );
      this.pushMessage = `Week ${Alpine.store('now').week} updates — ${
        Alpine.store('now').period_label
      }`;
      await Promise.all([this.loadStaged(), this.loadCommits()]);
      this.pollInterval = setInterval(() => this.loadStaged(), 30000);
    },
    destroy() {
      if (this.pollInterval) clearInterval(this.pollInterval);
    },
    async loadStaged() {
      this.stagedLoading = true;
      this.stagedError = false;
      try {
        const res = await API.getStaged();
        this.staged = Array.isArray(res) ? res : res.entries || [];
      } catch {
        this.stagedError = true;
        this.staged = [];
      }
      this.stagedLoading = false;
    },
    async loadCommits() {
      this.commitsLoading = true;
      this.commitsError = false;
      try {
        const res = await API.getCommits(this.currentMonth, this.currentYear);
        this.commits = Array.isArray(res) ? res : res.commits || [];
      } catch {
        this.commitsError = true;
        this.commits = [];
      }
      this.commitsLoading = false;
    },
    async mergeEntry(entry) {
      try {
        await API.mergeStaged(entry.id || entry.entry_id);
        Alpine.store('toast').showToast('Entry merged', 'success');
        await Promise.all([this.loadStaged(), this.loadCommits()]);
      } catch (e) {
        Alpine.store('toast').showToast(e.message, 'error');
      }
    },
    async rejectEntry(entry) {
      Alpine.store('confirm').open('Reject this entry?', async () => {
        try {
          await API.rejectStaged(entry.id || entry.entry_id, {});
          Alpine.store('toast').showToast('Entry rejected', 'success');
          await this.loadStaged();
        } catch (e) {
          Alpine.store('toast').showToast(e.message, 'error');
        }
      });
    },
    async pushAll() {
      if (!this.pushMessage) return;
      try {
        await API.pushCommits(this.pushMessage);
        Alpine.store('toast').showToast('All changes pushed', 'success');
        await Promise.all([this.loadStaged(), this.loadCommits()]);
      } catch (e) {
        Alpine.store('toast').showToast(e.message, 'error');
      }
    },
    async publishMonth() {
      this.publishLoading = true;
      try {
        await API.publishMonth({ month: this.currentMonth, year: this.currentYear });
        Alpine.store('toast').showToast('Month published', 'success');
        await this.loadCommits();
      } catch (e) {
        Alpine.store('toast').showToast(e.message, 'error');
      }
      this.publishLoading = false;
    },
    async openDiff(commit) {
      this.diffData = null;
      this.diffModalOpen = true;
      this.diffLoading = true;
      try {
        const res = await API.getCommitDiff(commit.commit_id || commit.id);
        this.diffData = Array.isArray(res) ? res : res.diff || res.changes || [];
      } catch {
        this.diffData = [];
        Alpine.store('toast').showToast('Failed to load diff', 'error');
      }
      this.diffLoading = false;
    },
    closeDiff() {
      this.diffModalOpen = false;
      this.diffData = null;
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
    retryStaged() {
      this.loadStaged();
    },
    retryCommits() {
      this.loadCommits();
    },
  };
}
