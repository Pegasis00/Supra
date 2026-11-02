'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useRouter } from 'next/navigation';
import Shell from '@/components/Shell';
import { sb } from '@/lib/supabase';
import { buildInvoicePdf } from '@/lib/pdf';
import { dmy, inr } from '@/lib/money';
import type { Business, Invoice, InvoiceItem } from '@/lib/types';

const num = <T extends object>(o: T, keys: string[]) => {
  const c = { ...o } as Record<string, unknown>;
  keys.forEach((k) => { c[k] = Number(c[k]); });
  return c as unknown as T;
};

export default function BillView() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [inv, setInv] = useState<Invoice | null>(null);
  const [items, setItems] = useState<InvoiceItem[]>([]);
  const [biz, setBiz] = useState<Business | null>(null);
  const [msg, setMsg] = useState('');

  async function loadBill() {
    const db = sb();
    const [invoice, lines, business] = await Promise.all([
      db.from('sales_invoices').select('*').eq('id', id).single(),
      db.from('sales_invoice_lines').select('*').eq('invoice_id', id).order('position'),
      db.from('business').select('*').eq('id', 1).single(),
    ]);
    if (invoice.data) setInv(num(invoice.data as Invoice, ['subtotal', 'cgst', 'sgst', 'round_off', 'total']));
    setItems(((lines.data ?? []) as InvoiceItem[]).map((i) => num(i, ['gst', 'qty', 'rate', 'amount', 'cgst', 'sgst', 'total'])));
    if (business.data) setBiz(business.data as Business);
  }

  useEffect(() => {
    const editNotice = sessionStorage.getItem('invoice-edit-pdf-notice');
    if (editNotice) {
      setMsg(editNotice);
      sessionStorage.removeItem('invoice-edit-pdf-notice');
    }
    void loadBill();
  }, [id]);

  if (!inv || !biz) return <Shell title="Bill" back="/bills"><p className="muted">Loading…</p></Shell>;
  const fileName = `Invoice-${inv.invoice_no}-${inv.customer_name.replace(/[^a-z0-9]+/gi, '_')}.pdf`;

  const make = () => buildInvoicePdf(inv, items, biz);
  const download = (blob: Blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = fileName; a.click();
  };
  async function share() {
    const blob = await make();
    const file = new File([blob], fileName, { type: 'application/pdf' });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: `Invoice ${inv!.invoice_no}` }); } catch { /* cancelled */ }
    } else {
      download(blob);
      setMsg('PDF downloaded. Open WhatsApp and attach it.');
    }
  }
  async function print() { window.open(URL.createObjectURL(await make()), '_blank'); }
  async function cancel() {
    if (!confirm(`Cancel invoice #${inv!.invoice_no}? This cannot be undone.`)) return;
    const { error } = await sb().rpc('cancel_invoice', { p_id: id });
    if (error) setMsg(error.message);
    else setInv({ ...inv!, status: 'cancelled' });
  }
  async function deleteBill() {
    if (!confirm(`Permanently delete invoice #${inv!.invoice_no} from the database? This also removes its invoice lines.`)) return;
    const { error } = await sb().rpc('delete_invoice', { p_id: id });
    if (error) setMsg(error.message);
    else router.replace('/bills');
  }

  return (
    <Shell title={`Invoice #${inv.invoice_no}`} back="/bills">
      <div className="card">
        <div className="between"><strong>{inv.customer_name}</strong>{inv.status === 'cancelled' && <span className="badge">Cancelled</span>}</div>
        <div className="muted small">{dmy(inv.invoice_date)}{inv.challan_no ? ` · Challan ${inv.challan_no}` : ''}{inv.source === 'excel_import' ? ' · Imported from Excel' : ''}</div>
        {inv.import_warning && <p className="small" style={{ margin: '8px 0 0', color: '#8a6100' }}>Import note: {inv.import_warning}</p>}
        {items.map((i) => (
          <div key={i.position} className="between" style={{ marginTop: 8 }}>
            <span>{i.description}<br /><span className="muted small">{i.qty} × {inr(i.rate)}{i.gst ? ` · GST ${i.gst}%` : ''}</span></span>
            <strong>{inr(i.total)}</strong>
          </div>
        ))}
        <hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: '12px 0' }} />
        <div className="between"><span>Round off</span><span>{inv.round_off > 0 ? '+' : ''}{inv.round_off.toFixed(2)}</span></div>
        <div className="between"><strong>Grand total</strong><span className="big">₹ {inr(inv.total)}</span></div>
      </div>
      <button style={{ width: '100%', marginBottom: 10 }} onClick={share}>Share on WhatsApp</button>
      {inv.status === 'final' && <button className="alt" style={{ width: '100%', marginBottom: 10 }} onClick={() => router.push(`/bills/${id}/edit`)}>Edit bill</button>}
      <div className="grid">
        <button className="alt" onClick={async () => download(await make())}>Download PDF</button>
        <button className="alt" onClick={print}>Print</button>
      </div>
      {msg && <p className="muted small">{msg}</p>}
      {inv.status === 'final' && <button className="danger" style={{ width: '100%', marginTop: 24 }} onClick={cancel}>Cancel this bill</button>}
      <button className="danger" style={{ width: '100%', marginTop: 10 }} onClick={deleteBill}>Delete this bill permanently</button>
    </Shell>
  );
}
