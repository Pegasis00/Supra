'use client';
import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Shell from '@/components/Shell';
import Picker from '@/components/Picker';
import { sb } from '@/lib/supabase';
import { buildInvoicePdf } from '@/lib/pdf';
import { calcLine, inr, n, r2 } from '@/lib/money';
import { createId } from '@/lib/id';
import type { Business, Customer, Invoice, InvoiceItem, Product } from '@/lib/types';

type Bill = Invoice & { customer_id: string | null; po_no: string | null };
type Line = {
  key: string; product_id: string | null; description: string; hsn: string;
  gst: string; qty: string; rate: string;
};
const fileNameFor = (invoiceNo: number, customerName: string) =>
  `Invoice-${invoiceNo}-${customerName.replace(/[^a-z0-9]+/gi, '_')}.pdf`;

export default function EditBill() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [bill, setBill] = useState<Bill | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [business, setBusiness] = useState<Business | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [date, setDate] = useState('');
  const [challan, setChallan] = useState('');
  const [po, setPo] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [picker, setPicker] = useState<'customer' | 'product' | null>(null);
  const [originalFileName, setOriginalFileName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      const db = sb();
      const [billRes, linesRes, customersRes, productsRes, businessRes] = await Promise.all([
        db.from('sales_invoices').select('*').eq('id', id).single(),
        db.from('sales_invoice_lines').select('*').eq('invoice_id', id).order('position'),
        db.from('parties').select('id,name,gstin,address1,address2').in('kind', ['customer', 'both']).order('name'),
        db.from('products').select('*').eq('active', true).order('name'),
        db.from('business').select('*').eq('id', 1).single(),
      ]);
      if (!active) return;
      if (billRes.error || !billRes.data) {
        setError(billRes.error?.message ?? 'Bill not found.');
        setLoading(false);
        return;
      }
      const b = billRes.data as Bill;
      const cs = (customersRes.data ?? []) as Customer[];
      setBill(b);
      setCustomers(cs);
      setProducts(((productsRes.data ?? []) as Product[]).map((p) => ({ ...p, rate: Number(p.rate), gst: Number(p.gst) })));
      setBusiness(businessRes.data as Business);
      setDate(b.invoice_date);
      setChallan(b.challan_no ?? '');
      setPo(b.po_no ?? '');
      setOriginalFileName(fileNameFor(b.invoice_no, b.customer_name));
      setCustomer(cs.find((c) => c.id === b.customer_id) ?? cs.find((c) => c.name.toLowerCase() === b.customer_name.toLowerCase()) ?? null);
      setLines(((linesRes.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
        key: createId(),
        product_id: (row.product_id as string | null) ?? null,
        description: String(row.description ?? ''),
        hsn: String(row.hsn ?? ''),
        gst: String(row.gst ?? '0'),
        qty: String(row.qty ?? ''),
        rate: String(row.rate ?? ''),
      })));
      setLoading(false);
    }
    void load();
    return () => { active = false; };
  }, [id]);

  const calculations = useMemo(() => lines.map((line) => calcLine(n(line.qty), n(line.rate), n(line.gst))), [lines]);
  const subtotal = r2(calculations.reduce((sum, line) => sum + line.amount, 0));
  const tax = r2(calculations.reduce((sum, line) => sum + line.cgst, 0));
  const exact = r2(subtotal + tax * 2);
  const total = Math.round(exact);
  const roundOff = r2(total - exact);

  function patchLine(key: string, patch: Partial<Line>) {
    setLines((current) => current.map((line) => line.key === key
      ? { ...line, ...patch, ...(patch.description !== undefined ? { product_id: null } : {}) }
      : line));
  }

  function addProduct(productId: string) {
    const product = products.find((item) => item.id === productId);
    if (!product) return;
    setLines((current) => [...current, {
      key: createId(), product_id: product.id, description: product.name, hsn: product.hsn,
      gst: String(product.gst), qty: '', rate: String(product.rate),
    }]);
    setPicker(null);
  }

  function addCustom(description: string) {
    setLines((current) => [...current, {
      key: createId(), product_id: null, description, hsn: business ? '4820' : '', gst: '0', qty: '', rate: '',
    }]);
    setPicker(null);
  }

  async function save() {
    setError('');
    if (!bill || !business) return;
    if (!customer) return setError('Choose a customer first.');
    if (!date) return setError('Enter the bill date.');
    if (!lines.length || lines.some((line) => n(line.qty) <= 0)) return setError('Every item needs a quantity greater than zero.');
    if (lines.some((line) => !line.description.trim() || line.rate.trim() === '')) return setError('Every item needs a description and rate.');
    if (lines.some((line) => n(line.gst) < 0 || n(line.gst) > 28 || n(line.rate) < 0)) return setError('Check each rate and GST value.');

    const nextItems: InvoiceItem[] = lines.map((line, index) => ({
      position: index + 1,
      description: line.description.trim(),
      hsn: line.hsn.trim() || null,
      gst: n(line.gst),
      qty: n(line.qty),
      rate: n(line.rate),
      ...calcLine(n(line.qty), n(line.rate), n(line.gst)),
    }));
    const nextBill: Invoice = {
      ...bill,
      invoice_date: date,
      challan_no: challan.trim() || null,
      po_no: po.trim() || null,
      customer_name: customer.name,
      customer_gstin: customer.gstin,
      customer_address1: customer.address1,
      customer_address2: customer.address2,
      subtotal,
      cgst: tax,
      sgst: tax,
      round_off: roundOff,
      total,
    };

    setBusy(true);
    try {
      const pdf = await buildInvoicePdf(nextBill, nextItems, business);
      const { error: saveError } = await sb().rpc('update_invoice', {
        p_id: id,
        p: {
          invoice_date: date,
          challan_no: challan,
          po_no: po,
          customer_id: customer.id,
          items: lines.map((line) => ({
            product_id: line.product_id,
            description: line.description.trim(),
            hsn: line.hsn.trim(),
            gst: n(line.gst),
            qty: n(line.qty),
            rate: n(line.rate),
          })),
        },
      });
      if (saveError) throw new Error(saveError.message);
      const anchor = document.createElement('a');
      const url = URL.createObjectURL(pdf);
      anchor.href = url;
      anchor.download = originalFileName;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      sessionStorage.setItem('invoice-edit-pdf-notice', 'Updated bill saved and a replacement PDF was downloaded. Your browser cannot remove an older PDF already saved on this device; delete it manually if both copies remain.');
      router.replace(`/bills/${id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not update this bill.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Shell title="Edit Bill" back={`/bills/${id}`}><p className="muted">Loading…</p></Shell>;
  if (error && !bill) return <Shell title="Edit Bill" back="/bills"><p className="bad">{error}</p></Shell>;
  if (!bill || !business) return <Shell title="Edit Bill" back={`/bills/${id}`}><p className="muted">Bill details are unavailable.</p></Shell>;
  if (bill.status !== 'final') return <Shell title={`Edit Invoice #${bill.invoice_no}`} back={`/bills/${id}`}><p className="muted">Cancelled bills cannot be edited.</p></Shell>;

  return (
    <Shell title={`Edit Invoice #${bill.invoice_no}`} back={`/bills/${id}`}>
      <div className="card">
        <label style={{ marginTop: 0 }}>Customer</label>
        <button className="alt" style={{ width: '100%', textAlign: 'left' }} onClick={() => setPicker('customer')}>
          {customer ? customer.name : 'Choose customer…'}
        </button>
        {customer && <div className="muted small" style={{ marginTop: 6 }}>{customer.gstin ? `GSTIN: ${customer.gstin}` : 'No GSTIN saved'}</div>}
        <div className="row">
          <div><label>Date</label><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></div>
          <div><label>Challan No</label><input value={challan} onChange={(event) => setChallan(event.target.value)} /></div>
        </div>
        <label>P.O. No (optional)</label>
        <input value={po} onChange={(event) => setPo(event.target.value)} />
      </div>

      {lines.map((line, index) => {
        const calc = calculations[index];
        return (
          <div className="card" key={line.key}>
            <div className="between">
              <strong>{index + 1}. Item</strong>
              <button className="danger small" onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))}>Remove</button>
            </div>
            <label>Description</label>
            <input value={line.description} onChange={(event) => patchLine(line.key, { description: event.target.value })} />
            <div className="row">
              <div><label>HSN</label><input value={line.hsn} onChange={(event) => patchLine(line.key, { hsn: event.target.value })} /></div>
              <div><label>Qty</label><input inputMode="decimal" value={line.qty} onChange={(event) => patchLine(line.key, { qty: event.target.value })} /></div>
            </div>
            <div className="row">
              <div><label>Rate</label><input inputMode="decimal" value={line.rate} onChange={(event) => patchLine(line.key, { rate: event.target.value })} /></div>
              <div><label>GST %</label><input inputMode="decimal" value={line.gst} onChange={(event) => patchLine(line.key, { gst: event.target.value })} /></div>
            </div>
            <div className="between" style={{ marginTop: 8 }}>
              <span className="muted small">CGST {inr(calc.cgst)} + SGST {inr(calc.sgst)}</span>
              <strong>₹ {inr(calc.total)}</strong>
            </div>
          </div>
        );
      })}
      <button className="alt" style={{ width: '100%' }} onClick={() => setPicker('product')}>＋ Add item</button>
      {error && <p className="bad">{error}</p>}

      <div className="sticky">
        <div className="in">
          <div className="between small muted"><span>Subtotal {inr(subtotal)} · GST {inr(2 * tax)}</span><span>Round off {roundOff > 0 ? '+' : ''}{roundOff.toFixed(2)}</span></div>
          <div className="between" style={{ margin: '4px 0 8px' }}><strong>Total</strong><span className="big">₹ {inr(total)}</span></div>
          <button style={{ width: '100%' }} disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save changes'}</button>
        </div>
      </div>

      {picker === 'customer' && <Picker title="Customer" options={customers.map((c) => ({ id: c.id, label: c.name, sub: c.gstin ?? '' }))} onPick={(customerId) => { setCustomer(customers.find((c) => c.id === customerId) ?? null); setPicker(null); }} onClose={() => setPicker(null)} />}
      {picker === 'product' && <Picker title="Add item" options={products.map((p) => ({ id: p.id, label: p.name, sub: `₹ ${inr(p.rate)}` }))} onPick={addProduct} onCustom={addCustom} onClose={() => setPicker(null)} />}
    </Shell>
  );
}
