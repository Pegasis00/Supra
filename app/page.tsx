'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import Shell from '@/components/Shell';
import { sb } from '@/lib/supabase';
import { inr } from '@/lib/money';

const shortcuts = [
  { href: '/', code: '01', title: 'Overview', detail: 'Today at a glance and quick actions' },
  { href: '/dashboard', code: '02', title: 'Dashboard', detail: 'Track sales, products and customers' },
  { href: '/bills', code: '03', title: 'Sales bills', detail: 'Review and manage customer invoices' },
  { href: '/customer-bills', code: '04', title: 'Customer ledger', detail: 'Track receivables and payments' },
  { href: '/product-bills', code: '05', title: 'Product bills', detail: 'See customers and sales by product' },
  { href: '/purchase-bills', code: '06', title: 'Purchase bills', detail: 'Upload supplier invoices and receive stock' },
  { href: '/inventory', code: '07', title: 'Inventory', detail: 'See current stock balances' },
  { href: '/products', code: '08', title: 'Products', detail: 'Manage prices, GST and stock tracking' },
  { href: '/customers', code: '09', title: 'Customers', detail: 'Keep customer details up to date' },
  { href: '/ask-supra', code: '10', title: 'Ask Supra', detail: 'Find answers across your business records' },
  { href: '/settings', code: '11', title: 'Settings', detail: 'Manage business and invoice settings' },
];

export default function Home() {
  const [today, setToday] = useState<{ count: number; sum: number } | null>(null);
  useEffect(() => {
    const d = new Date();
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    sb().from('sales_invoices').select('total').eq('invoice_date', iso).eq('status', 'final').then(({ data }) => {
      const rows = (data ?? []) as { total: number }[];
      setToday({ count: rows.length, sum: rows.reduce((sum, row) => sum + Number(row.total), 0) });
    });
  }, []);

  return <Shell title="Overview">
    <section className="overview-layout" aria-label="Today at a glance">
      <div className="today-panel">
        <div>
          <p className="eyebrow">TODAY’S SALES</p>
          <div className="today-amount"><span className="currency">₹</span>{inr(today?.sum ?? 0)}</div>
          <p className="today-meta">{today ? `${today.count} completed bill${today.count === 1 ? '' : 's'} today` : 'Loading today’s activity…'}</p>
        </div>
        <div className="today-date"><span className="date-dot" />Live overview</div>
      </div>
      <div className="quick-action-panel">
        <span className="quick-action-kicker">READY TO BILL?</span>
        <h2>Start a new sale</h2>
        <p>Pick a customer, add products, and send a clean invoice.</p>
        <Link href="/bill/new" className="btn">Create an invoice <span aria-hidden="true">↗</span></Link>
      </div>
    </section>

    <section className="workspace-section">
      <div className="section-heading"><div><p className="eyebrow">YOUR TOOLS</p><h2>Workspace</h2></div><Link href="/settings" className="subtle-link">Business settings <span aria-hidden="true">↗</span></Link></div>
      <div className="workspace-list">
        {shortcuts.map(item => <Link className="workspace-link" href={item.href} key={item.href}>
          <span className="workspace-code">{item.code}</span><span className="workspace-label"><strong>{item.title}</strong><small>{item.detail}</small></span><span className="workspace-arrow" aria-hidden="true">↗</span>
        </Link>)}
      </div>
    </section>
  </Shell>;
}
