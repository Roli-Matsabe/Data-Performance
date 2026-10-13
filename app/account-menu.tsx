'use client';
import { useState } from 'react';
export default function AccountMenu({ email }: { email: string }) {
  const [error, setError] = useState('');
  async function signOut() {
    try {
      const response = await fetch('/api/auth/session', { method: 'DELETE' });
      if (!response.ok) throw new Error('Sign-out failed. Please retry.');
      window.location.assign('/signin');
    } catch { setError('Sign-out failed. Please retry.'); }
  }
  return <div className="account-bar"><span>{email}</span><button onClick={() => void signOut()}>Sign out</button>{error && <span role="alert">{error}</span>}</div>;
}
