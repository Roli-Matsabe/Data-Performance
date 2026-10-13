declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
  }
}
declare namespace Cloudflare { interface Env { GOOGLE_TOKEN_ENCRYPTION_KEY?:string; SITE_ORIGIN?:string; } }
