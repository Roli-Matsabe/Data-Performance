import catalog from './properties.json';
export type Property={id:string;name:string;type:string;url:string;logo:string;logoBackground:string;path:string;sourceNote?:string;logoSourceUrl?:string};
export const sourceProperties=catalog.filter(p=>p.type!=='Group') as Property[];
const groupAliases:Record<string,string>={
 'gold-reef-city-hotel':'gold-reef-city','gold-reef-city-theme-park-hotel':'gold-reef-city',
 'suncoast-hotel':'suncoast','suncoast-towers-hotel':'suncoast','silverstar-hotel':'silverstar',
 'emerald-hotel':'emerald','golden-horse-hotel':'golden-horse','blackrock-hotel':'blackrock',
 'the-caledon-hotel-spa':'the-caledon','garden-route-hotel':'garden-route',
 'the-ridge-hotel':'the-ridge','the-ridgepoint-hotel':'the-ridge','hemingways-hotel':'hemingways'
};
export const reportingPropertyId=(id:string)=>groupAliases[id]||id;
export const sourcePropertyById=(id:string)=>sourceProperties.find(p=>p.id===id);
export const properties=sourceProperties.filter(p=>!groupAliases[p.id]).map(p=>({...p,name:p.id==='emerald'?'Emerald':p.name.replace(/ Casino$/,'')}));
export const groupBrand=catalog.find(p=>p.type==='Group') as Property;
export const propertyById=(id:string)=>properties.find(p=>p.id===reportingPropertyId(id));
export function pathProperty(path:string):string|undefined {
 let clean=path.toLowerCase().split('?')[0];try{if(clean.startsWith('http'))clean=new URL(clean).pathname;}catch{}
 const hotel=sourceProperties.filter(p=>p.type==='Hotel').find(p=>clean===p.path.slice(0,-1)||clean.startsWith(p.path));if(hotel)return reportingPropertyId(hotel.id);
 const hotelAlias=sourceProperties.filter(p=>p.type==='Hotel').find(p=>clean.startsWith('/casino/'+p.id+'/')||clean.startsWith('/casino/'+p.id+'-'));if(hotelAlias)return reportingPropertyId(hotelAlias.id);
 const casino=properties.filter(p=>p.type==='Casino').find(p=>[p.id,p.id.replace(/^the-/,'')].some(s=>clean==='/casino/'+s||clean.startsWith('/casino/'+s+'/')||clean.startsWith('/casino/'+s+'-')));return casino?.id;
}
export function parentProperty(id:string){
 if(['the-palazzo-hotel','the-pivot-hotel','the-piazza-hotel','hotel-perte'].includes(id))return 'montecasino';
 if(id.startsWith('gold-reef-city'))return 'gold-reef-city';
 if(id==='suncoast-towers-hotel')return 'suncoast';
 if(id==='the-ridgepoint-hotel')return 'the-ridge';
 if(id==='the-caledon-hotel-spa')return 'the-caledon';
 return id.replace(/-hotel$/,'');
}
export function belongsToProperty(path:string,id:string){const detected=pathProperty(path);return !detected||detected===id||(propertyById(id)?.type==='Casino'&&parentProperty(detected)===id);}
export function contentName(path:string,id?:string){
 let s=path.split('?')[0];try{if(s.startsWith('http'))s=new URL(s).pathname;}catch{}
 const p=id?propertyById(id):propertyById(pathProperty(s)||'');
 if(p?.type==='Hotel'&&s.startsWith(p.path))s=s.slice(p.path.length);
 else{s=s.replace(/^\/(?:casino|hotel|hotels)\//,'');if(p){for(const slug of [p.id,p.id.replace(/^the-/,'')])if(s.startsWith(slug+'-')||s.startsWith(slug+'/')){s=s.slice(slug.length+1);break;}}}
 s=s.replace(/^\/+|\/+$/g,'');if(!s||s===p?.id)return p?`${p.name} homepage`:'Homepage';
 try{s=decodeURIComponent(s);}catch{}return s.replaceAll('-',' ').replaceAll('/',' · ').replace(/\b\w/g,c=>c.toUpperCase());
}
export function contentGroup(path:string,id?:string){
 const p=sourcePropertyById(id||pathProperty(path)||'');const s=path.toLowerCase();
 if(p?.type==='Hotel'||/\/hotels?\/|(?:^|[-/])(?:hotel|hotels|chalet|chalets|accommodation|bush-lodge|river-resort)(?:[-/]|$)/.test(s))return 'Hotel & accommodation';
 if(/(?:^|[-/])(?:gaming|slots|tables|jackpot|jackpots)(?:[-/]|$)/.test(s)||/[-/]casino\/?$/.test(s))return 'Casino gaming';
 if(/(?:entertainment|aquadome|game-drives|ten-pin|fun-company|padel|adventure-golf|theme-park)/.test(s))return 'Leisure & attractions';
 if(/(?:dining|restaurant|graze|wimpy|mozambik|cappello|bossa)/.test(s))return 'Dining';
 if(/(?:offers|winter-warmers|campaign|promotion)/.test(s))return 'Offers & campaigns';
 if(/(?:meetings|conference|event)/.test(s))return 'Meetings & events';
 return 'Other / review';
}
