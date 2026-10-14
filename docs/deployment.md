# Publish with Supabase and Netlify

This full-stack Next.js application uses Supabase for its database and email/password sign-in, and Netlify for the website. Start with each service's Free plan. Free plans have quotas and may pause projects or sites when limits are reached; avoid enabling paid upgrades or automatic credit purchases if you want to keep the project free. Review the plan offered in each account during setup.

The old ChatGPT website remains a separate deployment. The following steps create the standalone version.

## 1. Prepare the Supabase project

1. Create or open a **Free** project at [Supabase](https://supabase.com/dashboard).
2. Copy the **Project URL** and **publishable key** from its Connect/API settings. A legacy `anon` public key also works. These identify the project; they are not administrative credentials. The application rejects secret/service-role keys.
3. Open **SQL Editor → New query**, paste the complete contents of [202610140001_dashboard.sql](../supabase/migrations/202610140001_dashboard.sql), and run it **once**. It creates the dashboard's private tables and `public.dashboard_operation`; it does not change unrelated tables or existing Firebase data. It is transactional, so errors roll back the migration. Do not re-run it after a successful application.
4. Under **Authentication → Providers**, enable email/password authentication. Disable new public sign-ups in the authentication settings.
5. Under **Authentication → Users → Add user → Create new user**, create `rolihlahla.info@gmail.com` with a strong password and enable **Auto Confirm User** for this account you own. Keep the password private. The application has no public registration page. An administrator can reset this password through Supabase when needed.

The migration approves only `rolihlahla.info@gmail.com`. Adding another person later requires adding their verified address to `dashboard_private.approved_emails` and to the host's `ALLOWED_EMAILS` variable. Never remove the ownership or session checks to fix a sign-in problem.

## 2. Connect GitHub to Netlify

1. Sign in at [Netlify](https://app.netlify.com/) and choose its **Free** plan.
2. Choose **Add new project → Import an existing project → GitHub**.
3. Select `Roli-Matsabe/Data-Performance`, branch **main**, with the repository root as the base directory.
4. Keep the settings from `netlify.toml`: build command `npm run build`, publish directory `.next`, Node 24, pnpm 11.25.0. Netlify automatically applies its Next.js runtime for API routes, server rendering, and the session proxy. Do not select a static export.
5. Add these environment variables, available to both **Builds and Functions**, then deploy:

| Variable | Value |
| --- | --- |
| `SUPABASE_URL` | Your Supabase Project URL, beginning `https://` |
| `SUPABASE_PUBLISHABLE_KEY` | Your publishable key or legacy anon public key |
| `ALLOWED_EMAILS` | `rolihlahla.info@gmail.com` |

`netlify.toml` includes the approved email for builds. `next.config.ts` embeds that public allowlist in the server configuration and derives `SITE_ORIGIN` from Netlify's canonical `URL` during the build. No second source edit is needed just to use the assigned `*.netlify.app` address. If using a custom domain or another host, set `SITE_ORIGIN` to its exact HTTPS origin and rebuild.

Do not copy the local `.env.example` value of `SITE_ORIGIN` into a production deployment. Do not use `NEXT_PUBLIC_` for secrets. Supabase service-role keys, database passwords, and Firebase credentials are unnecessary.

Alternatively, the README's **Deploy to Netlify** button asks for the two public Supabase values during its template flow. To keep using this repository directly, prefer the import steps above.

## 3. Verify the live site

1. Wait for Netlify's deploy to succeed and open its assigned HTTPS URL.
2. Confirm the login page appears and sign in using `rolihlahla.info@gmail.com` and the password created in Supabase.
3. Import a small CSV. Refresh the page and confirm the report remains. The SQL Editor can inspect `dashboard_private.reports` to verify the saved record.
4. Sign out and confirm the dashboard redirects back to sign-in. An unapproved account must be denied.
5. Record the final URL in Supabase's Auth URL Configuration as the Site URL. Password sign-in does not require Google OAuth or redirect configuration; this setting is useful if email recovery/invitation flows are enabled later.

The production project and site are not verified until these checks run against the actual services. Creating a database or pushing a commit alone does not establish a live connection.

## Optional Google Analytics sync

CSV reporting works without this section. Google Analytics sync needs a separate read-only Google OAuth connection:

1. Generate a random 32-byte base64/base64url encryption key securely. Store it as `GOOGLE_TOKEN_ENCRYPTION_KEY` in Netlify's Functions environment and redeploy. Preserve this value after saving a connection; changing it makes existing encrypted Google credentials unreadable.
2. Enable the Analytics Data and Analytics Admin APIs in the Google OAuth client's Cloud project and configure its consent screen.
3. Create a Web application OAuth client with the exact redirect URI `https://YOUR_SITE/api/google/callback`.
4. In the signed-in dashboard, enter the client ID/secret, authorize access, select the GA4 property, and save the mappings.

The app encrypts Google client secrets, refresh tokens, and OAuth verifiers before writing them to Supabase. Do not paste encryption keys, passwords, or administrative tokens into GitHub or chat. Large GA4 syncs may hit the hosting plan's function duration limit; narrow the property/date selection or import the CSV instead.

## Existing reports

The uploaded ZIP includes the bundled Emerald reports, but no live ChatGPT database or saved Google credentials. Re-import saved CSVs and reconnect Google, or arrange a separate authorized database export. Account IDs have changed to Supabase UUIDs, so any migration must map owners explicitly.

Bundled report JSON and logos remain part of the repository/client assets. Login protects saved records and authenticated routes; it cannot make already-published source files confidential.
