document.addEventListener('alpine:init', () => {

  // ── Toast ──────────────────────────────────────────────────────────
  Alpine.store('toast', {
    show: false,
    message: '',
    type: 'info',
    _timer: null,
    showToast(message, type = 'info', duration = 3500) {
      clearTimeout(this._timer);
      this.message = message;
      this.type = type;
      this.show = true;
      this._timer = setTimeout(() => { this.show = false; }, duration);
    },
    hide() { this.show = false; },
  });

  // ── Confirm dialog ─────────────────────────────────────────────────
  Alpine.store('confirm', {
    show: false,
    message: '',
    _resolve: null,
    open(message, onConfirm) {
      this.message = message;
      this._resolve = onConfirm;
      this.show = true;
    },
    confirm() {
      this.show = false;
      if (this._resolve) this._resolve();
      this._resolve = null;
    },
    cancel() {
      this.show = false;
      this._resolve = null;
    },
  });

  // ── Modal ──────────────────────────────────────────────────────────
  Alpine.store('modal', {
    show: false,
    title: '',
    content: '',
    data: null,
    open(title, content, data = null) {
      this.title = title;
      this.content = content;
      this.data = data;
      this.show = true;
    },
    hide() { this.show = false; },
  });

  // ── Sidebar ────────────────────────────────────────────────────────
  Alpine.store('sidebar', {
    collapsed: false,
    active: 'inventory',
    items: [
      { id: 'home',           label: 'Home',           icon: 'fas fa-home',          roles: ['assistant', 'manager', 'admin'] },
      { id: 'inventory',      label: 'Inventory',      icon: 'fas fa-boxes-stacked', roles: ['staff', 'assistant', 'manager', 'admin'] },
      { id: 'source-control', label: 'Source Control', icon: 'fas fa-code-branch',   roles: ['assistant', 'manager', 'admin'] },
      { id: 'reports',        label: 'Reports',        icon: 'fas fa-chart-line',    roles: ['manager', 'admin'] },
      { id: 'users',          label: 'Users',          icon: 'fas fa-users',         roles: ['admin'] },
      { id: 'barcodes',       label: 'Barcodes',       icon: 'fas fa-barcode',       roles: ['staff', 'assistant', 'manager', 'admin'] },
      { id: 'settings',       label: 'Settings',       icon: 'fas fa-gear',          roles: ['admin'] },
      { id: 'files',          label: 'Files',          icon: 'fas fa-folder-open',   roles: ['manager', 'admin'] },
      { id: 'qr-portal',      label: 'QR Portal',      icon: 'fas fa-qrcode',        roles: ['staff', 'assistant', 'manager', 'admin'] },
    ],
    get filteredItems() {
      const role = Alpine.store('auth')?.user?.role || 'staff';
      return this.items.filter(i => i.roles.includes(role));
    },
    toggle() { this.collapsed = !this.collapsed; },
    setActive(id) {
      this.active = id;
      window.location.hash = id;
    },
  });

  // ── Auth ───────────────────────────────────────────────────────────
  Alpine.store('auth', {
    user: null,
    loading: true,
    async init() {
      try {
        const res = await fetch('/api/auth/me', { credentials: 'include' });
        const data = await res.json();
        if (data.authenticated) {
          this.user = data.user;
          const role = data.user?.role || 'staff';
          const hash = window.location.hash.replace('#', '');
          const sidebar = Alpine.store('sidebar');
          if (hash && sidebar.items.some(i => i.id === hash && i.roles.includes(role))) {
            sidebar.active = hash;
          } else {
            sidebar.active = role === 'staff' ? 'inventory' : 'home';
          }
        } else {
          window.location.href = '/?expired=1';
        }
      } catch {
        window.location.href = '/';
      } finally {
        this.loading = false;
      }
    },
    async logout() {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
      window.location.href = '/';
    },
  });

  // ── Now (current period) ───────────────────────────────────────────
  // Rule: always seed from the CLIENT's real Date() first — the browser
  // knows the user's local time. Then optionally check if the DB has a
  // different open month (admin override), accepting it only if it is
  // within ±1 month of the real calendar date.
  const _MONTH_NAMES = ['January','February','March','April','May','June',
                        'July','August','September','October','November','December'];
  const _clientNow = new Date();

  Alpine.store('now', {
    month:      _clientNow.getMonth(),
    year:       _clientNow.getFullYear(),
    week:       Math.min(4, Math.ceil(_clientNow.getDate() / 7)),
    month_name: _MONTH_NAMES[_clientNow.getMonth()],
    loaded:     false,

    async init() {
      // Step 1: authoritative client date
      const d        = new Date();
      this.month     = d.getMonth();
      this.year      = d.getFullYear();
      this.week      = Math.min(4, Math.ceil(d.getDate() / 7));
      this.month_name = _MONTH_NAMES[this.month];

      // Step 2: check DB open month — only override if admin set a different month
      // and it's within ±1 of the real calendar month (guards against stale data)
      try {
        const res = await fetch('/api/inventory/current-month', { credentials: 'include' });
        if (res.ok) {
          const payload = await res.json();
          const rec = (payload && payload.data != null) ? payload.data : payload;
          if (rec && rec.status === 'open' && typeof rec.month === 'number' && typeof rec.year === 'number') {
            const dbTs   = rec.year * 12 + rec.month;
            const realTs = d.getFullYear() * 12 + d.getMonth();
            if (Math.abs(dbTs - realTs) <= 1) {
              this.month      = rec.month;
              this.year       = rec.year;
              this.month_name = _MONTH_NAMES[rec.month];
            }
          }
        }
      } catch { /* server unreachable — client date is correct */ }

      this.loaded = true;
    },
  });

});
