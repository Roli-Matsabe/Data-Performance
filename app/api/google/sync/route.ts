import {properties} from '@/lib/properties';
import {claimSync,releaseSync,saveGoogleReport,updateConnection} from '@/lib/report-store';
import {ownerOf,bodyOf,connection,configOf,GoogleError,accessToken,signature,json,failure,random} from '@/lib/google-server';
import {fetchReport} from '@/lib/google-report';
export async function POST(req:Request){
 let owner='',lock='',revision:number|undefined;
 try{
  owner=await ownerOf(req,true);
  const body=await bodyOf(req),c=await connection(owner),config=configOf(c);
  if(!c||!config)throw new GoogleError('Connect Google Analytics and save your property mapping first.',409);
  revision=c.revision;
  const id=String(body.propertyId||''),month=String(body.month||'');
  if(id!=='all'&&(!properties.some(p=>p.id===id)||!config.mappings[id]))throw new GoogleError('This property is not mapped.');
  lock=random();
  if(!await claimSync(owner,lock)){lock='';throw new GoogleError('Another sync is running. Wait for it to finish before refreshing.',409);}
  const result=await fetchReport(await accessToken(c),config,id,month);
  if(Buffer.byteLength(JSON.stringify(result))>1800000)throw new GoogleError('This report is too large to save safely. Narrow the property filter.');
  if(!await saveGoogleReport(owner,result,await signature(config),c.revision,lock))throw new GoogleError('The connection changed while saving. Retry the sync.',409);
  return json({report:result});
 }catch(e){
  if(owner&&lock){try{await updateConnection(owner,{last_error:e instanceof GoogleError?e.message:'The last sync could not finish. Retry; saved reports are unchanged.'},revision,false,false);}catch{}}
  return failure(e);
 }finally{if(owner&&lock){try{await releaseSync(owner,lock);}catch{}}}
}
