export type Row = Record<string,string|number>;
export type Report = {month:string; pages:Row[]; traffic:Row[]; events:Row[]; queries:Row[]; sources:Record<string,string>; searchConfirmed:boolean; scopeConfirmed:boolean};
export const n=(r:Row,k:string)=>Number(r[k])||0;
export const sum=(rs:Row[],k:string)=>rs.reduce((a,r)=>a+n(r,k),0);
export const pageKey='Page path and screen class';
export const channelKey='Session primary channel group (Default channel group)';
export const categories=['Hotel & accommodation','Casino gaming','Leisure & attractions','Dining','Offers & campaigns','Resort & information','Meetings & events','Other / review'];
export function category(path:string){
 const s=path.toLowerCase();
 if(/emerald-hotel|emerald-chalet|emerald-accommodation|emerald-bush-lodge|emerald-river-resort/.test(s))return categories[0];
 if(/emerald-gaming|emerald-slots|emerald-casino|emerald-tables|emerald-jackpot/.test(s))return categories[1];
 if(/emerald-entertainment|emerald-aquadome|emerald-game-drives|emerald-ten-pin|emerald-the-fun-company|emerald-padel|emerald-adventure-golf|emerald-silver-safari|emerald-always-upstairs|emerald-junior-ranger/.test(s))return categories[2];
 if(/emerald-dining|emerald-graze|emerald-liquid-lounge|emerald-mozambik|emerald-cappello|emerald-bossa|emerald-sip-savour|emerald-the-perfect-pour|emerald-i-scream|emerald-womens-day|emerald-wimpy|emerald-sausage|emerald-vaal-river-meander-wine|emerald-international-ice-cream|emerald-international-french-fries/.test(s))return categories[3];
 if(/emerald-offers|emerald-upstairs-day-spa-offer|emerald-find-your-celebration|emerald-celebrate-the-season|emerald-winter-warmers/.test(s))return categories[4];
 if(/emerald-meetings/.test(s))return categories[6];
 if(/\/emerald\/?$|emerald-more|emerald-about|emerald-wifi/.test(s))return categories[5];
 return categories[7];
}
export function label(path:string){return path.replace(/^\/casino\//,'').replace(/^emerald\/?$/,'Resort homepage').replace(/^emerald-/,'').replace(/\/$/,'').replaceAll('-',' ').replace(/\b\w/g,c=>c.toUpperCase());}
export function prevMonth(month:string){const d=new Date(month+'-01T12:00:00Z');d.setUTCMonth(d.getUTCMonth()-1);return d.toISOString().slice(0,7);}
export function monthLabel(m:string){return new Date(m+'-01T12:00:00Z').toLocaleDateString('en-ZA',{month:'long',year:'numeric',timeZone:'UTC'});}
export function metrics(r:Report){const sessions=sum(r.traffic,'Sessions'),engaged=sum(r.traffic,'Engaged sessions');return {sessions,views:sum(r.pages,'Views'),engaged,rate:sessions?engaged/sessions:0,time:sessions?r.traffic.reduce((a,x)=>a+n(x,'Average engagement time per session')*n(x,'Sessions'),0)/sessions:0,events:sum(r.events,'Event count'),clicks:sum(r.queries,'Clicks'),impressions:sum(r.queries,'Impressions'),keyEvents:sum(r.traffic,'Key events'),revenue:sum(r.traffic,'Total revenue')};}
export function groups(r:Report){return categories.map(name=>({name,views:sum(r.pages.filter(p=>category(String(p[pageKey]))===name),'Views')})).filter(x=>x.views>0).sort((a,b)=>b.views-a.views);}
export function top(rs:Row[],key:string){return [...rs].sort((a,b)=>n(b,key)-n(a,key)).slice(0,10);}
export function change(current:number,prior:number|undefined){return prior===undefined?'Unavailable':prior===0?(current===0?'0.0%':'No baseline'):((current-prior)/prior>=0?'+':'')+(((current-prior)/prior)*100).toFixed(1)+'%';}
export function parseCSV(text:string){
 const input=text.replace(/^\uFEFF/,'').split(/\r?\n/).filter(l=>!l.startsWith('#')).join('\n');
 const rows:string[][]=[];let row:string[]=[],cell='',quoted=false;
 for(let i=0;i<input.length;i++){const c=input[i];if(c==='"'){if(quoted&&input[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(cell);cell='';}else if((c==='\n'||c==='\r')&&!quoted){row.push(cell);if(row.some(x=>x.trim()))rows.push(row);row=[];cell='';}else cell+=c;}
 if(quoted)throw Error('Unclosed quote in CSV.');row.push(cell);if(row.some(x=>x.trim()))rows.push(row);
 const headers=rows.shift()?.map(s=>s.trim());if(!headers?.length||!rows.length)throw Error('The file contains no data rows.');
 const data:Row[]=rows.filter(r=>!['Total','Totals','Grand total'].includes(r[0])).map((r,i)=>{if(r.length!==headers.length)throw Error(`CSV row ${i+2} has the wrong number of columns.`);return Object.fromEntries(headers.map((h,j)=>{if(j===0)return [h,r[j]];const raw=r[j].trim();const v=Number(raw.replace(/%$/,''));if(!raw||!Number.isFinite(v)||v<0)throw Error(`Invalid value for ${h} at row ${i+2}.`);return [h,raw.endsWith('%')?v/100:v];}));});
 const keys=data.map(r=>String(r[headers[0]]));if(new Set(keys).size!==keys.length)throw Error('Duplicate row labels found. Export a single period without comparisons.');return {headers,data};
}
export function reportFromFiles(month:string,files:{name:string;text:string}[],searchConfirmed:boolean,scopeConfirmed:boolean):Report{
 if(!/^20\d\d-(0[1-9]|1[0-2])$/.test(month))throw Error('Choose a valid reporting month.');
 const report:Report={month,pages:[],traffic:[],events:[],queries:[],sources:{},searchConfirmed,scopeConfirmed};
 for(const file of files){const {headers,data}=parseCSV(file.text);const kind=headers[0]===pageKey?'pages':headers[0]===channelKey?'traffic':headers[0]==='Event name'?'events':headers[0]==='Top queries'?'queries':null;if(!kind)throw Error(`Unrecognised export: ${file.name}`);if(report[kind].length)throw Error(`Two ${kind} files were supplied.`);
 const required=kind==='pages'?['Views','Active users','Average engagement time per active user','Event count','Key events','Total revenue']:kind==='traffic'?['Sessions','Engaged sessions','Engagement rate','Average engagement time per session','Event count','Key events','Total revenue']:kind==='events'?['Event count','Total users','Total revenue']:['Clicks','Impressions','CTR','Position'];if(required.some(k=>!headers.includes(k)))throw Error(`Missing required columns in ${file.name}.`);
 if(kind!=='queries'){const start=file.text.match(/# Start date:\s*(\d{8})/)?.[1],end=file.text.match(/# End date:\s*(\d{8})/)?.[1];const prefix=month.replace('-','');const last=new Date(Number(month.slice(0,4)),Number(month.slice(5)),0).getDate();if(start!==prefix+'01'||end!==prefix+String(last))throw Error(`${file.name} must cover the complete selected month, with GA4 date headers.`);}
 report[kind]=data;report.sources[kind]=file.name;
 }
 if(!report.pages.length||!report.traffic.length||!report.events.length)throw Error('Add all three GA4 exports: pages, traffic acquisition and events.');
 if(report.pages.some(r=>!/^\/casino\/emerald(?:[-/]|$)/i.test(String(r[pageKey]))&&!/^\/hotels?\/emerald(?:[-/]|$)/i.test(String(r[pageKey]))))throw Error('The pages file includes non-Emerald paths. Export Emerald only.');
 if(!scopeConfirmed)throw Error('Confirm that the GA4 files use the same Emerald scope.');
 if(report.queries.length&&!searchConfirmed)throw Error('Confirm the Search Console date range and Emerald page filter.');
 const counts=[sum(report.pages,'Event count'),sum(report.events,'Event count'),sum(report.traffic,'Event count')];if(!counts.every(x=>x===counts[0]))throw Error('Event totals differ between exports. Check the date range, Emerald filter and that all rows were exported.');
 const pageViews=report.events.find(r=>r['Event name']==='page_view');if(pageViews&&n(pageViews,'Event count')!==sum(report.pages,'Views'))throw Error('Page views do not reconcile. Export all page rows.');
 return report;
}
