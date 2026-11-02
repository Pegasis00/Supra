'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Shell from '@/components/Shell';
import { sb } from '@/lib/supabase';
import { dmy, inr } from '@/lib/money';

type Payment = { id: string; amount: number; method: string; paid_on: string; note: string | null };
type Row = { id: string; invoice_no: number; invoice_date: string; customer_name: string; total: number; status: string; source: string; import_warning: string | null; payments: Payment[] };
type MonthGroup = { key: string; label: string; rows: Row[]; total: number };
type YearGroup = { key: string; months: MonthGroup[]; count: number; total: number };

const PAGE = 1000;
const METHODS = ['Cash', 'UPI', 'Card', 'Bank transfer', 'Cheque', 'Other'];

async function loadAll(): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb().from('sales_invoices')
      .select('id,invoice_no,invoice_date,customer_name,total,status,source,import_warning,payments:invoice_payments(id,amount,method,paid_on,note)')
      .order('invoice_date', { ascending: false }).order('invoice_no', { ascending: false }).range(from, from + PAGE - 1);
    if (error || !data) break;
    out.push(...(data as Row[]).map(row => ({ ...row, payments: row.payments ?? [] })));
    if (data.length < PAGE) break;
  }
  return out;
}

const monthName = (year: string, month: string) => new Date(Date.UTC(Number(year), Number(month) - 1, 1)).toLocaleString('en-IN', { month: 'long', timeZone: 'UTC' });
const sumFinal = (rows: Row[]) => rows.reduce((t, r) => r.status === 'final' ? t + Number(r.total) : t, 0);

export default function Bills() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [expandedPaymentId, setExpandedPaymentId] = useState<string | null>(null);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('UPI');
  const [customMethod, setCustomMethod] = useState('');
  const [paidOn, setPaidOn] = useState(new Date().toISOString().slice(0, 10));
  const [paymentError, setPaymentError] = useState('');
  const [savingPayment, setSavingPayment] = useState(false);

  useEffect(() => { loadAll().then(data => { setRows(data); setLoaded(true); if (data[0]) setOpen(new Set([data[0].invoice_date.slice(0, 4), data[0].invoice_date.slice(0, 7)])); }); }, []);

  const searching = q.trim().length > 0;
  const years = useMemo<YearGroup[]>(() => {
    const needle = q.trim().toLowerCase();
    const hits = needle ? rows.filter(r => `${r.customer_name} ${r.invoice_no} ${r.invoice_date}`.toLowerCase().includes(needle)) : rows;
    const byYear = new Map<string, Map<string, Row[]>>();
    for (const r of hits) {
      const y = r.invoice_date.slice(0, 4); const m = r.invoice_date.slice(0, 7);
      if (!byYear.has(y)) byYear.set(y, new Map());
      const months = byYear.get(y)!; if (!months.has(m)) months.set(m, []); months.get(m)!.push(r);
    }
    return [...byYear]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([y, months]) => {
        const groups = [...months]
          .sort(([a], [b]) => b.localeCompare(a))
          .map(([m, list]) => ({
            key: m,
            label: monthName(y, m.slice(5)),
            // Invoice number is the primary order inside a month. Date is
            // only the tie-breaker when two rows share the same number.
            rows: [...list].sort((a, b) => b.invoice_no - a.invoice_no || b.invoice_date.localeCompare(a.invoice_date)),
            total: sumFinal(list),
          }));
        return { key: y, months: groups, count: groups.reduce((n, g) => n + g.rows.length, 0), total: groups.reduce((t, g) => t + g.total, 0) };
      });
  }, [rows, q]);

  const toggle = (key: string) => setOpen(prev => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const isOpen = (key: string) => searching || open.has(key);
  const paid = (row: Row) => row.payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
  const balance = (row: Row) => Math.max(0, Number(row.total) - paid(row));
  const startPayment = (row: Row) => { setPayingId(row.id); setAmount(balance(row).toFixed(2)); setMethod('UPI'); setCustomMethod(''); setPaidOn(new Date().toISOString().slice(0, 10)); setPaymentError(''); };
  async function savePayment(row: Row) {
    const paymentMethod = method === 'Other' ? customMethod.trim() : method; const paymentAmount = Number(amount);
    if (!paymentAmount || paymentAmount <= 0) return setPaymentError('Enter a valid payment amount.');
    if (!paymentMethod) return setPaymentError('Enter a payment method.');
    setSavingPayment(true); setPaymentError('');
    const { data, error } = await sb().rpc('record_invoice_payment', { p_invoice_id: row.id, p_amount: paymentAmount, p_method: paymentMethod, p_paid_on: paidOn, p_note: null });
    if (error) { setPaymentError(error.message); setSavingPayment(false); return; }
    setRows(current => current.map(item => item.id === row.id ? { ...item, payments: [...item.payments, { id: String(data), amount: paymentAmount, method: paymentMethod, paid_on: paidOn, note: null }] } : item));
    setPayingId(null); setSavingPayment(false);
  }

  return <Shell title="Bills" back="/">
    <input placeholder="Search by customer, number or date (2025-06)…" value={q} onChange={e => setQ(e.target.value)} />
    {years.map(y => <section key={y.key}>
      <button className="alt" aria-expanded={isOpen(y.key)} onClick={() => toggle(y.key)} style={{ width: '100%', justifyContent: 'space-between', marginTop: 12 }}><span>{isOpen(y.key) ? '▾' : '▸'} {y.key}</span><span className="muted small">{y.count} bills · ₹ {inr(y.total)}</span></button>
      {isOpen(y.key) && y.months.map(m => <div key={m.key} style={{ marginLeft: 10 }}>
        <button className="alt small" aria-expanded={isOpen(m.key)} onClick={() => toggle(m.key)} style={{ width: '100%', justifyContent: 'space-between', marginTop: 8 }}><span>{isOpen(m.key) ? '▾' : '▸'} {m.label}</span><span className="muted">{m.rows.length} bills · ₹ {inr(m.total)}</span></button>
        {isOpen(m.key) && <div className="list" style={{ marginTop: 4 }}>{m.rows.map(r => <div className="bill-row" key={r.id}>
          <Link className="bill-main" href={`/bills/${r.id}`}><div className="between"><strong>#{r.invoice_no} · {r.customer_name}</strong><strong>₹ {inr(Number(r.total))}</strong></div><div className="between small muted"><span>{dmy(r.invoice_date)}</span><span style={{ display: 'flex', gap: 6 }}>{r.source === 'excel_import' && <span className="badge" style={{ background: '#eef1f8', color: '#516079' }}>Imported</span>}{r.import_warning && <span className="badge" style={{ background: '#fff7e0', color: '#8a6100' }}>Check</span>}{r.status === 'cancelled' && <span className="badge">Cancelled</span>}</span></div></Link>
          {r.status === 'final' && <div className="bill-payment">
            <button type="button" className="bill-payment-summary" aria-expanded={expandedPaymentId === r.id} onClick={() => setExpandedPaymentId(expandedPaymentId === r.id ? null : r.id)}>
              <span className={balance(r) <= 0.01 ? 'payment-paid' : paid(r) > 0 ? 'payment-partial' : 'payment-unpaid'}>{balance(r) <= 0.01 ? 'PAID IN FULL' : paid(r) > 0 ? 'PARTLY PAID' : 'UNPAID'}</span>
              <span>{balance(r) <= 0.01 ? `Paid ₹ ${inr(paid(r))}` : `Due ₹ ${inr(balance(r))}`} <span className="payment-chevron">{expandedPaymentId === r.id ? '↑' : '↓'}</span></span>
            </button>
            {expandedPaymentId === r.id && <div className="bill-payment-details">
              {r.payments.length > 0 ? r.payments.map(payment => <div className="payment-detail" key={payment.id}><strong>₹ {inr(Number(payment.amount))}</strong><span>{payment.method} · {dmy(payment.paid_on)}</span></div>) : <span className="muted small">No payment recorded yet.</span>}
              {balance(r) > 0.01 && payingId !== r.id && <button type="button" className="alt small" style={{ marginTop: 8 }} onClick={() => startPayment(r)}>Add payment</button>}
              {payingId === r.id && <form onSubmit={event => { event.preventDefault(); void savePayment(r); }} onClick={event => event.stopPropagation()} style={{ marginTop: 8 }}><div className="row"><div><label>Amount</label><input type="number" min="0.01" max={balance(r).toFixed(2)} step="0.01" value={amount} onChange={event => setAmount(event.target.value)} /></div><div><label>Date</label><input type="date" value={paidOn} onChange={event => setPaidOn(event.target.value)} /></div></div><label>Method</label><select value={method} onChange={event => setMethod(event.target.value)}>{METHODS.map(option => <option key={option}>{option}</option>)}</select>{method === 'Other' && <input placeholder="Custom payment method" value={customMethod} onChange={event => setCustomMethod(event.target.value)} style={{ marginTop: 6 }} />}{paymentError && <p className="bad">{paymentError}</p>}<div className="row" style={{ marginTop: 7 }}><button type="submit" disabled={savingPayment}>{savingPayment ? 'Saving…' : 'Save payment'}</button><button type="button" className="alt" onClick={() => setPayingId(null)}>Cancel</button></div></form>}
            </div>}
          </div>}
        </div>)}</div>}
      </div>)}
    </section>)}
    {!loaded && <p className="muted">Loading…</p>}{loaded && years.length === 0 && <p className="muted">{searching ? 'No bills match.' : 'No bills yet.'}</p>}
  </Shell>;
}
