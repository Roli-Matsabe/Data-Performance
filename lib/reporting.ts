import type {GoogleReportMeta,GoogleTotals,GoogleDaily} from './google-types';
import {Report,Row,n,sum,pageKey,channelKey,parseCSV,prevMonth,metrics as legacyMetrics} from './analytics';
import {propertyById,belongsToProperty,contentName,properties,reportingPropertyId,pathProperty} from './properties';
import seed from './seed.json';
import july from './july.json';
export type Kind='pages'|'traffic'|'events'|'queries';
export type PropertyReport=Report&{propertyId:string;revision:number;contributors?:Partial<Record<Kind,string[]>>;excluded?:string[];google?:GoogleReportMeta;totals?:GoogleTotals;daily?:GoogleDaily[];periodComplete?:boolean;groupingNotes?:string[];scopeKeys?:Partial<Record<Kind,string[]>>};
export type ImportFile={name:string;text:string};
export const kinds:Kind[]=['pages','traffic','events','queries'];
export const kindNames:Record<Kind,string>={pages:'Pages & screens',traffic:'Traffic acquisition',events:'Events',queries:'Search Console queries'};
export const baseline:PropertyReport[]=[{...seed,propertyId:'emerald',revision:0},{...july,propertyId:'emerald',revision:0}] as PropertyReport[];
export const keyOf=(r:{propertyId:string;month:string})=>r.propertyId+'|'+r.month;
export const emptyReport=(propertyId:string,month:string):PropertyReport=>({propertyId,month,revision:0,pages:[],traffic:[],events:[],queries:[],sources:{},scopeConfirmed:false,searchConfirmed:false});
export const normalize=(r:Report&{propertyId?:string;revision?:number}):PropertyReport=>({...r,propertyId:r.propertyId||'emerald',revision:r.revision||0});
export const has=(r:PropertyReport|undefined,k:Kind)=>!!r?.sources[k];
export function summary(r:PropertyReport){const m={...legacyMetrics(r),...r.totals};return {sessions:has(r,'traffic')?m.sessions:undefined,views:has(r,'pages')?m.views:undefined,rate:has(r,'traffic')?m.rate:undefined,engaged:has(r,'traffic')?m.engaged:undefined,time:has(r,'traffic')?m.time:undefined,events:has(r,'events')?m.events:undefined,clicks:has(r,'queries')?m.clicks:undefined,impressions:has(r,'queries')?m.impressions:undefined,keyEvents:has(r,'traffic')?m.keyEvents:undefined,revenue:has(r,'traffic')?m.revenue:undefined,organic:has(r,'traffic')?sum(r.traffic.filter(x=>x[channelKey]==='Organic Search'),'Sessions'):undefined};}
export type Metric=keyof ReturnType<typeof summary>;
export const metricKind=(k:Metric):Kind=>['views'].includes(k)?'pages':['events'].includes(k)?'events':['clicks','impressions'].includes(k)?'queries':'traffic';
export function inferKind(text:string):Kind{const h=parseCSV(text).headers[0];if(h===pageKey)return 'pages';if(h===channelKey)return 'traffic';if(h==='Event name')return 'events';if(h==='Top queries'||h==='Query')return 'queries';throw Error('Unrecognised CSV. Use a Pages, Traffic acquisition, Events or Queries export.');}
export function parseImport(propertyId:string,month:string,files:ImportFile[],scope:boolean,searchConfirmed:boolean){
 if(propertyId!=='all'&&!properties.some(p=>p.id===propertyId))throw Error('Choose a property.');if(!/^20\d\d-(0[1-9]|1[0-2])$/.test(month))throw Error('Choose a reporting month.');if(!files.length||files.length>4)throw Error('Choose one CSV per report type, up to four files.');
 if(!scope)throw Error('Confirm the selected property and date range.');const r=emptyReport(propertyId,month);r.scopeConfirmed=true;r.searchConfirmed=searchConfirmed;
 for(const f of files){const kind=inferKind(f.text);if(has(r,kind))throw Error(`Two ${kindNames[kind]} files selected. Import one property and month at a time.`);const parsed=parseCSV(f.text);let rows=parsed.data;
 const required=kind==='pages'?['Views','Active users','Average engagement time per active user','Event count','Key events','Total revenue']:kind==='traffic'?['Sessions','Engaged sessions','Engagement rate','Average engagement time per session','Event count','Key events','Total revenue']:kind==='events'?['Event count','Total users','Total revenue']:['Clicks','Impressions','CTR','Position'];if(required.some(k=>!parsed.headers.includes(k)))throw Error(`${f.name}: required columns are missing.`);
 if(kind!=='queries'){const start=f.text.match(/# Start date:\s*(\d{8})/)?.[1],end=f.text.match(/# End date:\s*(\d{8})/)?.[1];const prefix=month.replace('-',''),last=new Date(Number(month.slice(0,4)),Number(month.slice(5)),0).getDate();if(start!==prefix+'01'||end!==prefix+last)throw Error(`${f.name}: export the full ${month} calendar month, without a comparison.`);}else{if(!searchConfirmed)throw Error('Confirm Search Console dates and the selected property page filter.');if(parsed.headers[0]==='Query')rows=rows.map(({Query,...rest})=>({'Top queries':Query,...rest}));}
 if(kind==='pages'&&propertyId!=='all'){const foreign=rows.find(p=>!belongsToProperty(String(p[pageKey]),propertyId));if(foreign)throw Error(`A page belongs to a different property: ${foreign[pageKey]}. Check your filter.`);}
 if(kind==='pages')rows=rows.map(p=>({...p,_propertyId:propertyId==='all'?pathProperty(String(p[pageKey]))||'all':propertyId}));
 r[kind]=rows;r.sources[kind]=f.name;
 }
 return r;
}
export function mergeImport(existing:PropertyReport|undefined,incoming:PropertyReport){
 const result={...(existing||emptyReport(incoming.propertyId,incoming.month)),sources:{...existing?.sources},scopeConfirmed:incoming.scopeConfirmed};
 for(const k of kinds)if(has(incoming,k)){result[k]=incoming[k];result.sources[k]=incoming.sources[k];}
 if(has(incoming,'queries'))result.searchConfirmed=incoming.searchConfirmed;
 const counts=kinds.filter(k=>k!=='queries'&&has(result,k)).map(k=>sum(result[k],'Event count'));
 if(counts.length>1&&!counts.every(v=>v===counts[0]))throw Error('Event totals do not match the other saved exports for this property and month. Upload the matching files together.');
 if(has(result,'pages')&&has(result,'events')){const pv=result.events.find(r=>r['Event name']==='page_view');if(pv&&n(pv,'Event count')!==sum(result.pages,'Views'))throw Error('Page view totals do not match. Export all page rows.');}
 return result;
}
function mergedRows(reports:PropertyReport[],kind:Kind):Row[]{
 if(kind==='pages')return reports.flatMap(r=>r.pages.map(p=>({...p,_propertyId:r.propertyId,_contentName:contentName(String(p[pageKey]),r.propertyId)})));
 const dim=kind==='traffic'?channelKey:kind==='events'?'Event name':'Top queries';const map=new Map<string,Row>();
 for(const r of reports)for(const row of r[kind]){const key=String(row[dim]);const target=map.get(key)||{[dim]:key};for(const [k,v] of Object.entries(row)){if(k===dim||typeof v!=='number')continue;if(k==='Average engagement time per session')target._time=n(target,'_time')+v*n(row,'Sessions');else if(k==='Position')target._position=n(target,'_position')+v*n(row,'Impressions');else target[k]=n(target,k)+v;}map.set(key,target);}
 return [...map.values()].map(row=>kind==='traffic'?{...row,'Engagement rate':n(row,'Sessions')?n(row,'Engaged sessions')/n(row,'Sessions'):0,'Average engagement time per session':n(row,'Sessions')?n(row,'_time')/n(row,'Sessions'):0}:kind==='queries'?{...row,CTR:n(row,'Impressions')?n(row,'Clicks')/n(row,'Impressions'):0,Position:n(row,'Impressions')?n(row,'_position')/n(row,'Impressions'):0}:row);
}
export function portfolio(reports:PropertyReport[],month:string){
 const rows=reports.filter(r=>r.propertyId!=='all'&&r.month===month).sort((a,b)=>Number(propertyById(a.propertyId)?.type==='Hotel')-Number(propertyById(b.propertyId)?.type==='Hotel')||a.propertyId.localeCompare(b.propertyId));
 const accepted:PropertyReport[]=[],seen=new Set<string>(),excluded:string[]=[];
 for(const r of rows){const paths=r.pages.map(p=>String(p[pageKey]));if(paths.some(p=>seen.has(p))){excluded.push(r.propertyId);continue;}accepted.push(r);paths.forEach(p=>seen.add(p));}
 const result=emptyReport('all',month);result.contributors={};result.excluded=excluded;
 for(const k of kinds){const subset=accepted.filter(r=>has(r,k));result.contributors[k]=subset.map(r=>r.propertyId).sort();if(subset.length){result[k]=mergedRows(subset,k);result.sources[k]=`${subset.length} property exports`;}}
 result.searchConfirmed=accepted.filter(r=>has(r,'queries')).every(r=>r.searchConfirmed);result.scopeConfirmed=accepted.every(r=>r.scopeConfirmed);result.groupingNotes=[...new Set(accepted.flatMap(r=>r.groupingNotes||[]))];result.scopeKeys=Object.fromEntries(kinds.map(k=>[k,accepted.filter(r=>has(r,k)).flatMap(r=>r.scopeKeys?.[k]||[r.propertyId]).sort()]));return result;
}
export function viewReport(reports:PropertyReport[],propertyId:string,month:string){return propertyId==='all'?(reports.find(r=>r.propertyId==='all'&&r.month===month)||(reports.some(r=>r.google)?emptyReport('all',month):portfolio(reports,month))):reports.find(r=>r.propertyId===propertyId&&r.month===month)||propertyPageReports(reports,month).find(r=>r.propertyId===propertyId)||emptyReport(propertyId,month);}
export function comparable(a:PropertyReport,b:PropertyReport,k:Kind){if(!has(a,k)||!has(b,k)||a.periodComplete===false||b.periodComplete===false)return false;if(!!a.google!==!!b.google)return false;if(JSON.stringify(a.scopeKeys?.[k])!==JSON.stringify(b.scopeKeys?.[k]))return false;if(a.google&&b.google&&a.google.configKey!==b.google.configKey)return false;if(k==='queries'&&(!a.searchConfirmed||!b.searchConfirmed))return false;return a.propertyId!=='all'||JSON.stringify(a.contributors?.[k])===JSON.stringify(b.contributors?.[k]);}
export function metricPrevious(a:PropertyReport,b:PropertyReport,k:Metric){return comparable(a,b,metricKind(k))?summary(b)[k]:undefined;}
export function rowIdentity(p:Row,fallback:string){return String(p._propertyId||fallback)+'|'+String(p[pageKey]);}
export function movements(a:PropertyReport,b:PropertyReport){if(!comparable(a,b,'pages'))return [];const before=new Map(b.pages.map(p=>[rowIdentity(p,b.propertyId),n(p,'Views')]));return a.pages.filter(p=>before.has(rowIdentity(p,a.propertyId))).map(p=>({name:String(p._contentName||contentName(String(p[pageKey]),String(p._propertyId||a.propertyId))),propertyId:String(p._propertyId||a.propertyId),path:String(p[pageKey]),now:n(p,'Views'),before:before.get(rowIdentity(p,a.propertyId))!,diff:n(p,'Views')-before.get(rowIdentity(p,a.propertyId))!}));}
export function months(reports:PropertyReport[]){return [...new Set(reports.map(r=>r.month))].sort();}
export function timeSeries(reports:PropertyReport[],propertyId:string,selectedMonth:string,metric:Metric){const current=viewReport(reports,propertyId,selectedMonth),k=metricKind(metric);if(current.daily&&['views','sessions','rate'].includes(metric))return current.daily.map(p=>({month:p.date,value:p[metric as 'views'|'sessions'|'rate']}));const earliest=months(reports).filter(m=>m<=selectedMonth)[0]||selectedMonth;const range:string[]=[];let cursor=selectedMonth;for(let i=0;i<12&&cursor>=earliest;i++){range.unshift(cursor);cursor=prevMonth(cursor);}return range.map(month=>{const report=viewReport(reports,propertyId,month);return {month,value:(k!=='queries'||report.searchConfirmed)&&(month===selectedMonth||comparable(current,report,k))?summary(report)[metric]??null:null};});}
export function loadedCount(reports:PropertyReport[],month:string){return new Set([...propertyPageReports(reports,month).map(r=>r.propertyId),...reports.filter(r=>r.propertyId!=='all'&&r.month===month&&kinds.some(k=>has(r,k))).map(r=>r.propertyId)]).size;}
export {properties,propertyById,contentName,prevMonth};

// Consolidate display scopes without mutating saved exports or adding overlapping visits.
export function consolidateReports(input:PropertyReport[]):PropertyReport[]{
 const buckets=new Map<string,PropertyReport[]>();
 for(const r of input){if(r.propertyId!=='all'&&!propertyById(r.propertyId))continue;const id=reportingPropertyId(r.propertyId),key=id+'|'+r.month;buckets.set(key,[...(buckets.get(key)||[]),r]);}
 return [...buckets.values()].map(rows=>{
  const id=reportingPropertyId(rows[0].propertyId);rows.sort((a,b)=>Number(b.propertyId===id)-Number(a.propertyId===id)||a.propertyId.localeCompare(b.propertyId));
  const primary=rows[0];const result={...primary,propertyId:id,sources:{...primary.sources},scopeKeys:{} as Partial<Record<Kind,string[]>>,groupingNotes:[] as string[]};
  for(const k of kinds){const candidates=rows.filter(r=>has(r,k)),canonical=candidates.find(r=>r.propertyId===id);const selected=canonical?[canonical]:candidates;
   result.scopeKeys[k]=selected.map(r=>r.propertyId).sort();
   if(!selected.length)continue;
   if(canonical||selected.length===1){result[k]=selected[0][k];result.sources[k]=selected[0].sources[k];}
   else if(k==='pages'){const unique=new Map<string,Row>();for(const r of selected)for(const p of r.pages){const path=String(p[pageKey]);if(!unique.has(path))unique.set(path,p);}result.pages=[...unique.values()];result.sources.pages='Combined hotel page exports';}
   else{result[k]=[];delete result.sources[k];result.groupingNotes.push(`${propertyById(id)?.name}: upload a combined property report for ${kindNames[k].toLowerCase()}; separate hotel figures may overlap.`);}
   if(!canonical&&id!==selected[0].propertyId)result.groupingNotes.push(`${propertyById(id)?.name}: available hotel exports only; the combined property report is not yet available.`);
  }
  if(primary.propertyId!==id){result.totals=undefined;result.daily=undefined;}
  result.pages=result.pages.map(p=>({...p,_propertyId:reportingPropertyId(String(p._propertyId|| (id==='all'?pathProperty(String(p[pageKey]))||'all':id)))}));
  result.groupingNotes=[...new Set(result.groupingNotes)];return result;
 });
}
export function propertyPageReports(reports:PropertyReport[],month:string){
 const website=reports.find(r=>r.propertyId==='all'&&r.month===month&&has(r,'pages'));
 if(!website)return reports.filter(r=>r.propertyId!=='all'&&r.month===month&&has(r,'pages'));
 return properties.map(p=>{const report=emptyReport(p.id,month);report.google=website.google;report.periodComplete=website.periodComplete;report.scopeKeys={pages:['website:'+p.id]};report.pages=website.pages.filter(row=>reportingPropertyId(String(row._propertyId||pathProperty(String(row[pageKey]))||'all'))===p.id);if(report.pages.length)report.sources.pages=website.sources.pages;return report;}).filter(r=>r.pages.length);
}
