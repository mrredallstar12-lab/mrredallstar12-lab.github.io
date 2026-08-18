# Phase 3 Accounts And Persistent Identity

Phase 3 turns the Phase 2 account/session foundations into the first usable authenticated OFA player-state system. This is still local/staging infrastructure. It is not the public OFA 2.0 redesign, Steam integration, public production deployment, or a social/profile system.

## Implemented

- Account registration with opaque internal account IDs.
- Globally unique usernames with display casing preserved.
- Case-insensitive username uniqueness using trimmed/lowercase normalized usernames.
- Reserved username rejection.
- Private recoverable email storage using field encryption with an external key.
- Email lookup using digests so ordinary queries do not require plaintext email storage.
- Local/staging-only email-link sign-in.
- Email-link tokens are random, short-lived, single-use, purpose-bound, and stored only as digests.
- Fresh opaque session establishment after successful authentication.
- Session tokens are stored only as digests.
- Session expiry and revocation are server-authoritative.
- `HttpOnly` session cookie handling.
- CSRF token generation and server-side CSRF validation for authenticated mutations.
- `/api/v1/me/...` private-resource routes deriving account ownership from the authenticated session.
- Separate fictional Archive identity per account.
- Persistent discoveries/private state foundation.
- Authenticated Inventory 2.0 proof with account-bound item grant, ledger provenance, idempotency, and private inventory reads.
- Staging-only account test page at `/staging/account-test.html`.
- Explicit owner bootstrap CLI gated by environment variables and audited.
- Configurable storage roots for database, media, uploads, runtime, logs, and backups.
- Copy-and-verify SQLite storage migration helper that never deletes source data.

## Still Schema / Interface Only

- Real email provider delivery.
- Full WebAuthn/passkey ceremony.
- Steam account linking and entitlement.
- Steam inventory/market synchronization.
- Public profiles/social features.
- Full Inventory 2.0 inspection UI.
- Full OFA 2.0 visual redesign.
- Game integration.
- Full authored-event execution.
- Generic legacy localStorage import endpoint.

## API Routes

Implemented for local/staging:

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/email/start`
- `POST /api/v1/auth/email/complete`
- `POST /api/v1/auth/logout`
- `GET /api/v1/me`
- `GET /api/v1/me/discoveries`
- `POST /api/v1/me/discoveries`
- `GET /api/v1/me/inventory`
- `POST /api/v1/staging/grant-test-item`

Existing:

- `GET /api/v1/health`

Private resources use `/me` semantics. They do not accept client-supplied internal account IDs.

## Username Rules

- Display casing is preserved.
- Uniqueness uses trimmed/lowercase normalized form.
- Length: 3-24 characters.
- Allowed characters: letters, numbers, underscore, hyphen.
- Reserved names are rejected, including `admin`, `owner`, `root`, `system`, `support`, `archive`, and `ofa`.
- Username history/cooldown storage exists for later rename support.

## Credential Protection

Email-link tokens:

- generated from cryptographically secure random bytes
- stored only as purpose-bound digests
- expire quickly
- are single-use
- cannot be replayed after consumption
- can be explicitly revoked at the repository layer

Session tokens:

- generated from cryptographically secure random bytes
- stored only as digests
- expire server-side
- can be revoked individually
- support future logout-all behavior

Plaintext auth secrets are not written to audit logs. The one Phase 3 exception is the explicitly staging-only local email-link credential log used for manual testing. That log event is gated by environment and must remain disabled outside local/staging development.

## Sensitive Identity Data

Email addresses are not public identity. They are not returned by ordinary account APIs and are not used in fictional Archive identity.

Phase 3 stores recoverable email data encrypted with AES-256-GCM using a key supplied outside the repository/database:

- `OFA_FIELD_ENCRYPTION_KEY_B64`
- `OFA_FIELD_ENCRYPTION_KEY_ID`

Email lookup uses a digest keyed by:

- `OFA_IDENTITY_PEPPER`

These secrets must be environment-managed and must not be committed.

## Owner Bootstrap

Owner bootstrap is CLI-only:

```powershell
$env:OFA_OWNER_BOOTSTRAP_ENABLED="true"
$env:OFA_OWNER_BOOTSTRAP_CONFIRM="BOOTSTRAP_OWNER"
node src/admin/bootstrap-owner.js --username=<existing-username>
```

Rules:

- operates on an explicitly selected existing account
- never depends on registration order
- does not seed a creator account
- does not create default credentials
- refuses if an active owner already exists
- writes audit events for refused and successful attempts
- real owner/admin authorization remains separate from fictional Archive identity or clearance

## Relocatable Storage

Configurable roots:

- `OFA_STORAGE_ROOT`
- `OFA_MEDIA_ROOT`
- `OFA_UPLOAD_ROOT`
- `OFA_RUNTIME_ROOT`
- `OFA_LOG_ROOT`
- `OFA_BACKUP_ROOT`
- `OFA_SQLITE_PATH`

The current staging paths on `C:` and `E:` are deployment configuration, not application logic. Future migration to another drive should be possible by stopping OFA, copying/verifying data, changing configuration, and restarting.

Storage copy validation:

```powershell
$env:OFA_STORAGE_MIGRATION_SOURCE="C:\OFA\staging\data\ofa-staging.sqlite"
$env:OFA_STORAGE_MIGRATION_DESTINATION="D:\OFA\staging\data\ofa-staging.sqlite"
$env:OFA_STORAGE_MIGRATION_CONFIRM="COPY_ONLY"
node src/storage/run-storage-copy-check.js
```

The helper copies only, verifies SQLite integrity, refuses likely live SQLite migration files, and never deletes source data.

## Physical Server Validation

From `C:\OFA\staging\repo\backend`:

```powershell
git fetch origin
git switch ofa-2-phase-3-accounts-identity
git pull --ff-only
node src/db/run-migrations.js
node tests/run-tests.mjs
node tests/run-server-tests.mjs
node tests/run-phase2-tests.mjs
node tests/run-phase3-tests.mjs
node src/backup/run-backup-restore-check.js
npm run dev:server
```

Manual account-flow validation:

1. Open `http://127.0.0.1:8787/staging/account-test.html`.
2. Register a username and email.
3. Start email-link sign-in.
4. Copy the `local_staging_email_link` token from the local server log.
5. Complete sign-in with that token.
6. Verify `GET /api/v1/me`.
7. Add a discovery.
8. Grant the staging test item.
9. Verify inventory.
10. Logout.
11. Verify `/me` no longer authenticates.

Staging remains local-only.

