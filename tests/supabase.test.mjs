import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { requireOwner } from '../lib/auth.ts';
import { execFileSync } from 'node:child_process';
import { NextRequest } from 'next/server.js';
import { proxy } from '../proxy.ts';
import * as store from '../lib/report-store.ts';
import * as server from '../lib/google-server.ts';
import * as reporting from '../lib/reporting.ts';
import * as reportsRoute from '../app/api/reports/route.ts';
import * as sessionRoute from '../app/api/auth/session/route.ts';
import * as configRoute from '../app/api/google/config/route.ts';
import * as startRoute from '../app/api/google/start/route.ts';
import * as callbackRoute from '../app/api/google/callback/route.ts';
import * as statusRoute from '../app/api/google/route.ts';
import * as syncRoute from '../app/api/google/sync/route.ts';
import { config, fakeRows } from './fixtures.mjs';

if (!process.env.TEST_SUPABASE_ADMIN_KEY || !process.env.TEST_DATABASE_CONTAINER || !/^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.SUPABASE_URL || '')) {
  throw new Error('Run npm run test:integration. This suite requires isolated local Supabase services.');
}
process.env.GOOGLE_TOKEN_ENCRYPTION_KEY=Buffer.alloc(32,7).toString('base64url');
const options={auth:{persistSession:false,autoRefreshToken:false}};
const admin=createClient(process.env.SUPABASE_URL,process.env.TEST_SUPABASE_ADMIN_KEY,options);
const publicClient=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_PUBLISHABLE_KEY,options);
const password='Local-test-password-7352';
const owners={};
const sql=text=>execFileSync('docker',['exec','-i',process.env.TEST_DATABASE_CONTAINER,'psql','-U','postgres','-v','ON_ERROR_STOP=1'],{input:text,encoding:'utf8'});
const originalFetch=globalThis.fetch;
const sessions={};
const tokens={};
const jsonResponse=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
const request=(pathname,data,owner='alice',origin=process.env.SITE_ORIGIN)=>new Request(process.env.SITE_ORIGIN+pathname,{
  method:data===undefined?'GET':'POST',
  headers:{Cookie:sessions[owner]||'',Origin:origin,'Content-Type':'application/json'},
  ...(data===undefined?{}:{body:JSON.stringify(data)}),
});
for (const owner of ['alice','bob','outsider']) {
  const {data,error}=await admin.auth.admin.createUser({email:owner+'@example.test',email_confirm:true,password});
  assert.equal(error,null);
  const client=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_PUBLISHABLE_KEY,options);
  const logged=await client.auth.signInWithPassword({email:owner+'@example.test',password});
  assert.equal(logged.error,null);tokens[owner]=logged.data.session.access_token;
  owners[owner]={id:data.user.id,db:client};
  if(owner!=='outsider'){
    const session=await sessionRoute.POST(request('/api/auth/session',{email:owner+'@example.test',password},owner));
    assert.equal(session.status,200,await session.text());
    const cookies=session.headers.getSetCookie();
    assert.ok(cookies.every(cookie=>cookie.includes('HttpOnly')&&cookie.includes('SameSite=Lax')));
    sessions[owner]=cookies.map(cookie=>cookie.split(';')[0]).join('; ');
    owners[owner]=await requireOwner(request('/api/reports',undefined,owner));
  }
}
after(()=>{globalThis.fetch=originalFetch;});

await test('Supabase sessions reject forged identity headers, invalid cookies, wrong passwords, unapproved accounts and cross-origin login',async()=>{
  assert.equal((await reportsRoute.GET(new Request('https://dashboard.example/api/reports',{headers:{'oai-authenticated-user-id':'alice'}}))).status,401);
  assert.equal((await reportsRoute.GET(new Request('https://dashboard.example/api/reports',{headers:{Cookie:'__session=fake'}}))).status,401);
  assert.equal((await sessionRoute.POST(request('/api/auth/session',{email:'outsider@example.test',password},'outsider'))).status,403);
  assert.equal((await sessionRoute.POST(request('/api/auth/session',{email:'alice@example.test',password},'alice','https://attacker.example'))).status,403);
  const result=await reportsRoute.GET(request('/api/reports'));assert.equal(result.status,200);assert.deepEqual((await result.json()).reports,[]);
});

await test('database denies anonymous access, unapproved accounts, direct table access and owner impersonation',async()=>{
  assert.ok((await publicClient.rpc('dashboard_operation',{action:'list_reports'})).error);
  assert.equal((await owners.outsider.db.rpc('dashboard_operation',{action:'list_reports'})).error.code,'42501');
  assert.ok((await owners.alice.db.from('reports').select('*')).error);
  assert.ok((await owners.alice.db.schema('dashboard_private').from('reports').select('*')).error);
  const result=await owners.alice.db.rpc('dashboard_operation',{action:'get_connection',payload:{owner:owners.bob.id}});
  assert.equal(result.error,null);assert.equal(result.data,null);
  assert.equal((await sessionRoute.POST(request('/api/auth/session',{email:'alice@example.test',password:'incorrect'}))).status,401);
});

await test('expired sessions refresh through the proxy and continue with verified cookies',async()=>{
  const jar=sessions.alice.split('; ').map(pair=>{
    const index=pair.indexOf('=');
    return {name:pair.slice(0,index),value:decodeURIComponent(pair.slice(index+1))};
  });
  const sessionCookie=jar.find(cookie=>cookie.name.endsWith('-auth-token'));
  assert.ok(sessionCookie,'Test session fits in one cookie');
  const session=JSON.parse(Buffer.from(sessionCookie.value.slice('base64-'.length),'base64url').toString());
  session.expires_at=Math.floor(Date.now()/1000)-60;
  sessionCookie.value='base64-'+Buffer.from(JSON.stringify(session)).toString('base64url');
  const response=await proxy(new NextRequest('https://dashboard.example/',{headers:{cookie:jar.map(cookie=>cookie.name+'='+encodeURIComponent(cookie.value)).join('; ')}}));
  assert.ok(response.headers.getSetCookie().length>0,'Refresh must persist its new cookies');
  assert.match(response.headers.get('Cache-Control'),/no-store/);
  sessions.alice=response.headers.getSetCookie().map(cookie=>cookie.split(';')[0]).join('; ');
  owners.alice=await requireOwner(request('/api/reports'));
  assert.equal((await reportsRoute.GET(request('/api/reports'))).status,200);
});

await test('CSV imports persist in PostgreSQL, isolate owners and reject stale revisions and cross-origin writes',async()=>{
  const text='# Start date: 20260901\n# End date: 20260930\nPage path and screen class,Views,Active users,Average engagement time per active user,Event count,Key events,Total revenue\n/hotel/emerald-hotel/,12,5,8,20,0,0';
  const body={propertyId:'all',month:'2026-09',files:[{name:'pages.csv',text}],scopeConfirmed:true,expectedRevision:0};
  const response=await reportsRoute.POST(request('/api/reports',body));assert.equal(response.status,200,await response.text());
  const saved=await reportsRoute.GET(request('/api/reports'));assert.equal((await saved.json()).reports[0].pages[0].Views,12);
  const bob=await reportsRoute.GET(request('/api/reports',undefined,'bob'));assert.deepEqual((await bob.json()).reports,[]);
  const impersonation=await owners.bob.db.rpc('dashboard_operation',{action:'list_reports',payload:{owner:owners.alice.id,kind:'reports'}});
  assert.equal(impersonation.error,null);assert.deepEqual(impersonation.data,[]);
  assert.equal((await reportsRoute.POST(request('/api/reports',body))).status,409);
  assert.equal((await reportsRoute.POST(request('/api/reports',{...body,expectedRevision:1,replace:true},'alice','https://attacker.example'))).status,403);
});

await test('reports larger than one MiB round-trip through PostgreSQL, concurrent revisions conflict and replacements shrink correctly',async()=>{
  const large=reporting.emptyReport('all','2026-07');large.sources.pages='large.csv';
  large.pages=Array.from({length:1800},(_,i)=>({'Page path and screen class':'/test/'+i+'-'+('long'.repeat(200)),Views:i}));
  assert.ok(Buffer.byteLength(JSON.stringify(large))>1024*1024);
  await store.saveImport(owners.bob,large,0,false);
  assert.deepEqual((await store.listReports(owners.bob))[0].pages,large.pages);
  const smaller={...large,pages:[large.pages[0]]};
  const results=await Promise.allSettled([store.saveImport(owners.bob,smaller,1,true),store.saveImport(owners.bob,smaller,1,true)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.find(r=>r.status==='rejected').reason.status,409);
  assert.equal((await store.listReports(owners.bob))[0].pages.length,1);

});

await test('Google credentials are owner-scoped, encrypted, and protected from cross-origin changes',async()=>{
  const body={action:'credentials',clientId:'client.apps.googleusercontent.com',clientSecret:'client-secret-for-test'};
  assert.equal((await configRoute.POST(request('/api/google/config',body,'alice','https://attacker.example'))).status,403);
  assert.equal((await configRoute.POST(request('/api/google/config',body))).status,200);
  assert.ok(!(await server.connection(owners.alice)).client_secret.includes(body.clientSecret));
  assert.equal(await server.connection(owners.bob),null);
  const status=await statusRoute.GET(request('/api/google'));assert.ok(!JSON.stringify(await status.json()).includes(body.clientSecret));
});

await test('OAuth binds Supabase owner and cookie, consumes state once, and encrypts refresh tokens',async()=>{
  const start=await startRoute.POST(request('/api/google/start',{}));assert.equal(start.status,200);
  const auth=new URL((await start.json()).url),state=auth.searchParams.get('state');
  assert.equal(auth.searchParams.get('scope'),server.READ_SCOPE);assert.ok(auth.searchParams.get('code_challenge'));
  const callbackRequest=owner=>new Request('https://dashboard.example/api/google/callback?state='+state+'&code=test',{headers:{Cookie:sessions[owner]+'; __Host-tsogo-ga-state='+state}});
  globalThis.fetch=async(url,opts)=>{if(String(url).startsWith(process.env.SUPABASE_URL))return originalFetch(url,opts);assert.equal(url,'https://oauth2.googleapis.com/token');assert.ok(new URLSearchParams(opts.body).get('code_verifier'));return jsonResponse({access_token:'access-test',refresh_token:'refresh-test',scope:server.READ_SCOPE});};
  try{
    assert.ok((await callbackRoute.GET(callbackRequest('bob'))).headers.get('Location').endsWith('google=failed'));
    assert.ok((await callbackRoute.GET(callbackRequest('alice'))).headers.get('Location').endsWith('google=connected'));
    assert.ok((await callbackRoute.GET(callbackRequest('alice'))).headers.get('Location').endsWith('google=failed'));
    assert.equal(await server.unseal((await server.connection(owners.alice)).refresh_token,owners.alice.id+':refresh'),'refresh-test');
  }finally{globalThis.fetch=originalFetch;}
});

await test('GA4 sync preserves uploaded reports, isolates cached results, and prevents concurrent sync',async()=>{
  const connection=await server.connection(owners.alice);
  await store.updateConnection(owners.alice,{config:JSON.stringify(config)},connection.revision);
  const before=await store.listReports(owners.alice);
  globalThis.fetch=async(url,opts)=>String(url).startsWith(process.env.SUPABASE_URL)?originalFetch(url,opts):url==='https://oauth2.googleapis.com/token'?jsonResponse({access_token:'test'}):jsonResponse(fakeRows(JSON.parse(opts.body)));
  try{
    const synced=await syncRoute.POST(request('/api/google/sync',{propertyId:'emerald',month:'2026-08'}));assert.equal(synced.status,200,await synced.text());
    assert.deepEqual(await store.listReports(owners.alice),before);
    assert.equal((await store.listReports(owners.alice,'googleReports')).length,1);
    assert.equal(await store.claimSync(owners.alice,'other-operation'),true);
    assert.equal((await syncRoute.POST(request('/api/google/sync',{propertyId:'emerald',month:'2026-08'}))).status,409);
    await store.releaseSync(owners.alice,'wrong-token');assert.equal(await store.claimSync(owners.alice,'third-operation'),false);
    await store.releaseSync(owners.alice,'other-operation');
    const bob=await statusRoute.GET(request('/api/google',undefined,'bob'));assert.deepEqual((await bob.json()).reports,[]);
  }finally{globalThis.fetch=originalFetch;}
});

await test('changed connections invalidate an in-flight sync and expired OAuth states cannot be consumed',async()=>{
  const current=await server.connection(owners.alice);
  await store.claimSync(owners.alice,'pending-operation');
  await store.updateConnection(owners.alice,{last_error:null},current.revision);
  assert.equal(await store.saveGoogleReport(owners.alice,reporting.baseline[0],'stale-key',current.revision,'pending-operation'),false);
  await store.releaseSync(owners.alice,'pending-operation');
  sql(`insert into dashboard_private.oauth_states(owner,hash,verifier,expires) values ('${owners.alice.id}','expired','unused',now()-interval '1 minute') on conflict(owner) do update set hash=excluded.hash,verifier=excluded.verifier,expires=excluded.expires;`);
  assert.equal(await store.consumeOAuthState(owners.alice,'expired'),null);
});

await test('disconnect clears credentials without deleting reports and session logout clears the browser cookie',async()=>{
  const current=await server.connection(owners.alice);
  assert.equal(await store.disconnect(owners.alice,current.revision),true);
  assert.equal((await server.connection(owners.alice)).refresh_token,null);
  assert.equal((await store.listReports(owners.alice,'googleReports')).length,1);
  const logout=await sessionRoute.DELETE(new Request('https://dashboard.example/api/auth/session',{method:'DELETE',headers:{Origin:'https://dashboard.example',Cookie:sessions.alice}}));
  assert.equal(logout.status,200);assert.match(logout.headers.get('Set-Cookie'),/Max-Age=0/);
  await assert.rejects(store.listReports(owners.alice),{status:403});
});
