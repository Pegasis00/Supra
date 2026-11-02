'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { sb } from '@/lib/supabase';

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr('');
    const { error } = await sb().auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) setErr(error.message); else router.replace('/');
  }

  return <main className="login-page">
    <section className="login-aside">
      <div className="login-brand"><span className="brand-mark">S</span>Supra</div>
      <div className="login-aside-copy"><h2>Business, in good order.</h2><p>Sales, purchases and stock in one clear workspace.</p></div>
      <div className="login-aside-foot">SUPRA MARKETING · BILLING WORKSPACE</div>
    </section>
    <section className="login-form-wrap">
      <p className="eyebrow">WELCOME BACK</p><h1>Sign in</h1><p className="muted small">Use your Supra Billing account to continue.</p>
      <form onSubmit={submit}>
        <label>Email</label>
        <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <label>Password</label>
        <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {err && <p className="bad small">{err}</p>}
        <button disabled={busy} style={{ width: '100%', marginTop: 18 }}>{busy ? 'Signing in…' : 'Sign in to workspace'}</button>
      </form>
    </section>
  </main>;
}
