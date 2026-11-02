'use client';
import { useEffect, useState } from 'react';
import Shell from '@/components/Shell';
import { sb } from '@/lib/supabase';

type Row = { id: string; name: string; stock_qty: number; opening_qty: number };

export default function Inventory() {
  const [rows, setRows] = useState<Row[]>([]);
  const [adjusting, setAdjusting] = useState<Row | null>(null);
  const [openingMode, setOpeningMode] = useState(false);
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function load() {
    const [stock, movements] = await Promise.all([
      sb().from('v_stock').select('product_id,name,stock_qty').eq('track_stock', true).eq('active', true).order('name'),
      sb().from('stock_movements').select('product_id,qty_delta,reason').limit(100000),
    ]);
    if (!stock.error && !movements.error) {
      const opening = new Map<string, number>();
      for (const movement of movements.data ?? []) if (String(movement.reason).toLowerCase().startsWith('opening stock')) opening.set(movement.product_id, (opening.get(movement.product_id) ?? 0) + Number(movement.qty_delta));
      setRows((stock.data ?? []).map((row: any) => ({ id: row.product_id, name: row.name, stock_qty: Number(row.stock_qty), opening_qty: opening.get(row.product_id) ?? 0 })));
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function saveAdjustment() {
    if (!adjusting) return;
    const delta = Number(quantity);
    if (!Number.isFinite(delta) || delta === 0) return setError('Enter a nonzero quantity.');
    if (openingMode && delta < 0) return setError('Opening stock must be a positive quantity.');
    if (!reason.trim()) return setError('Add a reason for this stock update.');
    setBusy(true); setError(''); setMessage('');
    const { error } = await sb().rpc('adjust_stock', { p_product_id: adjusting.id, p_delta: delta, p_reason: reason.trim() });
    setBusy(false);
    if (error) {
      const missingFunction = error.code === 'PGRST202' || error.message.toLowerCase().includes('schema cache');
      setError(missingFunction ? 'Stock updates are not installed in Supabase. Apply the database migrations with `npm run db:push`.' : error.message);
      return;
    }
    setMessage(`${adjusting.name} stock updated.`); setAdjusting(null); setOpeningMode(false); setQuantity(''); setReason(''); await load();
  }
  async function stopTracking(product: Row) {
    if (!window.confirm(`Stop tracking stock for ${product.name}? Existing stock history will remain, but it will be hidden from Inventory.`)) return;
    setBusy(true); setError('');
    const { error: updateError } = await sb().from('products').update({ track_stock: false }).eq('id', product.id);
    setBusy(false);
    if (updateError) { setError(updateError.message); return; }
    setMessage(`${product.name} is no longer tracked in Inventory.`); await load();
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
          <span className="stock-count"><span className={`stock-count ${Number(product.stock_qty) <= 5 ? 'stock-low' : ''}`}><strong>{Number(product.stock_qty).toLocaleString('en-IN')}</strong><small>units</small></span><span className="inventory-actions"><button className="alt small" onClick={() => { setAdjusting(product); setOpeningMode(true); setQuantity(''); setReason('Opening stock from previous year'); setError(''); }}>Opening stock</button><button className="alt small" onClick={() => { setAdjusting(product); setOpeningMode(false); setQuantity(''); setReason(''); setError(''); }}>Adjust</button><button className="danger small" disabled={busy} onClick={() => void stopTracking(product)}>Stop tracking</button></span></span>
        </div>)}
      </div>
      {adjusting && <section className="card" style={{ marginTop: 16 }}>
        <strong>{openingMode ? 'Add previous-year opening stock' : `Adjust ${adjusting.name}`}</strong>
        <p className="muted small">Current available: {Number(adjusting.stock_qty).toLocaleString('en-IN')} units. {openingMode ? 'Enter the quantity carried forward from before the imported bills.' : `You can reduce only down to protected opening stock: ${Number(adjusting.opening_qty).toLocaleString('en-IN')} units.`}</p>
        <label>{openingMode ? 'Opening quantity' : 'Quantity change'}</label><input type="number" min={openingMode ? '0' : String(-(Number(adjusting.stock_qty) - Number(adjusting.opening_qty)))} step="0.001" value={quantity} onChange={e => setQuantity(e.target.value)} placeholder={openingMode ? 'e.g. 250' : 'e.g. 25 or -3'} />
        <label>Reason</label><input value={reason} onChange={e => setReason(e.target.value)} readOnly={openingMode} placeholder="Damaged items, count correction..." />
        {error && <p className="bad small">{error}</p>}
        <div className="row" style={{ marginTop: 12 }}><button className="alt" disabled={busy} onClick={() => { setAdjusting(null); setOpeningMode(false); }}>Cancel</button><button disabled={busy} onClick={saveAdjustment}>{busy ? 'Saving...' : openingMode ? 'Save opening stock' : 'Save stock update'}</button></div>
      </section>}
      {message && <p className="muted small">{message}</p>}
    </> : <div className="empty-state"><span className="empty-state-mark">04</span><strong>No tracked stock yet</strong><p>Products marked for stock tracking will appear here after a purchase or adjustment.</p></div>}
  </Shell>;
}
