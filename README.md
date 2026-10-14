# Tsogo Sun Performance

A standalone dashboard for the Tsogo Sun portfolio, using **Next.js, Supabase Auth, and Supabase PostgreSQL**. The original report layout, bundled Emerald reports, CSV imports, property grouping, and optional read-only Google Analytics connection are retained.

Repository: https://github.com/Roli-Matsabe/Data-Performance

The app is prepared for **Supabase Free + Netlify Free**, within those services' quotas. It does not need Firebase App Hosting, a Firebase billing account, or ChatGPT Cloud. The approved account is `rolihlahla.info@gmail.com`.

**Deployment status:** the migration is implemented and tested locally. The live Supabase project and Netlify site still need to be connected. A GitHub push alone does not publish a website.

## Publish the dashboard

Follow [the deployment guide](docs/deployment.md): apply the SQL migration, create the approved Supabase Auth user, and deploy to Netlify with the project's public URL and publishable key. No service-role key or database password is required by the app.

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/Roli-Matsabe/Data-Performance)

The button uses Netlify's template flow. To keep deploying from this exact repository, use **Add new project → Import an existing project** instead, choosing `Roli-Matsabe/Data-Performance`, branch `main`.

## Development

Use Node.js 22.13 or newer and pnpm **11.25.0**.

```sh
npm exec --yes --package=pnpm@11.25.0 -- pnpm install --frozen-lockfile
cp .env.example .env.local
npm run dev
```

Fill `.env.local` with the Supabase project URL and publishable/anon key. Apply the migration to a development project and create an approved test account before using it. Local development may access that configured project's database, so use a separate project for experimentation.

## Verification

```sh
npm run test:integration
npm run build
npm run typecheck
npm run lint
```

The integration runner requires Docker. It creates disposable PostgreSQL, Supabase Auth, and PostgREST containers using pinned image digests, runs **17 tests**, then removes its containers and temporary volumes. It never uses the configured cloud Supabase project. Tests cover password sign-in, refreshed sessions, access denial, private database tables, owner isolation, saved CSVs, large reports, concurrent edits, encrypted credentials, OAuth replay, and sync locking. Google API responses are mocked. `npm run test:unit` runs only the seven reporting/crypto tests.

CI runs the same checks. Netlify supplies the Next.js runtime for server rendering and API routes; a static host alone cannot run this app.

The local production browser check also passed sign-in, report persistence after refresh, mobile layout, and sign-out. Netlify's local adapter built the server function, but its final edge bundle could not complete because this workspace could not fetch a required runtime resource. The first real Netlify deployment still needs verification.

## Access and data

Sign-in uses a Supabase email/password account. Tokens stay in HTTP-only cookies; the server validates the user with Supabase Auth, and the proxy persists refreshed cookies. Both the server email allowlist and database allowlist must approve the account. Public sign-up is not exposed by the application and should be disabled in Supabase.

Every database operation derives the owner from Supabase's verified JWT and checks an active Auth session. Private tables have row-level security enabled and no browser grants. A narrowly scoped database function provides atomic reads/writes for the signed-in user. The application never uses a service-role key. See [the database model](docs/supabase-data.md).

The ZIP excluded the old live database and Google tokens. Bundled Emerald reports are retained; previous saved imports require re-import or a separate authorized export. Reconnect Google Analytics to create a new encrypted connection. SQL under `drizzle/` is historical reference and is not used by this runtime.
