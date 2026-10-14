import type { SupabaseClient, User } from '@supabase/supabase-js';
import { sessionClient } from './supabase';
import { AppError } from './errors';

export type Owner = { id: string; db: SupabaseClient };

export function checkAccess(user: Pick<User, 'email' | 'email_confirmed_at'>) {
  if (!user.email || !user.email_confirmed_at) throw new AppError('Use your verified dashboard account to sign in.', 403);
  const allowed = (process.env.ALLOWED_EMAILS || 'rolihlahla.info@gmail.com').split(',').map((email) => email.trim().toLowerCase()).filter(Boolean);
  if (!allowed.includes(user.email.toLowerCase())) throw new AppError('This account has not been approved for the dashboard.', 403);
}

export function requestOrigin(request: Request) {
  const configured = process.env.SITE_ORIGIN || process.env.URL;
  if (configured) return new URL(configured).origin;
  if (process.env.NODE_ENV !== 'production') return new URL(request.url).origin;
  throw new AppError('The dashboard site address has not been configured.', 503);
}

export function checkSameOrigin(request: Request) {
  if (request.headers.get('sec-fetch-site') === 'cross-site' || request.headers.get('origin') !== requestOrigin(request)) {
    throw new AppError('Please make this request from the dashboard.', 403);
  }
}

export async function authenticated(request: Pick<Request, 'headers'>) {
  const { client } = sessionClient(request);
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) throw new AppError('Sign in to the dashboard.', 401);
  checkAccess(user);
  return { user, owner: { id: user.id, db: client } satisfies Owner };
}

export async function requireOwner(request: Request, write = false) {
  if (write) checkSameOrigin(request);
  return (await authenticated(request)).owner;
}
