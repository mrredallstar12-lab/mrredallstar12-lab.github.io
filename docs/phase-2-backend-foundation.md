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

