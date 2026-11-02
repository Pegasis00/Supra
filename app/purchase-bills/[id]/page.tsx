'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import Shell from '@/components/Shell';
import { sb } from '@/lib/supabase';
import { dmy, inr } from '@/lib/money';

type Line = { position: number; description: string; hsn: string | null; quantity: number; unit_rate: number | null; discount: number; line_total: number | null; gst_rate: number | null };
type Bill = { id: string; supplier_name: string; supplier_gstin: string | null; supplier_address: string | null; supplier_invoice_number: string; purchase_date: string; grand_total: number | null; subtotal: number | null; tax_total: number | null; extraction_metadata?: { supplier_mobile?: string | null } | null; bill_json: { items?: Line[] } | null };

export default function PurchaseBillDetail() {
  const { id } = useParams<{ id: string }>();
  const [bill, setBill] = useState<Bill | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    const { data, error: loadError } = await sb().from('purchase_bills').select('id,supplier_name,supplier_gstin,supplier_address,supplier_invoice_number,purchase_date,grand_total,subtotal,tax_total,extraction_metadata,bill_json').eq('id', id).single();
    if (loadError) setError(loadError.message); else setBill(data as Bill);
  }
  useEffect(() => { void load(); }, [id]);
  if (error) return <Shell title="Purchase bill" back="/supplier-ledger"><p className="bad">{error}</p></Shell>;
  if (!bill) return <Shell title="Purchase bill" back="/supplier-ledger"><p className="muted">Loading bill...</p></Shell>;

  const items = bill.bill_json?.items ?? [];
  const mobile = bill.extraction_metadata?.supplier_mobile;
  const currentBill = bill;
  async function deleteBill() {
    if (!confirm(`Delete purchase bill ${currentBill.supplier_invoice_number}? Its purchase stock will be removed.`)) return;
    setBusy(true); const result = await sb().rpc('delete_purchase_bill', { p_id: currentBill.id }); setBusy(false);
    if (result.error) setError(result.error.message); else window.location.href = '/supplier-ledger';
  }
  return <Shell title={`Bill #${bill.supplier_invoice_number}`} back="/supplier-ledger">
    <section className="card"><div className="between"><div><p className="eyebrow">PURCHASE BILL</p><h2>{bill.supplier_name}</h2><p className="muted small">Bill #{bill.supplier_invoice_number} · {dmy(bill.purchase_date)}</p></div><strong className="big">₹ {inr(Number(bill.grand_total ?? 0))}</strong></div><p className="muted small">{mobile ? `Mob ${mobile} · ` : ''}{bill.supplier_gstin || 'No GSTIN'}{bill.supplier_address ? ` · ${bill.supplier_address}` : ''}</p><div className="row" style={{ marginTop: 14 }}><Link className="alt small" href={`/purchase-bills?edit=${bill.id}`}>Edit bill</Link><button className="danger small" disabled={busy} onClick={() => void deleteBill()}>Delete bill</button></div></section>
    <section className="card"><div className="table-wrap"><table><thead><tr><th>Sr no</th><th>Description</th><th>HSN</th><th>GST %</th><th>Qty</th><th>Rate</th><th>Discount</th><th>Amount</th></tr></thead><tbody>{items.map((line, index) => <tr key={line.position ?? index}><td>{index + 1}</td><td>{line.description}</td><td>{line.hsn ?? '-'}</td><td>{line.gst_rate ?? 0}</td><td>{line.quantity}</td><td>₹ {inr(Number(line.unit_rate ?? 0))}</td><td>{Number(line.discount ?? 0)}%</td><td>₹ {inr(Number(line.line_total ?? 0))}</td></tr>)}</tbody></table></div><div className="between" style={{ marginTop: 14 }}><span>Subtotal</span><strong>₹ {inr(Number(bill.subtotal ?? 0))}</strong></div><div className="between" style={{ marginTop: 8 }}><span>GST</span><strong>₹ {inr(Number(bill.tax_total ?? 0))}</strong></div><div className="between" style={{ marginTop: 8 }}><span>Grand total</span><strong className="big">₹ {inr(Number(bill.grand_total ?? 0))}</strong></div></section>
  </Shell>;
}
