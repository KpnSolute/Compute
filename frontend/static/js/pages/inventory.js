function inventoryPage() {
  return {
    selMonth: new Date().getMonth(),
    selYear: new Date().getFullYear(),
    selWeek: 1,
    selCategory: '',
    items: [],
    allItems: [],
    filtered: [],
    categories: [],
    summary: {},
    loading: true,
    canWrite: false,
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
    commitModalOpen: false,
    diffModalOpen: false,
    diffData: null,
    diffLoading: false,
    commitForm: {
      search: '',
      selectedItem: null,
      searchResults: [],
      week: 1,
      field: 'received',
      action: 'pull',
      value: 0,
    },
    summaryLoading: false,
    itemsLoading: false,
    summaryError: false,
    itemsError: false,
    page: 1,
    perPage: 100,
    totalItems: 0,
    totalPages: 1,
    searchQuery: '',
    sortField: '',
    sortDir: 'asc',

    editingCell: null,
    editValue: '',
    cellSaveStatus: {},

    chartInstance: null,
    generatingBarcodes: {},

    async ensureBarcode(itemId, itemDescript) {
      if (this.generatingBarcodes[itemId]) return;
      this.generatingBarcodes[itemId] = true;
      try {
        const res = await API.getItemBarcode(itemId);
        if (!res || !res.barcode_id) {
          await API.regenerateBarcode(itemId);
        }
      } catch {
        // silently skip — barcodes are best-effort on save
      } finally {
        delete this.generatingBarcodes[itemId];
      }
    },
    async generateAllBarcodes() {
      const btn = document.getElementById('gen-all-barcodes');
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Generating...';
      }
      let count = 0;
      for (const item of this.allItems) {
        if (!item.item_id) continue;
        try {
          const res = await API.getItemBarcode(item.item_id);
          if (!res || !res.barcode_id) {
            await API.regenerateBarcode(item.item_id);
            count++;
          }
        } catch {
          // skip
        }
      }
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Generate All';
      }
      Alpine.store('toast').showToast(`Generated ${count} barcode(s)`, 'success');
    },

    async initPage() {
      this.canWrite = ['admin', 'manager', 'assistant'].includes(
        Alpine.store('auth')?.user?.role || '',
      );
      const role = Alpine.store('auth')?.user?.role || 'staff';
      if (role === 'staff') {
        const wk = await API.getCurrentWeek().catch(() => ({ week: 1 }));
        this.selWeek = wk.week || 1;
      }
      await this.loadData();
    },
    destroy() {
      if (this.chartInstance) {
        this.chartInstance.destroy();
        this.chartInstance = null;
      }
    },
    async loadData(pg) {
      if (pg) this.page = pg;
      this.itemsLoading = true;
      this.summaryLoading = true;
      this.itemsError = false;
      this.summaryError = false;
      const [itemsRes, catsRes] = await Promise.all([
        API.getItems(this.selMonth, this.selYear, this.perPage, this.page).catch((e) => {
          this.itemsError = true;
          return { items: [] };
        }),
        API.getCategories().catch(() => []),
      ]);
      this.itemsLoading = false;
      this.allItems = Array.isArray(itemsRes) ? itemsRes : itemsRes.items || [];
      this.totalItems =
        (itemsRes && itemsRes.pagination && itemsRes.pagination.total_count) ||
        this.allItems.length;
      this.totalPages = (itemsRes && itemsRes.pagination && itemsRes.pagination.total_pages) || 1;
      this.categories = Array.isArray(catsRes) ? catsRes : catsRes.categories || [];
      try {
        this.summary = await API.getSummary(this.selMonth, this.selYear);
      } catch {
        this.summaryError = true;
        this.summary = {};
      }
      this.summaryLoading = false;
      this.filterItems();
      this.$nextTick(() => this.renderChart());
    },
    filterItems() {
      let result = this.allItems;
      if (this.selCategory) {
        result = result.filter((i) => i.category === this.selCategory);
      }
      if (this.searchQuery) {
        const q = this.searchQuery.toLowerCase();
        result = result.filter(
          (i) =>
            (i.description || '').toLowerCase().includes(q) ||
            (i.sku || '').toLowerCase().includes(q),
        );
      }
      if (this.sortField) {
        result = [...result].sort((a, b) => {
          const va = a[this.sortField] ?? 0;
          const vb = b[this.sortField] ?? 0;
          return this.sortDir === 'asc' ? (va > vb ? 1 : -1) : va < vb ? 1 : -1;
        });
      }
      this.filtered = result;
    },
    toggleSort(field) {
      if (this.sortField === field) {
        this.sortDir = this.sortDir === 'asc' ? 'desc' : '';
        if (this.sortDir === '') this.sortField = '';
      } else {
        this.sortField = field;
        this.sortDir = 'asc';
      }
      this.filterItems();
    },
    getWeekField(item, field) {
      const w = this.selWeek;
      if (field === 'received') return item[`w${w}_received`] ?? 0;
      if (field === 'issued') return item[`w${w}_issued`] ?? 0;
      if (field === 'ending_qty') {
        const onHand = parseFloat(item.on_hand) || 0;
        let totalRec = 0,
          totalIss = 0;
        for (let i = 1; i <= w; i++) {
          totalRec += parseFloat(item[`w${i}_received`]) || 0;
          totalIss += parseFloat(item[`w${i}_issued`]) || 0;
        }
        return onHand + totalRec - totalIss;
      }
      return 0;
    },
    number(v) {
      return typeof v === 'number' ? Math.round(v).toLocaleString() : v || '0';
    },

    isEditing(id, field, week) {
      return (
        this.editingCell &&
        this.editingCell.id === id &&
        this.editingCell.field === field &&
        this.editingCell.week === week
      );
    },
    getCellKey(id, field, week) {
      return id + '-' + field + '-' + week;
    },
    cellStatus(id, field, week) {
      return this.cellSaveStatus[this.getCellKey(id, field, week)] || '';
    },
    canEditField(item, field) {
      const role = Alpine.store('auth')?.user?.role || 'staff';
      if (role === 'staff') return field === 'issued';
      if (field === 'unit_price') return role === 'admin' || role === 'manager';
      return true;
    },
    getCellValue(item, field, week) {
      if (field === 'on_hand') return parseFloat(item.on_hand) || 0;
      if (field === 'unit_price') return parseFloat(item.unit_price) || 0;
      if (field === 'received') return parseFloat(item[`w${week}_received`]) || 0;
      if (field === 'issued') return parseFloat(item[`w${week}_issued`]) || 0;
      return 0;
    },
    fieldToApiField(field, week) {
      if (field === 'on_hand') return 'on_hand';
      if (field === 'unit_price') return 'unit_price';
      if (field === 'received') return 'w' + week + '_received';
      if (field === 'issued') return 'w' + week + '_issued';
      return field;
    },
    startEdit(item, field, week) {
      if (!this.canEditField(item, field)) return;
      this.editingCell = { id: item.item_id, field, week };
      this.editValue = String(this.getCellValue(item, field, week));
      this.$nextTick(() => {
        const el = document.querySelector('.cell-input');
        if (el) setTimeout(() => el.focus(), 50);
      });
    },
    cancelEdit() {
      this.editingCell = null;
      this.editValue = '';
    },
    async saveEdit(item, field, week) {
      const newVal = parseFloat(this.editValue);
      if (isNaN(newVal) || newVal < 0) {
        this.cancelEdit();
        return;
      }
      const oldVal = this.getCellValue(item, field, week);
      if (newVal === oldVal) {
        this.cancelEdit();
        return;
      }
      const apiField = this.fieldToApiField(field, week);
      const key = this.getCellKey(item.item_id, field, week);
      this.cellSaveStatus[key] = 'saving';
      const col =
        apiField === 'on_hand' || apiField === 'unit_price' ? apiField : `w${week}_${field}`;
      item[col] = newVal;
      this.editingCell = null;
      try {
        await API.updateItem(item.item_id, {
          field: apiField,
          value: newVal,
          month: this.selMonth,
          year: this.selYear,
        });
        this.cellSaveStatus[key] = 'saved';
        this.ensureBarcode(item.item_id, item.description);
        setTimeout(() => {
          if (this.cellSaveStatus[key] === 'saved') delete this.cellSaveStatus[key];
        }, 2000);
      } catch (e) {
        item[col] = oldVal;
        this.cellSaveStatus[key] = 'error';
        Alpine.store('toast').showToast(e.message || 'Save failed', 'error');
        setTimeout(() => {
          if (this.cellSaveStatus[key] === 'error') delete this.cellSaveStatus[key];
        }, 3000);
      }
    },
    renderChart() {
      if (typeof Chart === 'undefined') return;
      if (this.chartInstance) this.chartInstance.destroy();
      const el = document.getElementById('category-chart');
      if (!el) return;
      const catMap = {};
      this.allItems.forEach((i) => {
        const name = i.category || 'Uncategorized';
        if (!catMap[name]) catMap[name] = 0;
        catMap[name] += (this.getEndQty(i) || 0) * (i.unit_price || 0);
      });
      const labels = Object.keys(catMap);
      const values = Object.values(catMap);
      if (labels.length === 0) return;
      this.chartInstance = new Chart(el, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            {
              label: 'Category Value ($)',
              data: values,
              backgroundColor: [
                '#3b82f6',
                '#10b981',
                '#f59e0b',
                '#ef4444',
                '#8b5cf6',
                '#ec4899',
                '#14b8a6',
                '#f97316',
                '#6366f1',
              ],
              borderRadius: 4,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            y: { beginAtZero: true, ticks: { callback: (v) => '$' + v.toLocaleString() } },
            x: { grid: { display: false } },
          },
        },
      });
    },
    getEndQty(item) {
      let ending = parseFloat(item.on_hand) || 0;
      for (let w = 1; w <= 4; w++) {
        ending +=
          (parseFloat(item[`w${w}_received`]) || 0) - (parseFloat(item[`w${w}_issued`]) || 0);
      }
      return Math.max(0, ending);
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
    openPullSheet() {
      window.open('/pull_sheet', 'pullsheet', 'width=1000,height=800');
    },
    openCommitModal() {
      this.commitForm = {
        search: '',
        selectedItem: null,
        searchResults: [],
        week: this.selWeek,
        field: 'received',
        action: 'pull',
        value: 0,
      };
      this.commitModalOpen = true;
    },
    async searchItems() {
      if (!this.commitForm.search.trim()) {
        this.commitForm.searchResults = [];
        return;
      }
      const q = this.commitForm.search.toLowerCase();
      this.commitForm.searchResults = this.allItems
        .filter(
          (i) =>
            (i.description || '').toLowerCase().includes(q) ||
            (i.sku || '').toLowerCase().includes(q),
        )
        .slice(0, 10);
    },
    selectCommitItem(item) {
      this.commitForm.selectedItem = item;
      this.commitForm.search = item.description;
      this.commitForm.searchResults = [];
    },
    async submitCommit() {
      const f = this.commitForm;
      if (!f.selectedItem || !f.value) return;
      try {
        await API.stageCommit({
          item_id: f.selectedItem.item_id,
          month: this.selMonth,
          year: this.selYear,
          week_number: f.week,
          field: f.field,
          action: f.action,
          value: f.value,
        });
        Alpine.store('toast').showToast('Change submitted for review', 'success');
        this.commitModalOpen = false;
        await this.loadData();
      } catch (e) {
        Alpine.store('toast').showToast(e.message, 'error');
      }
    },
    jumpToCurrent() {
      this.selMonth = new Date().getMonth();
      this.selYear = new Date().getFullYear();
      this.loadData();
    },
    prevPage() {
      if (this.page > 1) this.loadData(this.page - 1);
    },
    nextPage() {
      if (this.page < this.totalPages) this.loadData(this.page + 1);
    },
    retrySummary() {
      this.summaryError = false;
      this.loadData();
    },
    retryItems() {
      this.itemsError = false;
      this.loadData();
    },
  };
}
