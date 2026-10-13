# Firestore data model

All application collections are beneath `dashboardUsers/{ownerKey}`, where `ownerKey` is the base64url encoding of the verified Firebase UID. No browser-selected owner ID or ChatGPT header is trusted.

| Path under an owner | Purpose |
| --- | --- |
| `reports/{propertyId}_{month}` | Uploaded report metadata, revision, chunk count, checksum |
| `googleReports/{propertyId}_{month}` | GA4 report metadata and mapping signature |
| Either report's `chunks/{number}` | UTF-8 JSON bytes split into at most ten 400 kB documents |
| `private/googleConnection` | OAuth client settings, encrypted credentials, configuration, revision |
| `private/googleOAuth` | One pending OAuth attempt, hashed state, encrypted verifier, expiry |
| `private/googleSync` | A sync lease with unique token and expiry |

Writes and reads of report metadata/chunks are transactional. Shrinking a report deletes unused chunks. Revisions reject stale uploads. Mapping and credential changes invalidate an in-flight GA4 sync. OAuth state is consumed exactly once, for its initiating owner, before expiry. Sync leases are only released by their owning token. Expiry is checked in application transactions; background TTL deletion is not relied on.

`firestore.indexes.json` disables indexing for report chunk bytes. Firestore rules deny browser access throughout the database. The Admin SDK bypasses those rules through IAM, so the server validates every request's Firebase session and approved email before selecting its owner subtree.

Collections are created on the first authenticated write. Retained SQL files describe the old D1 schema only. Production database contents were not supplied with the source ZIP and have not been migrated.
