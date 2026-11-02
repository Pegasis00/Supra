'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Shell from '@/components/Shell';
import { sb } from '@/lib/supabase';
import { inr } from '@/lib/money';

type Payment = { amount: number };
type Bill = { customer_id: string | null; customer_name: string; total: number; status: string; payments: Payment[] };
type CustomerTotal = { id: string; name: string; bills: number; total: number; received: number; opening_receivable: number };
const received = (bill: Bill) => bill.payments.reduce((sum, payment) => sum + Number(payment.amount), 0);

export default function CustomerBills() {
  const [rows, setRows] = useState<CustomerTotal[]>([]); const [q, setQ] = useState(''); const [loaded, setLoaded] = useState(false);
  useEffect(() => { Promise.all([sb().from('parties').select('id,name,opening_receivable').in('kind', ['customer', 'both']).order('name'), sb().from('sales_invoices').select('customer_id,customer_name,total,status,payments:invoice_payments(amount)')]).then(([parties, invoices]) => { const groups = new Map<string, CustomerTotal>((parties.data ?? []).map(row => [row.id, { id: row.id, name: row.name, bills: 0, total: 0, received: 0, opening_receivable: Number(row.opening_receivable ?? 0) }])); for (const bill of (invoices.data ?? []) as Bill[]) { if (!bill.customer_id) continue; const current = groups.get(bill.customer_id); if (!current) continue; current.name = bill.customer_name; current.bills += 1; if (bill.status === 'final') current.total += Number(bill.total); current.received += received(bill); } setRows([...groups.values()].sort((a, b) => a.name.localeCompare(b.name))); setLoaded(true); }); }, []);
  const filtered = useMemo(() => rows.filter(row => row.name.toLowerCase().includes(q.trim().toLowerCase())), [rows, q]);
  return <Shell title="Customer ledger" back="/"><div className="section-intro"><div><p className="eyebrow">RECEIVABLES</p><h2>Customers and payments</h2></div><span className="muted small">Open a customer to manage every bill and payment.</span></div><input placeholder="Search customer..." value={q} onChange={event => setQ(event.target.value)} /><div className="list" style={{ marginTop: 12 }}>{filtered.map(row => <Link href={`/customer-bills/${row.id}`} className="item" key={row.id}><div className="between"><strong>{row.name}</strong><strong>₹ {inr(row.total + row.opening_receivable)}</strong></div><div className="between muted small"><span>{row.bills} bills{row.opening_receivable > 0 ? ` · Prior ₹ ${inr(row.opening_receivable)}` : ''}</span><span>Received ₹ {inr(row.received)} · Due ₹ {inr(Math.max(0, row.total + row.opening_receivable - row.received))}</span></div></Link>)}</div>{loaded && filtered.length === 0 && <p className="muted">No customers found.</p>}</Shell>;
}
