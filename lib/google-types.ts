import type {PropertyReport} from './reporting';
export type GoogleMapping={value:string;pathPrefix?:string};
export type GoogleConfig={propertyId:string;propertyName:string;dimension:string;dimensionName:string;timeZone:string;mappings:Record<string,GoogleMapping>};
export type GoogleStatus={setupReady:boolean;configured:boolean;connected:boolean;clientId?:string;redirectUri:string;config:GoogleConfig|null;lastSync:string|null;error?:string;reports:PropertyReport[];};
export type GoogleDimension={apiName:string;uiName:string;description?:string};
export type GoogleProperty={id:string;name:string;account:string};
export type GoogleDaily={date:string;views:number;sessions:number;rate:number;organic?:number};
export type GoogleReportMeta={gaPropertyId:string;dimension:string;value:string;pathPrefix?:string;configKey:string;timeZone:string;syncedAt:string;startDate:string;endDate:string;warnings:string[]};
export type GoogleTotals={views:number;sessions:number;activeUsers:number;engaged:number;rate:number;time:number;events:number;keyEvents:number;revenue:number};
