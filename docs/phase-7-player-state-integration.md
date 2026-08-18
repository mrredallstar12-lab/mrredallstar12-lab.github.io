# Phase 7: Player State Integration

Status: approved for implementation. Phase 7 remains open until physical Windows staging validation is reviewed and accepted.

Implementation status: complete in the Phase 7 development branch; automated validation passes. Physical staging migration, `RunValidation`, browser checks, backup/restore verification, and explicit acceptance remain required before closure.

## Branch Record

- Branch: `ofa-2-phase-7-player-state-integration`
- Exact base: frozen Phase 6 SHA `6410bc84a0a0613da67086fc81a6bace1f4e1bde`
- Protected branches: do not modify `main` or frozen Phase 0-6 branches.

## Objective

Phase 7 implements one narrow authoritative player-facing loop:

1. An authenticated account explicitly reviews an accessible canonical Archive record.
2. The server derives the actor and resource, re-authorizes visibility, and emits a canonical event.
3. The Phase 6 engine evaluates deterministic rules and applies authoritative consequences.
4. A player-safe projection reports only explicitly authored visible state.
5. Existing home, inventory, and cases pages may render additive canonical sections without replacing legacy behavior.

The public site remains recognizable and usable when anonymous, offline, API-unconfigured, or disabled by operational mode.

## Canonical And Legacy Separation

- Canonical Inventory 2.0 state is never written to `oddInventory`.
- Local achievements, quests, room stamps, radio state, currencies, and other localStorage state are not imported.
- Legacy state is not evidence of canonical progression.
- Canonical and legacy state are not silently merged or represented as one total.
- Canonical protected state remains in memory only.
- Migration of any individual legacy system requires later explicit approval.

## Fully Implemented Scope

- Additive migration `0006_phase7_player_state_integration.sql`.
- Explicit player-safe projection definitions for discoveries and fictional credentials.
- Default-enabled `player_surfaces_disabled` operational mode.
- Authenticated `GET /api/v1/me/state` with opaque revision and ETag.
- Authenticated, CSRF-protected `POST /api/v1/archive/records/:slug/review`.
- Code-registered `archive.record.reviewed` event.
- Server-controlled review idempotency bound to account, event type, canonical record, and record revision.
- Safe bounded recent progression receipts.
- Strict staging-only allowlists for the legacy discovery mutation tester.
- Additive canonical sections on home, inventory, and cases through `js/ofa-api.js`.
- Disposable progression-changing validation fixtures; never mutate `noobuus` gameplay state.
- Expanded Control Center and `RunValidation` inspection where needed.

## Player-Safe Projection Contract

`GET /api/v1/me/state` is a purpose-built projection, not an internal table serialization.

Allowed fields:

- ordinary public account and Archive identity presentation
- explicitly projected discoveries
- explicitly projected fictional credentials
- player-visible canonical relationships
- Inventory 2.0 balances and instances using public metadata only
- bounded player-safe progression receipts
- opaque state revision

Always omitted:

- real roles, permissions, owner/admin status, or elevation
- internal account IDs
- raw or unprojected discovery/credential keys
- condition trees, hidden expected values, definitions, evaluations, and rule explanations
- privileged audit data
- secret/internal provenance
- session, credential, recovery, and security metadata

Unknown state is omitted. The revision is opaque, stable when the visible projection is unchanged, changes when visible canonical state changes, and may be used only for cache validation.

Implemented response shape:

```json
{
  "ok": true,
  "state": {
    "account": { "username": "...", "archiveIdentity": { "designation": "..." } },
    "discoveries": [{ "label": "...", "summary": "...", "publicMetadata": {}, "discoveredAt": "..." }],
    "credentials": [{ "label": "...", "summary": "...", "publicMetadata": {} }],
    "relationships": [{ "source": {}, "relationship": "...", "target": {}, "confidence": null }],
    "inventory": { "balances": [], "instances": [] },
    "recentReceipts": [{ "label": "...", "summary": "...", "occurredAt": "..." }],
    "revision": "opaque-digest"
  }
}
```

Only discovery and fictional-credential keys registered in `player_state_projection_definitions` can become projected labels. Keys themselves are not returned. Inventory uses public item metadata only. Recent receipts are limited to 12 by the server. Responses use `Cache-Control: no-store`; a matching `If-None-Match` receives `304`.

## Record Review Boundary

`POST /api/v1/archive/records/:slug/review`:

- derives the account from the opaque session
- requires CSRF and same-session cookie protections
- resolves the canonical resource by public slug
- reuses Phase 4 field/resource visibility authorization
- applies authored existence behavior to inaccessible resources
- constructs canonical event payload and idempotency identity server-side
- applies ordinary gameplay rate limits without owner elevation
- is blocked by `player_surfaces_disabled`, `player_mutations_disabled`, or `authored_events_disabled`
- returns only a safe review receipt and updated opaque state revision

Repeated review of the same canonical revision is idempotent. Repeatable future mechanics require distinct authored event semantics.

The implemented idempotency key is derived only on the server from the internal account actor, canonical record identity, and current canonical revision. The event payload contains only the server-resolved public catalog ID and revision. The response contains `catalogId`, `duplicate`, `stateChanged`, and the updated opaque `stateRevision`; it does not return rule, effect, account, or internal resource identifiers.

## Discovery Route Hardening

`POST /api/v1/me/discoveries` is not a progression API. It remains available only in development, staging, and test for exact Phase 3/4 allowlisted fixtures. It requires authentication, CSRF, rate limiting, and exact typed keys. Arbitrary type/key combinations are rejected.

`GET /api/v1/me/discoveries` must not expose internal keys as the supported player-facing contract. `/api/v1/me/state` replaces it for ordinary player surfaces.

The legacy `/api/v1/events` visitor feed remains non-authoritative and is never connected to Phase 6 progression.

## Frontend Integration

- Home: ordinary signed-in Archive identity and safe state summary.
- Inventory: a separate canonical Archive custody section; the legacy local grid remains unchanged.
- Cases: an additive API-backed canonical catalog/review section; the legacy index remains unchanged.
- New sections remain hidden when the integration is unavailable or disabled.
- The bridge uses credentials for same-origin requests, keeps CSRF in memory, and never stores canonical responses in localStorage.
- The frontend cannot select effects or directly mutate canonical state.

Phase 7 is not a public redesign or login redesign.

## Operational Modes

- `player_surfaces_disabled`: default enabled; disables Phase 7 projection surfaces and review action.
- `authored_events_disabled`: remains enabled by default; disables engine execution.
- `player_mutations_disabled`: broader emergency player-mutation block.

Validation may temporarily disable modes using disposable fixtures. Physical staging must finish with both Phase 7 rollout switches enabled, meaning surfaces/events remain disabled.

## Migration And Repository Boundaries

Migration `0006` is additive. New repositories own projection definitions, deterministic projection construction, visible relationship filtering, safe receipts, revision digesting, and review coordination. Application logic remains adapter-portable and does not introduce direct SQLite-only behavior outside the database adapter/repository boundary.

No real authored campaign or account progression is seeded by migration. Validation definitions/content/items are namespaced fixtures and removed afterward.

Migration `0006_phase7_player_state_integration.sql` creates projection definitions, adds the bounded receipt lookup index, and inserts `player_surfaces_disabled=true` with reason `phase7_default_disabled_until_physical_validation`. It does not seed player progression or alter existing accounts. The visibility repository also now treats nullable legacy policy columns as their authored defaults so older canonical rows cannot crash the new projection.

## Test Strategy

Automated tests must cover:

- migration and rollback compatibility
- allowlist projection behavior, including unknown discoveries/credentials
- stable revision and ETag behavior
- authenticated/anonymous/disabled projection responses
- record visibility and authored existence behavior
- server-derived actor, record, payload, and idempotency
- replay without duplicate consequences
- ordinary gameplay rate limits for owner and ordinary accounts
- discovery-route staging allowlists and production refusal
- no role/owner/internal/security leakage
- frontend rendering/no-op behavior and no canonical mutation capability
- legacy localStorage unchanged where practical
- deterministic projection after adapter/server restart
- fixture cleanup after success and injected failure
- all Phase 1-6 regressions

## Physical Staging Validation

1. Retain a pre-migration SQLite backup under `E:\OFA\backups\staging` and verify its hash.
2. Apply migration `0006` and verify six migration versions.
3. Run all tests and backup/restore validation.
4. Start through the DPAPI-protected launcher on `127.0.0.1:8787`.
5. Run expanded `RunValidation` using disposable accounts/content/definitions/items/events.
6. Temporarily enable the Phase 7 surface and event modes only for controlled validation.
7. Validate authenticated home identity, canonical custody, canonical cases/review, and progression-driven reveal.
8. Validate anonymous/offline/API-disabled fallback and unchanged legacy state.
9. Confirm no visible OWNER/admin indication.
10. Restore `player_surfaces_disabled=true` and `authored_events_disabled=true`.

Destructive/manual checks remain separate from safe automation. Production-only behavior is not claimed from loopback staging.

### Deployment And Backup Sequence

From `C:\OFA\staging\repo` in a fresh Windows PowerShell session:

```powershell
git fetch origin
git switch ofa-2-phase-7-player-state-integration
git pull --ff-only origin ofa-2-phase-7-player-state-integration

cd C:\OFA\staging\repo\backend
.\tools\windows-staging-secrets.ps1 -Action Verify
Copy-Item C:\OFA\staging\data\ofa-staging.sqlite E:\OFA\backups\staging\ofa-staging-pre-phase7.sqlite
Get-FileHash E:\OFA\backups\staging\ofa-staging-pre-phase7.sqlite -Algorithm SHA256
npm test
npm run migrate:server
npm run backup:server:check
.\tools\windows-staging-secrets.ps1 -Action RunServer
```

In a second fresh PowerShell session, run validation through the established DPAPI helper:

```powershell
cd C:\OFA\staging\repo\backend
.\tools\windows-staging-secrets.ps1 -Action RunValidation
```

The migration runner must report six applied migrations. The restore check must restore into a separate validation database and pass. The staging restore-check location remains temporary validation storage and does not replace `E:\OFA\backups\staging`.

### Expected RunValidation Checks

The harness must report PASS for all existing Phase 1-6 checks plus:

- `Phase 7 rollout kill switches`
- `Phase 7 player-safe projection`
- `Phase 7 review authorization boundary`
- `Phase 7 authoritative record review`
- `Phase 7 review replay and OWNER parity`
- `Phase 7 frontend bridge boundary`
- `Phase 7 rollout switches restored`

It verifies allowlist projection, omitted unknown state, stable and changing revisions, ETag behavior, staging discovery-route hardening, canonical event provenance, server-derived review identity, hidden-resource behavior, replay idempotency, safe inventory and relationship projection, OWNER gameplay parity, audit presence, and static bridge storage/mutation boundaries. Fixtures use random namespaces and disposable accounts only. Cleanup removes accounts, sessions, roles, records, policies, protected fields, relationships, projection definitions, inventory, progression state, audit rows, and rate-limit rows after success or failure, then restores the exact operational-mode snapshot.

### Required Browser Checks

Temporarily disable `player_surfaces_disabled` and `authored_events_disabled` only while using disposable validation content/accounts. Confirm:

- authenticated home shows ordinary Archive identity with no role or OWNER indication
- inventory shows a separate Archive Custody section without changing the legacy inventory grid
- cases shows the additive canonical catalog and performs the typed review
- a legitimate review reveals the authored field and updates projected discovery, credential, relationship, inventory, receipt, and revision
- replay does not duplicate consequences
- anonymous, offline, unconfigured API, and disabled-surface states leave legacy pages usable and hide the canonical sections
- browser localStorage is semantically unchanged before and after canonical loading/review
- page refresh/restart reproduces the same canonical projection from server state

Do not use `noobuus` for progression-changing checks. Restore `player_surfaces_disabled=true` and `authored_events_disabled=true` after browser validation and verify both through the Control Center or read-only database inspection.

## Rollback

- Enable `player_surfaces_disabled`, `authored_events_disabled`, and if necessary `player_mutations_disabled`.
- Stop Phase 7 and restart frozen Phase 6 code.
- Phase 6 ignores additive Phase 7 tables.
- Revert static page/script integration independently if required.
- Restore the database backup only for database damage or explicitly approved data rollback.
- Preserve security audit and progression history during incident response.

## Deferred

- Steamworks, game synchronization, game-client protocol, and service credentials
- automatic legacy localStorage migration
- public login/account redesign
- major public OFA redesign
- full campaigns and ARG chains
- economy, trading, crafting, and marketplaces
- generalized content/event authoring UI
- production exposure and production-only security validation
- broad client-authored event ingestion
- unrelated legacy-system migration

## Acceptance Criteria

Phase 7 may close only after implementation tests, full Phase 1-7 regressions, backup/restore, physical migration, expanded staging validation, browser integration checks, cleanup verification, exact mode restoration, and explicit review. It must remain open after automated implementation succeeds and must not begin Phase 8.
