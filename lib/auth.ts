import type { DecodedIdToken } from 'firebase-admin/auth';
import { firebaseAuth } from './firebase-admin';
import { AppError } from './errors';

export const SESSION_COOKIE = '__session';
export const SESSION_DURATION_MS = 5 * 24 * 60 * 60 * 1000;

export function checkAccess(user: DecodedIdToken) {
  if (!user.email || !user.email_verified) throw new AppError('Use a verified Google account to sign in.', 403);
  if (process.env.ACCESS_POLICY === 'authenticated') return;
  const allowed = (process.env.ALLOWED_EMAILS || '').split(',').map((email) => email.trim().toLowerCase()).filter(Boolean);
  if (!allowed.includes(user.email.toLowerCase())) throw new AppError('This account has not been approved for the dashboard.', 403);
}

export function requestOrigin(request: Request) {
  const configured = process.env.SITE_ORIGIN;
  if (configured) return new URL(configured).origin;
  if (process.env.NODE_ENV !== 'production' || process.env.FIREBASE_AUTH_EMULATOR_HOST) return new URL(request.url).origin;
  throw new AppError('The dashboard site address has not been configured.', 503);
}

export function checkSameOrigin(request: Request) {
  if (request.headers.get('sec-fetch-site') === 'cross-site' || request.headers.get('origin') !== requestOrigin(request)) {
    throw new AppError('Please make this request from the dashboard.', 403);
  }
}

export function sessionFrom(request: Request) {
  return request.headers.get('cookie')?.split(';').map((value) => value.trim()).find((value) => value.startsWith(SESSION_COOKIE + '='))?.slice(SESSION_COOKIE.length + 1);
}

export async function verifySession(session: string | undefined) {
  if (!session) throw new AppError('Sign in to the dashboard.', 401);
  let user: DecodedIdToken;
  try { user = await firebaseAuth().verifySessionCookie(session, true); }
  catch { throw new AppError('Your session has expired. Please sign in again.', 401); }
  checkAccess(user);
  return user;
}

export async function requireOwner(request: Request, write = false) {
  if (write) checkSameOrigin(request);
  return (await verifySession(sessionFrom(request))).uid;
}

export function sessionCookie(value: string, maxAge: number) {
  const secure = process.env.NODE_ENV === 'production' && !process.env.FIREBASE_AUTH_EMULATOR_HOST;
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}
