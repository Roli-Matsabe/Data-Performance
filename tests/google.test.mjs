// Tests use isolated SQLite and mocked Google HTTP responses; no live credentials or reports.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import {createRequire} from 'node:module';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'tsogo-ga-test-'));
const files=['analytics','properties','reporting','google-types','google-server','google-report'];
function compile(name,source){const output=ts.transpileModule(source.replaceAll('@/lib/','./').replaceAll('cloudflare:workers','./test-env'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;fs.writeFileSync(path.join(temp,name+'.js'),output);}
for(const name of files)compile(name,fs.readFileSync('lib/'+name+'.ts','utf8'));
for(const name of ['seed','july','properties'])fs.copyFileSync('lib/'+name+'.json',path.join(temp,name+'.json'));
for(const name of ['config','start','callback','sync','discover'])compile(name+'-route',fs.readFileSync('app/api/google/'+name+'/route.ts','utf8'));
compile('status-route',fs.readFileSync('app/api/google/route.ts','utf8'));
fs.writeFileSync(path.join(temp,'test-env.js'),`exports.env={SITE_ORIGIN:'https://dashboard.example',GOOGLE_TOKEN_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64url')};`);
fs.writeFileSync(path.join(temp,'report-store.js'),`const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(':memory:');exports.sqlite=db;function prepared(sql,params=[]){return {bind(...p){return prepared(sql,p)},first:async()=>db.prepare(sql).get(...params)||null,run:async()=>({meta:{changes:db.prepare(sql).run(...params).changes}}),all:async()=>({results:db.prepare(sql).all(...params)})};}exports.reportDb=()=>({prepare:prepared,batch:async(q)=>Promise.all(q.map(x=>x.all()))});`);
const require=createRequire(path.join(temp,'test.cjs'));
const catalog=require('./properties.js'),analytics=require('./analytics.js');
const server=require('./google-server.js'),report=require('./google-report.js'),reporting=require('./reporting.js'),{sqlite}=require('./report-store.js');
for(const f of fs.readdirSync('drizzle').filter(x=>x.endsWith('.sql')).sort())sqlite.exec(fs.readFileSync('drizzle/'+f,'utf8'));
const config={propertyId:'123456',propertyName:'Tsogo Sun',dimension:'customEvent:property_name',dimensionName:'Property Name',timeZone:'Africa/Johannesburg',mappings:{emerald:{value:'Emerald'}}};
const post=(data,owner='alice',origin='https://dashboard.example')=>new Request('https://dashboard.example/api/google/config',{method:'POST',headers:{'oai-authenticated-user-id':owner,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(data)});
const jsonResponse=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
const originalFetch=globalThis.fetch;
await test('encryption authenticates both ciphertext and owner context',async()=>{const cipher=await server.seal('test-refresh-token','alice:refresh');assert.notEqual(cipher,'test-refresh-token');assert.equal(await server.unseal(cipher,'alice:refresh'),'test-refresh-token');await assert.rejects(server.unseal(cipher,'bob:refresh'));await assert.rejects(server.unseal(cipher.slice(0,-3)+'xxx','alice:refresh'));});
await test('credential setup is owner scoped, secret is encrypted, and cross-origin changes fail',async()=>{const route=require('./config-route.js');assert.equal((await route.POST(post({action:'credentials',clientId:'client.apps.googleusercontent.com',clientSecret:'client-secret-for-test'},'alice','https://attacker.example'))).status,403);assert.equal((await route.POST(post({action:'credentials',clientId:'client.apps.googleusercontent.com',clientSecret:'client-secret-for-test'}))).status,200);const row=await server.connection('alice');assert.ok(!row.client_secret.includes('client-secret-for-test'));assert.equal(await server.connection('bob'),null);const status=await require('./status-route.js').GET(new Request('https://dashboard.example/api/google',{headers:{'oai-authenticated-user-id':'alice'}}));assert.ok(!JSON.stringify(await status.json()).includes('client-secret-for-test'));});
await test('OAuth requires the initiating owner and cookie; consumes state once; stores refresh token encrypted',async()=>{const start=await require('./start-route.js').POST(post({}));assert.equal(start.status,200);const auth=new URL((await start.json()).url),state=auth.searchParams.get('state');assert.equal(auth.searchParams.get('scope'),server.READ_SCOPE);assert.ok(auth.searchParams.get('code_challenge'));const cookie='__Host-tsogo-ga-state='+state;globalThis.fetch=async(url,opts)=>{assert.equal(url,'https://oauth2.googleapis.com/token');const params=new URLSearchParams(opts.body);assert.ok(params.get('code_verifier'));return jsonResponse({access_token:'access-test',refresh_token:'refresh-test',scope:server.READ_SCOPE});};const callback=require('./callback-route.js');const wrong=await callback.GET(new Request('https://dashboard.example/api/google/callback?state='+state+'&code=test',{headers:{'oai-authenticated-user-id':'bob',Cookie:cookie}}));assert.ok(wrong.headers.get('Location').endsWith('google=failed'));const ok=await callback.GET(new Request('https://dashboard.example/api/google/callback?state='+state+'&code=test',{headers:{'oai-authenticated-user-id':'alice',Cookie:cookie}}));assert.ok(ok.headers.get('Location').endsWith('google=connected'));const replay=await callback.GET(new Request('https://dashboard.example/api/google/callback?state='+state+'&code=test',{headers:{'oai-authenticated-user-id':'alice',Cookie:cookie}}));assert.ok(replay.headers.get('Location').endsWith('google=failed'));assert.equal(await server.unseal((await server.connection('alice')).refresh_token,'alice:refresh'),'refresh-test');globalThis.fetch=originalFetch;});
await test('date boundaries respect GA4 timezone and mark a current month incomplete',()=>{assert.deepEqual(report.dateRange('2026-08','Africa/Johannesburg',new Date('2026-09-19T12:00:00Z')),{startDate:'2026-08-01',endDate:'2026-08-31',complete:true});assert.equal(report.dateRange('2026-09','Africa/Johannesburg',new Date('2026-09-19T12:00:00Z')).endDate,'2026-09-18');assert.equal(report.dateRange('2026-09','Africa/Johannesburg',new Date('2026-09-19T12:00:00Z')).complete,false);assert.throws(()=>report.dateRange('2026-10','Africa/Johannesburg',new Date('2026-09-19T12:00:00Z')));});
await test('filters use registered exact values; hotel prefix is an additional condition',()=>{assert.equal(report.propertyFilter(config.dimension,config.mappings.emerald).filter.stringFilter.matchType,'EXACT');assert.equal(report.propertyFilter(config.dimension,{value:'Emerald',pathPrefix:'/casino/emerald-hotel'}).andGroup.expressions.length,2);assert.equal(report.propertyFilter(config.dimension),undefined);});
function fakeRows(body){const dims=(body.dimensions||[]).map(x=>x.name),metrics=(body.metrics||[]).map(x=>x.name);let rows=[];
 if(!dims.length)rows=[{screenPageViews:100,sessions:60,activeUsers:40,engagedSessions:30,engagementRate:.5,userEngagementDuration:600,eventCount:300,keyEvents:2,totalRevenue:0}];
 else if(dims.join()==='pagePath')rows=[{pagePath:'/casino/emerald-hotel/',screenPageViews:100,activeUsers:40,userEngagementDuration:600,eventCount:300,keyEvents:2,totalRevenue:0}];
 else if(dims.join()==='pagePath,pageTitle')rows=[{pagePath:'/casino/emerald-hotel/',pageTitle:'Emerald Hotel | Tsogo Sun',screenPageViews:100}];
 else if(dims.join()==='sessionPrimaryChannelGroup')rows=[{sessionPrimaryChannelGroup:'Organic Search',sessions:60,engagedSessions:30,engagementRate:.5,userEngagementDuration:600,eventCount:300,keyEvents:2,totalRevenue:0}];
 else if(dims.join()==='eventName')rows=[{eventName:'page_view',eventCount:100,totalUsers:40,totalRevenue:0}];
 else if(dims.join()==='date')rows=[{date:'20260801',screenPageViews:100,sessions:60,engagementRate:.5}];
 return {rowCount:rows.length,rows:rows.map(r=>({dimensionValues:dims.map(k=>({value:String(r[k]??'(not set)')})),metricValues:metrics.map(k=>({value:String(r[k]??0)}))}))};}
await test('GA4 reports retain exact titles, daily observations and directly queried totals',async()=>{const bodies=[];const run=async b=>{bodies.push(b);return fakeRows(b)};const emerald=await report.fetchReport('test',config,'emerald','2026-08',run,new Date('2026-09-19T12:00:00Z'));assert.equal(emerald.pages[0]._contentName,'Emerald Hotel | Tsogo Sun');assert.equal(emerald.daily.length,31);assert.equal(emerald.daily[0].views,100);assert.equal(emerald.totals.sessions,60);assert.equal(emerald.pages[0]['Average engagement time per active user'],15);assert.ok(bodies.every(b=>b.dimensionFilter.filter.stringFilter.value==='Emerald'));bodies.length=0;const all=await report.fetchReport('test',config,'all','2026-08',run,new Date('2026-09-19T12:00:00Z'));assert.ok(bodies.every(b=>!b.dimensionFilter));assert.equal(reporting.summary(all).sessions,60);assert.equal(reporting.summary(reporting.viewReport([emerald],'all','2026-08')).sessions,undefined);assert.equal(reporting.comparable(emerald,reporting.baseline[1],'pages'),false);});
await test('oversized and truncated API reports fail rather than save partial data',async()=>{await assert.rejects(report.collect(async()=>({rows:[],rowCount:1}),['pagePath'],['screenPageViews'],{},new Set()),/incomplete/);await assert.rejects(report.collect(async()=>({rows:[],rowCount:50001}),['pagePath'],['screenPageViews'],{},new Set()),/50,000/);});
await test('sync preserves uploaded data, prevents concurrent writes, and isolates cached reports',async()=>{const conn=await server.connection('alice');sqlite.prepare('UPDATE google_connections SET config=? WHERE owner=?').run(JSON.stringify(config),'alice');sqlite.prepare('INSERT INTO property_reports (owner,property_id,month,payload,revision,updated_at) VALUES (?,?,?,?,?,?)').run('alice','emerald','2026-08',JSON.stringify(reporting.baseline[0]),1,'now');globalThis.fetch=async(url,opts)=>url==='https://oauth2.googleapis.com/token'?jsonResponse({access_token:'test'}):jsonResponse(fakeRows(JSON.parse(opts.body)));const sync=require('./sync-route.js');let res=await sync.POST(post({propertyId:'emerald',month:'2026-08'}));assert.equal(res.status,200);assert.equal(JSON.parse(sqlite.prepare('SELECT payload FROM property_reports WHERE owner=?').get('alice').payload).pages.length,43);assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM google_reports WHERE owner=?').get('alice').count,1);sqlite.prepare('INSERT INTO google_sync_locks (owner,token,expires) VALUES (?,?,?)').run('alice','other-operation',Date.now()+100000);res=await sync.POST(post({propertyId:'emerald',month:'2026-08'}));assert.equal(res.status,409);const bob=await require('./status-route.js').GET(new Request('https://dashboard.example/api/google',{headers:{'oai-authenticated-user-id':'bob'}}));assert.equal((await bob.json()).reports.length,0);globalThis.fetch=originalFetch;});
fs.rmSync(temp,{recursive:true,force:true});


test('shared property names consolidate without double-counting resort and hotel reports',()=>{

 assert.equal(catalog.properties.length,17);
 assert.equal(catalog.reportingPropertyId('gold-reef-city-theme-park-hotel'),'gold-reef-city');
 assert.equal(catalog.reportingPropertyId('suncoast-towers-hotel'),'suncoast');
 assert.equal(catalog.reportingPropertyId('the-ridgepoint-hotel'),'the-ridge');
 assert.equal(catalog.reportingPropertyId('the-palazzo-hotel'),'the-palazzo-hotel');
 assert.equal(catalog.pathProperty('/hotel/suncoast-towers-hotel/'),'suncoast');
 function fixture(id,views,sessions){const r=reporting.emptyReport(id,'2026-08');r.pages=[{[analytics.pageKey]:'/hotel/suncoast-hotel/',Views:views}];r.traffic=[{[analytics.channelKey]:'Direct',Sessions:sessions}];r.sources={pages:'pages.csv',traffic:'traffic.csv'};return r;}
 const grouped=reporting.consolidateReports([fixture('suncoast',100,50),fixture('suncoast-hotel',40,25)]);
 assert.equal(grouped.length,1);assert.equal(grouped[0].propertyId,'suncoast');assert.equal(reporting.summary(grouped[0]).views,100);assert.equal(reporting.summary(grouped[0]).sessions,50);
 const partial=reporting.consolidateReports([fixture('suncoast-hotel',40,25),fixture('suncoast-towers-hotel',40,25)]);
 assert.equal(reporting.summary(partial[0]).sessions,undefined);assert.equal(reporting.summary(partial[0]).views,40);assert.ok(partial[0].groupingNotes.length);
 assert.equal(reporting.comparable(grouped[0],partial[0],'pages'),false);
});

test('one website export accepts all property paths and groups hotel views under shared names',()=>{
 const columns=[analytics.pageKey,'Views','Active users','Average engagement time per active user','Event count','Key events','Total revenue'];
 const text='# Start date: 20260801\n# End date: 20260831\n'+columns.join(',')+'\n/casino/suncoast/,100,50,10,100,0,0\n/hotel/suncoast-towers-hotel/,40,20,10,40,0,0\n/casino/gold-reef-city/,60,30,10,60,0,0\n';
 const r=reporting.parseImport('all','2026-08',[{name:'pages.csv',text}],true,false);
 const grouped=reporting.consolidateReports([r]);const ranks=reporting.propertyPageReports(grouped,'2026-08');
 assert.equal(ranks.length,2);assert.equal(reporting.summary(ranks.find(r=>r.propertyId==='suncoast')).views,140);
 assert.equal(reporting.summary(reporting.viewReport(grouped,'all','2026-08')).views,200);
 assert.equal(reporting.summary(reporting.viewReport(grouped,'suncoast','2026-08')).views,140);
 assert.equal(reporting.loadedCount(grouped,'2026-08'),2);
});
