function usersPage() {
  return {
    users: [],
    editingUser: null,
    userModalOpen: false,
    pinModalOpen: false,
    pinForm: { pin: '' },
    form: {
      username: '',
      display_name: '',
      last_name: '',
      password: '',
      pin: '',
      role: 'staff',
      active: true,
    },
    loading: true,
    error: false,
    searchQuery: '',
    async initPage() {
      await this.loadUsers();
    },
    async loadUsers() {
      this.loading = true;
      this.error = false;
      try {
        const res = await API.getUsers();
        this.users = Array.isArray(res) ? res : res.users || [];
      } catch {
        this.error = true;
        this.users = [];
      }
      this.loading = false;
    },
    get filteredUsers() {
      if (!this.searchQuery) return this.users;
      const q = this.searchQuery.toLowerCase();
      return this.users.filter(
        (u) =>
          (u.display_name || '').toLowerCase().includes(q) ||
          (u.username || '').toLowerCase().includes(q) ||
          (u.role || '').toLowerCase().includes(q),
      );
    },
    openUserModal() {
      this.editingUser = null;
      this.form = {
        username: '',
        display_name: '',
        last_name: '',
        password: '',
        pin: '',
        role: 'staff',
        active: true,
      };
      this.userModalOpen = true;
    },
    editUser(u) {
      this.editingUser = u;
      this.form = {
        username: u.username || '',
        display_name: u.display_name || '',
        last_name: u.last_name || '',
        password: '',
        pin: '',
        role: u.role || 'staff',
        active: u.active !== false,
      };
      this.userModalOpen = true;
    },
    async saveUser() {
      try {
        if (this.editingUser) {
          const payload = {};
          if (this.form.username !== this.editingUser.username)
            payload.username = this.form.username;
          if (this.form.display_name !== this.editingUser.display_name)
            payload.display_name = this.form.display_name;
          if (this.form.last_name !== (this.editingUser.last_name || ''))
            payload.last_name = this.form.last_name;
          if (this.form.password) payload.password = this.form.password;
          if (this.form.pin) payload.pin = this.form.pin;
          if (this.form.role !== this.editingUser.role) payload.role = this.form.role;
          if (this.form.active !== (this.editingUser.active !== false))
            payload.active = this.form.active;
          if (Object.keys(payload).length > 0) await API.updateUser(this.editingUser.id, payload);
          Alpine.store('toast').showToast('User updated', 'success');
        } else {
          await API.createUser({
            username: this.form.username,
            display_name: this.form.display_name,
            last_name: this.form.last_name,
            password: this.form.password,
            pin: this.form.pin || undefined,
            role: this.form.role,
          });
          Alpine.store('toast').showToast('User created', 'success');
        }
        this.userModalOpen = false;
        await this.loadUsers();
      } catch (e) {
        Alpine.store('toast').showToast(e.message, 'error');
      }
    },
    openPinModal(u) {
      this.editingUser = u;
      this.pinForm = { pin: '' };
      this.pinModalOpen = true;
    },
    async savePin() {
      if (!this.pinForm.pin || this.pinForm.pin.length !== 4) {
        Alpine.store('toast').showToast('Enter a valid 4-digit PIN', 'error');
        return;
      }
      try {
        await API.resetPin(this.editingUser.id, { pin: this.pinForm.pin });
        Alpine.store('toast').showToast('PIN reset successfully', 'success');
        this.pinModalOpen = false;
      } catch (e) {
        Alpine.store('toast').showToast(e.message, 'error');
      }
    },
    async deleteUser(u) {
      Alpine.store('confirm').open(
        'Delete user "' + (u.display_name || u.username) + '"?',
        async () => {
          try {
            await API.deleteUser(u.id);
            Alpine.store('toast').showToast('User deleted', 'success');
            await this.loadUsers();
          } catch (e) {
            Alpine.store('toast').showToast(e.message, 'error');
          }
        },
      );
    },
    roleBadgeClass(role) {
      const map = {
        admin: 'bg-red-50 text-red-600 border border-red-200',
        manager: 'bg-blue-50 text-blue-600 border border-blue-200',
        assistant: 'bg-purple-50 text-purple-600 border border-purple-200',
        staff: 'bg-slate-100 text-slate-600 border border-slate-200',
      };
      return map[role] || 'bg-slate-100 text-slate-600';
    },
    formatDate(d) {
      if (!d) return '';
      const dt = new Date(d);
      return dt.getMonth() + 1 + '/' + dt.getDate() + '/' + dt.getFullYear();
    },
    retry() {
      this.loadUsers();
    },
  };
}
