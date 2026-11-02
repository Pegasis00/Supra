'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Shell from '@/components/Shell';
import { sb } from '@/lib/supabase';
import type { Business } from '@/lib/types';

const FIELDS: [keyof Business, string][] = [
  ['name','Business name'],['address1','Address line 1'],['address2','Address line 2'],['phone','Phone'],['gstin','GSTIN'],['pan','PAN'],['bank_name','Bank name'],['bank_account','A/C number'],['bank_ifsc','IFSC'],
];
export default function Settings() {
  const router=useRouter(); const [b,setB]=useState<Business|null>(null); const [msg,setMsg]=useState('');
  useEffect(()=>{sb().from('business').select('*').eq('id',1).single().then(({data})=>setB(data as Business));},[]);
  async function save(){if(!b)return;const{id,...rest}=b;void id;const{error}=await sb().from('business').update({...rest,next_invoice_no:Number(b.next_invoice_no)}).eq('id',1);setMsg(error?error.message:'Saved.');}
  return <Shell title="Settings" back="/">{b&&<div className="card">{FIELDS.map(([key,label])=><div key={key}><label>{label}</label><input value={(b[key] as string)??''} onChange={e=>setB({...b,[key]:e.target.value})}/></div>)}<label>Next invoice number</label><input inputMode="numeric" value={b.next_invoice_no} onChange={e=>setB({...b,next_invoice_no:Number(e.target.value)||0})}/><p className="muted small">The next new invoice is #5605 unless you change it here.</p><button style={{width:'100%'}} onClick={save}>Save</button>{msg&&<p className="small muted">{msg}</p>}</div>}<button className="alt" style={{width:'100%'}} onClick={async()=>{await sb().auth.signOut();router.replace('/login');}}>Sign out</button></Shell>;
}
