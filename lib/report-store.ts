import {env} from 'cloudflare:workers';
export function reportDb(){if(!env.DB)throw Error('Database unavailable');return env.DB;}
