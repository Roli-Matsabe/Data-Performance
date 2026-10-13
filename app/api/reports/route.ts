import {propertyById} from '@/lib/properties';
import {reportDb} from '@/lib/report-store';
import {normalize,parseImport,mergeImport,baseline,has,kinds,PropertyReport} from '@/lib/reporting';
export async function GET(request:Request){
 const owner=request.headers.get('oai-authenticated-user-id');if(!owner)return Response.json({error:'Sign in to load saved reports.'},{status:401});
 try{const db=reportDb();const results=await db.batch([db.prepare('SELECT payload FROM reports WHERE owner = ?').bind(owner),db.prepare('SELECT payload FROM property_reports WHERE owner = ? ORDER BY month DESC').bind(owner)]);return Response.json({reports:results.flatMap(r=>(r.results as {payload:string}[]).map(x=>normalize(JSON.parse(x.payload))).filter(r=>r.propertyId==='all'||propertyById(r.propertyId)))});}catch(e){console.error(e);return Response.json({error:'Saved reports are temporarily unavailable. The original reports remain visible.'},{status:503});}
}
export async function POST(request:Request){
 const owner=request.headers.get('oai-authenticated-user-id');if(!owner)return Response.json({error:'Sign in to save a report.'},{status:401});if(request.headers.get('sec-fetch-site')==='cross-site')return Response.json({error:'Request rejected.'},{status:403});
 let body;try{const text=await request.text();if(text.length>2000000)return Response.json({error:'Keep each import below 1.9 MB.'},{status:413});body=JSON.parse(text);}catch{return Response.json({error:'Invalid import.'},{status:400});}
 let incoming;try{if(!Array.isArray(body.files)||body.files.some((f:{name:unknown;text:unknown})=>typeof f.name!=='string'||typeof f.text!=='string'))throw Error('Select CSV files.');incoming=parseImport(body.propertyId,body.month,body.files,body.scopeConfirmed===true,body.searchConfirmed===true);}catch(e){return Response.json({error:e instanceof Error?e.message:'Invalid data.'},{status:400});}
 try{
 const db=reportDb();const saved=await db.prepare('SELECT payload,revision FROM property_reports WHERE owner = ? AND property_id = ? AND month = ?').bind(owner,incoming.propertyId,incoming.month).first<{payload:string;revision:number}>();
 let existing:PropertyReport|undefined=saved?normalize(JSON.parse(saved.payload)):undefined;
 if(!existing&&incoming.propertyId==='emerald'){const old=await db.prepare('SELECT payload FROM reports WHERE owner = ? AND month = ?').bind(owner,incoming.month).first<{payload:string}>();existing=old?normalize(JSON.parse(old.payload)):baseline.find(r=>r.month===incoming.month);}
 if((saved?.revision||0)!==body.expectedRevision)return Response.json({error:'This report changed since you opened it. Refresh saved reports before importing.'},{status:409});
 if(kinds.some(k=>has(incoming,k)&&has(existing,k))&&!body.replace)return Response.json({error:'Confirm replacement of the selected report types.'},{status:409});
 let result;try{result=mergeImport(existing,incoming);}catch(e){return Response.json({error:e instanceof Error?e.message:'Inconsistent exports.'},{status:400});}
 result.revision=(saved?.revision||0)+1;
 const query=saved?'UPDATE property_reports SET payload=?, revision=?, updated_at=? WHERE owner=? AND property_id=? AND month=? AND revision=?':'INSERT INTO property_reports (payload,revision,updated_at,owner,property_id,month) VALUES (?,?,?,?,?,?) ON CONFLICT DO NOTHING';
 const values=[JSON.stringify(result),result.revision,new Date().toISOString(),owner,result.propertyId,result.month];if(saved)values.push(saved.revision);
 const changed=await db.prepare(query).bind(...values).run();if(!changed.meta.changes)return Response.json({error:'Another update was saved first. Refresh before importing again.'},{status:409});
 return Response.json({report:result});
 }catch(e){console.error(e);return Response.json({error:'The report could not be saved. Your selected files are still available; please retry.'},{status:503});}
}
