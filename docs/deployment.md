# Deployment requirements

## Current status

The original dashboard address supplied with this project is:

https://emerald-performance.rolihlahla-info.chatgpt.site/

The chosen arrangement is to keep that existing ChatGPT Sites deployment live and store the exported source on GitHub. This import does not change the live site.

Importing or pushing this repository to GitHub does **not** deploy it, update that address, or establish automatic synchronization with ChatGPT Sites. Publish access to the original site has not been verified. No separate deployment or new hosting account is being configured.

The included GitHub Actions workflow validates dependencies, tests, types, and the build; it contains no publishing step.

This is a full-stack React/Vinext application targeting Cloudflare Workers. GitHub Pages cannot run its server routes, D1 persistence, or Google Analytics connection.

## Continue hosting on ChatGPT Sites

The export includes its original Sites project association in `.openai/hosting.json`. That identifier is metadata, not publishing permission.

Publishing to the same original project requires access through the supported ChatGPT Sites publishing workflow. Confirm the target project, current database association, authentication policy, and required environment settings before publishing. A GitHub source repository can coexist with the original live site, but synchronization must be configured explicitly through a supported workflow.

## Optional future move to a separate Cloudflare account

A separate Cloudflare deployment is outside the current GitHub import. If one is wanted later, it can preserve the dashboard UI and reporting code, but needs these prerequisites:

1. **Authentication replacement.** The original host owns ChatGPT sign-in, cookies, and identity header injection. The application reads `oai-authenticated-user-id` directly in `app/api/reports/route.ts` and `lib/google-server.ts`. A public Worker must not trust a caller-supplied value for this header. Introduce authentication that verifies identity, removes untrusted identity headers, and supplies a stable owner ID through a trusted server path. Preserve that identity through Google OAuth callbacks. The development sign-in middleware provides no production authentication.
2. **Workers deployment configuration.** Build using the pinned dependencies and configure the intended Cloudflare account and Worker. The generated configuration currently derives from a local placeholder database ID in `vite.config.ts`; it must be connected to a real production database before deployment. Do not deploy the placeholder configuration unchanged.
3. **D1 database binding.** Bind the production database as `DB`. Apply only pending SQL migrations from `drizzle/` in filename order, using a migration history or an explicit record of applied files. Local database commands do not change production. No R2 bucket is required by the current application.
4. **Runtime configuration.** Set `SITE_ORIGIN` to the actual HTTPS origin with no path or trailing slash. Store `GOOGLE_TOKEN_ENCRYPTION_KEY` as a secret containing a base64 or base64url encoded 32-byte random key. This key encrypts stored Google secrets and tokens. Preserve it with the database; changing it without a migration makes existing encrypted records unreadable.
5. **Google OAuth configuration.** Enable the Analytics Data and Analytics Admin APIs in the appropriate Google Cloud project. Create a Web application OAuth client and authorize the exact redirect URI `<SITE_ORIGIN>/api/google/callback`. Enter the client ID and secret through the dashboard's authenticated connection screen, then complete Google consent, select the GA4 property, and verify the first sync.
6. **Validation before launch.** Verify sign-in and sign-out, rejection of forged identity headers, isolation between users, report imports and persistence, the OAuth callback, and Google report syncing. Confirm the intended access policy for the dashboard and its assets.

Production credentials belong in secure hosting settings. Do not commit them to the repository or place them in client-exposed configuration.

## Data migration and access

The archive includes bundled Emerald July and August reports in `lib/july.json` and `lib/seed.json`. These are imported into the browser application. Protect the whole site, including its assets, if those reports should require sign-in.

The export explicitly excludes live database records, production credentials, and Google authorization tokens. A new D1 database therefore begins with no saved imports or Google connections beyond the client application's bundled reports. Existing records must be exported separately from the original database and imported through an authorized migration process if they are needed.

Saved records are keyed by the original host's user IDs, which are specific to that site. A new authentication provider may issue different IDs, so transferring records also requires a deliberate owner mapping. Google credentials use the owner ID as authenticated encryption context; moving them between IDs requires a supported re-encryption process with the original key, or reconnecting Google on the new host. Do not assume a raw database copy alone preserves usable sign-in or Google access.

Daily background Google sync is not enabled by the current application. The existing interface starts sync manually; no scheduled production job is included.
