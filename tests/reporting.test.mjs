import test from 'node:test';
import assert from 'node:assert/strict';
import * as analytics from '../lib/analytics.ts';
import * as reporting from '../lib/reporting.ts';
import * as catalog from '../lib/properties.ts';
import * as report from '../lib/google-report.ts';
import * as server from '../lib/google-server.ts';
import {config,fakeRows} from './fixtures.mjs';
process.env.GOOGLE_TOKEN_ENCRYPTION_KEY=Buffer.alloc(32,7).toString('base64url');
await test('encryption authenticates both ciphertext and owner context',async()=>{const cipher=await server.seal('test-refresh-token','alice:refresh');assert.notEqual(cipher,'test-refresh-token');assert.equal(await server.unseal(cipher,'alice:refresh'),'test-refresh-token');await assert.rejects(server.unseal(cipher,'bob:refresh'));await assert.rejects(server.unseal(cipher.slice(0,-3)+'xxx','alice:refresh'));});
await test('date boundaries respect GA4 timezone and mark a current month incomplete',()=>{assert.deepEqual(report.dateRange('2026-08','Africa/Johannesburg',new Date('2026-09-19T12:00:00Z')),{startDate:'2026-08-01',endDate:'2026-08-31',complete:true});assert.equal(report.dateRange('2026-09','Africa/Johannesburg',new Date('2026-09-19T12:00:00Z')).endDate,'2026-09-18');assert.equal(report.dateRange('2026-09','Africa/Johannesburg',new Date('2026-09-19T12:00:00Z')).complete,false);assert.throws(()=>report.dateRange('2026-10','Africa/Johannesburg',new Date('2026-09-19T12:00:00Z')));});
await test('filters use registered exact values; hotel prefix is an additional condition',()=>{assert.equal(report.propertyFilter(config.dimension,config.mappings.emerald).filter.stringFilter.matchType,'EXACT');assert.equal(report.propertyFilter(config.dimension,{value:'Emerald',pathPrefix:'/casino/emerald-hotel'}).andGroup.expressions.length,2);assert.equal(report.propertyFilter(config.dimension),undefined);});
await test('GA4 reports retain exact titles, daily observations and directly queried totals',async()=>{const bodies=[];const run=async b=>{bodies.push(b);return fakeRows(b)};const emerald=await report.fetchReport('test',config,'emerald','2026-08',run,new Date('2026-09-19T12:00:00Z'));assert.equal(emerald.pages[0]._contentName,'Emerald Hotel | Tsogo Sun');assert.equal(emerald.daily.length,31);assert.equal(emerald.daily[0].views,100);assert.equal(emerald.totals.sessions,60);assert.equal(emerald.pages[0]['Average engagement time per active user'],15);assert.ok(bodies.every(b=>b.dimensionFilter.filter.stringFilter.value==='Emerald'));bodies.length=0;const all=await report.fetchReport('test',config,'all','2026-08',run,new Date('2026-09-19T12:00:00Z'));assert.ok(bodies.every(b=>!b.dimensionFilter));assert.equal(reporting.summary(all).sessions,60);assert.equal(reporting.summary(reporting.viewReport([emerald],'all','2026-08')).sessions,undefined);assert.equal(reporting.comparable(emerald,reporting.baseline[1],'pages'),false);});
await test('oversized and truncated API reports fail rather than save partial data',async()=>{await assert.rejects(report.collect(async()=>({rows:[],rowCount:1}),['pagePath'],['screenPageViews'],{},new Set()),/incomplete/);await assert.rejects(report.collect(async()=>({rows:[],rowCount:50001}),['pagePath'],['screenPageViews'],{},new Set()),/50,000/);});
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
