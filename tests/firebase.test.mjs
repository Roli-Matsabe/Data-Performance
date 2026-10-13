import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { deleteApp, getApps } from 'firebase-admin/app';
import { firebaseAuth, firestore } from '../lib/firebase-admin.ts';
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

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  throw new Error('Run npm run test:emulators. These integration tests require real Firebase emulators.');
}
process.env.FIREBASE_PROJECT_ID='demo-tsogo-performance';
process.env.SITE_ORIGIN='https://dashboard.example';
process.env.GOOGLE_TOKEN_ENCRYPTION_KEY=Buffer.alloc(32,7).toString('base64url');
process.env.ACCESS_POLICY='allowlist';
process.env.ALLOWED_EMAILS='alice@example.test,bob@example.test';
const originalFetch=globalThis.fetch;
const sessions={};
const idTokens={};
const jsonResponse=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
const request=(pathname,data,owner='alice',origin=process.env.SITE_ORIGIN)=>new Request(process.env.SITE_ORIGIN+pathname,{
  method:data===undefined?'GET':'POST',
  headers:{Cookie:sessions[owner]||'',Origin:origin,'Content-Type':'application/json'},
  ...(data===undefined?{}:{body:JSON.stringify(data)}),
});
for (const owner of ['alice','bob','outsider']) {
  await firebaseAuth().createUser({uid:owner,email:owner+'@example.test',emailVerified:true,password:'emulator-test-password'});
  const response=await originalFetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key`,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:owner+'@example.test',password:'emulator-test-password',returnSecureToken:true}),
  });
  assert.equal(response.status,200);
  idTokens[owner]=(await response.json()).idToken;
  if(owner!=='outsider'){
    const session=await sessionRoute.POST(request('/api/auth/session',{idToken:idTokens[owner]},owner));
    assert.equal(session.status,200,await session.text());
    sessions[owner]=session.headers.get('Set-Cookie').split(';')[0];
  }
}
after(async()=>{globalThis.fetch=originalFetch;await firestore().terminate();await Promise.all(getApps().map(deleteApp));});

await test('Firebase sessions reject forged ChatGPT headers, invalid cookies, unapproved accounts and cross-origin login',async()=>{
  assert.equal((await reportsRoute.GET(new Request('https://dashboard.example/api/reports',{headers:{'oai-authenticated-user-id':'alice'}}))).status,401);
  assert.equal((await reportsRoute.GET(new Request('https://dashboard.example/api/reports',{headers:{Cookie:'__session=fake'}}))).status,401);
  assert.equal((await sessionRoute.POST(request('/api/auth/session',{idToken:idTokens.outsider},'outsider'))).status,403);
  assert.equal((await sessionRoute.POST(request('/api/auth/session',{idToken:idTokens.alice},'alice','https://attacker.example'))).status,403);
  const result=await reportsRoute.GET(request('/api/reports'));assert.equal(result.status,200);assert.deepEqual((await result.json()).reports,[]);
});

await test('Firestore rules deny direct anonymous client reads and writes',async()=>{
  const endpoint=`http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/demo-tsogo-performance/databases/(default)/documents/dashboardUsers/alice`;
  assert.equal((await originalFetch(endpoint)).status,403);
  assert.equal((await originalFetch(endpoint,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({fields:{test:{stringValue:'blocked'}}})})).status,403);
});

await test('CSV imports persist in Firestore, isolate owners and reject stale revisions and cross-origin writes',async()=>{
  const text='# Start date: 20260901\n# End date: 20260930\nPage path and screen class,Views,Active users,Average engagement time per active user,Event count,Key events,Total revenue\n/hotel/emerald-hotel/,12,5,8,20,0,0';
  const body={propertyId:'all',month:'2026-09',files:[{name:'pages.csv',text}],scopeConfirmed:true,expectedRevision:0};
  const response=await reportsRoute.POST(request('/api/reports',body));assert.equal(response.status,200,await response.text());
  const saved=await reportsRoute.GET(request('/api/reports'));assert.equal((await saved.json()).reports[0].pages[0].Views,12);
  const bob=await reportsRoute.GET(request('/api/reports',undefined,'bob'));assert.deepEqual((await bob.json()).reports,[]);
  assert.equal((await reportsRoute.POST(request('/api/reports',body))).status,409);
  assert.equal((await reportsRoute.POST(request('/api/reports',{...body,expectedRevision:1,replace:true},'alice','https://attacker.example'))).status,403);
});

await test('reports larger than one MiB round-trip through chunks, concurrent revisions conflict and shrinking removes surplus chunks',async()=>{
  const large=reporting.emptyReport('all','2026-07');large.sources.pages='large.csv';
  large.pages=Array.from({length:1800},(_,i)=>({'Page path and screen class':'/test/'+i+'-'+('long'.repeat(200)),Views:i}));
  assert.ok(Buffer.byteLength(JSON.stringify(large))>1024*1024);
  await store.saveImport('bob',large,0,false);
  assert.deepEqual((await store.listReports('bob'))[0].pages,large.pages);
  const smaller={...large,pages:[large.pages[0]]};
  const results=await Promise.allSettled([store.saveImport('bob',smaller,1,true),store.saveImport('bob',smaller,1,true)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.find(r=>r.status==='rejected').reason.status,409);
  assert.equal((await store.listReports('bob'))[0].pages.length,1);
  const chunks=await firestore().doc('dashboardUsers/'+Buffer.from('bob').toString('base64url')+'/reports/all_2026-07').collection('chunks').get();
  assert.equal(chunks.size,1);
});

await test('Google credentials are owner-scoped, encrypted, and protected from cross-origin changes',async()=>{
  const body={action:'credentials',clientId:'client.apps.googleusercontent.com',clientSecret:'client-secret-for-test'};
  assert.equal((await configRoute.POST(request('/api/google/config',body,'alice','https://attacker.example'))).status,403);
  assert.equal((await configRoute.POST(request('/api/google/config',body))).status,200);
  assert.ok(!(await server.connection('alice')).client_secret.includes(body.clientSecret));
  assert.equal(await server.connection('bob'),null);
  const status=await statusRoute.GET(request('/api/google'));assert.ok(!JSON.stringify(await status.json()).includes(body.clientSecret));
});

await test('OAuth binds Firebase owner and cookie, consumes state once, and encrypts refresh tokens',async()=>{
  const start=await startRoute.POST(request('/api/google/start',{}));assert.equal(start.status,200);
  const auth=new URL((await start.json()).url),state=auth.searchParams.get('state');
  assert.equal(auth.searchParams.get('scope'),server.READ_SCOPE);assert.ok(auth.searchParams.get('code_challenge'));
  const callbackRequest=owner=>new Request('https://dashboard.example/api/google/callback?state='+state+'&code=test',{headers:{Cookie:sessions[owner]+'; __Host-tsogo-ga-state='+state}});
  globalThis.fetch=async(url,opts)=>{assert.equal(url,'https://oauth2.googleapis.com/token');assert.ok(new URLSearchParams(opts.body).get('code_verifier'));return jsonResponse({access_token:'access-test',refresh_token:'refresh-test',scope:server.READ_SCOPE});};
  try{
    assert.ok((await callbackRoute.GET(callbackRequest('bob'))).headers.get('Location').endsWith('google=failed'));
    assert.ok((await callbackRoute.GET(callbackRequest('alice'))).headers.get('Location').endsWith('google=connected'));
    assert.ok((await callbackRoute.GET(callbackRequest('alice'))).headers.get('Location').endsWith('google=failed'));
    assert.equal(await server.unseal((await server.connection('alice')).refresh_token,'alice:refresh'),'refresh-test');
  }finally{globalThis.fetch=originalFetch;}
});

await test('GA4 sync preserves uploaded reports, isolates cached results, and prevents concurrent sync',async()=>{
  const connection=await server.connection('alice');
  await store.updateConnection('alice',{config:JSON.stringify(config)},connection.revision);
  const before=await store.listReports('alice');
  globalThis.fetch=async(url,opts)=>url==='https://oauth2.googleapis.com/token'?jsonResponse({access_token:'test'}):jsonResponse(fakeRows(JSON.parse(opts.body)));
  try{
    const synced=await syncRoute.POST(request('/api/google/sync',{propertyId:'emerald',month:'2026-08'}));assert.equal(synced.status,200,await synced.text());
    assert.deepEqual(await store.listReports('alice'),before);
    assert.equal((await store.listReports('alice','googleReports')).length,1);
    assert.equal(await store.claimSync('alice','other-operation'),true);
    assert.equal((await syncRoute.POST(request('/api/google/sync',{propertyId:'emerald',month:'2026-08'}))).status,409);
    await store.releaseSync('alice','wrong-token');assert.equal(await store.claimSync('alice','third-operation'),false);
    await store.releaseSync('alice','other-operation');
    const bob=await statusRoute.GET(request('/api/google',undefined,'bob'));assert.deepEqual((await bob.json()).reports,[]);
  }finally{globalThis.fetch=originalFetch;}
});

await test('changed connections invalidate an in-flight sync and expired OAuth states cannot be consumed',async()=>{
  const current=await server.connection('alice');
  await store.claimSync('alice','pending-operation');
  await store.updateConnection('alice',{last_error:null},current.revision);
  assert.equal(await store.saveGoogleReport('alice',reporting.baseline[0],'stale-key',current.revision,'pending-operation'),false);
  await store.releaseSync('alice','pending-operation');
  const ref=firestore().doc('dashboardUsers/'+Buffer.from('alice').toString('base64url')+'/private/googleOAuth');
  await ref.set({hash:'expired',verifier:'unused',expires:Date.now()-1});
  assert.equal(await store.consumeOAuthState('alice','expired'),null);
});

await test('disconnect clears credentials without deleting reports and session logout clears the browser cookie',async()=>{
  const current=await server.connection('alice');
  assert.equal(await store.disconnect('alice',current.revision),true);
  assert.equal((await server.connection('alice')).refresh_token,null);
  assert.equal((await store.listReports('alice','googleReports')).length,1);
  const logout=await sessionRoute.DELETE(new Request('https://dashboard.example/api/auth/session',{method:'DELETE',headers:{Origin:'https://dashboard.example'}}));
  assert.equal(logout.status,200);assert.match(logout.headers.get('Set-Cookie'),/Max-Age=0/);
});
