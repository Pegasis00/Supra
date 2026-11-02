'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Shell from '@/components/Shell';
import { sb } from '@/lib/supabase';
import { inr } from '@/lib/money';
type Row = { id: string; name: string; bills: number; total: number; paid: number };
export default function AgencyLedger() {
  const [rows, setRows] = useState<Row[]>([]); const [query, setQuery] = useState('');
  useEffect(() => { Promise.all([sb().from('parties').select('id,name').in('kind', ['supplier', 'both']).order('name'), sb().from('purchase_bills').select('supplier_id,grand_total,payments:purchase_bill_payments(amount)').eq('status', 'confirmed')]).then(([parties, bills]) => { const groups = new Map<string, Row>((parties.data ?? []).map(p => [p.id, { id: p.id, name: p.name, bills: 0, total: 0, paid: 0 }])); for (const bill of (bills.data ?? []) as any[]) { const row = groups.get(bill.supplier_id); if (!row) continue; row.bills += 1; row.total += Number(bill.grand_total ?? 0); row.paid += (bill.payments ?? []).reduce((sum: number, p: any) => sum + Number(p.amount), 0); } setRows([...groups.values()].filter(row => row.bills > 0).sort((a, b) => a.name.localeCompare(b.name))); }); }, []);
  const filtered = useMemo(() => rows.filter(row => row.name.toLowerCase().includes(query.toLowerCase().trim())), [rows, query]);
  return <Shell title="Supplier ledger" back="/"><div className="section-intro"><div><p className="eyebrow">PAYABLES</p><h2>Suppliers and payments</h2></div><span className="muted small">Open a supplier to record or edit what has been paid.</span></div><input placeholder="Search supplier..." value={query} onChange={event => setQuery(event.target.value)} /><div className="list" style={{ marginTop: 12 }}>{filtered.map(row => <Link href={`/agency-ledger/${row.id}`} className="item" key={row.id}><div className="between"><strong>{row.name}</strong><strong>₹ {inr(row.total)}</strong></div><div className="between muted small"><span>{row.bills} bills · Paid ₹ {inr(row.paid)}</span><span>Due ₹ {inr(Math.max(0, row.total - row.paid))}</span></div></Link>)}</div>{!filtered.length && <p className="muted">No suppliers found.</p>}</Shell>;
}
