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
    if (!res.ok) throw new Error(data.error || data.message || 'Request failed');
    // Unwrap envelope if present
    if (data && typeof data === 'object' && 'data' in data && 'error' in data) return data.data;
    return data;
  },

  // ── Auth ──────────────────────────────────────────────────────────
  login: (p) => API.request('/api/auth/login', { method: 'POST', body: JSON.stringify(p) }),
  getMe: () => API.request('/api/auth/me'),
  logout: () => API.request('/api/auth/logout', { method: 'POST' }),

  // ── Period ────────────────────────────────────────────────────────
  getNow: () => API.request('/api/inventory/now'),
  getCurrentMonth: () => API.request('/api/inventory/current-month'),

  // ── Items ─────────────────────────────────────────────────────────
  getItems: (month, year, perPage = 200, page = 1) =>
    API.request(`/api/inventory/items?month=${month}&year=${year}&per_page=${perPage}&page=${page}`),
  getItem: (id) => API.request(`/api/inventory/items/${id}`),
  createItem: (data) => API.request('/api/inventory/items', { method: 'POST', body: JSON.stringify(data) }),
  updateItem: (id, data) => API.request(`/api/inventory/items/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteItem: (id) => API.request(`/api/inventory/items/${id}`, { method: 'DELETE' }),

  // ── Summary / Categories ──────────────────────────────────────────
  getSummary: (month, year) => API.request(`/api/inventory/summary?month=${month}&year=${year}`),
  getCategories: () => API.request('/api/inventory/categories'),
  getHistory: () => API.request('/api/inventory/history'),

  // ── Staging / Commits ─────────────────────────────────────────────
  stageCommit: (data) => API.request('/api/inventory/submit', { method: 'POST', body: JSON.stringify(data) }),
  getStaged: () => API.request('/api/inventory/staging'),
  getStagedEntry: (id) => API.request(`/api/inventory/staging/${id}`),
  mergeStaged: (id) => API.request(`/api/inventory/staging/${id}/merge`, { method: 'POST' }),
  rejectStaged: (id, data) => API.request(`/api/inventory/pending/${id}/reject`, { method: 'POST', body: JSON.stringify(data || {}) }),
  pushCommits: (message, branch = 'main') =>
    API.request('/api/inventory/commits/push', { method: 'POST', body: JSON.stringify({ message, branch }) }),
  getCommits: (page = 1) => API.request(`/api/inventory/commits?page=${page}`),
  getCommit: (id) => API.request(`/api/inventory/commits/${id}`),
  getCommitTree: () => API.request('/api/inventory/commits/tree'),
  revertCommit: (id) => API.request(`/api/inventory/commits/${id}/revert`, { method: 'POST' }),
  publishMonth: (data) => API.request('/api/inventory/publish', { method: 'POST', body: JSON.stringify(data) }),

  // ── Barcodes ──────────────────────────────────────────────────────
  getBarcodes: () => API.request('/api/inventory/barcodes'),
  exportBarcodes: (data) => API.request('/api/inventory/barcodes/export', { method: 'POST', body: JSON.stringify(data) }),

  // ── Invoice ───────────────────────────────────────────────────────
  parseInvoice: (data) => API.request('/api/inventory/parse-invoice', { method: 'POST', body: JSON.stringify(data) }),
  applyInvoice: (data) => API.request('/api/inventory/apply-invoice', { method: 'POST', body: JSON.stringify(data) }),

  // ── Snapshot / Versions ───────────────────────────────────────────
  saveSnapshot: (data) => API.request('/api/inventory/snapshot', { method: 'POST', body: JSON.stringify(data) }),
  rollover: (data) => API.request('/api/inventory/rollover', { method: 'POST', body: JSON.stringify(data) }),
  getVersions: (month, year) => API.request(`/api/inventory/versions?month=${month}&year=${year}`),

  // ── Users ─────────────────────────────────────────────────────────
  getUsers: () => API.request('/api/users'),
  createUser: (data) => API.request('/api/users', { method: 'POST', body: JSON.stringify(data) }),
  updateUser: (id, data) => API.request(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteUser: (id) => API.request(`/api/users/${id}`, { method: 'DELETE' }),
  resetPin: (id, data) => API.request(`/api/users/${id}/pin`, { method: 'PATCH', body: JSON.stringify(data) }),

  // ── Settings ──────────────────────────────────────────────────────
  getSettings: () => API.request('/api/settings'),
  updateSetting: (key, value) => API.request('/api/settings', { method: 'PATCH', body: JSON.stringify({ key, value }) }),
};
