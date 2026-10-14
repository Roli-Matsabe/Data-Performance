'use client';
import { useState, type FormEvent } from 'react';

export default function SignIn() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/auth/session', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.get('email'), password: form.get('password') }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Sign-in could not be completed.');
      window.location.assign('/');
    } catch (error) { setError(error instanceof Error ? error.message : 'Sign-in could not be completed.'); }
    finally { setBusy(false); }
  }
  return <main className="signin-page"><section className="signin-card">
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src="/logos/tsogo-sun.svg" alt="Tsogo Sun" width="180" height="80"/>
    <p className="signin-eyebrow">PERFORMANCE INTELLIGENCE</p>
    <h1>Your portfolio, in perspective.</h1>
    <p>Sign in to view performance reports and manage your Google Analytics connection.</p>
    <form onSubmit={signIn} className="signin-form">
      <label htmlFor="email">Email address</label>
      <input id="email" name="email" type="email" autoComplete="username" required disabled={busy}/>
      <label htmlFor="password">Password</label>
      <input id="password" name="password" type="password" autoComplete="current-password" required disabled={busy}/>
      <button className="primary" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
    </form>
    {error && <p className="notice warning" role="alert">{error}</p>}
    <p className="signin-help">Use the account provided by your dashboard administrator.</p>
  </section></main>;
}
