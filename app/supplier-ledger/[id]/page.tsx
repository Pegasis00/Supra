'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import Shell from '@/components/Shell';
import { sb } from '@/lib/supabase';
import { dmy, inr } from '@/lib/money';

type Payment = { id: string; amount: number; method: string; paid_on: string; note: string | null };
type Bill = { id: string; supplier_invoice_number: string; supplier_name: string; purchase_date: string; grand_total: number; payments: Payment[] };
const paid = (bill: Bill) => bill.payments.reduce((sum, payment) => sum + Number(payment.amount), 0);

export default function SupplierDetail() {
  const { id } = useParams<{ id: string }>();
  const [name, setName] = useState('Supplier');
  const [bills, setBills] = useState<Bill[]>([]);
  const [openPayment, setOpenPayment] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('UPI');
  const [customMethod, setCustomMethod] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    const [party, purchases] = await Promise.all([
      sb().from('parties').select('name').eq('id', id).single(),
      sb().from('purchase_bills').select('id,supplier_invoice_number,supplier_name,purchase_date,grand_total,payments:purchase_bill_payments(id,amount,method,paid_on,note)').eq('supplier_id', id).eq('status', 'confirmed').order('supplier_invoice_number', { ascending: false }),
    ]);
    setName(party.data?.name ?? 'Supplier');
    setBills(((purchases.data ?? []) as Bill[]).map(row => ({ ...row, payments: row.payments ?? [] })));
  }
  useEffect(() => { void load(); }, [id]);

  function startPayment(bill: Bill) {
    setOpenPayment(bill.id); setAmount(Math.max(0, Number(bill.grand_total) - paid(bill)).toFixed(2));
    setMethod('UPI'); setCustomMethod(''); setDate(new Date().toISOString().slice(0, 10)); setError('');
  }
  async function savePayment(bill: Bill) {
    const paymentMethod = method === 'Other' ? customMethod.trim() : method;
    if (!Number(amount) || Number(amount) <= 0) return setError('Enter a valid payment amount.');
    if (Number(amount) > Math.max(0, Number(bill.grand_total) - paid(bill)) + 0.01) return setError('Payment cannot be greater than the outstanding amount.');
    if (!paymentMethod) return setError('Enter a payment method.');
    setBusy(true); setError('');
    const result = await sb().rpc('record_purchase_bill_payment', { p_bill_id: bill.id, p_amount: Number(amount), p_method: paymentMethod, p_paid_on: date, p_note: null });
    setBusy(false);
    if (result.error) return setError(result.error.message);
    setOpenPayment(null); await load();
  }
  async function remove(bill: Bill) {
    if (!confirm(`Delete purchase bill ${bill.supplier_invoice_number}? Its purchase stock will be removed.`)) return;
    setBusy(true); const result = await sb().rpc('delete_purchase_bill', { p_id: bill.id }); setBusy(false);
    if (result.error) setError(result.error.message); else await load();
  }

  const total = bills.reduce((sum, bill) => sum + Number(bill.grand_total), 0);
  const received = bills.reduce((sum, bill) => sum + paid(bill), 0);
  return <Shell title={name} back="/supplier-ledger">
    <div className="between"><div><p className="eyebrow">SUPPLIER LEDGER</p><h2>{name}</h2></div><span className="muted small">{bills.length} bills</span></div>
    <div className="list" style={{ marginTop: 14 }}>{bills.map(bill => {
      const got = paid(bill); const due = Math.max(0, Number(bill.grand_total) - got); const editingPayment = openPayment === bill.id;
      return <div className="bill-row" key={bill.id}>
        <Link className="bill-main" href={`/purchase-bills/${bill.id}`}><div className="between"><strong>#{bill.supplier_invoice_number} · {bill.supplier_name}</strong><strong>₹ {inr(Number(bill.grand_total))}</strong></div><div className="between small muted"><span>{dmy(bill.purchase_date)}</span><span>Open bill →</span></div></Link>
        <div className="bill-payment"><div className="payment-status-line"><span className={due <= .01 ? 'payment-paid' : got > 0 ? 'payment-partial' : 'payment-unpaid'}>{due <= .01 ? 'PAID' : got > 0 ? 'PARTLY PAID' : 'UNPAID'}</span><span className="small muted">{due <= .01 ? `Paid ₹ ${inr(got)}` : `Due ₹ ${inr(due)}`}</span></div>
          <div className="row" style={{ marginTop: 8 }}><button className="alt small" onClick={() => startPayment(bill)}>{editingPayment ? 'Close payment' : 'Update payment'}</button><button className="danger small" disabled={busy} onClick={() => void remove(bill)}>Delete</button></div>
          {editingPayment && <form onSubmit={e => { e.preventDefault(); void savePayment(bill); }} style={{ marginTop: 9 }}><label>Amount</label><input type="number" min="0.01" max={due.toFixed(2)} step="0.01" value={amount} onChange={e => setAmount(e.target.value)} /><div className="row"><div><label>Date</label><input type="date" value={date} onChange={e => setDate(e.target.value)} /></div><div><label>Method</label><select value={method} onChange={e => setMethod(e.target.value)}>{['Cash', 'UPI', 'Card', 'Bank transfer', 'Cheque', 'Other'].map(option => <option key={option}>{option}</option>)}</select></div></div>{method === 'Other' && <input placeholder="Custom payment method" value={customMethod} onChange={e => setCustomMethod(e.target.value)} />}{error && <p className="bad small">{error}</p>}<div className="row" style={{ marginTop: 7 }}><button type="submit" disabled={busy}>Save payment</button><button type="button" className="alt" onClick={() => setOpenPayment(null)}>Cancel</button></div></form>}
        </div>
      </div>;
    })}</div>
    <div className="card" style={{ marginTop: 16 }}><div className="between"><strong>Total payable</strong><strong>₹ {inr(total)}</strong></div><div className="between" style={{ marginTop: 8 }}><span>Actually paid</span><strong>₹ {inr(received)}</strong></div><div className="between" style={{ marginTop: 8 }}><span>Outstanding due</span><strong>₹ {inr(Math.max(0, total - received))}</strong></div></div>
    {error && <p className="bad small">{error}</p>}
  </Shell>;
}
