'use client';
import { useCallback, useEffect, useState } from 'react';
import Shell from '@/components/Shell';
import { sb } from '@/lib/supabase';
import { inr } from '@/lib/money';
import { createId } from '@/lib/id';
import type { Product } from '@/lib/types';

type Line = {
  description: string | null; quantity: number | null; unit_rate: number | null;
  line_total: number | null; hsn?: string | null; gst_rate?: number | null;
  cgst?: number | null; sgst?: number | null; igst?: number | null; product_id?: string | null;
};
type Bill = {
  supplier_name: string | null; supplier_gstin?: string | null; supplier_address?: string | null;
  supplier_invoice_number: string | null; purchase_date: string | null;
  purchase_order_number?: string | null; challan_number?: string | null; items: Line[];
  subtotal?: number | null; tax_total?: number | null; round_off?: number | null;
  grand_total?: number | null; source_filename?: string; extraction?: Record<string, unknown>;
};
type Payment = { id: string; amount: number; method: string; paid_on: string; note: string | null };
type SavedBill = { id: string; supplier_name: string; supplier_invoice_number: string; purchase_date: string; source_file_path: string | null; grand_total: number | null; status: string; line_count?: number; payments: Payment[] };
type ProviderConfig = { nvidia: { configured: boolean; model: string } };

export default function PurchaseBills() {
  const [products, setProducts] = useState<Product[]>([]);
  const [saved, setSaved] = useState<SavedBill[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [sourceReference, setSourceReference] = useState<string | null>(null);
  const [bill, setBill] = useState<Bill | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [providerConfig, setProviderConfig] = useState<ProviderConfig | null>(null);
  const [expandedPaymentId, setExpandedPaymentId] = useState<string | null>(null);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('UPI');
  const [paymentCustomMethod, setPaymentCustomMethod] = useState('');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [paymentError, setPaymentError] = useState('');
  const totalsDifference = bill?.subtotal != null && bill.tax_total != null && bill.round_off != null && bill.grand_total != null
    ? Math.round((bill.grand_total - bill.subtotal - bill.tax_total - bill.round_off) * 100) / 100
    : 0;

  const load = useCallback(() => {
    // One query: the line count comes from an embedded count instead of downloading every line row.
    sb().from('purchase_bills').select('id,supplier_name,supplier_invoice_number,purchase_date,source_file_path,grand_total,status,payments:purchase_bill_payments(id,amount,method,paid_on,note),purchase_bill_lines(count)')
      .order('purchase_date', { ascending: false })
      .then(({ data }) => {
        setSaved((data ?? []).map(({ purchase_bill_lines, ...bill }: any) => ({ ...bill, payments: bill.payments ?? [], line_count: purchase_bill_lines?.[0]?.count ?? 0 })) as SavedBill[]);
      });
  }, []);

  useEffect(() => {
    sb().from('products').select('*').eq('active', true).order('name')
      .then(({ data }) => setProducts((data ?? []) as Product[]));
    load();
    fetch('/api/purchase-bills/extract').then(r => r.json()).then(setProviderConfig).catch(() => setProviderConfig(null));
  }, [load]);

  function updateBill(key: keyof Bill, value: unknown) {
    setBill(current => current ? { ...current, [key]: value } : current);
  }
  function updateLine(index: number, key: keyof Line, value: unknown) {
    setBill(current => current ? { ...current, items: current.items.map((line, i) => i === index ? { ...line, [key]: value } : line) } : current);
  }
  function addLine() { setBill(current => current ? { ...current, items: [...current.items, { description: '', quantity: null, unit_rate: null, line_total: null, product_id: null }] } : current); }
  function removeLine(index: number) { setBill(current => current ? { ...current, items: current.items.filter((_, i) => i !== index) } : current); }
  function startManual() {
    setFile(null); setSourceReference(null); setError('');
    setBill({ supplier_name: '', supplier_gstin: '', supplier_address: '', supplier_invoice_number: '', purchase_date: new Date().toISOString().slice(0, 10), items: [{ description: '', quantity: null, unit_rate: null, line_total: null, product_id: null }], subtotal: null, tax_total: null, round_off: 0, grand_total: null });
  }
  const paid = (row: SavedBill) => row.payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
  const balance = (row: SavedBill) => Math.max(0, Number(row.grand_total ?? 0) - paid(row));
  function startPayment(row: SavedBill) { setPayingId(row.id); setPaymentAmount(balance(row).toFixed(2)); setPaymentMethod('UPI'); setPaymentCustomMethod(''); setPaymentDate(new Date().toISOString().slice(0, 10)); setPaymentError(''); }
  async function savePayment(row: SavedBill) {
    const method = paymentMethod === 'Other' ? paymentCustomMethod.trim() : paymentMethod;
    if (!Number(paymentAmount) || Number(paymentAmount) <= 0) return setPaymentError('Enter a valid payment amount.');
    if (!method) return setPaymentError('Enter a payment method.');
    setBusy(true); setPaymentError('');
    const { data, error } = await sb().rpc('record_purchase_bill_payment', { p_bill_id: row.id, p_amount: Number(paymentAmount), p_method: method, p_paid_on: paymentDate, p_note: null });
    if (error) { setPaymentError(error.message); setBusy(false); return; }
    setSaved(current => current.map(item => item.id === row.id ? { ...item, payments: [...item.payments, { id: String(data), amount: Number(paymentAmount), method, paid_on: paymentDate, note: null }] } : item));
    setPayingId(null); setBusy(false);
  }

  async function extract() {
    if (!file) return;
    setBusy(true); setError('');
    let uploadedPath: string | null = null;
    try {
      const { data: { session } } = await sb().auth.getSession();
      if (!session) throw new Error('Sign in again to upload this document.');
      const path = `${session.user.id}/${createId()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const upload = await sb().storage.from('purchase-documents').upload(path, file, { contentType: file.type, upsert: false });
      if (upload.error) throw new Error(upload.error.message);
      uploadedPath = path;
      setSourceReference(path);
      const form = new FormData(); form.append('file', file);
      const response = await fetch('/api/purchase-bills/extract', { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}` }, body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'NVIDIA extraction failed.');
      setBill({ ...result, items: (result.items ?? []).map((line: Line) => ({ ...line, product_id: null })) });
    } catch (e) {
      // Extraction failed after the upload: remove the stored file so failed attempts don't pile up as orphans.
      if (uploadedPath) { await sb().storage.from('purchase-documents').remove([uploadedPath]); setSourceReference(null); }
      const message = e instanceof Error ? e.message : 'Upload failed.';
      setError(message.toLowerCase().includes('bucket not found')
        ? 'The private purchase-documents bucket is missing. Apply the database migrations with `npm run db:push`, then retry.'
        : message);
    } finally { setBusy(false); }
  }

  async function addProductFromLine(index: number) {
    const line = bill?.items[index];
    if (!line?.description?.trim()) { setError(`Line ${index + 1} needs a description before creating a product.`); return; }
    setError(''); setBusy(true);
    const { data, error } = await sb().from('products').insert({
      name: line.description.trim(), hsn: line.hsn?.trim() || '4820', rate: line.unit_rate ?? 0,
      gst: line.gst_rate ?? 0, track_stock: true, active: true,
    }).select('*').single();
    setBusy(false);
    if (error) { setError(error.code === '23505' ? `A product named "${line.description.trim()}" already exists. Choose it from the product list.` : error.message); return; }
    setProducts(rows => [...rows, data as Product].sort((a, b) => a.name.localeCompare(b.name)));
    updateLine(index, 'product_id', data.id);
  }

  async function confirm() {
    if (!bill) return;
    setError(''); setBusy(true);
    const { error } = await sb().rpc('confirm_purchase_bill', { p: {
      ...bill, source_reference: sourceReference,
      totals: { subtotal: bill.subtotal ?? null, tax_total: bill.tax_total ?? null, round_off: bill.round_off ?? null, grand_total: bill.grand_total ?? null },
    } });
    setBusy(false);
    if (error) {
      const diagnostics = [error.code && `Code: ${error.code}`, error.details, error.hint].filter(Boolean).join(' ');
      setError(diagnostics ? `${error.message} ${diagnostics}` : error.message);
      return;
    }
    setBill(null); setFile(null); setSourceReference(null); load();
  }

  async function deletePurchase(item: SavedBill) {
    if (!window.confirm(`Permanently delete purchase bill ${item.supplier_invoice_number} from ${item.supplier_name}? Received stock will be removed too.`)) return;
    setError(''); setBusy(true);
    const { data: sourcePath, error } = await sb().rpc('delete_purchase_bill', { p_id: item.id });
    if (error) {
      const missingRpc = error.code === 'PGRST202' || error.message.toLowerCase().includes('schema cache');
      setError(missingRpc
        ? 'The purchase deletion function is missing. Apply the database migrations with `npm run db:push`, then retry.'
        : error.message);
      setBusy(false); return;
    }
    if (sourcePath) {
      const { error: storageError } = await sb().storage.from('purchase-documents').remove([sourcePath]);
      if (storageError) setError(`Bill deleted, but its stored source file could not be removed: ${storageError.message}`);
    }
    setBusy(false); load();
  }

  return <Shell title="Purchase Bills" back="/">
    <p className="muted">Upload a supplier bill, review every extracted value, then confirm to receive eligible stock.</p>
    {!bill && <>
      <section className="card">
        <h2 style={{ marginTop: 0 }}>Upload supplier bill</h2>
        <p className="muted small">Choose a PDF or image (JPEG, PNG, WebP), up to 10 MB. The document is saved privately for your records.</p>
        <label className="upload-select">{file ? 'Choose a different file' : 'Select PDF or image'}
          <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={e => setFile(e.target.files?.[0] ?? null)} />
        </label>
        {file && <p className="small">Selected: <strong>{file.name}</strong> | {(file.size / 1024 / 1024).toFixed(2)} MB</p>}
        <div className={`config-note ${providerConfig?.nvidia.configured ? 'ready' : 'pending'}`}>
          {!providerConfig ? 'Checking NVIDIA configuration...' : providerConfig.nvidia.configured
            ? `NVIDIA API key detected. Model: ${providerConfig.nvidia.model}`
            : 'OpenRouter API key missing. Add OPENROUTER_API_KEY to the root .env.local file and restart the dev server.'}
        </div>
        <button style={{ marginTop: 14, width: '100%' }} disabled={!file || busy || !providerConfig?.nvidia.configured} onClick={extract}>
          {busy ? 'Uploading and extracting with NVIDIA...' : 'Upload and extract with NVIDIA'}
        </button>
        <button className="alt" style={{ marginTop: 9, width: '100%' }} disabled={busy} onClick={startManual}>Enter purchase bill manually</button>
        {error && <p className="bad">{error}</p>}
      </section>
      <h2>Recorded purchase bills</h2>
      {error && <p className="bad">{error}</p>}
      <div className="list">{saved.map(item => <div className="bill-row" key={item.id}>
        <div className="bill-main"><div className="between"><strong>#{item.supplier_invoice_number} · {item.supplier_name}</strong><strong>₹ {inr(Number(item.grand_total ?? 0))}</strong></div><div className="between small muted"><span>{item.purchase_date} · {item.line_count ?? 0} lines</span><button className="danger small" disabled={busy} onClick={() => deletePurchase(item)}>Delete</button></div></div>
        {item.status === 'confirmed' && <div className="bill-payment"><button type="button" className="bill-payment-summary" onClick={() => setExpandedPaymentId(expandedPaymentId === item.id ? null : item.id)}><span className={balance(item) <= .01 ? 'payment-paid' : paid(item) > 0 ? 'payment-partial' : 'payment-unpaid'}>{balance(item) <= .01 ? 'PAID IN FULL' : paid(item) > 0 ? 'PARTLY PAID' : 'UNPAID'}</span><span>{balance(item) <= .01 ? `Paid ₹ ${inr(paid(item))}` : `Due ₹ ${inr(balance(item))}`} <span className="payment-chevron">{expandedPaymentId === item.id ? '↑' : '↓'}</span></span></button>{expandedPaymentId === item.id && <div className="bill-payment-details">{item.payments.length ? item.payments.map(payment => <div className="payment-detail" key={payment.id}><strong>₹ {inr(Number(payment.amount))}</strong><span>{payment.method} · {payment.paid_on}</span></div>) : <span className="muted small">No payment recorded yet.</span>}{balance(item) > .01 && payingId !== item.id && <button className="alt small" style={{ marginTop: 8 }} onClick={() => startPayment(item)}>Add payment</button>}{payingId === item.id && <form onSubmit={e => { e.preventDefault(); void savePayment(item); }} style={{ marginTop: 8 }}><div className="row"><div><label>Amount</label><input type="number" min="0.01" max={balance(item).toFixed(2)} step="0.01" value={paymentAmount} onChange={e => setPaymentAmount(e.target.value)} /></div><div><label>Date</label><input type="date" value={paymentDate} onChange={e => setPaymentDate(e.target.value)} /></div></div><label>Method</label><select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}>{['Cash','UPI','Card','Bank transfer','Cheque','Other'].map(option => <option key={option}>{option}</option>)}</select>{paymentMethod === 'Other' && <input placeholder="Custom payment method" value={paymentCustomMethod} onChange={e => setPaymentCustomMethod(e.target.value)} style={{ marginTop: 6 }} />}{paymentError && <p className="bad">{paymentError}</p>}<div className="row" style={{ marginTop: 7 }}><button type="submit" disabled={busy}>Save payment</button><button type="button" className="alt" onClick={() => setPayingId(null)}>Cancel</button></div></form>}</div>}</div>}
      </div>)}{saved.length === 0 && <div className="card muted">No purchase bills recorded yet.</div>}</div>
    </>}

    {bill && <>
      <section className="card"><strong>Review extracted bill</strong><p className="muted small">Values are unverified until you confirm. Missing fields are left blank.</p>
        <label>Supplier name *</label><input value={bill.supplier_name ?? ''} onChange={e => updateBill('supplier_name', e.target.value)} />
        <label>Supplier bill number *</label><input value={bill.supplier_invoice_number ?? ''} onChange={e => updateBill('supplier_invoice_number', e.target.value)} />
        <label>Purchase date *</label><input type="date" value={bill.purchase_date ?? ''} onChange={e => updateBill('purchase_date', e.target.value)} />
        <label>Supplier GSTIN</label><input value={bill.supplier_gstin ?? ''} onChange={e => updateBill('supplier_gstin', e.target.value)} />
        <label>Supplier address</label><input value={bill.supplier_address ?? ''} onChange={e => updateBill('supplier_address', e.target.value)} />
      </section>
      {bill.items.map((line, index) => <section className="card" key={index}>
        <strong>Line {index + 1}</strong>
        {bill.items.length > 1 && <button className="danger small" style={{ float: 'right' }} onClick={() => removeLine(index)}>Remove line</button>}
        <label>Description *</label><input value={line.description ?? ''} onChange={e => updateLine(index, 'description', e.target.value)} />
        <div className="row">
          <div><label>Quantity *</label><input type="number" min="0.001" step="0.001" value={line.quantity ?? ''} onChange={e => updateLine(index, 'quantity', e.target.value === '' ? null : Number(e.target.value))} /></div>
          <div><label>Unit rate</label><input type="number" min="0" step="0.01" value={line.unit_rate ?? ''} onChange={e => updateLine(index, 'unit_rate', e.target.value === '' ? null : Number(e.target.value))} /></div>
          <div><label>Line amount</label><input type="number" min="0" step="0.01" value={line.line_total ?? ''} onChange={e => updateLine(index, 'line_total', e.target.value === '' ? null : Number(e.target.value))} /></div>
        </div>
        <label>Match product for stock receipt</label>
        <select value={line.product_id ?? ''} onChange={e => updateLine(index, 'product_id', e.target.value || null)}>
          <option value="">Unlinked</option>{products.map(product => <option key={product.id} value={product.id}>{product.name}{product.track_stock ? ' (stock tracked)' : ' (non-stock)'}</option>)}
        </select>
        {!line.product_id && <button className="alt small" style={{ marginTop: 8 }} disabled={busy} onClick={() => addProductFromLine(index)}>Add this line as a stock product</button>}
        <label>Tax components as printed</label>
        <div className="row">{(['cgst', 'sgst', 'igst'] as const).map(key => <div key={key}><label>{key.toUpperCase()}</label><input type="number" value={line[key] ?? ''} onChange={e => updateLine(index, key, e.target.value === '' ? null : Number(e.target.value))} /></div>)}</div>
      </section>)}
      <button className="alt" style={{ width: '100%', marginBottom: 10 }} onClick={addLine}>Add another line</button>
      <section className="card"><strong>Bill totals</strong>
        <div className="row">{(['subtotal', 'tax_total', 'round_off', 'grand_total'] as const).map(key => <div key={key}><label>{key.replace('_', ' ')}</label><input type="number" value={bill[key] ?? ''} onChange={e => updateBill(key, e.target.value === '' ? null : Number(e.target.value))} /></div>)}</div>
        {Math.abs(totalsDifference) > 1 && <p className="ask-warning">Check the printed totals: grand total differs from subtotal + tax + round-off by ₹{inr(Math.abs(totalsDifference))}. The bill can still be saved with the printed values.</p>}
        {error && <p className="bad">{error}</p>}
        <div className="row" style={{ marginTop: 12 }}><button className="alt" onClick={() => setBill(null)}>Discard review</button><button disabled={busy} onClick={confirm}>{busy ? 'Saving...' : 'Confirm purchase bill'}</button></div>
      </section>
    </>}
  </Shell>;
}
