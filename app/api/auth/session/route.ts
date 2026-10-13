import { firebaseAuth } from '@/lib/firebase-admin';
import { checkAccess, checkSameOrigin, SESSION_DURATION_MS, sessionCookie } from '@/lib/auth';
import { AppError, errorResponse } from '@/lib/errors';

export async function POST(request: Request) {
  try {
    checkSameOrigin(request);
    const text = await request.text();
    if (text.length > 20000) throw new AppError('Invalid sign-in request.');
    let idToken: unknown;
    try { idToken = JSON.parse(text).idToken; } catch { throw new AppError('Invalid sign-in request.'); }
    if (typeof idToken !== 'string' || !idToken) throw new AppError('Sign in with Google first.', 401);
    let user;
    try { user = await firebaseAuth().verifyIdToken(idToken, true); }
    catch { throw new AppError('Sign-in could not be verified. Please try again.', 401); }
    checkAccess(user);
    if (Date.now() / 1000 - user.auth_time > 300) throw new AppError('Please sign in again to start a new session.', 401);
    const session = await firebaseAuth().createSessionCookie(idToken, { expiresIn: SESSION_DURATION_MS });
    return Response.json({ signedIn: true }, { headers: {
      'Set-Cookie': sessionCookie(session, SESSION_DURATION_MS / 1000), 'Cache-Control': 'no-store',
    } });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request) {
  try {
    checkSameOrigin(request);
    return Response.json({ signedOut: true }, { headers: { 'Set-Cookie': sessionCookie('', 0), 'Cache-Control': 'no-store' } });
  } catch (error) { return errorResponse(error); }
}
