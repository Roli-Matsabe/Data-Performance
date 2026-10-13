# Tsogo Sun Performance

A website performance dashboard for the Tsogo Sun portfolio, now prepared to run outside ChatGPT with **Next.js, Firebase Authentication, and Cloud Firestore**. The original report layout, CSV imports, portfolio grouping, and optional read-only Google Analytics connection are retained.

Repository: https://github.com/Roli-Matsabe/Data-Performance

This version no longer relies on ChatGPT identity headers or Cloudflare D1. The deployment configuration targets Firebase project `website-analytics-dashbo-15be5`, Firestore database `(default)`, and permits only the verified account `rolihlahla.info@gmail.com`. The public Web app configuration is included in `apphosting.yaml`. **Production access and deployment have not yet been verified.** The previous ChatGPT website is a separate deployment and is not updated by these changes. Follow [Firebase deployment](docs/deployment.md) to publish the standalone app.

## Development

Use Node.js 22.13 or newer, pnpm **11.25.0**, and Java **21** for emulator tests.

```sh
npm exec --yes --package=pnpm@11.25.0 -- pnpm install --frozen-lockfile
cp .env.example .env.local
npm run dev
```

Fill `.env.local` with the project's configuration. Firebase Admin uses Application Default Credentials locally and the managed service identity on Firebase App Hosting. Credentials and local environment files must not be committed. The Firebase web API key identifies the project; it is not a service-account credential.

For local emulators, use the isolated project `demo-tsogo-performance`, `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`, and `FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099`. Emulators do not connect to production. The application rejects non-loopback emulator addresses and requires a `demo-` project when they are enabled. Set `SITE_ORIGIN` to the local application address and explicitly approve the emulator user's email through `ALLOWED_EMAILS`.

## Verification

```sh
npm run test:emulators
npm run typecheck
npm run lint
npm run build
npm start
```

`test:emulators` starts real Firebase Auth and Firestore emulators, then runs 16 tests covering sessions, owner isolation, denied client access, persistent CSV imports, large reports, revision conflicts, Google OAuth state, encryption, sync locking, and the original reporting calculations. `npm test` expects both emulators to already be running. Google HTTP responses are mocked; these tests do not prove access to a live GA4 property.

CI runs emulator tests, types, lint, and a production build. It does not deploy the application automatically.

The runtime targets a Node server. Firebase App Hosting is the recommended deployment. Static Firebase Hosting and GitHub Pages cannot run this application's API routes alone.

## Database and authentication

Google sign-in uses Firebase Authentication. A verified ID token is exchanged for a five-day HTTP-only session cookie, and each server request verifies the session, revocation state, and access policy. By default, only verified addresses in `ALLOWED_EMAILS` are accepted. An empty allowlist denies everyone. `ACCESS_POLICY=authenticated` explicitly allows all verified authenticated accounts.

Firestore rules deny all direct browser reads and writes. Only the server's managed identity accesses the database, and all records are scoped to the verified Firebase UID. Reports are split into 400 kB chunks, read and written transactionally, and checked for completeness. This supports reports exceeding Firestore's one-document limit without exposing Google tokens to the browser. Combined stored reports have a 4 MB limit.

The ZIP did not include the original production database, Google tokens, or encryption key. Bundled Emerald reports remain available after sign-in; previous saved imports and Google connections require a separate data migration or re-import/reconnection. The old SQL migrations under `drizzle/` are retained solely as a reference for that migration; they are not used by the Firebase runtime. See [the data model](docs/firestore-data.md).
