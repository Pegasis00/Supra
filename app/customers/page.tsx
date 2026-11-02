'use client';
import { useCallback, useEffect, useState } from 'react';
import Shell from '@/components/Shell';
import { sb } from '@/lib/supabase';
import type { Customer } from '@/lib/types';

type Form = { id?: string; name: string; kind?: Customer['kind']; gstin: string; address1: string; address2: string };
const blank: Form = { name: '', kind: 'customer', gstin: '', address1: '', address2: '' };

export default function Customers() {
  const [rows, setRows] = useState<Customer[]>([]); const [q, setQ] = useState(''); const [f, setF] = useState<Form | null>(null); const [err, setErr] = useState('');
  const load = useCallback(() => { sb().from('parties').select('id,name,kind,gstin,address1,address2').in('kind', ['customer', 'both']).order('name').then(({ data, error }) => { if (error) setErr(error.message); else setRows((data ?? []) as Customer[]); }); }, []);
  useEffect(load, [load]);
  async function save() { if (!f || !f.name.trim()) return setErr('Name is required.'); const row = { name: f.name.trim(), kind: f.kind === 'both' ? 'both' : 'customer', gstin: f.gstin.trim().toUpperCase() || null, address1: f.address1.trim() || null, address2: f.address2.trim() || null }; const { error } = f.id ? await sb().from('parties').update(row).eq('id', f.id) : await sb().from('parties').insert(row); if (error) return setErr(error.code === '23505' ? 'A customer with this name already exists.' : error.message); setF(null); setErr(''); load(); }
  const set = (k: keyof Form, v: string) => setF((x) => x ? { ...x, [k]: v } : x);
  return <Shell title="Customers" back="/">{f ? <div className="card"><strong>{f.id ? 'Edit customer' : 'New customer'}</strong><label>Name</label><input value={f.name} onChange={(e) => set('name', e.target.value)} /><label>GSTIN (leave empty if none)</label><input value={f.gstin} onChange={(e) => set('gstin', e.target.value)} autoCapitalize="characters" /><label>Address line 1</label><input value={f.address1} onChange={(e) => set('address1', e.target.value)} /><label>Address line 2</label><input value={f.address2} onChange={(e) => set('address2', e.target.value)} />{err && <p className="bad small">{err}</p>}<div className="row" style={{ marginTop: 14 }}><button className="alt" onClick={() => { setF(null); setErr(''); }}>Cancel</button><button onClick={save}>Save</button></div></div> : <><button style={{ width: '100%', marginBottom: 10 }} onClick={() => setF(blank)}>+ Add customer</button><input placeholder="Search..." value={q} onChange={(e) => setQ(e.target.value)} />{err && <p className="bad small">{err}</p>}<div className="list" style={{ marginTop: 8 }}>{rows.filter((r) => r.name.toLowerCase().includes(q.toLowerCase())).map((r) => <div key={r.id} className="item" onClick={() => setF({ id: r.id, name: r.name, kind: r.kind, gstin: r.gstin ?? '', address1: r.address1 ?? '', address2: r.address2 ?? '' })}><strong>{r.name}</strong><div className="muted small">{r.gstin || 'No GSTIN'}{r.address1 ? ` · ${r.address1}` : ''}</div></div>)}</div></>}</Shell>;
}
