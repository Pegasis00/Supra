'use client';
import { Fragment, useEffect, useState } from 'react';
import Shell from '@/components/Shell';
import { sb } from '@/lib/supabase';

type Row = { id: string; name: string; stock_qty: number; opening_qty: number; purchase_rate: number };

export default function Inventory() {
  const [rows, setRows] = useState<Row[]>([]);
  const [adjusting, setAdjusting] = useState<Row | null>(null);
  const [openingMode, setOpeningMode] = useState(false);
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [listView, setListView] = useState(false);
  const [editingRateId, setEditingRateId] = useState<string | null>(null);
  const [rateDraft, setRateDraft] = useState('');
  async function load() {
    const [stock, movements] = await Promise.all([
      sb().from('products').select('id,name,purchase_rate').eq('track_stock', true).eq('active', true).order('name'),
      sb().from('stock_movements').select('product_id,qty_delta,reason').limit(100000),
    ]);
    if (!stock.error && !movements.error) {
      const balances = await sb().from('v_stock').select('product_id,stock_qty').eq('track_stock', true).eq('active', true);
      if (balances.error) return;
      const balanceById = new Map((balances.data ?? []).map((row: any) => [row.product_id, Number(row.stock_qty)]));
      const opening = new Map<string, number>();
      for (const movement of movements.data ?? []) if (String(movement.reason).toLowerCase().startsWith('opening stock')) opening.set(movement.product_id, (opening.get(movement.product_id) ?? 0) + Number(movement.qty_delta));
      setRows((stock.data ?? []).map((row: any) => ({ id: row.id, name: row.name, stock_qty: balanceById.get(row.id) ?? 0, opening_qty: opening.get(row.id) ?? 0, purchase_rate: Number(row.purchase_rate ?? 0) })));
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function saveAdjustment() {
    if (!adjusting) return;
    const delta = Number(quantity);
    if (!Number.isFinite(delta) || delta === 0) return setError('Enter a nonzero quantity.');
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
  async function savePurchaseRate(product: Row) {
    const value = Number(rateDraft);
    if (!Number.isFinite(value) || value < 0) { setError('Enter a valid purchase rate of zero or more.'); return; }
    setBusy(true); setError('');
    const { error: updateError } = await sb().from('products').update({ purchase_rate: value }).eq('id', product.id);
    setBusy(false);
    if (updateError) { setError(updateError.message); return; }
    setRows(current => current.map(row => row.id === product.id ? { ...row, purchase_rate: value } : row));
    setEditingRateId(null); setRateDraft(''); setMessage(`${product.name} purchase rate updated.`);
  }
  const totalUnits = rows.reduce((sum, row) => sum + Number(row.stock_qty), 0);
  const totalValue = rows.reduce((sum, row) => sum + Number(row.stock_qty) * Number(row.purchase_rate), 0);
  const openEditor = (product: Row, opening: boolean) => { setAdjusting(product); setOpeningMode(opening); setQuantity(''); setReason(opening ? 'Opening stock from previous year' : ''); setError(''); };
  const editor = adjusting && <section className="card inventory-editor">
    <strong>{openingMode ? 'Adjust opening stock' : `Adjust ${adjusting.name}`}</strong>
    <p className="muted small">Current available: {Number(adjusting.stock_qty).toLocaleString('en-IN')} units. {openingMode ? 'Enter a positive quantity to add or a negative quantity to reduce opening stock.' : 'Enter a positive quantity to add or a negative quantity to reduce stock. Stock cannot go below zero.'}</p>
    <label>{openingMode ? 'Opening quantity change' : 'Quantity change'}</label><input type="number" step="0.001" value={quantity} onChange={e => setQuantity(e.target.value)} placeholder={openingMode ? 'e.g. 100 or -720' : 'e.g. 25 or -720'} />
    <label>Reason</label><input value={reason} onChange={e => setReason(e.target.value)} placeholder="Sales reconciliation, damaged items, count correction..." />
    {error && <p className="bad small">{error}</p>}
    <div className="row" style={{ marginTop: 12 }}><button className="alt" disabled={busy} onClick={() => { setAdjusting(null); setOpeningMode(false); }}>Cancel</button><button disabled={busy} onClick={saveAdjustment}>{busy ? 'Saving...' : 'Save stock update'}</button></div>
  </section>;

  return <Shell title="Inventory" back="/">
    <div className="section-intro"><p>Current balances are calculated from the stock movement ledger.</p><div className="inventory-view-actions"><span>{rows.length} tracked products</span><button className="alt small" onClick={() => setListView(value => !value)}>{listView ? 'View as cards' : 'View as list'}</button></div></div>
    {rows.length > 0 ? <>
      <section className="inventory-summary"><div><span className="eyebrow">TOTAL UNITS ON HAND</span><strong>{totalUnits.toLocaleString('en-IN')}</strong></div><span className="inventory-summary-mark">STOCK LEDGER</span></section>
      {listView ? <section className="inventory-table-wrap"><table className="inventory-table"><thead><tr><th>Sr no</th><th>Product name</th><th className="right">Qty</th><th className="right">Purchase rate</th><th className="right">Total</th></tr></thead><tbody>{rows.map((product, index) => <tr key={product.id}><td>{index + 1}</td><td>{product.name}</td><td className="right">{Number(product.stock_qty).toLocaleString('en-IN')}</td><td className="right"><div className="inventory-rate-cell">{editingRateId === product.id ? <><input className="inventory-rate-input" type="number" min="0" step="0.01" value={rateDraft} onChange={e => setRateDraft(e.target.value)} autoFocus /><button className="small" disabled={busy} onClick={() => void savePurchaseRate(product)}>Save</button><button className="alt small" disabled={busy} onClick={() => { setEditingRateId(null); setRateDraft(''); }}>Cancel</button></> : <><span>₹ {Number(product.purchase_rate).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span><button className="alt small" disabled={busy} onClick={() => { setEditingRateId(product.id); setRateDraft(String(product.purchase_rate)); setError(''); }}>Edit</button></>}</div></td><td className="right">₹ {(Number(product.stock_qty) * Number(product.purchase_rate)).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td></tr>)}</tbody><tfoot><tr><th colSpan={2}>Total</th><th className="right">{totalUnits.toLocaleString('en-IN')}</th><th></th><th className="right">₹ {totalValue.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</th></tr></tfoot></table></section> : <div className="record-list">
        <div className="record-list-head"><span>PRODUCT</span><span>AVAILABLE</span></div>
        {rows.map(product => <Fragment key={product.id}><div className="inventory-row">
          <span className="inventory-product"><span className="inventory-product-mark">P</span><strong>{product.name}</strong></span>
          <span className="stock-count"><span className={`stock-count ${Number(product.stock_qty) <= 5 ? 'stock-low' : ''}`}><strong>{Number(product.stock_qty).toLocaleString('en-IN')}</strong><small>units</small></span><span className="inventory-actions"><button className="alt small" onClick={() => openEditor(product, true)}>Opening stock</button><button className="alt small" onClick={() => openEditor(product, false)}>Adjust</button><button className="danger small" disabled={busy} onClick={() => void stopTracking(product)}>Stop tracking</button></span></span>
        </div>{adjusting?.id === product.id && editor}</Fragment>)}
      </div>}
      {message && <p className="muted small">{message}</p>}
    </> : <div className="empty-state"><span className="empty-state-mark">04</span><strong>No tracked stock yet</strong><p>Products marked for stock tracking will appear here after a purchase or adjustment.</p></div>}
  </Shell>;
}
