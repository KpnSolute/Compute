function filesPage() {
  return {
    files: [],
    loading: true,
    error: false,
    async initPage() {
      this.loading = true;
      this.error = false;
      try {
        const res = await API.getFiles();
        this.files = Array.isArray(res) ? res : res.files || [];
      } catch {
        this.error = true;
        this.files = [];
      }
      this.loading = false;
    },
    async deleteFile(id) {
      Alpine.store('confirm').open('Delete this file?', async () => {
        try {
          await API.deleteFile(id);
          Alpine.store('toast').showToast('File deleted', 'success');
          await this.initPage();
        } catch (e) {
          Alpine.store('toast').showToast(e.message, 'error');
        }
      });
    },
    retry() {
      this.initPage();
    },
  };
}
