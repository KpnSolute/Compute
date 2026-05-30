function barcodesPage() {
  return {
    allItems: [],
    filteredBarcodes: [],
    selectedBarcodes: [],
    barcodeSearch: '',
    loading: true,
    error: false,
    async initPage() {
      this.loading = true;
      this.error = false;
      try {
        const res = await API.getBarcodes();
        this.allItems = Array.isArray(res) ? res : res.barcodes || res.data || [];
        this.filterBarcodes();
        this.$nextTick(() => this.renderBarcodes());
      } catch {
        this.error = true;
        this.allItems = [];
        this.filteredBarcodes = [];
      }
      this.loading = false;
    },
    filterBarcodes() {
      const q = this.barcodeSearch.toLowerCase();
      this.filteredBarcodes = this.allItems.filter(
        (i) =>
          (i.description || '').toLowerCase().includes(q) ||
          (i.barcode_id || '').toLowerCase().includes(q) ||
          (i.sku || '').toLowerCase().includes(q),
      );
      this.$nextTick(() => this.renderBarcodes());
    },
    renderBarcodes() {
      if (typeof JsBarcode === 'undefined') return;
      this.filteredBarcodes.forEach((item) => {
        const el = document.getElementById('bc-' + item.id);
        if (el && item.barcode_id) {
          try {
            JsBarcode(el, item.barcode_id, {
              format: 'CODE128',
              width: 1.2,
              height: 36,
              displayValue: false,
              margin: 2,
              background: '#ffffff',
              lineColor: '#000000',
              fontSize: 10,
            });
          } catch {
            // skip invalid barcode IDs
          }
        }
      });
    },
    printSelected() {
      if (this.selectedBarcodes.length === 0) return;
      const items = this.allItems.filter((i) => this.selectedBarcodes.includes(i.id));
      const svgs = items
        .map((item) => {
          const el = document.getElementById('bc-' + item.id);
          if (!el || !item.barcode_id) return '';
          const svg = JsBarcode(el, item.barcode_id, {
            format: 'CODE128',
            width: 1.5,
            height: 48,
            displayValue: true,
            margin: 5,
            background: '#ffffff',
            lineColor: '#000000',
          });
          return `<div style="text-align:center;margin:16px 0;page-break-inside:avoid">
          ${el.outerHTML}
          <div style="font-family:monospace;font-size:12px;margin-top:4px">${
            item.description || ''
          }</div>
        </div>`;
        })
        .filter(Boolean);
      if (svgs.length === 0) return;
      const html = `<!DOCTYPE html><html><head><style>
        body{padding:20px;font-family:sans-serif}
        @media print{@page{margin:10mm}body{padding:0}}
      </style></head><body>${svgs.join('')}</body></html>`;
      const w = window.open('', '_blank');
      if (w) {
        w.document.write(html);
        w.document.close();
        w.focus();
        setTimeout(() => w.print(), 300);
      }
    },
    async retry() {
      await this.initPage();
    },
  };
}
