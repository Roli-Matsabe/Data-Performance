import Dashboard from './dashboard';
import AccountMenu from './account-menu';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { authenticated } from '@/lib/auth';
export const dynamic = 'force-dynamic';
export default async function Page() {
  let user;
  try { user = (await authenticated({ headers: await headers() })).user; }
  catch { redirect('/signin'); }
  return <><AccountMenu email={user.email || ''}/><Dashboard/></>;
}
