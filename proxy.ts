import { NextResponse, type NextRequest } from 'next/server';
import { sessionClient } from './lib/supabase';

// Refresh cookies before server components and API handlers read the session.
export async function proxy(request: NextRequest) {
  if (!request.cookies.getAll().some(({ name }) => name.startsWith('sb-'))) return NextResponse.next();
  try {
    const session = sessionClient(request);
    await session.client.auth.getUser();
    const headers = new Headers(request.headers);
    headers.set('cookie', session.cookieHeader());
    return session.applyCookies(NextResponse.next({ request: { headers } }));
  } catch { return NextResponse.next(); }
}

export const config = { matcher: ['/', '/api/:path*', '/signin'] };
