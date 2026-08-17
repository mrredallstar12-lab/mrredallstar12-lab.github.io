# Phase 2 Backend Foundation

This phase implements backend architecture foundations only. It does not redesign the public website, expose staging publicly, implement Steam integration, or build user-facing Inventory 2.0 behavior.

## Implemented Foundation

- SQLite server migration runner with `schema_migrations`.
- Repository/data-access boundaries for new OFA 2.0 code.
- Hashed opaque session-token storage.
- Server-authoritative session expiry and revocation.
- Roles, permissions, role grants, and permission checks.
- Real audit-event storage separate from fictional Archive logs.
- Account, external identity, and fictional Archive identity schema.
- Inventory definition, instance, balance, ledger, provenance, idempotency, and history schema.
- Inventory repositories for idempotent quantity and instance grants.
- Archive State scopes and append-oriented transition history.
- Content record, revision, access-rule, relationship, discovery, and annotation schema.
- Legacy localStorage import batch/item trust framework.
- SQLite backup, restore, and restore verification utilities.

## Intentionally Schema / Interface Only

- Passkeys/WebAuthn.
- Email-link recovery.
- Steam identity and entitlement.
- Full event execution/scheduling.
- Protected media upload and delivery.
- Rich content-domain behavior for cases, incidents, transmissions, facilities, people, media, and events.
- Legacy localStorage import endpoint.
- Public account UI.

## Security Decisions

- Session tokens are returned once and stored server-side only as SHA-256 digests with optional environment pepper.
- Fictional Archive identities/clearances are schema-separated from real authorization roles and permissions.
- Inventory ledger stores backend custody truth separately from fictional custody event data.
- Inventory grants require idempotency keys.
- Archive State transitions append history with cause/actor fields before updating materialized current state.
- Legacy localStorage imports are recorded as untrusted review batches, not accepted as authoritative progression.
- No owner account or magical privileged credential is seeded.

## Commands

From `backend/`:

```powershell
node src/db/run-migrations.js
node src/backup/run-backup-restore-check.js
node tests/run-tests.mjs
node tests/run-server-tests.mjs
node tests/run-phase2-tests.mjs
```

`npm test` runs all current backend tests.

## Physical Server Validation Checkpoint

Status: passed.

Validated on the actual OFA staging server:

- Windows 11 Pro x64
- Node 24.19.0
- branch: `ofa-2-phase-2-backend-foundation`
- commit: `50ae3231dd41a5778aaf0217d580370b34d274a7`
- bind: `127.0.0.1:8787`
- SQLite staging database: `C:\OFA\staging\data\ofa-staging.sqlite`

Confirmed:

- existing backend validation tests pass
- staging server skeleton tests pass
- Phase 2 foundation tests pass
- `0001_phase2_foundation.sql` successfully migrated the real staging SQLite database
- migration runner reported success
- backup/restore validation reported success and verified the restored database
- `npm run dev:server` starts and remains running
- `GET /api/v1/health` returns `ok: true`, `version: v1`, and `db: true`
- existing OFA frontend loads through `http://127.0.0.1:8787/`
- staging remains local-only
- `main` and the frozen Phase 0/1 branch remain untouched

## Backup Path Clarification

`run-backup-restore-check.js` restores each validation run into a temporary isolated restore directory. That temporary restore path exists only to prove that a copied SQLite backup can be restored and verified without overwriting the active staging database.

The temporary restore path does not replace the planned staging backup destination:

```text
E:\OFA\backups\staging
```

For staging operations, backup files should still be written to `E:\OFA\backups\staging`. Same-machine HDD backup is acceptable for this staging phase, but it is not sufficient as the eventual sole production backup strategy.
