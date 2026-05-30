function settingsPage() {
  return {
    settings: { ai_provider: 'ollama', ai_model: '', ai_api_key: '' },
    systemInfo: { env: 'loading...' },
    loading: true,
    error: false,
    async initPage() {
      this.loading = true;
      this.error = false;
      try {
        const res = await API.getSettings();
        const s = Array.isArray(res) ? res : res.settings || [];
        s.forEach((item) => {
          if (item.setting_key === 'AI_PROVIDER')
            this.settings.ai_provider = item.setting_value || 'ollama';
          if (item.setting_key === 'AI_MODEL') this.settings.ai_model = item.setting_value || '';
          if (item.setting_key === 'AI_API_KEY')
            this.settings.ai_api_key = item.setting_value || '';
        });
      } catch {
        this.error = true;
      }
      this.loading = false;
      this.systemInfo = { env: 'production' };
    },
    async saveSetting(key, value) {
      try {
        await API.updateSettings({ key, value });
        Alpine.store('toast').showToast('Setting saved', 'success');
      } catch (e) {
        Alpine.store('toast').showToast(e.message, 'error');
      }
    },
    retry() {
      this.initPage();
    },
  };
}
