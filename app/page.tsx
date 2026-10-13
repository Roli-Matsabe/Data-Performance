import Dashboard from './dashboard';
import AccountMenu from './account-menu';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, verifySession } from '@/lib/auth';
export const dynamic = 'force-dynamic';
export default async function Page() {
  let user;
  try { user = await verifySession((await cookies()).get(SESSION_COOKIE)?.value); }
  catch { redirect('/signin'); }
  return <><AccountMenu email={user.email || ''}/><Dashboard/></>;
}
