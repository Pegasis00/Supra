'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Shell from '@/components/Shell';
import Picker from '@/components/Picker';
import { sb } from '@/lib/supabase';
import { calcLine, inr, n, r2 } from '@/lib/money';
import { createId } from '@/lib/id';
import type { Business, Customer, Product } from '@/lib/types';

type Line = {
  key: string; product_id: string | null; description: string; hsn: string;
  gst: string; qty: string; rate: string; orig_rate: number | null; orig_gst: number | null; save_default: boolean;
};
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function NewBill() {
  const router = useRouter();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [biz, setBiz] = useState<Business | null>(null);
  const [cust, setCust] = useState<Customer | null>(null);
  const [date, setDate] = useState(today());
  const [challan, setChallan] = useState('');
  const [po, setPo] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [pick, setPick] = useState<'cust' | 'prod' | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const db = sb();
    db.from('parties').select('id,name,gstin,address1,address2').in('kind', ['customer','both']).order('name').then(({ data }) => setCustomers((data ?? []) as Customer[]));
    db.from('products').select('*').eq('active', true).order('name').then(({ data }) =>
      setProducts(((data ?? []) as Product[]).map((p) => ({ ...p, rate: Number(p.rate), gst: Number(p.gst) }))));
    db.from('business').select('*').eq('id', 1).single().then(({ data }) => setBiz(data as Business));
  }, []);

  const calc = lines.map((l) => calcLine(n(l.qty), n(l.rate), n(l.gst)));
  const sub = r2(calc.reduce((s, c) => s + c.amount, 0));
  const tax = r2(calc.reduce((s, c) => s + c.cgst, 0));
  const exact = r2(sub + 2 * tax);
  const total = Math.round(exact);
  const roundOff = r2(total - exact);

  const patch = (key: string, p: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));

  function addProduct(id: string) {
    const p = products.find((x) => x.id === id);
    if (!p) return;
    setLines((ls) => [...ls, { key: createId(), product_id: p.id, description: p.name, hsn: p.hsn, gst: String(p.gst), qty: '', rate: String(p.rate), orig_rate: p.rate, orig_gst: p.gst, save_default: false }]);
    setPick(null);
  }
  function addCustom(text: string) {
    setLines((ls) => [...ls, { key: createId(), product_id: null, description: text, hsn: biz ? '4820' : '', gst: '0', qty: '', rate: '', orig_rate: null, orig_gst: null, save_default: false }]);
    setPick(null);
  }

  async function save() {
    setErr('');
    if (!cust) return setErr('Choose a customer first.');
    const valid = lines.filter((l) => n(l.qty) > 0);
    if (!valid.length) return setErr('Add at least one item with a quantity.');
    if (valid.some((l) => l.rate.trim() === '')) return setErr('Every item needs a rate.');
    setBusy(true);
    const db = sb();
    for (const l of valid) {
      if (l.product_id && l.save_default) await db.from('products').update({ rate: n(l.rate), gst: n(l.gst) }).eq('id', l.product_id);
    }
    const { data, error } = await db.rpc('create_invoice', {
      p: {
        invoice_date: date, challan_no: challan, po_no: po, customer_id: cust.id,
        items: valid.map((l) => ({ product_id: l.product_id, description: l.description, hsn: l.hsn, gst: n(l.gst), qty: n(l.qty), rate: n(l.rate) })),
      },
    });
    setBusy(false);
    if (error) return setErr(error.message);
    router.push(`/bills/${data}`);
  }

  return (
    <Shell title="New Bill" back="/">
      <div className="card">
        <label style={{ marginTop: 0 }}>Customer</label>
        <button className="alt" style={{ width: '100%', textAlign: 'left' }} onClick={() => setPick('cust')}>
          {cust ? cust.name : 'Choose customer…'}
        </button>
        {cust && <div className="muted small" style={{ marginTop: 6 }}>{cust.gstin ? `GSTIN: ${cust.gstin}` : 'No GSTIN saved'}</div>}
        <div className="row">
          <div><label>Date</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div><label>Challan No</label><input value={challan} onChange={(e) => setChallan(e.target.value)} /></div>
        </div>
        <label>P.O. No (optional)</label>
        <input value={po} onChange={(e) => setPo(e.target.value)} />
      </div>

      {lines.map((l, i) => {
        const c = calc[i];
        const changed = l.product_id && (n(l.rate) !== l.orig_rate || n(l.gst) !== l.orig_gst);
        return (
          <div className="card" key={l.key}>
            <div className="between">
              <strong>{i + 1}. {l.description}</strong>
              <button className="danger small" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>Remove</button>
            </div>
            <div className="row">
              <div><label>Qty</label><input inputMode="decimal" value={l.qty} onChange={(e) => patch(l.key, { qty: e.target.value })} /></div>
              <div><label>Rate</label><input inputMode="decimal" value={l.rate} onChange={(e) => patch(l.key, { rate: e.target.value })} /></div>
              <div><label>GST %</label><input inputMode="decimal" value={l.gst} onChange={(e) => patch(l.key, { gst: e.target.value })} /></div>
            </div>
            {changed && (
              <label style={{ display: 'flex', alignItems: 'center', marginTop: 10 }}>
                <input type="checkbox" checked={l.save_default} onChange={(e) => patch(l.key, { save_default: e.target.checked })} />
                Save this rate / GST as the new default
              </label>
            )}
            <div className="between" style={{ marginTop: 8 }}>
              <span className="muted small">HSN {l.hsn}{n(l.gst) ? ` · CGST ${inr(c.cgst)} + SGST ${inr(c.sgst)}` : ''}</span>
              <strong>₹ {inr(c.total)}</strong>
            </div>
          </div>
        );
      })}
      <button className="alt" style={{ width: '100%' }} onClick={() => setPick('prod')}>＋ Add item</button>
      {err && <p className="bad">{err}</p>}

      <div className="sticky">
        <div className="in">
          <div className="between small muted"><span>Amount {inr(sub)} · GST {inr(2 * tax)}</span><span>Round off {roundOff > 0 ? '+' : ''}{roundOff.toFixed(2)}</span></div>
          <div className="between" style={{ margin: '4px 0 8px' }}><strong>Total</strong><span className="big">₹ {inr(total)}</span></div>
          <button style={{ width: '100%' }} disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save bill'}</button>
        </div>
      </div>

      {pick === 'cust' && (
        <Picker title="Customer" options={customers.map((c) => ({ id: c.id, label: c.name, sub: c.gstin ?? '' }))}
          onPick={(id) => { setCust(customers.find((c) => c.id === id) ?? null); setPick(null); }} onClose={() => setPick(null)} />
      )}
      {pick === 'prod' && (
        <Picker title="Add item" options={products.map((p) => ({ id: p.id, label: p.name, sub: `₹ ${inr(p.rate)}` }))}
          onPick={addProduct} onCustom={addCustom} onClose={() => setPick(null)} />
      )}
    </Shell>
  );
}
