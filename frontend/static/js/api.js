/**
 * api.js — Centralized API client for MJCC Portal
 *
 * Every fetch call in the app goes through API.request().
 * All endpoints are defined here — never write a raw fetch() elsewhere.
 *
 * Base: /api/
 *   /auth/*        — authentication
 *   /inventory/*   — items, commits, barcodes, invoices, reports
 *   /users/*       — user management
 *   /settings/*    — app settings
 *   /github/*      — GitHub data store sync
 *   /files/*       — file uploads (coming soon)
 */

const API = {
  // ── Core request ────────────────────────────────────────────────────

  async request(url, opts = {}) {
    const res = await fetch(url, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...opts.headers },
      ...opts,
    });

    if (res.status === 401) {
      // Session expired — redirect to login
      window.location.href = '/?expired=1';
      throw new Error('Session expired');
    }

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || data.message || `HTTP ${res.status}`);
    }

    // Unwrap {data, error, meta} envelope if present
    if (data && typeof data === 'object' && 'data' in data && 'error' in data) {
      return data.data;
    }
    return data;
  },

  // ── Auth  /api/auth/* ────────────────────────────────────────────────

  login:   (payload)  => API.request('/api/auth/login',  { method: 'POST', body: JSON.stringify(payload) }),
  me:      ()         => API.request('/api/auth/me'),
  logout:  ()         => API.request('/api/auth/logout', { method: 'POST' }),

  // ── Period helpers  /api/inventory/* ────────────────────────────────

  getNow:          ()         => API.request('/api/inventory/now'),
  getCurrentMonth: ()         => API.request('/api/inventory/current-month'),
  getCurrentWeek:  ()         => API.request('/api/inventory/current-week'),

  // ── Items ────────────────────────────────────────────────────────────

  getItems:   (month, year, perPage = 200, page = 1, category = '') => {
    let url = `/api/inventory/items?month=${month}&year=${year}&per_page=${perPage}&page=${page}`;
    if (category) url += `&category=${encodeURIComponent(category)}`;
    return API.request(url);
  },
  getItem:    (id)            => API.request(`/api/inventory/items/${id}`),
  createItem: (data)          => API.request('/api/inventory/items',      { method: 'POST',   body: JSON.stringify(data) }),
  updateItem: (id, data)      => API.request(`/api/inventory/items/${id}`, { method: 'PATCH',  body: JSON.stringify(data) }),
  deleteItem: (id)            => API.request(`/api/inventory/items/${id}`, { method: 'DELETE' }),

  // ── Summary & categories ─────────────────────────────────────────────

  getSummary:    (month, year) => API.request(`/api/inventory/summary?month=${month}&year=${year}`),
  getCategories: ()            => API.request('/api/inventory/categories'),
  getHistory:    ()            => API.request('/api/inventory/history'),

  // ── Commits / staging pipeline ───────────────────────────────────────
  //
  // POST /commits/stage  — submit a change
  //   role < 20 (staff):    goes to staging, awaits manager approval
  //   role >= 20 (assistant/manager/admin): auto-commits + GitHub sync
  //
  // POST /commits/push   — manager pushes all staged entries as one commit

  stageCommit: (data)    => API.request('/api/inventory/commits/stage',   { method: 'POST', body: JSON.stringify(data) }),
  getStaged:   ()        => API.request('/api/inventory/staging'),
  getStagedEntry: (id)   => API.request(`/api/inventory/staging/${id}`),
  mergeStaged: (id)      => API.request(`/api/inventory/staging/${id}/merge`, { method: 'POST' }),
  rejectStaged: (id, note) => API.request(`/api/inventory/pending/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ review_note: note || '' }),
  }),
  deleteStagedEntry: (id) => API.request(`/api/inventory/staging/${id}`, { method: 'DELETE' }),

  pushCommits: (message, branch = 'main', month, year) => API.request('/api/inventory/commits/push', {
    method: 'POST',
    body: JSON.stringify({ message, branch, month, year }),
  }),

  getCommits:    (page = 1, perPage = 20) => API.request(`/api/inventory/commits?page=${page}&per_page=${perPage}`),
  getCommit:     (id)    => API.request(`/api/inventory/commits/${id}`),
  getCommitTree: ()      => API.request('/api/inventory/commits/tree'),
  revertCommit:  (id)    => API.request(`/api/inventory/commits/${id}/revert`, { method: 'POST' }),

  // ── Month lifecycle ──────────────────────────────────────────────────

  publishMonth: (data)   => API.request('/api/inventory/publish',  { method: 'POST', body: JSON.stringify(data) }),
  rollover:     (data)   => API.request('/api/inventory/rollover', { method: 'POST', body: JSON.stringify(data) }),
  saveSnapshot: (data)   => API.request('/api/inventory/snapshot', { method: 'POST', body: JSON.stringify(data) }),

  // ── Versions ─────────────────────────────────────────────────────────

  getVersions:    (month, year) => API.request(`/api/inventory/versions?month=${month}&year=${year}`),
  createVersion:  (data)        => API.request('/api/inventory/versions',              { method: 'POST', body: JSON.stringify(data) }),
  restoreVersion: (id)          => API.request(`/api/inventory/versions/${id}/restore`, { method: 'POST' }),

  // ── Invoice / AI parsing ─────────────────────────────────────────────
  //
  // parseInvoice accepts { text, month, year }  — text invoice
  //              or      { image, month, year } — base64 image (JPEG/PNG/WEBP)
  //                        image can be a data URI or raw base64

  parseInvoice: (data) => API.request('/api/inventory/parse-invoice', { method: 'POST', body: JSON.stringify(data) }),
  applyInvoice: (data) => API.request('/api/inventory/apply-invoice', { method: 'POST', body: JSON.stringify(data) }),

  // Helper: read a File object and call parseInvoice with the image
  parseInvoiceFromFile: async (file, month, year) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const result = await API.parseInvoice({ image: e.target.result, month, year });
          resolve(result);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  },

  // ── Barcodes ─────────────────────────────────────────────────────────

  getBarcodes:    ()     => API.request('/api/inventory/barcodes'),
  exportBarcodes: (data) => API.request('/api/inventory/barcodes/export', { method: 'POST', body: JSON.stringify(data) }),

  // ── Activity / reporting ─────────────────────────────────────────────

  getActivity:      (filters = {}) => {
    const qs = new URLSearchParams(filters).toString();
    return API.request(`/api/inventory/activity${qs ? '?' + qs : ''}`);
  },
  getActivityStats: (filters = {}) => {
    const qs = new URLSearchParams(filters).toString();
    return API.request(`/api/inventory/activity/stats${qs ? '?' + qs : ''}`);
  },

  // ── Users  /api/users/* ───────────────────────────────────────────────

  getUsers:    ()        => API.request('/api/users'),
  createUser:  (data)    => API.request('/api/users',       { method: 'POST',   body: JSON.stringify(data) }),
  updateUser:  (id, data) => API.request(`/api/users/${id}`, { method: 'PATCH',  body: JSON.stringify(data) }),
  deleteUser:  (id)      => API.request(`/api/users/${id}`, { method: 'DELETE' }),
  resetPin:    (id, data) => API.request(`/api/users/${id}/pin`, { method: 'PATCH', body: JSON.stringify(data) }),

  // ── Settings  /api/settings/* ────────────────────────────────────────

  getSettings:    ()          => API.request('/api/settings'),
  updateSetting:  (key, value) => API.request('/api/settings', { method: 'PATCH', body: JSON.stringify({ key, value }) }),

  // ── GitHub sync  /api/github/* ────────────────────────────────────────

  getGithubStatus:  ()           => API.request('/api/github/status'),
  triggerGithubSync: (month, year) => API.request('/api/github/sync',    { method: 'POST', body: JSON.stringify({ month, year }) }),
  listGithubFiles:  (path)       => API.request(`/api/github/files?path=${encodeURIComponent(path)}`),
  getGithubFile:    (path)       => API.request(`/api/github/file?path=${encodeURIComponent(path)}`),
  getGithubCommits: (page = 1)   => API.request(`/api/github/commits?page=${page}`),

  // ── Files  /api/files/* ──────────────────────────────────────────────
  // (coming soon — stubs return 501)

  uploadFile:  (formData) => fetch('/api/files/upload', { method: 'POST', credentials: 'include', body: formData }).then(r => r.json()),
  listFiles:   ()         => API.request('/api/files'),
  deleteFile:  (id)       => API.request(`/api/files/${id}`, { method: 'DELETE' }),
};
