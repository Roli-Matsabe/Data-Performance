'use client';
import { useState } from 'react';
import { initializeApp, getApps } from 'firebase/app';
import { connectAuthEmulator, getAuth, GoogleAuthProvider, inMemoryPersistence, setPersistence, signInWithPopup, signOut } from 'firebase/auth';

export default function SignIn() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function signIn() {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/auth/config');
      const config = await response.json();
      if (!response.ok) throw new Error(config.error);
      const app = getApps()[0] || initializeApp(config);
      const auth = getAuth(app);
      if (config.emulatorUrl && !auth.emulatorConfig) connectAuthEmulator(auth, config.emulatorUrl);
      await setPersistence(auth, inMemoryPersistence);
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      const credential = await signInWithPopup(auth, provider);
      try {
        const session = await fetch('/api/auth/session', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken: await credential.user.getIdToken() }),
        });
        const result = await session.json();
        if (!session.ok) throw new Error(result.error || 'Sign-in could not be completed.');
      } finally { await signOut(auth); }
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
    <button className="primary" onClick={() => void signIn()} disabled={busy}>{busy ? 'Signing in…' : 'Continue with Google'}</button>
    {error && <p className="notice warning" role="alert">{error}</p>}
  </section></main>;
}
