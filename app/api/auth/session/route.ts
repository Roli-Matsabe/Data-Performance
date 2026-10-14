import { checkAccess, checkSameOrigin } from '@/lib/auth';
import { sessionClient } from '@/lib/supabase';
import { AppError, errorResponse } from '@/lib/errors';

export async function POST(request: Request) {
  try {
    checkSameOrigin(request);
    const text = await request.text();
    if (text.length > 4000) throw new AppError('Invalid sign-in request.');
    let body;
    try { body = JSON.parse(text); } catch { throw new AppError('Invalid sign-in request.'); }
    if (typeof body?.email !== 'string' || typeof body?.password !== 'string' || !body.password || body.email.length > 254) {
      throw new AppError('Enter your email and password.');
    }
    const session = sessionClient(request);
    const { data, error } = await session.client.auth.signInWithPassword({ email: body.email.trim(), password: body.password });
    if (error || !data.user) throw new AppError('Sign-in failed. Check your email and password.', 401);
    try { checkAccess(data.user); }
    catch (error) { await session.client.auth.signOut({ scope: 'local' }); return session.applyCookies(errorResponse(error)); }
    return session.applyCookies(Response.json({ signedIn: true }));
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request) {
  try {
    checkSameOrigin(request);
    const session = sessionClient(request);
    const { error } = await session.client.auth.signOut({ scope: 'local' });
    if (error) throw new AppError('Sign-out failed. Please retry.', 503);
    return session.applyCookies(Response.json({ signedOut: true }));
  } catch (error) { return errorResponse(error); }
}
