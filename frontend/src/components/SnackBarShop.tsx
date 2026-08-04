import { useEffect, useState } from 'react';
import { ROLE_LEVEL, type User } from '../lib/constants';
import { fmtMoney } from '../lib/format';
import {
  api,
  type SnackBarProduct,
  type SnackBarEntityRate,
  type SnackBarEntityType,
  type SnackBarTransaction,
} from '../lib/api';

const toast = (msg: string) => (window as any).toast?.(msg);

function ProductsPanel({ canManage, products, onReload }: { canManage: boolean; products: SnackBarProduct[]; onReload: () => void }) {
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('');

  async function addProduct(e: React.FormEvent) {
    e.preventDefault();
    const p = parseFloat(price);
    const s = parseInt(stock, 10);
    if (!name.trim() || !p || p < 0) { toast('Enter a name and valid price'); return; }
    try {
      await api.createSnackBarProduct({ name: name.trim(), price: p, stock_qty: isNaN(s) ? 0 : s });
      setName(''); setPrice(''); setStock(''); setShowForm(false);
      onReload();
    } catch (err: any) {
      toast(err?.message || 'Failed to add product');
    }
  }

  async function removeProduct(id: string) {
    if (!window.confirm('Remove this product from the catalog?')) return;
    try {
      await api.deactivateSnackBarProduct(id);
      onReload();
    } catch (err: any) {
      toast(err?.message || 'Failed to remove');
    }
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-head">
        <h3>Products</h3>
        {canManage && (
          <button className="btn" style={{ padding: '4px 10px', fontSize: 11.5 }} onClick={() => setShowForm((v) => !v)}>+ Add product</button>
        )}
      </div>
      <div className="card-body flush">
        {showForm && (
          <form onSubmit={addProduct} style={{ display: 'flex', gap: 8, padding: '10px 16px', borderBottom: '1px solid var(--line-soft)' }}>
            <input className="ipt" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1 }} />
            <input className="ipt" type="number" min={0} step="0.01" placeholder="Price" value={price} onChange={(e) => setPrice(e.target.value)} style={{ width: 90 }} />
            <input className="ipt" type="number" min={0} placeholder="Stock" value={stock} onChange={(e) => setStock(e.target.value)} style={{ width: 80 }} />
            <button className="btn primary" type="submit" style={{ padding: '6px 12px' }}>Save</button>
          </form>
        )}
        <div className="tbl-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Name</th>
                <th>Price</th>
                <th>Stock</th>
                {canManage && <th style={{ width: 40 }}></th>}
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id}>
                  <td style={{ fontWeight: 600 }}>{p.name}</td>
                  <td>{fmtMoney(p.price)}</td>
                  <td style={{ color: p.stock_qty <= 0 ? 'var(--red)' : undefined }}>{p.stock_qty}</td>
                  {canManage && (
                    <td>
                      <button className="row-del" onClick={() => removeProduct(p.id)} title="Remove product">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                        </svg>
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {products.length === 0 && (
                <tr><td colSpan={canManage ? 4 : 3} style={{ color: 'var(--muted)', textAlign: 'center', padding: 20 }}>No products yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function RatesPanel({ rates, onReload }: { rates: SnackBarEntityRate[]; onReload: () => void }) {
  async function save(entityType: SnackBarEntityType, taxPct: string, discountPct: string) {
    const tax = parseFloat(taxPct) || 0;
    const discount = parseFloat(discountPct) || 0;
    try {
      await api.updateSnackBarRate(entityType, { tax_pct: tax, discount_pct: discount });
      toast(`${entityType} rates updated`);
      onReload();
    } catch (err: any) {
      toast(err?.message || 'Failed to update rates');
    }
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-head"><h3>Tax & Discount Rates</h3></div>
      <div className="card-body flush">
        <div className="tbl-wrap">
          <table className="data">
            <thead><tr><th>Entity</th><th>Tax %</th><th>Discount %</th><th style={{ width: 70 }}></th></tr></thead>
            <tbody>
              {rates.map((r) => {
                let taxVal = String(r.tax_pct);
                let discVal = String(r.discount_pct);
                return (
                  <tr key={r.entity_type}>
                    <td style={{ fontWeight: 600, textTransform: 'capitalize' }}>{r.entity_type}</td>
                    <td><input className="ipt" type="number" min={0} max={100} step="0.1" defaultValue={taxVal} style={{ width: 70 }} onChange={(e) => { taxVal = e.target.value; }} /></td>
                    <td><input className="ipt" type="number" min={0} max={100} step="0.1" defaultValue={discVal} style={{ width: 70 }} onChange={(e) => { discVal = e.target.value; }} /></td>
                    <td><button className="btn" style={{ padding: '4px 10px', fontSize: 11 }} onClick={() => save(r.entity_type, taxVal, discVal)}>Save</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

interface ItemRow { productId: string; qty: string }

function NewTransactionPanel({ products, onSaved }: { products: SnackBarProduct[]; onSaved: () => void }) {
  const [entityType, setEntityType] = useState<SnackBarEntityType>('student');
  const [entityName, setEntityName] = useState('');
  const [rows, setRows] = useState<ItemRow[]>([{ productId: '', qty: '1' }]);
  const [saving, setSaving] = useState(false);

  function updateRow(i: number, patch: Partial<ItemRow>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function addRow() {
    setRows((prev) => [...prev, { productId: '', qty: '1' }]);
  }
  function removeRow(i: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== i));
  }

  const previewSubtotal = rows.reduce((sum, r) => {
    const p = products.find((x) => x.id === r.productId);
    const qty = parseInt(r.qty, 10) || 0;
    return sum + (p ? p.price * qty : 0);
  }, 0);

  async function submit() {
    if (!entityName.trim()) { toast('Enter who bought it'); return; }
    const items = rows
      .filter((r) => r.productId && parseInt(r.qty, 10) > 0)
      .map((r) => ({ product_id: r.productId, qty: parseInt(r.qty, 10) }));
    if (items.length === 0) { toast('Add at least one item'); return; }
    setSaving(true);
    try {
      const txn = await api.createSnackBarTransaction({ entity_type: entityType, entity_name: entityName.trim(), items });
      toast(`Recorded — ${fmtMoney(txn.total_amount)}`);
      setEntityName('');
      setRows([{ productId: '', qty: '1' }]);
      onSaved();
    } catch (err: any) {
      toast(err?.message || 'Failed to record sale');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-head"><h3>New Sale</h3></div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <select className="ipt sel" value={entityType} onChange={(e) => setEntityType(e.target.value as SnackBarEntityType)} style={{ width: 110 }}>
            <option value="student">Student</option>
            <option value="staff">Staff</option>
          </select>
          <input className="ipt" placeholder="Who bought it (name/ID)" value={entityName} onChange={(e) => setEntityName(e.target.value)} style={{ flex: 1 }} />
        </div>
        {rows.map((row, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select className="ipt sel" value={row.productId} onChange={(e) => updateRow(i, { productId: e.target.value })} style={{ flex: 1 }}>
              <option value="">Select item…</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name} — {fmtMoney(p.price)}</option>)}
            </select>
            <input className="ipt" type="number" min={1} value={row.qty} onChange={(e) => updateRow(i, { qty: e.target.value })} style={{ width: 70 }} />
            {rows.length > 1 && (
              <button className="row-del" type="button" onClick={() => removeRow(i)} title="Remove item">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>
        ))}
        <button className="btn" type="button" onClick={addRow} style={{ alignSelf: 'flex-start', padding: '5px 10px', fontSize: 11.5 }}>+ Add item</button>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>Subtotal (before tax/discount): {fmtMoney(previewSubtotal)}</span>
          <button className="btn primary" onClick={submit} disabled={saving}>{saving ? 'Recording…' : 'Record Sale'}</button>
        </div>
      </div>
    </div>
  );
}

function RecentTransactions({ transactions }: { transactions: SnackBarTransaction[] }) {
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-head"><h3>Recent Sales</h3></div>
      <div className="card-body flush">
        <div className="tbl-wrap">
          <table className="data">
            <thead><tr><th>Date</th><th>Entity</th><th>Items</th><th>Total</th></tr></thead>
            <tbody>
              {transactions.map((t) => (
                <tr key={t.id}>
                  <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{t.business_date}</td>
                  <td><span className="pill role-manager" style={{ textTransform: 'capitalize' }}>{t.entity_type}</span> {t.entity_name}</td>
                  <td style={{ fontSize: 11.5, color: 'var(--muted)' }}>{t.items.map((i) => `${i.qty}× ${i.product_name}`).join(', ')}</td>
                  <td style={{ fontWeight: 700 }}>{fmtMoney(t.total_amount)}</td>
                </tr>
              ))}
              {transactions.length === 0 && (
                <tr><td colSpan={4} style={{ color: 'var(--muted)', textAlign: 'center', padding: 20 }}>No sales recorded yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function SnackBarShop({ user }: { user: User }) {
  const canManage = ROLE_LEVEL[user.role] >= 30;
  const [products, setProducts] = useState<SnackBarProduct[]>([]);
  const [rates, setRates] = useState<SnackBarEntityRate[]>([]);
  const [transactions, setTransactions] = useState<SnackBarTransaction[]>([]);

  async function loadProducts() {
    try { setProducts(await api.getSnackBarProducts()); } catch { setProducts([]); }
  }
  async function loadRates() {
    try { setRates(await api.getSnackBarRates()); } catch { setRates([]); }
  }
  async function loadTransactions() {
    try { setTransactions(await api.getSnackBarTransactions({ limit: 25 })); } catch { setTransactions([]); }
  }

  useEffect(() => { loadProducts(); loadRates(); loadTransactions(); }, []);

  return (
    <div>
      <NewTransactionPanel products={products} onSaved={() => { loadTransactions(); loadProducts(); }} />
      <RecentTransactions transactions={transactions} />
      <ProductsPanel canManage={canManage} products={products} onReload={loadProducts} />
      {canManage && <RatesPanel rates={rates} onReload={loadRates} />}
    </div>
  );
}
