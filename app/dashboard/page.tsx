'use client';

import { useEffect, useMemo, useState } from 'react';
import Shell from '@/components/Shell';
import { sb } from '@/lib/supabase';
import { inr } from '@/lib/money';

type SaleBill = { id: string; bill_no: number; bill_date: string; party_id: string | null; party_name: string; total: number; is_cancelled: boolean; financial_year: string };
type SaleLine = { invoice_id: string; invoice_no: number; invoice_date: string; customer_name: string; product_id: string | null; product_name: string; quantity: number; line_total: number; is_cancelled: boolean; financial_year: string };
type PurchaseBill = { id: string; party_name: string; bill_date: string; total: number | null; is_cancelled: boolean };
type PurchaseLine = { purchase_bill_id: string; purchase_date: string; product_id: string | null; product_name: string; quantity: number; line_total: number | null; is_cancelled: boolean };
type CatalogName = { id: string; name: string };
type BalanceRow = { name: string; total: number; paid: number };

const money = (value: number) => `₹ ${inr(value)}`;
const monthName = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { month: 'short' });
const monthKey = (iso: string) => iso.slice(0, 7);
const financialYearOf = (iso: string) => { const year = Number(iso.slice(0, 4)); return `${iso.slice(5, 7) >= '04' ? year : year - 1}-${String((iso.slice(5, 7) >= '04' ? year + 1 : year) % 100).padStart(2, '0')}`; };

function BarList({ rows, color, expanded, onToggle }: { rows: { name: string; value: number; detail: string }[]; color: 'blue' | 'green'; expanded: boolean; onToggle: () => void }) {
  const max = Math.max(...rows.map((row) => row.value), 1);
  const visible = expanded ? rows : rows.slice(0, 7);
  return <div className="dash-bar-list">{rows.length ? <>{visible.map((row, index) => <div className="dash-bar-row" key={`${row.name}-${index}`}>
    <div className="dash-bar-label"><span><b>{index + 1}</b>{row.name}</span><small>{row.detail}</small></div>
    <div className="dash-bar-track"><i className={`dash-bar-fill ${color}`} style={{ width: `${Math.max(4, row.value / max * 100)}%` }} /></div>
    <strong>{money(row.value)}</strong>
  </div>)}{rows.length > 7 && <button className="dash-see-more" onClick={onToggle}>{expanded ? 'Show top 7' : `See all ${rows.length}`}</button>}</> : <p className="muted small">No matching records for these filters.</p>}</div>;
}

function BalanceList({ rows, payable, expanded, onToggle }: { rows: BalanceRow[]; payable?: boolean; expanded: boolean; onToggle: () => void }) {
  const visible = expanded ? rows : rows.slice(0, 7);
  return rows.length ? <>{visible.map((row) => <div className="balance-row" key={row.name}>
    <div className="between"><strong>{row.name}</strong><span>Due ₹ {inr(Math.max(0, row.total - row.paid))}</span></div>
    <div className={`balance-track${payable ? ' payable' : ''}`}><i style={{ width: `${row.total ? Math.min(100, row.paid / row.total * 100) : 0}%` }} /></div>
    <small>{payable ? 'Paid' : 'Received'} ₹ {inr(row.paid)} of ₹ {inr(row.total)}</small>
  </div>)}{rows.length > 7 && <button className="dash-see-more" onClick={onToggle}>{expanded ? 'Show top 7' : 'See all'}</button>}</> : <div className="dash-empty">{payable ? 'No supplier payables.' : 'No customer receivables.'}</div>;
}

function DetailedBalanceList({ rows, payable, expanded, onToggle }: { rows: BalanceRow[]; payable?: boolean; expanded: boolean; onToggle: () => void }) {
  const visible = expanded ? rows : rows.slice(0, 7);
  const total = rows.reduce((sum, row) => sum + row.total, 0);
  const paid = rows.reduce((sum, row) => sum + row.paid, 0);
  return rows.length ? <div className="dash-balance-table">
    <div className="dash-balance-grid dash-balance-header"><span>Name</span><span>Total</span><span>{payable ? 'Paid' : 'Received'}</span><span>Due</span></div>
    {visible.map((row) => <div className="dash-balance-grid dash-balance-item" key={row.name}>
      <strong>{row.name}</strong><span>{money(row.total)}</span><span className="dash-balance-received">{money(row.paid)}</span><span className="dash-balance-due">{money(Math.max(0, row.total - row.paid))}</span>
    </div>)}
    <div className="dash-balance-grid dash-balance-total"><strong>Total</strong><strong>{money(total)}</strong><strong className="dash-balance-received">{money(paid)}</strong><strong className="dash-balance-due">{money(Math.max(0, total - paid))}</strong></div>
    {rows.length > 7 && <button className="dash-see-more" onClick={onToggle}>{expanded ? 'Show top 7' : 'See all'}</button>}
  </div> : <div className="dash-empty">{payable ? 'No supplier payables.' : 'No customer receivables.'}</div>;
}

export default function Dashboard() {
  const [bills, setBills] = useState<SaleBill[]>([]);
  const [lines, setLines] = useState<SaleLine[]>([]);
  const [purchaseBills, setPurchaseBills] = useState<PurchaseBill[]>([]);
  const [purchaseLines, setPurchaseLines] = useState<PurchaseLine[]>([]);
  const [customerCatalog, setCustomerCatalog] = useState<CatalogName[]>([]);
  const [productCatalog, setProductCatalog] = useState<CatalogName[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [year, setYear] = useState('all');
  const [month, setMonth] = useState('all');
  const [customer, setCustomer] = useState('all');
  const [product, setProduct] = useState('all');
  const [showAllProducts, setShowAllProducts] = useState(false);
  const [showAllCustomers, setShowAllCustomers] = useState(false);
  const [showAllReceivables, setShowAllReceivables] = useState(false);
  const [showAllPayables, setShowAllPayables] = useState(false);
  const [receivables, setReceivables] = useState<BalanceRow[]>([]);
  const [payables, setPayables] = useState<BalanceRow[]>([]);

  async function load() {
    setLoading(true); setError('');
    const [b, l, pb, pl, customers, products] = await Promise.all([
      sb().from('v_sales_bills').select('id,bill_no,bill_date,party_id,party_name,total,is_cancelled,financial_year').limit(10000),
      sb().from('v_sales_lines').select('invoice_id,invoice_no,invoice_date,customer_name,product_id,product_name,quantity,line_total,is_cancelled,financial_year').limit(20000),
      sb().from('v_purchase_bills').select('id,party_name,bill_date,total,is_cancelled').limit(10000),
      sb().from('v_purchase_lines').select('purchase_bill_id,purchase_date,product_id,product_name,quantity,line_total,is_cancelled').limit(20000),
      sb().from('parties').select('id,name').in('kind', ['customer', 'both']).limit(10000),
      sb().from('products').select('id,name').limit(10000),
    ]);
    const firstError = [b, l, pb, pl, customers, products].find((result) => result.error)?.error;
    if (firstError) setError(firstError.message);
    setBills((b.data ?? []) as SaleBill[]); setLines((l.data ?? []) as SaleLine[]);
    setPurchaseBills((pb.data ?? []) as PurchaseBill[]); setPurchaseLines((pl.data ?? []) as PurchaseLine[]);
    setCustomerCatalog((customers.data ?? []) as CatalogName[]); setProductCatalog((products.data ?? []) as CatalogName[]);
    const [salesData, purchaseData] = await Promise.all([
      sb().from('sales_invoices').select('customer_name,total,status,payments:invoice_payments(amount)').eq('status', 'final').limit(10000),
      sb().from('purchase_bills').select('supplier_name,grand_total,status,payments:purchase_bill_payments(amount)').eq('status', 'confirmed').limit(10000),
    ]);
    const collect = (rows: any[], totalKey: string) => { const map = new Map<string, BalanceRow>(); for (const row of rows) { const name = row[totalKey === 'total' ? 'customer_name' : 'supplier_name']; if (!name) continue; const current = map.get(name) ?? { name, total: 0, paid: 0 }; current.total += Number(row[totalKey] ?? 0); current.paid += (row.payments ?? []).reduce((sum: number, payment: any) => sum + Number(payment.amount ?? 0), 0); map.set(name, current); } return [...map.values()].sort((a, b) => b.total - a.total); };
    setReceivables(collect(salesData.data ?? [], 'total')); setPayables(collect(purchaseData.data ?? [], 'grand_total'));
    setLoading(false);
  }
  useEffect(() => { void load(); }, []);

  const years = useMemo(() => [...new Set(bills.map((row) => row.financial_year).filter(Boolean))].sort().reverse(), [bills]);
  const customerNames = useMemo(() => new Map(customerCatalog.map((row) => [row.id, row.name])), [customerCatalog]);
  const productNames = useMemo(() => new Map(productCatalog.map((row) => [row.id, row.name])), [productCatalog]);
  const canonicalBills = useMemo(() => bills.map((row) => ({ ...row, party_name: row.party_id ? (customerNames.get(row.party_id) ?? row.party_name) : row.party_name })), [bills, customerNames]);
  const canonicalLines = useMemo(() => lines.map((row) => ({ ...row, customer_name: canonicalBills.find((bill) => bill.id === row.invoice_id)?.party_name ?? row.customer_name, product_name: row.product_id ? (productNames.get(row.product_id) ?? row.product_name) : row.product_name })), [lines, canonicalBills, productNames]);
  const canonicalPurchaseLines = useMemo(() => purchaseLines.map((row) => ({ ...row, product_name: row.product_id ? (productNames.get(row.product_id) ?? row.product_name) : row.product_name })), [purchaseLines, productNames]);
  const customers = useMemo(() => [...new Set(canonicalLines.map((row) => row.customer_name).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [canonicalLines]);
  const products = useMemo(() => [...new Set(canonicalLines.map((row) => row.product_name).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [canonicalLines]);

  const filteredLines = useMemo(() => canonicalLines.filter((row) => {
    const sameYear = year === 'all' || row.financial_year === year;
    const sameMonth = month === 'all' || monthKey(row.invoice_date).endsWith(`-${month.padStart(2, '0')}`);
    return !row.is_cancelled && sameYear && sameMonth && (customer === 'all' || row.customer_name === customer) && (product === 'all' || row.product_name === product);
  }), [canonicalLines, year, month, customer, product]);
  const filteredBillIds = useMemo(() => new Set(filteredLines.map((row) => row.invoice_id)), [filteredLines]);
  const filteredBills = useMemo(() => canonicalBills.filter((row) => !row.is_cancelled && filteredBillIds.has(row.id)), [canonicalBills, filteredBillIds]);
  const filteredPurchaseLines = useMemo(() => canonicalPurchaseLines.filter((row) => {
    const sameYear = year === 'all' || financialYearOf(row.purchase_date) === year;
    const sameMonth = month === 'all' || monthKey(row.purchase_date).endsWith(`-${month.padStart(2, '0')}`);
    return !row.is_cancelled && sameYear && sameMonth && (product === 'all' || row.product_name === product);
  }), [canonicalPurchaseLines, year, month, product]);
  const filteredPurchaseBillIds = useMemo(() => new Set(filteredPurchaseLines.map((row) => row.purchase_bill_id)), [filteredPurchaseLines]);
  const matchingPurchaseBills = useMemo(() => purchaseBills.filter((row) => !row.is_cancelled && filteredPurchaseBillIds.has(row.id)), [purchaseBills, filteredPurchaseBillIds]);

  const topProducts = useMemo(() => {
    const map = new Map<string, { value: number; qty: number }>();
    filteredLines.forEach((row) => { const item = map.get(row.product_name) ?? { value: 0, qty: 0 }; item.value += Number(row.line_total) || 0; item.qty += Number(row.quantity) || 0; map.set(row.product_name, item); });
    return [...map.entries()].map(([name, item]) => ({ name, value: item.value, detail: `${item.qty.toLocaleString('en-IN')} units` })).sort((a, b) => b.value - a.value);
  }, [filteredLines]);
  const topCustomers = useMemo(() => {
    const map = new Map<string, { value: number; bills: Set<string> }>();
    filteredBills.forEach((row) => { const item = map.get(row.party_name) ?? { value: 0, bills: new Set<string>() }; item.value += Number(row.total) || 0; item.bills.add(row.id); map.set(row.party_name, item); });
    return [...map.entries()].map(([name, item]) => ({ name, value: item.value, detail: `${item.bills.size} bill${item.bills.size === 1 ? '' : 's'}` })).sort((a, b) => b.value - a.value);
  }, [filteredBills]);
  const trend = useMemo(() => {
    const map = new Map<string, number>();
    filteredBills.forEach((row) => map.set(monthKey(row.bill_date), (map.get(monthKey(row.bill_date)) ?? 0) + Number(row.total)));
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-12);
  }, [filteredBills]);
  const sales = filteredBills.reduce((sum, row) => sum + Number(row.total), 0);
  const units = filteredLines.reduce((sum, row) => sum + Number(row.quantity), 0);
  const purchases = matchingPurchaseBills.reduce((sum, row) => sum + (Number(row.total) || 0), 0);
  const receivableTotal = receivables.reduce((sum, row) => sum + row.total, 0);
  const receivedTotal = receivables.reduce((sum, row) => sum + row.paid, 0);
  const payableTotal = payables.reduce((sum, row) => sum + row.total, 0);
  const paidTotal = payables.reduce((sum, row) => sum + row.paid, 0);
  const jumpTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return <Shell title="Dashboard">
    <div className="dashboard-head"><div><p className="section-kicker">BUSINESS PULSE</p><h2>See what is moving.</h2><p className="muted">Filter the same view by financial year, month, customer, or product.</p></div><button className="alt small" onClick={() => void load()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh data'}</button></div>
    <section className="dash-filters" aria-label="Dashboard filters">
      <div><label htmlFor="dash-year">Financial year</label><select id="dash-year" value={year} onChange={(e) => setYear(e.target.value)}><option value="all">All years</option>{years.map((item) => <option key={item}>{item}</option>)}</select></div>
      <div><label htmlFor="dash-month">Month</label><select id="dash-month" value={month} onChange={(e) => setMonth(e.target.value)}><option value="all">All months</option>{Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={String(i + 1)}>{new Date(2026, i, 1).toLocaleDateString('en-IN', { month: 'long' })}</option>)}</select></div>
      <div><label htmlFor="dash-customer">Customer</label><select id="dash-customer" value={customer} onChange={(e) => setCustomer(e.target.value)}><option value="all">All customers</option>{customers.map((item) => <option key={item}>{item}</option>)}</select></div>
      <div><label htmlFor="dash-product">Product</label><select id="dash-product" value={product} onChange={(e) => setProduct(e.target.value)}><option value="all">All products</option>{products.map((item) => <option key={item}>{item}</option>)}</select></div>
    </section>
    {error && <div className="config-note pending">Could not load dashboard data: {error}</div>}
    <section className="dash-kpis" aria-label="Selected metrics">
      <div><span>Sales</span><strong>{money(sales)}</strong><small>{filteredBills.length} completed bills</small></div>
      <div><span>Units sold</span><strong>{units.toLocaleString('en-IN')}</strong><small>{filteredLines.length} line items</small></div>
      <div><span>Average bill</span><strong>{money(filteredBills.length ? sales / filteredBills.length : 0)}</strong><small>per completed bill</small></div>
      <div><span>Purchases</span><strong>{money(purchases)}</strong><small>{matchingPurchaseBills.length} matching bills</small></div>
    </section>
    <section className="dash-grid dash-payment-summaries" aria-label="Payment summaries">
      <div className="dash-panel dash-payment-card" role="button" tabIndex={0} onClick={() => jumpTo('customer-receivables')} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') jumpTo('customer-receivables'); }}><div className="dash-panel-head"><div><p className="section-kicker">CUSTOMER RECEIVABLES</p><h3>Customer payments</h3></div><span className="muted small">What customers owe vs received</span></div><div className="dash-payment-summary"><div><span>Total billed</span><strong>{money(receivableTotal)}</strong></div><div><span>Received</span><strong className="positive">{money(receivedTotal)}</strong></div><div><span>Outstanding</span><strong className="negative">{money(Math.max(0, receivableTotal - receivedTotal))}</strong></div></div><div className="balance-summary-track"><i style={{ width: `${receivableTotal ? Math.min(100, receivedTotal / receivableTotal * 100) : 0}%` }} /></div><small className="muted">{receivableTotal ? Math.round(receivedTotal / receivableTotal * 100) : 0}% received · Click to view customer details</small></div>
      <div className="dash-panel dash-payment-card" role="button" tabIndex={0} onClick={() => jumpTo('supplier-payables')} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') jumpTo('supplier-payables'); }}><div className="dash-panel-head"><div><p className="section-kicker">SUPPLIER PAYABLES</p><h3>Supplier payments</h3></div><span className="muted small">What you owe vs paid</span></div><div className="dash-payment-summary"><div><span>Total purchased</span><strong>{money(payableTotal)}</strong></div><div><span>Paid</span><strong className="positive">{money(paidTotal)}</strong></div><div><span>Outstanding</span><strong className="negative">{money(Math.max(0, payableTotal - paidTotal))}</strong></div></div><div className="balance-summary-track payable"><i style={{ width: `${payableTotal ? Math.min(100, paidTotal / payableTotal * 100) : 0}%` }} /></div><small className="muted">{payableTotal ? Math.round(paidTotal / payableTotal * 100) : 0}% paid · Click to view supplier details</small></div>
    </section>
    <section className="dash-grid dash-grid-main">
      <div className="dash-panel dash-trend"><div className="dash-panel-head"><div><p className="section-kicker">SALES TREND</p><h3>Revenue by month</h3></div><span className="muted small">Final bills only</span></div>{trend.length ? <div className="dash-chart" aria-label="Sales by month bar chart">{trend.map(([key, value]) => { const max = Math.max(...trend.map(([, amount]) => amount), 1); return <div className="dash-column" key={key}><div className="dash-column-value">{money(value)}</div><i style={{ height: `${Math.max(5, value / max * 100)}%` }} /><small>{monthName(`${key}-01`)}</small></div>; })}</div> : <div className="dash-empty">No sales for this selection.</div>}</div>
      <div className="dash-panel dash-snapshot"><div className="dash-panel-head"><div><p className="section-kicker">QUICK READ</p><h3>Selected period</h3></div></div><div className="dash-snapshot-list"><div><span>Best product</span><strong>{topProducts[0]?.name ?? '—'}</strong></div><div><span>Best customer</span><strong>{topCustomers[0]?.name ?? '—'}</strong></div><div><span>Sales minus purchases</span><strong className={sales - purchases >= 0 ? 'positive' : 'negative'}>{money(sales - purchases)}</strong></div></div></div>
    </section>
    <section className="dash-grid dash-grid-lists">
      <div className="dash-panel"><div className="dash-panel-head"><div><p className="section-kicker">PRODUCTS</p><h3>Top products</h3></div><span className="muted small">by sales value</span></div><BarList rows={topProducts} color="blue" expanded={showAllProducts} onToggle={() => setShowAllProducts((value) => !value)} /></div>
      <div className="dash-panel"><div className="dash-panel-head"><div><p className="section-kicker">CUSTOMERS</p><h3>Top customers</h3></div><span className="muted small">by sales value</span></div><BarList rows={topCustomers} color="green" expanded={showAllCustomers} onToggle={() => setShowAllCustomers((value) => !value)} /></div>
    </section>
    <section className="dash-panel dash-recent"><div className="dash-panel-head"><div><p className="section-kicker">DETAIL</p><h3>Recent matching bills</h3></div><span className="muted small">{filteredBills.length} bills in selection</span></div>{filteredBills.length ? <div className="dash-table"><div className="dash-table-row dash-table-header"><span>Bill</span><span>Customer</span><span>Date</span><span className="right">Total</span></div>{[...filteredBills].sort((a, b) => b.bill_date.localeCompare(a.bill_date) || b.bill_no - a.bill_no).slice(0, 8).map((row) => <div className="dash-table-row" key={row.id}><span className="dash-bill-no">#{row.bill_no}</span><span>{row.party_name}</span><span className="muted">{new Date(`${row.bill_date}T00:00:00`).toLocaleDateString('en-IN')}</span><strong className="right">{money(Number(row.total))}</strong></div>)}</div> : <div className="dash-empty">No bills match the selected filters.</div>}</section>
    <section className="dash-grid dash-grid-lists dash-balance-panels">
      <div id="customer-receivables" className="dash-panel dash-scroll-target"><div className="dash-panel-head"><div><p className="section-kicker">RECEIVABLES</p><h3>Customer payments</h3></div><span className="muted small">Total, received and due</span></div><DetailedBalanceList rows={receivables} expanded={showAllReceivables} onToggle={() => setShowAllReceivables((value) => !value)} /></div>
      <div id="supplier-payables" className="dash-panel dash-scroll-target"><div className="dash-panel-head"><div><p className="section-kicker">PAYABLES</p><h3>Supplier payments</h3></div><span className="muted small">Total, paid and due</span></div><DetailedBalanceList rows={payables} payable expanded={showAllPayables} onToggle={() => setShowAllPayables((value) => !value)} /></div>
    </section>
  </Shell>;
}
