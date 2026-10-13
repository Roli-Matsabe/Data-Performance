# Tsogo Sun Performance

A portfolio dashboard for website traffic, content, search performance, CSV report imports, and an optional read-only Google Analytics 4 connection.

Original live dashboard: https://emerald-performance.rolihlahla-info.chatgpt.site/

This repository contains the exported React/Vinext application, assets, bundled Emerald reports, and Cloudflare D1 migrations. The existing ChatGPT Sites dashboard remains the live deployment; this GitHub import does not change it. GitHub changes do not automatically update that website. See [hosting and deployment notes](docs/deployment.md).

## Local development

Use Node.js **22.13.0 or newer** and **pnpm 11.25.0**, matching `package.json`. From the repository root:

```sh
pnpm install --frozen-lockfile
npm run build
npm run db:migrate:local
```

The build generates `dist/server/wrangler.json`; the migration helper prepares local report storage.

```sh
npm run dev
```

A clean checkout uses the portable development profile and starts on http://localhost:5173. Local development sign-in is available at http://localhost:5173/signin-with-chatgpt?return_to=/ and uses a simulated test identity. It is restricted to loopback requests and is excluded from production builds.

To preview the built Worker locally:

```sh
npm start
```

Use the address printed by Wrangler. This command shares local database state with development, runs on loopback, and does not deploy or simulate sign-in.

## Local database

The application needs the D1 binding `DB` for saved reports and Google connection records. Local state is stored in ignored `.wrangler/state/`; it is separate from the live site's database.

After `npm run build`, apply pending migrations:

```sh
npm run db:migrate:local
```

The helper uses Wrangler's migration ledger to apply files from `drizzle/` in order and skip those already recorded. It is safe to rerun and targets only local storage. Databases previously created through raw SQL execution need their migration history reconciled before using this helper.

## Checks

```sh
npm test
npm run typecheck
npm run build
npm run lint
```

The 10 automated tests exercise report processing, encryption, OAuth state, owner isolation, and Google sync using local fixtures. They do not verify a production Google connection. Tests, type checking, and the build pass.

The imported code has a known lint baseline: three errors (`set-state-in-effect` in `app/dashboard.tsx` and `app/report-components.tsx`, and `prefer-const` in `lib/properties.ts`) and nine warnings. Application logic is unchanged by this import.

The GitHub Actions workflow in `.github/workflows/ci.yml` installs locked dependencies and runs tests, type checking, and the build. It does not deploy the site.

## Google Analytics and hosting

Google Analytics requires authenticated hosting, a secure site origin, server-side token encryption, and Google OAuth setup. The bundled dashboard remains usable with its original report data before that connection is configured.

The export excludes production credentials, Google authorization tokens, and live database records. It contains configuration names in `.env.example`, with no values. Keep secrets in hosting settings or ignored local configuration. Read [deployment requirements](docs/deployment.md) before exposing the server outside local development.
