const API = {
  async request(url, opts = {}) {
    const res = await fetch(url, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...opts.headers },
      ...opts,
    });
    if (res.status === 401) {
      window.location.href = '/?expired=1';
      throw new Error('Session expired');
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  },

  login(payload) {
    return this.request('/api/auth/login', { method: 'POST', body: JSON.stringify(payload) });
  },
  getMe() {
    return this.request('/api/auth/me');
  },
  logout() {
    return this.request('/api/auth/logout', { method: 'POST' });
  },

  getNow() {
    return this.request('/api/inventory/now');
  },
  getCurrentMonth() {
    return this.request('/api/inventory/current-month');
  },
  getCurrentWeek() {
    return this.request('/api/inventory/current-week');
  },
  getItems(month, year, perPage = 100, page = 1) {
    return this.request(
      `/api/inventory/items?month=${month}&year=${year}&per_page=${perPage}&page=${page}`,
    );
  },
  getItem(id) {
    return this.request(`/api/inventory/items/${id}`);
  },
  createItem(data) {
    return this.request('/api/inventory/items', { method: 'POST', body: JSON.stringify(data) });
  },
  updateItem(id, data) {
    return this.request(`/api/inventory/items/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },
  deleteItem(id) {
    return this.request(`/api/inventory/items/${id}`, { method: 'DELETE' });
  },
  getSummary(month, year) {
    return this.request(`/api/inventory/summary?month=${month}&year=${year}`);
  },
  getCategories() {
    return this.request('/api/inventory/categories');
  },
  getHistory() {
    return this.request('/api/inventory/history');
  },

  stageCommit(data) {
    return this.request('/api/inventory/submit', { method: 'POST', body: JSON.stringify(data) });
  },
  getStaged() {
    return this.request('/api/inventory/pending');
  },
  getStagedEntry(id) {
    return this.request(`/api/inventory/pending/${id}`);
  },
  reviseStaged(id, data) {
    return this.request(`/api/inventory/pending/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },
  mergeStaged(id) {
    return this.request(`/api/inventory/pending/${id}/approve`, { method: 'POST' });
  },
  rejectStaged(id, data) {
    return this.request(`/api/inventory/pending/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify(data || {}),
    });
  },
  publishMonth(data) {
    return this.request('/api/inventory/publish', { method: 'POST', body: JSON.stringify(data) });
  },

  pushCommits(message, branch = 'main') {
    return this.request('/api/inventory/push-all', {
      method: 'POST',
      body: JSON.stringify({ message, branch }),
    });
  },
  getCommits(month, year, page = 1) {
    return this.request(`/api/inventory/commits?month=${month}&year=${year}&page=${page}`);
  },
  getCommit(id) {
    return this.request(`/api/inventory/commits/${id}`);
  },
  getCommitDiff(id) {
    return this.request(`/api/inventory/commits/${id}/diff`);
  },
  getCommitTree() {
    return this.request('/api/inventory/commits/tree');
  },
  revertCommit(id, data) {
    return this.request(`/api/inventory/commits/${id}/revert`, {
      method: 'POST',
      body: JSON.stringify(data || {}),
    });
  },

  getVersions(month, year) {
    return this.request(`/api/inventory/versions?month=${month}&year=${year}`);
  },
  getVersion(id) {
    return this.request(`/api/inventory/versions/${id}`);
  },
  saveVersion(data) {
    return this.request('/api/inventory/versions', { method: 'POST', body: JSON.stringify(data) });
  },
  restoreVersion(id) {
    return this.request(`/api/inventory/versions/${id}/restore`, { method: 'POST' });
  },

  parseInvoice(data) {
    return this.request('/api/inventory/parse-invoice', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
  applyInvoice(data) {
    return this.request('/api/inventory/apply-invoice', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  getBarcodes() {
    return this.request('/api/inventory/barcodes');
  },
  exportBarcodes(data) {
    return this.request('/api/inventory/barcodes/export', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
  getItemBarcode(id) {
    return this.request(`/api/inventory/items/${id}/barcode`, { method: 'POST' });
  },
  regenerateBarcode(id) {
    return this.request(`/api/inventory/items/${id}/barcode/regenerate`, { method: 'POST' });
  },

  getActivity(from, to) {
    return this.request(`/api/inventory/activity?from=${from || ''}&to=${to || ''}`);
  },
  getActivityStats(filters) {
    return this.request('/api/inventory/activity/stats', {
      method: 'POST',
      body: JSON.stringify(filters || {}),
    });
  },

  getUsers() {
    return this.request('/api/users');
  },
  getUser(id) {
    return this.request(`/api/users/${id}`);
  },
  createUser(data) {
    return this.request('/api/users', { method: 'POST', body: JSON.stringify(data) });
  },
  updateUser(id, data) {
    return this.request(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  },
  deleteUser(id) {
    return this.request(`/api/users/${id}`, { method: 'DELETE' });
  },
  resetPin(id, data) {
    return this.request(`/api/users/${id}/pin`, { method: 'PATCH', body: JSON.stringify(data) });
  },

  getSettings() {
    return this.request('/api/settings');
  },
  updateSettings(data) {
    return this.request('/api/settings', { method: 'PATCH', body: JSON.stringify(data) });
  },

  getFiles() {
    return this.request('/api/files');
  },
  uploadFile(file) {
    const formData = new FormData();
    formData.append('file', file);
    return fetch('/api/files/upload', {
      method: 'POST',
      credentials: 'include',
      body: formData,
    }).then((r) => r.json());
  },
  deleteFile(id) {
    return this.request(`/api/files/${id}`, { method: 'DELETE' });
  },
};
