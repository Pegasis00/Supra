'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Shell from '@/components/Shell';
import { sb } from '@/lib/supabase';
import { inr } from '@/lib/money';
import { createId } from '@/lib/id';
import type { Customer, Product } from '@/lib/types';

type Line = {
  description: string | null; quantity: number | null; unit_rate: number | null;
  discount?: number | null; discount_after_gst?: boolean; line_total: number | null; hsn?: string | null; gst_rate?: number | null;
  cgst?: number | null; sgst?: number | null; igst?: number | null; product_id?: string | null;
};
type Bill = {
  supplier_name: string | null; supplier_mobile?: string | null; supplier_gstin?: string | null; supplier_address?: string | null;
  supplier_invoice_number: string | null; purchase_date: string | null;
  purchase_order_number?: string | null; challan_number?: string | null; items: Line[];
  subtotal?: number | null; tax_total?: number | null; round_off?: number | null;
  grand_total?: number | null; source_filename?: string; extraction?: Record<string, unknown>;
};
type ProviderConfig = { nvidia: { configured: boolean; model: string } };
const lineMath = (line: Line) => {
  const qty = Number(line.quantity ?? 0), rate = Number(line.unit_rate ?? 0), discount = Number(line.discount ?? 0);
  const gross = qty * rate;
  const afterGst = Boolean(line.discount_after_gst);
  const amount = Math.max(0, Math.round((gross - (afterGst ? 0 : gross * discount / 100)) * 100) / 100);
  const tax = Math.round(amount * Number(line.gst_rate ?? 0) / 100 * 100) / 100;
  const total = afterGst ? Math.max(0, Math.round((gross + tax - gross * discount / 100) * 100) / 100) : Math.round((amount + tax) * 100) / 100;
  return { amount, tax, total };
};

function PurchaseBillsContent() {
  const searchParams = useSearchParams();
  const editId = searchParams.get('edit');
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Customer[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [sourceReference, setSourceReference] = useState<string | null>(null);
  const [bill, setBill] = useState<Bill | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [providerConfig, setProviderConfig] = useState<ProviderConfig | null>(null);
  const calculatedTotals = bill ? bill.items.map(lineMath).reduce((totals, line) => ({ subtotal: totals.subtotal + line.amount, tax: totals.tax + line.tax, total: totals.total + line.total }), { subtotal: 0, tax: 0, total: 0 }) : { subtotal: 0, tax: 0, total: 0 };
  const totalsDifference = bill?.subtotal != null && bill.tax_total != null && bill.round_off != null && bill.grand_total != null
    ? Math.round((bill.grand_total - bill.subtotal - bill.tax_total - bill.round_off) * 100) / 100
    : 0;

  useEffect(() => {
    sb().from('products').select('*').eq('active', true).order('name')
      .then(({ data }) => setProducts((data ?? []) as Product[]));
    sb().from('parties').select('id,name,gstin,address1,address2,phone').in('kind', ['supplier', 'both', 'customer']).order('name')
      .then(({ data }) => setSuppliers((data ?? []) as Customer[]));
    fetch('/api/purchase-bills/extract').then(r => r.json()).then(setProviderConfig).catch(() => setProviderConfig(null));
  }, []);

  useEffect(() => {
    if (!editId) return;
    sb().from('purchase_bills').select('id,source_file_path,supplier_name,supplier_gstin,supplier_address,supplier_invoice_number,purchase_date,grand_total,subtotal,tax_total,round_off,extraction_metadata,bill_json').eq('id', editId).single().then(({ data, error: loadError }) => {
      if (loadError) { setError(loadError.message); return; }
      const row = data as any;
      const timings = row.extraction_metadata?.discount_timing ?? [];
      setSourceReference(row.source_file_path ?? null);
      setBill({
        supplier_name: row.supplier_name, supplier_mobile: row.extraction_metadata?.supplier_mobile ?? '', supplier_gstin: row.supplier_gstin ?? '', supplier_address: row.supplier_address ?? '', supplier_invoice_number: row.supplier_invoice_number, purchase_date: row.purchase_date,
        subtotal: row.subtotal, tax_total: row.tax_total, round_off: row.round_off, grand_total: row.grand_total, extraction: row.extraction_metadata ?? {},
        items: (row.bill_json?.items ?? []).map((line: any, index: number) => ({ ...line, quantity: line.quantity ?? null, unit_rate: line.unit_rate ?? null, discount: line.discount ?? null, gst_rate: line.gst_rate ?? null, product_id: line.product_id ?? null, discount_after_gst: timings[index] === 'after_gst' })),
      });
    });
  }, [editId]);

  function updateBill(key: keyof Bill, value: unknown) {
    setBill(current => current ? { ...current, [key]: value } : current);
  }
  function selectSupplier(id: string) {
    const supplier = suppliers.find(item => item.id === id);
    if (!supplier) return;
    updateBill('supplier_name', supplier.name);
    updateBill('supplier_mobile', (supplier as Customer & { phone?: string | null }).phone ?? '');
    updateBill('supplier_gstin', supplier.gstin ?? '');
    updateBill('supplier_address', [supplier.address1, supplier.address2].filter(Boolean).join(', '));
  }
  function updateLine(index: number, key: keyof Line, value: unknown) {
    setBill(current => current ? { ...current, items: current.items.map((line, i) => i === index ? { ...line, [key]: value } : line) } : current);
  }
  function selectProduct(index: number, id: string) {
    const product = products.find(item => item.id === id);
    if (!product) return updateLine(index, 'product_id', null);
    setBill(current => current ? { ...current, items: current.items.map((line, i) => i === index ? { ...line, product_id: product.id, description: product.name, hsn: product.hsn, gst_rate: Number(product.gst), discount: line.discount ?? null } : line) } : current);
  }
  function addLine() { setBill(current => current ? { ...current, items: [...current.items, { description: '', quantity: null, unit_rate: null, discount: null, discount_after_gst: false, line_total: null, gst_rate: null, product_id: null }] } : current); }
  function removeLine(index: number) { setBill(current => current ? { ...current, items: current.items.filter((_, i) => i !== index) } : current); }
  function startManual() {
    setFile(null); setSourceReference(null); setError('');
    setBill({ supplier_name: '', supplier_mobile: '', supplier_gstin: '', supplier_address: '', supplier_invoice_number: '', purchase_date: new Date().toISOString().slice(0, 10), items: [{ description: '', quantity: null, unit_rate: null, discount: null, discount_after_gst: false, line_total: null, gst_rate: null, product_id: null }], subtotal: 0, tax_total: 0, round_off: 0, grand_total: 0 });
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
      setBill({ ...result, items: (result.items ?? []).map((line: Line) => ({ ...line, discount: line.discount ?? null, discount_after_gst: false, product_id: null })) });
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
    setError('');
    if (!bill.supplier_name?.trim() || !bill.supplier_invoice_number?.trim() || !bill.purchase_date) return setError('Enter supplier name, bill number, and purchase date.');
    if (!bill.items.length || bill.items.some(line => !line.description?.trim() || Number(line.quantity ?? 0) <= 0 || Number(line.unit_rate ?? 0) < 0 || Number(line.discount ?? 0) < 0 || Number(line.discount ?? 0) > 100)) return setError('Every line needs a description, quantity, rate, and discount between 0% and 100%.');
    setBusy(true);
    const payload = {
      ...bill, source_reference: sourceReference,
      extraction: { ...(bill.extraction ?? {}), supplier_mobile: bill.supplier_mobile?.trim() || null, discount_timing: bill.items.map(line => line.discount_after_gst ? 'after_gst' : 'before_gst') },
      items: bill.items.map(line => ({ ...line, line_total: lineMath(line).amount, cgst: lineMath(line).tax / 2, sgst: lineMath(line).tax / 2 })),
      totals: { subtotal: calculatedTotals.subtotal, tax_total: calculatedTotals.tax, round_off: 0, grand_total: calculatedTotals.total },
    };
    const { error } = editId
      ? await sb().rpc('update_purchase_bill', { p_id: editId, p: payload })
      : await sb().rpc('confirm_purchase_bill', { p: payload });
    setBusy(false);
    if (error) {
      const diagnostics = [error.code && `Code: ${error.code}`, error.details, error.hint].filter(Boolean).join(' ');
      setError(diagnostics ? `${error.message} ${diagnostics}` : error.message);
      return;
    }
    setBill(null); setFile(null); setSourceReference(null);
    if (editId) window.location.href = `/purchase-bills/${editId}`;
  }

  return <Shell title="Purchase Bills" back="/">
    <p className="muted">{editId ? 'Edit the existing purchase bill and save the updated details.' : 'Upload a supplier bill, review every extracted value, then confirm to receive eligible stock.'}</p>
    {!bill && <>
      <section className="card">
        <h2 style={{ marginTop: 0 }}>{editId ? 'Edit purchase bill' : 'Upload supplier bill'}</h2>
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
        {!editId && <button style={{ marginTop: 14, width: '100%' }} disabled={!file || busy || !providerConfig?.nvidia.configured} onClick={extract}>
          {busy ? 'Uploading and extracting with NVIDIA...' : 'Upload and extract with NVIDIA'}
        </button>}
        {!editId && <button className="alt" style={{ marginTop: 9, width: '100%' }} disabled={busy} onClick={startManual}>Enter purchase bill manually</button>}
        {error && <p className="bad">{error}</p>}
      </section>
      <p className="muted small">Saved purchase bills are available from Supplier ledger, where you can view bills, update payments, edit, or delete them.</p>
    </>}

    {bill && <>
      <section className="card"><strong>Purchase bill details</strong><p className="muted small">Purchase rate is saved on this bill only; it never changes the product selling rate.</p>
        <label>Existing company / customer</label><select defaultValue="" onChange={e => selectSupplier(e.target.value)}><option value="">Type a new company below</option>{suppliers.map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.name}{supplier.gstin ? ` · ${supplier.gstin}` : ''}</option>)}</select>
        <div className="grid"><div><label>Company name *</label><input value={bill.supplier_name ?? ''} onChange={e => updateBill('supplier_name', e.target.value)} /></div><div><label>Bill number *</label><input value={bill.supplier_invoice_number ?? ''} onChange={e => updateBill('supplier_invoice_number', e.target.value)} /></div><div><label>Purchase date *</label><input type="date" value={bill.purchase_date ?? ''} onChange={e => updateBill('purchase_date', e.target.value)} /></div><div><label>Supplier mobile (optional)</label><input inputMode="tel" value={bill.supplier_mobile ?? ''} onChange={e => updateBill('supplier_mobile', e.target.value)} /></div><div><label>Supplier GSTIN (optional)</label><input value={bill.supplier_gstin ?? ''} onChange={e => updateBill('supplier_gstin', e.target.value)} /></div></div>
        <label>Address</label><input value={bill.supplier_address ?? ''} onChange={e => updateBill('supplier_address', e.target.value)} />
      </section>
      {bill.items.map((line, index) => <section className="card" key={index}>
        <strong>Item {index + 1}</strong>
        {bill.items.length > 1 && <button className="danger small" style={{ float: 'right' }} onClick={() => removeLine(index)}>Remove line</button>}
        <label>Product from list</label>
        <select value={line.product_id ?? ''} onChange={e => selectProduct(index, e.target.value)}>
          <option value="">New item / type description below</option>{products.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}
        </select>
        <label>Description *</label><input value={line.description ?? ''} onChange={e => updateLine(index, 'description', e.target.value)} />
        <div className="row">
          <div><label>Quantity *</label><input type="number" min="0.001" step="0.001" value={line.quantity ?? ''} onChange={e => updateLine(index, 'quantity', e.target.value === '' ? null : Number(e.target.value))} /></div>
          <div><label>Unit rate</label><input type="number" min="0" step="0.01" value={line.unit_rate ?? ''} onChange={e => updateLine(index, 'unit_rate', e.target.value === '' ? null : Number(e.target.value))} /></div>
        </div>
        {!line.product_id && <button className="alt small" style={{ marginTop: 8 }} disabled={busy} onClick={() => addProductFromLine(index)}>Add this line as a stock product</button>}
        <div className="row"><div><label>GST %</label><input type="number" min="0" max="28" step="0.01" value={line.gst_rate ?? ''} onChange={e => updateLine(index, 'gst_rate', e.target.value === '' ? null : Number(e.target.value))} /></div><div><label>Discount %</label><input type="number" min="0" max="100" step="0.01" value={line.discount ?? ''} onChange={e => updateLine(index, 'discount', e.target.value === '' ? null : Number(e.target.value))} /></div></div>
        <label className="small muted" style={{ marginTop: 10 }}>Discount calculation</label><div className="segmented discount-choice"><button type="button" className={!line.discount_after_gst ? '' : 'alt'} onClick={() => updateLine(index, 'discount_after_gst', false)}>Before GST</button><button type="button" className={line.discount_after_gst ? '' : 'alt'} onClick={() => updateLine(index, 'discount_after_gst', true)}>After GST</button></div>
        <div className="between" style={{ marginTop: 8 }}><span className="muted small">GST ₹ {inr(lineMath(line).tax)} · Discount applied {line.discount_after_gst ? 'after GST' : 'before GST'}</span><strong>Total ₹ {inr(lineMath(line).total)}</strong></div>
      </section>)}
      <button className="alt" style={{ width: '100%', marginBottom: 10 }} onClick={addLine}>Add another line</button>
      <section className="card"><strong>Bill totals</strong>
        <div className="between" style={{ marginTop: 10 }}><span>Subtotal</span><strong>₹ {inr(calculatedTotals.subtotal)}</strong></div><div className="between" style={{ marginTop: 8 }}><span>GST</span><strong>₹ {inr(calculatedTotals.tax)}</strong></div><div className="between" style={{ marginTop: 8 }}><span>Grand total</span><strong className="big">₹ {inr(calculatedTotals.total)}</strong></div>
        {Math.abs(totalsDifference) > 1 && <p className="ask-warning">Check the printed totals: grand total differs from subtotal + tax + round-off by ₹{inr(Math.abs(totalsDifference))}. The bill can still be saved with the printed values.</p>}
        {error && <p className="bad">{error}</p>}
        <div className="row" style={{ marginTop: 12 }}><button className="alt" onClick={() => setBill(null)}>Discard bill</button><button disabled={busy} onClick={confirm}>{busy ? 'Saving...' : 'Save purchase bill'}</button></div>
      </section>
    </>}
  </Shell>;
}

export default function PurchaseBills() {
  return <Suspense fallback={<Shell title="Purchase Bills" back="/"><p className="muted">Loading purchase bills...</p></Shell>}>
    <PurchaseBillsContent />
  </Suspense>;
}
