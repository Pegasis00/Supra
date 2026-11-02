'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Shell from '@/components/Shell';
import { sb } from '@/lib/supabase';
import { inr } from '@/lib/money';

type ProductTotal = { id: string; name: string; bills: number; units: number; value: number };
export default function ProductBills() {
  const [rows, setRows] = useState<ProductTotal[]>([]); const [q, setQ] = useState(''); const [loaded, setLoaded] = useState(false);
  useEffect(() => { Promise.all([sb().from('products').select('id,name').order('name'), sb().from('sales_invoice_lines').select('product_id,qty,total')]).then(([products, lines]) => { const byId = new Map<string, ProductTotal>(); for (const product of products.data ?? []) byId.set(product.id, { id: product.id, name: product.name, bills: 0, units: 0, value: 0 }); for (const line of lines.data ?? []) { if (!line.product_id) continue; const row = byId.get(line.product_id); if (row) { row.bills += 1; row.units += Number(line.qty); row.value += Number(line.total); } } setRows([...byId.values()].sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))); setLoaded(true); }); }, []);
  const filtered = useMemo(() => rows.filter(row => row.name.toLowerCase().includes(q.trim().toLowerCase())), [rows, q]);
  return <Shell title="Product bills" back="/"><div className="section-intro"><div><p className="eyebrow">SALES HISTORY</p><h2>Products and bills</h2></div><span className="muted small">Open a product to see every customer and bill.</span></div><input placeholder="Search product..." value={q} onChange={event => setQ(event.target.value)} /><div className="list" style={{ marginTop: 12 }}>{filtered.map(row => <Link href={`/product-bills/${row.id}`} className="item" key={row.id}><div className="between"><strong>{row.name}</strong><strong>₹ {inr(row.value)}</strong></div><div className="between muted small"><span>{row.bills} bills · {row.units} units</span><span>View bills →</span></div></Link>)}</div>{loaded && filtered.length === 0 && <p className="muted">No products with sales found.</p>}</Shell>;
}
