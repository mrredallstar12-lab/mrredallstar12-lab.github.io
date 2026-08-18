# Phase 7: Player State Integration

Status: formally closed and frozen after successful physical Windows staging validation on August 18, 2026. Reopen only for an explicitly approved Phase 7 bug or security fix.

Implementation status: complete. Automated regression, migration, backup/restore, disposable fixture, physical `RunValidation`, browser integration, cleanup, and operational-mode restoration requirements have been accepted.

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

Physical automated staging checkpoint: the actual Windows staging server ran the six-migration harness successfully at implementation HEAD `1d567c8dc14dafac03fb19ab1df70fbb15a8009d`. Every automated Phase 1-7 check passed, including all seven Phase 7 checks, and privileged audit verification found 62 request-linked entries. Emergency global session revocation, privileged browser UX, and production-only behavior remained explicitly skipped. This checkpoint does not satisfy or replace the browser lifecycle validation below.

### Required Browser Checks

The browser workflow uses a persistent disposable fixture. It is available only in staging/test on a loopback host and uses the same Phase 7 fixture constructor as `RunValidation`. Setup creates one ordinary account with no real role, snapshots all operational modes, creates the Phase 7 vertical slice, and temporarily sets `player_surfaces_disabled=false` and `authored_events_disabled=false`.

Setup writes lifecycle state and a safe manifest beside the staging SQLite database. The printed/file manifest contains only the disposable username, email, review slug, expected states, and cleanup command. It never contains a session token, CSRF token, protected secret, or reusable credential.

1. Keep the staging server running through the DPAPI-protected launcher. In a second fresh PowerShell session:

   ```powershell
   cd C:\OFA\staging\repo\backend
   .\tools\windows-staging-secrets.ps1 -Action SetupBrowserValidation
   ```

2. Record the disposable username, email, review record slug, and expected states printed from the manifest. Do not register another account with these values.
3. Use a separate browser profile/private window so the disposable session cannot be confused with `noobuus`. Open `http://127.0.0.1:8787/staging/account-test.html`, start an email link for the disposable email, and complete the link using the existing local staging token shown in the server log.
4. Before review, open `http://127.0.0.1:8787/api/v1/me/state` in another tab and record the opaque `revision`. Confirm the projected Phase 7 discovery, credential, relationship, inventory receipt, and progression receipts are absent. Unknown internal fixture state must also remain absent.
5. Record a semantic snapshot of localStorage before the canonical interaction. Do not clear or import it.
6. Open `http://127.0.0.1:8787/`. Confirm the ordinary account-backed Archive identity appears with no role, OWNER, permission, internal ID, or elevation indication.
7. Open `http://127.0.0.1:8787/pages/inventory.html`. Confirm Archive Custody is visibly separate from the unchanged legacy local inventory and has no Phase 7 review receipt yet.
8. Open `http://127.0.0.1:8787/pages/cases.html`. Locate the manifest's review slug/title. Before review, its protected finding must be represented as `[REVIEW REQUIRED]` when the record detail is inspected.
9. Use the case's `review record` button exactly once. Confirm the revealed finding is `THE VALIDATION ENVELOPE REMEMBERED THE REVIEW.`
10. Reload `/api/v1/me/state`. Confirm the revision changed and the projection now contains `Validation Finding`, `Validation Review Acknowledgement`, exactly one `documents` relationship for the fixture records, one Phase 7 Review Receipt in Archive Custody, and four bounded player-safe receipts.
11. Reload home/inventory/cases and confirm the server-backed state survives navigation/reload. Repeat the same record review. Confirm `stateChanged` is false, the revision remains stable, inventory quantity remains one, the relationship remains singular, and receipts are not duplicated.
12. Compare localStorage with the pre-review snapshot. It must be byte-for-byte or semantically unchanged by the canonical bridge. Existing legacy pages, inventory, and local progression must remain intact.
13. In a separate anonymous/private context, load home, inventory, and cases. Canonical account sections must remain hidden while legacy pages remain usable. Offline/API-unavailable behavior may be checked through browser offline mode; canonical sections must disappear without damaging legacy state.
14. Always clean up, including after an interrupted or failed browser check:

   ```powershell
   cd C:\OFA\staging\repo\backend
   .\tools\windows-staging-secrets.ps1 -Action CleanupBrowserValidation
   ```

15. Run cleanup a second time to confirm it is idempotent. Verify it reports that cleanup is already complete.
16. Verify `player_surfaces_disabled=true` and `authored_events_disabled=true` through the Control Center or read-only database inspection. With those modes restored, a safe page load from an existing ordinary account such as `noobuus` may confirm disabled-surface fallback, but must not perform a review or any progression-changing action.

Cleanup removes the disposable account, sessions, challenges, account state, discoveries, fictional credentials, inventory and ledger state, progression events/history/evaluations, rate-limit buckets, fixture-linked audit rows, content, policies, protected fields, relationships, projection definitions, item definition, and authored progression definition. It restores the exact pre-setup operational-mode snapshot. Cleanup is idempotent and setup performs the same cleanup automatically after an injected or ordinary setup failure.

Do not use `noobuus` for progression-changing checks.

### Physical Browser Closure Checkpoint

The disposable browser-validation lifecycle was exercised successfully on the actual Windows staging server:

- the disposable ordinary account authenticated through the existing local staging email-link flow
- pre-review canonical projected state contained none of the authored Phase 7 consequences
- one authorized record review produced the expected player-safe discovery, fictional credential, single relationship, Inventory 2.0 custody entry, four safe receipts, protected-field reveal, and changed opaque revision
- repeated review remained idempotent and did not duplicate inventory, relationships, receipts, or other consequences
- canonical account state remained independent from legacy localStorage and local progression
- anonymous/InPrivate home, inventory, and cases retained their existing legacy behavior without exposing authenticated canonical state
- cleanup removed the disposable account, authentication/session state, progression state, content, definitions, relationships, inventory, audit/rate-limit state, and lifecycle files
- cleanup restored the exact pre-setup operational-mode snapshot
- a second cleanup invocation confirmed idempotency
- final Control Center inspection confirmed `authored_events_disabled=true` and `player_surfaces_disabled=true`

No progression-changing validation was performed on `noobuus`. The hidden OWNER role remained separate from fictional progression and ordinary player presentation. Production exposure and production-only security validation remain deferred rather than implicitly accepted from loopback staging.

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

Phase 7 acceptance criteria are complete:

- implementation and full Phase 1-7 regression suites passed
- migration `0006` and six-migration physical staging state were validated
- staging backup/restore validation was accepted
- expanded physical `RunValidation` passed, including all Phase 7 checks and fixture cleanup
- disposable physical browser integration validated the complete record-review vertical slice
- projection allowlisting, field reveal, revision behavior, replay idempotency, OWNER parity, legacy separation, and anonymous fallback were validated
- browser fixture cleanup and repeated cleanup passed
- exact operational-mode restoration was verified with both rollout switches enabled in their disabled-state posture
- physical evidence was reviewed and explicitly accepted for closure

Phase 7 is frozen at the closure checkpoint committed to `ofa-2-phase-7-player-state-integration`. Do not continue implementation on this branch and do not begin Phase 8 without separate authorization.
