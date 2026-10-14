# Supabase database model

The migration is `supabase/migrations/202610140001_dashboard.sql`. Apply it once to the intended project through the Supabase SQL Editor or an authenticated migration workflow.

All application tables are under the unexposed `dashboard_private` schema:

| Table | Purpose |
| --- | --- |
| `approved_emails` | Approved, lowercase verified email addresses |
| `reports` | One JSONB report per owner, kind, property, and month; revision and configuration hash |
| `connections` | Owner's encrypted Google credentials, mapping configuration, and connection revision |
| `oauth_states` | Hashed OAuth state, encrypted verifier, ten-minute expiration |
| `sync_locks` | Token-bound, ten-minute lease preventing overlapping syncs |

RLS is enabled on all tables, with no direct grants or permissive policies for `anon` or `authenticated`. Access goes through `public.dashboard_operation(action, payload)`, a security-definer function with an empty search path, an explicit operation whitelist, and execution permission for authenticated users only.

The function derives ownership from `auth.uid()`. It verifies the current email against `approved_emails`, confirmed account status, absence of a ban/deletion, and the JWT's active session in `auth.sessions`. Caller-supplied owner fields are ignored. Every table query and mutation is constrained to that owner. Each operation takes a transaction-level advisory lock for that account.

CSV merging happens in the server. The write then rechecks the expected stored revision inside the transaction, so a concurrent edit cannot silently overwrite newer data. Reports are stored atomically as JSONB; the server allows 3.5 MB serialized reports, with a 4 MB SQL limit allowing for JSONB text formatting. No Firestore-style chunking is needed.

OAuth state consumption deletes and returns a matching, unexpired state once. Credential changes invalidate prior state/revisions. Sync results are written only when the connection revision and lease token still match, and sync releases only its own lease. Google imports are separate from user-uploaded CSV records.

Auth user deletion cascades to that user's application records. Removing an email from the database allowlist blocks subsequent RPC calls. Logging out removes the Auth session, so its old access token cannot use the database function even before JWT expiration.

The application needs only a public project URL/key and the user's session. It never needs a service-role key, database password, or unrestricted administrative client.
