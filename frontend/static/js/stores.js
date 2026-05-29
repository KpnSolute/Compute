document.addEventListener('alpine:init', () => {
  Alpine.store('toast', {
    show: false,
    message: '',
    type: 'success',
    timer: null,
    showToast(msg, type = 'success') {
      this.message = msg;
      this.type = type;
      this.show = true;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        this.show = false;
      }, 3500);
    },
    hide() {
      this.show = false;
    },
  });

  Alpine.store('confirm', {
    show: false,
    message: '',
    onConfirm: null,
    open(msg, onConfirm) {
      this.message = msg;
      this.onConfirm = onConfirm;
      this.show = true;
    },
    confirm() {
      if (this.onConfirm) this.onConfirm();
      this.show = false;
    },
    cancel() {
      this.show = false;
    },
  });

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
    hide() {
      this.show = false;
    },
  });

  Alpine.store('sidebar', {
    collapsed: false,
    active: 'inventory',
    items: [
      {
        id: 'inventory',
        label: 'Inventory',
        icon: '<i class="fas fa-chart-bar"></i>',
        roles: ['staff', 'assistant', 'manager', 'admin'],
      },
      {
        id: 'source-control',
        label: 'Source Control',
        icon: '<i class="fas fa-code-branch"></i>',
        roles: ['assistant', 'manager', 'admin'],
      },
      {
        id: 'reports',
        label: 'Reports',
        icon: '<i class="fas fa-chart-line"></i>',
        roles: ['manager', 'admin'],
      },
      {
        id: 'users',
        label: 'Users',
        icon: '<i class="fas fa-users"></i>',
        roles: ['manager', 'admin'],
      },
      {
        id: 'barcodes',
        label: 'Barcodes',
        icon: '<i class="fas fa-box"></i>',
        roles: ['staff', 'assistant', 'manager', 'admin'],
      },
      { id: 'settings', label: 'Settings', icon: '<i class="fas fa-cog"></i>', roles: ['admin'] },
      {
        id: 'files',
        label: 'Files',
        icon: '<i class="fas fa-folder"></i>',
        roles: ['manager', 'admin'],
      },
      {
        id: 'qr-portal',
        label: 'QR Portal',
        icon: '<i class="fas fa-qrcode"></i>',
        roles: ['staff', 'assistant', 'manager', 'admin'],
      },
    ],
    get filteredItems() {
      const role = Alpine.store('auth')?.user?.role || 'staff';
      return this.items.filter((i) => i.roles.includes(role));
    },
    toggle() {
      this.collapsed = !this.collapsed;
    },
    setActive(id) {
      this.active = id;
      window.location.hash = id;
    },
  });

  Alpine.store('auth', {
    user: null,
    loading: true,
    async init() {
      try {
        const res = await fetch('/api/auth/me', { credentials: 'include' });
        const data = await res.json();
        if (data.authenticated) {
          this.user = data.user;
        } else {
          window.location.href = '/';
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
});
