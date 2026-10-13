export const config={propertyId:'123456',propertyName:'Tsogo Sun',dimension:'customEvent:property_name',dimensionName:'Property Name',timeZone:'Africa/Johannesburg',mappings:{emerald:{value:'Emerald'}}};
export function fakeRows(body){const dims=(body.dimensions||[]).map(x=>x.name),metrics=(body.metrics||[]).map(x=>x.name);let rows=[];
 if(!dims.length)rows=[{screenPageViews:100,sessions:60,activeUsers:40,engagedSessions:30,engagementRate:.5,userEngagementDuration:600,eventCount:300,keyEvents:2,totalRevenue:0}];
 else if(dims.join()==='pagePath')rows=[{pagePath:'/casino/emerald-hotel/',screenPageViews:100,activeUsers:40,userEngagementDuration:600,eventCount:300,keyEvents:2,totalRevenue:0}];
 else if(dims.join()==='pagePath,pageTitle')rows=[{pagePath:'/casino/emerald-hotel/',pageTitle:'Emerald Hotel | Tsogo Sun',screenPageViews:100}];
 else if(dims.join()==='sessionPrimaryChannelGroup')rows=[{sessionPrimaryChannelGroup:'Organic Search',sessions:60,engagedSessions:30,engagementRate:.5,userEngagementDuration:600,eventCount:300,keyEvents:2,totalRevenue:0}];
 else if(dims.join()==='eventName')rows=[{eventName:'page_view',eventCount:100,totalUsers:40,totalRevenue:0}];
 else if(dims.join()==='date')rows=[{date:'20260801',screenPageViews:100,sessions:60,engagementRate:.5}];
 return {rowCount:rows.length,rows:rows.map(r=>({dimensionValues:dims.map(k=>({value:String(r[k]??'(not set)')})),metricValues:metrics.map(k=>({value:String(r[k]??0)}))}))};}
