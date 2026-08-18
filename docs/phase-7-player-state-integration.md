# Phase 7: Player State Integration

Status: approved for implementation. Phase 7 remains open until physical Windows staging validation is reviewed and accepted.

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
