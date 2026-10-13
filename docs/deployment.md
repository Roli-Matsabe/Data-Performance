# Deploy outside ChatGPT with Firebase

The source is in `Roli-Matsabe/Data-Performance`. This version is a standalone Next.js application using Firebase Authentication and Firestore. Creating a database or pushing to GitHub does not connect or deploy the application by itself.

## Required project details

The configured Firebase project is `website-analytics-dashbo-15be5`, using database `(default)`. Confirm the database region and the email addresses permitted to sign in. The Web app configuration and deployment access are still required. Existing cloud-workspace credentials could not authenticate to Firebase during preparation.

## 1. Prepare Firebase services

1. Select the intended company project in Firebase Console. Confirm Firestore is a **Standard, native-mode** database.
2. Open **Authentication → Sign-in method** and enable **Google**, choosing the appropriate support email.
3. In **Project settings → General**, register a Web app if none exists. Record its `apiKey`, `authDomain`, and `projectId`. Registering an app does not grant database access.
4. Use Firebase **App Hosting** for this full-stack Next.js application. App Hosting requires a billing-enabled Blaze project. The included configuration sets a zero minimum and a two-instance maximum; the maximum is not a spending cap. Configure billing alerts as appropriate.
5. Connect the Firebase App Hosting GitHub integration to this repository. Create a backend with repository root `/`, branch `main`, and a supported region near the database. Do not replace another application's backend or database.

## 2. Configure the backend

Use the backend's environment configuration and Secret Manager bindings. The checked-in `apphosting.yaml` contains the non-project-specific runtime defaults. If your setup uses YAML for project-specific configuration, add the non-secret values there and a Secret Manager reference for the encryption key before rollout.

| Variable | Value |
| --- | --- |
| `FIREBASE_PROJECT_ID` | The actual Firebase project ID |
| `FIRESTORE_DATABASE_ID` | `(default)` or the existing database ID |
| `FIREBASE_WEB_API_KEY` | The Web app's public Firebase API key |
| `FIREBASE_AUTH_DOMAIN` | The Web app's auth domain, normally `PROJECT_ID.firebaseapp.com` |
| `SITE_ORIGIN` | The deployed HTTPS origin, without a path or trailing slash |
| `ACCESS_POLICY` | `allowlist` by default |
| `ALLOWED_EMAILS` | Comma-separated, approved email addresses |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | A secret containing a cryptographically random, base64/base64url-encoded 32-byte key |

The encryption key is required for connecting Google Analytics, not for basic CSV reporting. Preserve it once Google credentials are saved. Changing it makes those credentials unreadable. Generate and store it through a secure administrative workflow; never paste private keys or tokens into GitHub or chat.

Firebase App Hosting provides the runtime's service identity. Give that specific service account the **Cloud Datastore User** role on the target project, and permission to access only the required Secret Manager secret. Do not upload a service-account JSON key to the repository. Locally, Firebase Admin uses standard Application Default Credentials; a Firebase CLI browser login and application-default authentication are separate credentials.

Do not set emulator environment variables in production.

## 3. Apply Firestore rules and indexes

The repository's `firestore.rules` denies all direct client access. Server access uses IAM, so backend session and owner checks still apply. Review the rules against any other application sharing this database before deployment; these rules would also deny its direct client access. A dedicated database is appropriate if another app requires different rules.

For a dedicated default database, from an authenticated administrative machine:

```sh
npm exec -- firebase login
npm exec -- firebase use website-analytics-dashbo-15be5
npm exec -- firebase deploy --only firestore:rules,firestore:indexes --project website-analytics-dashbo-15be5
```

`firebase.json` targets the default database. For a named database, add its explicit `database` entry to the Firestore configuration before applying rules/indexes, and set `FIRESTORE_DATABASE_ID` to the same value. The application creates owner-scoped documents on first use; no SQL migrations run.

## 4. Roll out and enable sign-in

1. Start the App Hosting rollout from the selected GitHub commit.
2. Set `SITE_ORIGIN` to the assigned HTTPS origin and roll out updated configuration if necessary.
3. Add the deployed hostname under **Authentication → Settings → Authorized domains**. Keep the Firebase auth domain from the Web app's configuration.
4. Visit the deployed site and sign in with an approved, verified Google account.
5. Import a small CSV and confirm it remains after refresh. Sign in as a second account and confirm it cannot see the first account's saved records.

Keep the existing ChatGPT website available until the standalone deployment is verified. A GitHub commit or a successful local build is not proof that a live rollout succeeded.

## 5. Optional Google Analytics connection

Enable the Analytics Data and Analytics Admin APIs in the OAuth client's Google Cloud project. Configure the OAuth consent audience and a Web application OAuth client. Register the exact redirect URI:

```text
https://YOUR_DEPLOYED_HOST/api/google/callback
```

Enter the client ID and secret through the signed-in dashboard, authorize read-only access, map the GA4 property, and run a sync. These credentials are stored encrypted on the server. Firebase Google sign-in and GA4 authorization serve different purposes; enabling one does not grant the other.

## Original data and account ownership

The ZIP excludes live D1 records, original credentials, and the encryption key. It includes the bundled Emerald reports. Re-import CSV reports and reconnect Google to populate the new database, or arrange a separate, authorized data export/migration.

Old records used ChatGPT Site-specific user IDs; new records use Firebase UIDs. Any migration must map owners explicitly. Encrypted Google credentials also bind to the old owner ID, so reconnecting Google is generally simpler than transferring tokens.

The bundled report JSON and logos are part of the source/client assets; the login page protects dashboard requests and saved records, not the confidentiality of source already published on GitHub. Remove bundled business data in a separate change if it should no longer be distributed.
