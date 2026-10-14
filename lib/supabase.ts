import { createServerClient, parseCookieHeader, serializeCookieHeader, type CookieOptions } from '@supabase/ssr';
import { AppError } from './errors';

export function supabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new AppError('Supabase sign-in has not been configured yet.', 503);
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(parsed.hostname))) {
    throw new AppError('Supabase needs a secure project URL.', 503);
  }
  let role: unknown;
  try { role = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role; } catch { /* Publishable keys are not JWTs. */ }
  if (key.startsWith('sb_secret_') || role === 'service_role') throw new AppError('Use the public Supabase publishable key, not an administrative key.', 503);
  return { url, key };
}

export function sessionClient(request: Pick<Request, 'headers'>) {
  const { url, key } = supabaseConfig();
  const jar = new Map(parseCookieHeader(request.headers.get('cookie') || '').map(({ name, value }) => [name, value || '']));
  const pending = new Map<string, { name: string; value: string; options: CookieOptions }>();
  const client = createServerClient(url, key, {
    cookieOptions: { path: '/', httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' },
    cookies: {
      getAll: () => Array.from(jar, ([name, value]) => ({ name, value })),
      setAll: (cookies) => {
        for (const cookie of cookies) { jar.set(cookie.name, cookie.value); pending.set(cookie.name, cookie); }
      },
    },
  });
  return {
    client,
    cookieHeader: () => Array.from(jar, ([name, value]) => `${name}=${encodeURIComponent(value)}`).join('; '),
    applyCookies<T extends Response>(response: T): T {
      for (const { name, value, options } of pending.values()) response.headers.append('Set-Cookie', serializeCookieHeader(name, value, options));
      response.headers.set('Cache-Control', 'private, no-store');
      return response;
    },
  };
}
