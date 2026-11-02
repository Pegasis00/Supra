'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import Shell from '@/components/Shell';
import { sb } from '@/lib/supabase';
import { dmy, inr } from '@/lib/money';

type Payment = { amount: number; paid_on: string };
type Bill = { id: string; invoice_no: number; invoice_date: string; customer_name: string; total: number; status: string; payments: Payment[] };
const paid = (bill: Bill) => bill.payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
export default function ProductBillDetail() {
  const { id } = useParams<{ id: string }>(); const [name, setName] = useState('Product'); const [bills, setBills] = useState<Bill[]>([]);
  useEffect(() => { (async () => { const product = await sb().from('products').select('name').eq('id', id).single(); if (product.data) setName(product.data.name); const lines = await sb().from('sales_invoice_lines').select('invoice_id').eq('product_id', id); const ids = [...new Set((lines.data ?? []).map(row => row.invoice_id))]; if (!ids.length) return; const result = await sb().from('sales_invoices').select('id,invoice_no,invoice_date,customer_name,total,status,payments:invoice_payments(amount,paid_on)').in('id', ids).order('invoice_no', { ascending: false }).order('invoice_date', { ascending: false }); setBills(((result.data ?? []) as Bill[]).map(row => ({ ...row, payments: row.payments ?? [] }))); })(); }, [id]);
  return <Shell title={name} back="/product-bills"><div className="between"><div><p className="eyebrow">PRODUCT SALES</p><h2>{name}</h2></div><span className="muted small">{bills.length} bills</span></div><div className="list" style={{ marginTop: 14 }}>{bills.map(bill => { const got = paid(bill); const due = Math.max(0, Number(bill.total) - got); return <div className="bill-row" key={bill.id}><Link className="bill-main" href={`/bills/${bill.id}`}><div className="between"><strong>#{bill.invoice_no} · {bill.customer_name}</strong><strong>₹ {inr(Number(bill.total))}</strong></div><div className="between small muted"><span>{dmy(bill.invoice_date)}</span><span>{bill.status === 'cancelled' ? 'Cancelled' : 'Bill details →'}</span></div></Link><div className="bill-payment"><div className="bill-payment-summary"><span className={due <= .01 ? 'payment-paid' : got > 0 ? 'payment-partial' : 'payment-unpaid'}>{due <= .01 ? 'PAID' : got > 0 ? 'PARTLY PAID' : 'UNPAID'}</span><span>{due <= .01 ? `Received ₹ ${inr(got)}` : `Due ₹ ${inr(due)}`}</span></div>{bill.payments.length > 0 && <div className="muted small" style={{ marginTop: 6 }}>{bill.payments.map(payment => `${inr(Number(payment.amount))} · ${dmy(payment.paid_on)}`).join(' | ')}</div>}</div></div>; })}</div>{bills.length === 0 && <p className="muted">No sales bills found for this product.</p>}</Shell>;
}
