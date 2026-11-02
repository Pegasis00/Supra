'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { sb } from '@/lib/supabase';
import AskSupraWidget from './AskSupraWidget';

const navigation = [
  { href: '/', label: 'Overview', code: '01' },
  { href: '/dashboard', label: 'Dashboard', code: '02' },
  { href: '/bills', label: 'Sales bills', code: '03' },
  { href: '/customer-bills', label: 'Customer ledger', code: '04' },
  { href: '/product-bills', label: 'Product bills', code: '05' },
  { href: '/purchase-bills', label: 'Purchases', code: '06' },
  { href: '/inventory', label: 'Inventory', code: '07' },
  { href: '/products', label: 'Products', code: '08' },
  { href: '/customers', label: 'Customers', code: '09' },
  { href: '/ask-supra', label: 'Ask Supra', code: '10' },
  { href: '/settings', label: 'Settings', code: '11' },
];

export default function Shell({ title, back, children }: { title: string; back?: string; children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ok, setOk] = useState(false);
  useEffect(() => {
    let alive = true;
    sb().auth.getSession().then(({ data }) => {
      if (!alive) return;
      if (!data.session) router.replace('/login');
      else setOk(true);
    });
    return () => { alive = false; };
  }, [router]);

  if (!ok) return <div className="center muted">Loading your workspace…</div>;
  const isActive = (href: string) => href === '/' ? pathname === '/' : pathname.startsWith(href);
  const links = (mobile = false) => navigation.map(item => (
    <Link key={item.href} href={item.href} className={`${isActive(item.href) ? 'active' : ''}${mobile ? ' mobile-nav-link' : ' side-link'}`} aria-current={isActive(item.href) ? 'page' : undefined}>
      {!mobile && <span className="nav-code">{item.code}</span>}
      <span>{item.label}</span>
    </Link>
  ));

  return <div className="app-frame">
    <aside className="side-rail">
      <Link href="/" className="brand-lockup">
        <span className="brand-mark">S</span>
        <span className="brand-copy"><strong>Supra</strong><small>Billing workspace</small></span>
      </Link>
      <div className="side-caption">WORKSPACE</div>
      <nav className="side-nav" aria-label="Main navigation">{links()}</nav>
      <div className="side-footer"><span className="status-dot" />All records synced</div>
    </aside>

    <div className="app-stage">
      <header className="topbar">
        <div className="topbar-context"><span className="context-mark">S</span><span className="muted">Workspace</span><span className="context-slash">/</span><strong>{title}</strong></div>
        <div className="topbar-actions">
          {back && pathname !== '/' && <Link href={back} className="back-link">Back</Link>}
          {pathname !== '/bill/new' && <Link href="/bill/new" className="btn top-new-bill">New bill <span aria-hidden="true">↗</span></Link>}
        </div>
      </header>
      <main className={`app-main${pathname === '/bill/new' ? ' bill-editor-main' : ''}`}>
        <div className="page-title"><p className="eyebrow">SUPRA MARKETING <span>·</span> OPERATIONS</p><h1>{title}</h1></div>
        <div className="page-content">{children}</div>
      </main>
    </div>

    <nav className="mobile-nav" aria-label="Main navigation">{links(true)}</nav>
    {pathname !== '/ask-supra' && <AskSupraWidget raised={pathname === '/bill/new'} />}
  </div>;
}
