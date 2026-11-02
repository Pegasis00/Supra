'use client';
import { useEffect, useState } from 'react';
import Shell from '@/components/Shell';
import { sb } from '@/lib/supabase';

type Row = { id: string; name: string; stock_qty: number };

export default function Inventory() {
  const [rows, setRows] = useState<Row[]>([]);
  const [adjusting, setAdjusting] = useState<Row | null>(null);
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function load() {
    const { data, error } = await sb().from('v_stock').select('product_id,name,stock_qty').eq('track_stock', true).eq('active', true).order('name');
    if (!error) setRows((data ?? []).map((row: any) => ({ id: row.product_id, name: row.name, stock_qty: Number(row.stock_qty) })));
  }
  useEffect(() => {
    void load();
  }, []);
  async function saveAdjustment() {
    if (!adjusting) return;
    const delta = Number(quantity);
    if (!Number.isFinite(delta) || delta === 0) return setError('Enter a nonzero quantity. Use a minus sign to reduce stock.');
    if (!reason.trim()) return setError('Add a reason for this stock update.');
    setBusy(true); setError(''); setMessage('');
    const { error } = await sb().rpc('adjust_stock', { p_product_id: adjusting.id, p_delta: delta, p_reason: reason.trim() });
    setBusy(false);
    if (error) {
      const missingFunction = error.code === 'PGRST202' || error.message.toLowerCase().includes('schema cache');
      setError(missingFunction ? 'Stock updates are not installed in Supabase. Apply the database migrations with `npm run db:push`.' : error.message);
      return;
    }
    setMessage(`${adjusting.name} stock updated.`); setAdjusting(null); setQuantity(''); setReason(''); await load();
  }
  const totalUnits = rows.reduce((sum, row) => sum + Number(row.stock_qty), 0);

  return <Shell title="Inventory" back="/">
    <div className="section-intro"><p>Current balances are calculated from the stock movement ledger.</p><span>{rows.length} tracked products</span></div>
    {rows.length > 0 ? <>
      <section className="inventory-summary"><div><span className="eyebrow">TOTAL UNITS ON HAND</span><strong>{totalUnits.toLocaleString('en-IN')}</strong></div><span className="inventory-summary-mark">STOCK LEDGER</span></section>
      <div className="record-list">
        <div className="record-list-head"><span>PRODUCT</span><span>AVAILABLE</span></div>
        {rows.map(product => <div className="inventory-row" key={product.id}>
          <span className="inventory-product"><span className="inventory-product-mark">P</span><strong>{product.name}</strong></span>
          <span className="stock-count"><span className={`stock-count ${Number(product.stock_qty) <= 5 ? 'stock-low' : ''}`}><strong>{Number(product.stock_qty).toLocaleString('en-IN')}</strong><small>units</small></span><button className="alt small" onClick={() => { setAdjusting(product); setQuantity(''); setReason(''); setError(''); }}>Update</button></span>
        </div>)}
      </div>
      {adjusting && <section className="card" style={{ marginTop: 16 }}>
        <strong>Update {adjusting.name}</strong>
        <p className="muted small">Current available: {Number(adjusting.stock_qty).toLocaleString('en-IN')} units. Enter a positive number to add or a negative number to remove.</p>
        <label>Quantity change</label><input type="number" step="0.001" value={quantity} onChange={e => setQuantity(e.target.value)} placeholder="e.g. 25 or -3" />
        <label>Reason</label><input value={reason} onChange={e => setReason(e.target.value)} placeholder="Opening balance, damaged items, count correction..." />
        {error && <p className="bad small">{error}</p>}
        <div className="row" style={{ marginTop: 12 }}><button className="alt" disabled={busy} onClick={() => setAdjusting(null)}>Cancel</button><button disabled={busy} onClick={saveAdjustment}>{busy ? 'Saving...' : 'Save stock update'}</button></div>
      </section>}
      {message && <p className="muted small">{message}</p>}
    </> : <div className="empty-state"><span className="empty-state-mark">04</span><strong>No tracked stock yet</strong><p>Products marked for stock tracking will appear here after a purchase or adjustment.</p></div>}
  </Shell>;
}
