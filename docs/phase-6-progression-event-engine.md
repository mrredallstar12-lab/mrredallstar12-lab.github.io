# Phase 6 Plan: Progression & Event Engine

Status: proposed for review. No Phase 6 implementation branch has been created and no runtime behavior has changed.

## Branch Proposal

- Proposed branch: `ofa-2-phase-6-progression-event-engine`
- Exact starting checkpoint: frozen Phase 5 SHA `1bbde2078d293229ef67939b3ff0b56dfd1c18f3`
- Creation rule: create only after this plan is approved.
- Protected branches: do not modify `main` or any frozen Phase 0-5 branch.

## Objective

Phase 6 will implement the first authoritative OFA progression engine. It will convert validated account, system, and future integration events into deterministic server-authored state changes.

The website and future Steam game remain non-authoritative clients. A client may report an action through an allowed, typed ingress contract, but it cannot choose its account identity, eligibility result, rule, consequence, target, quantity, clearance, relationship, Archive State transition, or chained event.

Phase 6 is a backend and operational phase. It is not a public redesign or a full campaign/content phase.

## Core Invariants

1. The authenticated session or service credential determines the actor. Request bodies never choose authoritative account identity.
2. Only code-registered event types can enter the engine. Database-authored definitions can react to registered types but cannot create new public ingress capabilities.
3. Rules and effects are typed declarative data. No database-defined JavaScript, SQL, templates with execution, shell commands, filesystem operations, or arbitrary method names are permitted.
4. Every eligibility decision uses a recorded definition version and a consistent server-side state snapshot.
5. Sibling rules triggered by one canonical event evaluate against the same pre-effect snapshot. Effects from one sibling cannot silently make another sibling eligible. Explicit chained events are required for that behavior.
6. Consequence order is deterministic: definition priority descending, stable event key ascending, then effect ordinal ascending.
7. A root event and all synchronous chained consequences commit atomically or not at all.
8. Idempotency applies at ingress and at each effect. Replaying a completed event cannot duplicate consequences.
9. Fictional discoveries, credentials, relationships, inventory, and Archive State can change. Real roles, permissions, sessions, identity providers, owner state, and security configuration cannot be progression effects.
10. Rejected or undiscovered secret data is never sent to ordinary clients to explain an eligibility failure.
11. The `authored_events_disabled` operational mode is the event-engine kill switch and does not disable Phase 5 emergency admin operations.
12. Important progression never depends solely on uncontrolled randomness. Phase 6 executes deterministic rules only.

## Fully Implemented In Phase 6

### Canonical event ingestion

- A code-authored registry of accepted event types, source types, authentication requirements, payload fields, size limits, and environment availability.
- An internal service method for server-validated events.
- An authenticated `/api/v1` ingress route for explicitly client-reportable event types.
- CSRF for browser-session ingress, account/operation rate limiting, and request-size limits.
- A staging-only event type and privileged trigger used by disposable validation fixtures.
- Canonical payload normalization and digesting before idempotency comparison.
- Server receipt time as authoritative ordering time. A client-reported occurrence time is provenance only unless a future event-specific validator explicitly approves its use.

### Declarative definitions

- Immutable, versioned authored-event definitions.
- Published definitions reference a registered trigger event type.
- One bounded condition AST per version and ordered typed effect rows.
- Publication-time validation of rule depth, node count, operators, referenced item/relationship keys, effect arguments, and chain limits.
- Initial definitions are migration/seed authored. Phase 6 does not implement a general web authoring system.

### Condition evaluator

Phase 6 will fully evaluate:

- discovery present or absent
- stackable inventory quantity comparisons
- held item-instance existence by item definition/state where identity matters
- fictional clearance/credential present or absent
- prior canonical event occurrence/count
- discovered canonical relationship
- Archive State field equality against an explicitly allowed state path
- current validated event payload equality against an event-registry-approved field
- `all`, `any`, and `not` compound conditions

The evaluator returns structured reason codes and a bounded explanation tree for privileged inspection. It does not return secret expected values to ordinary clients.

### Deterministic effects

The first execution set will be deliberately finite:

- grant/revoke a discovery
- grant/consume stackable inventory quantity
- grant/revoke a fictional clearance key
- reveal/revoke a canonical relationship for an account
- perform an append-oriented Archive State transition
- emit a typed chained event

Every effect writes an application record and progression history. No effect may mutate real authorization, sessions, external identities, protected secret fields, server configuration, audit records, or arbitrary tables.

### Execution and history

- Canonical event receipt and status.
- Rule evaluation records for matched and unmatched definitions.
- Effect application records with stable idempotency keys and before/after summaries.
- Append-oriented progression history connecting account, canonical event, definition version, rule result, effect, provenance, and reason.
- Root/parent event lineage for chained events.
- Completed duplicate requests return the prior result without executing again.
- Reuse of an idempotency key with a different canonical payload digest returns `409 idempotency_conflict`.

### Admin operations

- Read-only definition/version inspection.
- Read-only event, evaluation, effect, chain, and progression-history inspection.
- Player Inspector summary of recent progression events/history.
- Privileged dry-run simulation against an anonymous, generic authenticated, or selected-player snapshot.
- A narrow staging-only typed event trigger for physical validation.
- Audit records for privileged reads, simulation, and staging triggers.
- A small functional Control Center section for inspection and simulation, not a full authoring UI.

### Validation harness

`RunValidation` will gain Phase 6 checks using random disposable definitions and accounts. It will test positive, negative, replay, conflict, chain, rollback, authorization, dry-run, and cleanup behavior without using `noobuus` as a privilege mechanism.

## Schema / Interface Only In Phase 6

- An outbox boundary for future post-commit integrations such as Steam achievements, email, notifications, or cross-system delivery. No external delivery worker is implemented.
- Future service-source metadata suitable for a linked Steam/game service credential. No Steam credential, ticket, entitlement, or API is implemented.
- Definition lifecycle fields needed for future draft/review/publish tooling. Phase 6 definitions are still authored through controlled seed/migration code.
- Optional cohort/global event targeting beyond enough schema to avoid an account-only dead end. Rich cohort selection and scheduled global campaigns are deferred.
- Deterministic authored probability metadata may be reserved, but Phase 6 rejects execution of probabilistic definitions. A future implementation must use a recorded deterministic seed/roll and may not reroll on retry.
- Asynchronous/long-running event execution. Phase 6 processes bounded database-only effects synchronously.
- Rich player-facing progression explanations. Phase 6 stores the history and exposes only a minimal safe account summary if needed; secret rule trees remain privileged.
- Non-stackable inventory creation/consumption as event effects unless implementation review shows it fits without expanding custody/lineage semantics. Existing Phase 5 typed admin operations remain available.

## Proposed Migration

Proposed migration: `backend/migrations-server/0005_phase6_progression_event_engine.sql`.

### Definition tables

`authored_event_versions`

- immutable version ID
- parent `authored_events` ID
- integer version
- registered trigger event type
- status: draft, published, retired
- priority
- condition AST JSON
- schema version
- definition checksum
- player-safe label/summary where explicitly authored
- author/publisher identity and timestamps
- unique `(authored_event_id, version)`

`authored_event_version_effects`

- definition version ID
- stable effect key
- effect ordinal
- typed effect name
- effect JSON
- unique version/effect key and version/ordinal

Published versions are immutable. SQLite triggers should reject update/delete of published versions. Retirement creates or selects another version rather than rewriting historical truth.

The Phase 2 placeholder tables `event_eligibility_rules` and `event_effect_definitions` remain intact for compatibility but are not read by the Phase 6 engine. The implementation documentation will mark them superseded rather than destructively migrating unknown future data.

### Canonical execution tables

`progression_events`

- immutable event ID
- event type and schema version
- account ID when account-scoped
- source type and stable source subject
- required idempotency key
- canonical payload JSON and digest
- provenance JSON
- request/trace ID
- authoritative received time and untrusted/reconciled occurred time
- status: processing, completed, no_match, failed
- root event ID, parent event ID, chain depth
- completion/failure code and timestamps
- unique `(source_type, source_subject, idempotency_key)`

`progression_rule_evaluations`

- event ID and immutable definition version ID
- matched flag/status
- bounded reason/explanation JSON
- state-snapshot digest
- evaluated timestamp
- unique `(event_id, definition_version_id)`

`progression_effect_applications`

- event/evaluation/effect-definition references
- derived idempotency key
- effect type, target type/key
- status: applied, no_change, failed
- non-secret before/after summary JSON
- provenance JSON and timestamp
- unique derived idempotency key

`progression_history`

- account/scope
- canonical event, definition version, and effect application references
- change type and subject key
- reason/provenance JSON
- player visibility classification
- timestamp

`account_relationship_discoveries`

- account ID and canonical `entity_relationships` ID
- status/provenance/discovered/revoked timestamps
- unique account/relationship

This keeps canonical relationships, account-known canonical relationships, and player-authored speculative `account_relationships` separate.

`progression_outbox`

- schema/interface-only record of a future post-commit integration message
- no Phase 6 dispatcher

### Indexes and constraints

- Event idempotency, account/time, type/time, root/parent lineage, and status indexes.
- Evaluation and history indexes by account/event/definition.
- Foreign keys for all internal references.
- JSON remains adapter-contained and validated before storage; application logic must not depend on SQLite JSON functions.

## Event Registry And Canonical Model

Each code-registered event type declares:

- stable event type and schema version
- allowed source types: server, browser session, future scoped service, chained, or staging admin
- authentication requirement
- environment availability
- exact payload field schema and canonicalization
- maximum payload size and string/array bounds
- whether duplicate completion may return a player-safe summary
- optional server-side validator for claims that must be checked against current authoritative data

Unknown fields are rejected rather than silently becoming rule inputs. Payloads containing credentials, tokens, email addresses, arbitrary HTML, or unbounded text are rejected. Canonical event provenance may include internal account/session identity, request ID, source adapter, sanitized client build label, and a digest of sensitive network metadata when justified; it never stores reusable auth secrets.

Initial public production registration should be conservative. A Phase 6 staging event will prove the engine. Meaningful website actions should preferably be emitted internally after the server successfully performs the action, such as returning an authorized record, rather than trusting a second client claim that the action occurred.

Future Steam/game ingress will use a separate source adapter and scoped revocable service/player proof. It will resolve a linked account server-side and submit the same canonical internal event shape. It will not receive a privileged generic grant endpoint.

## Rule DSL Version 1

Illustrative structure:

```json
{
  "version": 1,
  "all": [
    { "discovery": { "key": "signal.001.catalogued", "present": true } },
    { "inventory_quantity": { "itemKey": "static_receipt", "op": "gte", "value": 1 } },
    {
      "any": [
        { "fictional_clearance": { "key": "transmission_desk", "present": true } },
        { "prior_event_count": { "eventType": "archive.signal.reviewed", "op": "gte", "value": 3 } }
      ]
    }
  ]
}
```

Structural limits proposed for Phase 6:

- maximum condition depth: 8
- maximum total nodes: 64
- maximum children per boolean node: 32
- fixed comparison operators per leaf type
- no regular expressions, dynamic paths, arithmetic expressions, scripting, or user-authored query language
- Archive State and payload paths must be explicitly allowlisted by the event/state registry

Malformed or oversized published definitions are rejected before activation. Runtime fail-closed behavior records an internal definition error and applies no effects.

## Deterministic Execution

1. Authenticate the source and derive account/service identity.
2. Check the event kill switch, source permission, rate limit, request size, and CSRF where applicable.
3. Validate and canonicalize the registered event payload.
4. Compute its payload digest and resolve the source-scoped idempotency key.
5. Return the prior completed result for an identical duplicate; return `409` for a key reused with a different digest.
6. Begin an authoritative transaction and recheck idempotency under the write lock.
7. Insert the canonical event.
8. Load published immutable definition versions for the event type in deterministic order.
9. Capture one eligibility snapshot for that event occurrence.
10. Evaluate all sibling definitions against that snapshot and record explanations.
11. Validate and apply effects for matched definitions in deterministic order.
12. Queue chained events breadth-first. Each chained event receives a derived idempotency key and sees state committed earlier in the same root transaction.
13. Stop and roll back on any effect failure, chain-cycle violation, or execution bound violation.
14. Mark the root and children completed/no-match and commit once.

No random selection occurs in Phase 6. No network call or external integration occurs inside the transaction.

## Chaining Bounds

Proposed hard defaults, externalized only downward for tests:

- maximum chain depth: 4
- maximum canonical events per root: 32
- maximum applied effects per root: 128
- maximum matching definitions per event: 32
- no repeated event type within one direct ancestry path in Phase 6

Exceeding a bound fails the entire root transaction with a stable internal code. Dry-run reports the same failure without mutation. Limits cannot be increased by a client or authored definition.

## Transaction And Failure Semantics

The current SQLite adapter transaction callback is synchronous and existing repositories often expose asynchronous methods. Phase 6 requires a real adapter-level unit of work so unrelated requests cannot accidentally execute inside another request's transaction.

The implementation should add a portable `withTransaction`/transaction-context boundary and a SQLite write coordinator using `BEGIN IMMEDIATE`, bounded busy handling, and transaction-scoped repository access. All new progression reads/writes and effects use that boundary. Existing Phase 1-5 repository APIs remain behaviorally compatible; any adapter changes require the full regression suite and explicit concurrency tests.

Failure classes:

- Input/auth/CSRF/rate-limit failure: no canonical progression event or consequence.
- No matching rule: canonical event and unmatched evaluations commit with `no_match`.
- Deterministic definition/effect failure: all canonical event/evaluation/effect/progression mutations roll back; a separate non-secret failure/audit receipt may be recorded only after confirmed rollback.
- Process crash before commit: SQLite rolls back; retry with the same idempotency key is safe.
- Duplicate after commit: prior result returned, no reevaluation.
- Unknown commit outcome: query by source/idempotency key before any retry.

Progression history is not a substitute for real security/admin audit. Privileged simulations/triggers also write `audit_events`; ordinary gameplay events use canonical progression provenance without flooding the privileged security log.

## Concurrency

Initial SQLite staging uses one serialized progression write coordinator. This favors correctness over throughput and is appropriate for the current server. Reads may occur concurrently when SQLite permits, but no second writer may interleave with a progression transaction.

Tests will cover:

- simultaneous identical idempotency keys
- same key with conflicting payloads
- multiple valid events for one account
- events for different accounts
- inventory consumption races near zero
- Archive State transitions targeting the same scope
- chain execution under concurrent ingress

Unique constraints remain the final replay guard. A future PostgreSQL adapter can use transaction isolation, row/advisory locks keyed by account/scope, and the same repository/service contracts without changing rule or effect semantics.

## Proposed API Boundaries

Ordinary authenticated API:

- `POST /api/v1/progression/events`
  - only code-registered client-reportable types
  - authenticated actor derived from opaque session
  - `Idempotency-Key` header required
  - CSRF required for browser sessions
  - no account ID, rule, effect, grant, target, or quantity accepted from the client
- `GET /api/v1/me/progression/history`
  - optional minimal player-safe applied-history view
  - never exposes unmatched secret rules, hidden canonical relationships, protected effect arguments, internal IDs, or real authorization

Privileged API:

- `GET /api/v1/admin/progression/definitions`
- `GET /api/v1/admin/progression/definitions/:eventKey/versions/:version`
- `GET /api/v1/admin/progression/events?username=&cursor=&status=`
- `GET /api/v1/admin/progression/events/:eventId`
- `POST /api/v1/admin/progression/simulate`
- `POST /api/v1/admin/staging/progression/trigger`

Admin boundaries:

- Add granular real permissions for definition inspection, player progression inspection, and simulation/trigger.
- Full player-specific inspection and simulation remain owner/system_admin only in Phase 6.
- Developer-readonly may inspect non-player-specific definition diagnostics but not selected-player state.
- Simulation requires admin authorization, CSRF, operation rate limiting, active elevation, and exact confirmation. It mutates no progression state but writes a privileged audit event.
- Staging trigger is development/staging/test only, elevated, CSRF-protected, audited, allowlisted, and unavailable in production.
- Ordinary `/api/v1/me` remains unchanged and continues hiding roles, permissions, elevation, internal IDs, and owner status.

## Dry-Run Simulation

Simulation invokes the same registry, snapshot builder, condition evaluator, deterministic ordering, effect planner, and chain-bound checks as execution. The effect executor is replaced by a no-write planner.

It returns:

- simulated event type and definition versions
- snapshot timestamp/digest
- matched/unmatched result and bounded reason codes
- ordered planned effects with non-secret before/after summaries
- planned chain and any bound/cycle error
- an explicit `committed: false`

It does not reserve idempotency keys, create canonical progression history, mutate inventory/discoveries/clearance/relationships/Archive State, or call external systems. The privileged simulation audit event is the only write.

## Security And Abuse Boundaries

- Event type and payload schema are code allowlists.
- Clients cannot submit consequences or authoritative target identity.
- Client-reported time cannot backdate cooldowns or reorder progression.
- Idempotency keys are source-scoped, length-limited, and payload-bound.
- Request/event/rule/effect/chain sizes are bounded before expensive evaluation.
- Browser mutations require authenticated opaque session, SameSite cookie policy, and session-bound CSRF.
- Future service/game sources require scoped, revocable, auditable credentials; shared permanent master secrets are not accepted.
- Real role/permission/session/account-security tables are absent from the effect registry.
- Fictional clearance never satisfies real permission middleware.
- Dry-run and admin inspection cannot be reached through username, fictional designation, clearance, or client headers.
- Secret rule details and undiscovered effects are omitted from ordinary responses.
- Definitions cannot access arbitrary JSON paths, tables, files, network services, environment variables, or secrets.
- Repeated rejected ingress is rate-limited and logged without storing attacker-controlled unbounded payloads.
- `authored_events_disabled` rejects new engine execution with `503` while preserving admin recovery access.

Abuse cases explicitly tested include replay, conflicting replay, forged account ID, forged source type, unknown event type, oversized/deep rules, forged clearance, client-supplied owner headers, negative/overflow quantities, inventory double-consumption, chain cycle/explosion, simulation without elevation, staging trigger in production, and secret leakage in ordinary/history responses.

## Phase 5 Compatibility

Phase 5 remains the behavioral baseline.

- Control Center authentication, elevation, CSRF, rate limits, hidden owner behavior, typed admin operations, emergency modes, and audit semantics remain intact.
- No username-based privilege is introduced.
- Existing Phase 5 direct admin grant/revoke operations remain explicit operator tools and do not masquerade as progression events.
- The existing `authored_events_disabled` mode gains real engine behavior; this is the expected documented Phase 5-to-6 integration change.
- Any SQLite adapter transaction changes and any Player Inspector additions require all Phase 1-5 regression tests.
- Existing staging discovery buttons remain narrow test tools until explicitly retired in a later phase.

## Implementation Stages

1. Create the approved branch from the exact frozen Phase 5 SHA and copy this approved plan into `docs/phase-6-progression-event-engine.md`.
2. Add the transaction/unit-of-work adapter contract and concurrency regression tests without changing public behavior.
3. Add migration `0005`, repository boundaries, immutable definition validation, event registry, and schema tests.
4. Implement snapshot building and the bounded condition evaluator with unit tests for every leaf and compound operator.
5. Implement deterministic effect planning/execution, progression history, idempotency, rollback, and bounded chaining.
6. Add ordinary ingress with a conservative registry and wire the event kill switch.
7. Add privileged inspection, simulation, staging trigger, permissions, auditing, and the functional Control Center section.
8. Expand disposable staging fixtures, cleanup, and `RunValidation`.
9. Run all Phase 1-6 tests, migration/backup-restore checks, local concurrency tests, and static-site regression checks.
10. Deploy only to local-only physical staging for validation and record a closure checkpoint after acceptance passes.

## Test Strategy

Unit tests:

- Event canonicalization and payload digests.
- Rule schema validation and all condition leaves/operators.
- Depth/node/array/string limits.
- Stable reason trees and deterministic order.
- Effect schema validation and forbidden effect types.
- Chain cycle and execution bounds.

Repository/integration tests:

- Migration from the real Phase 5 schema.
- Published definition immutability.
- Idempotent duplicate and conflicting replay.
- Matched, unmatched, and no-change effects.
- Discovery, inventory, clearance, relationship, and Archive State history/provenance.
- All-or-nothing rollback after a later effect fails.
- Same-event sibling snapshot behavior and chained-event updated-state behavior.
- Concurrent duplicates and inventory/state races.
- Failed execution leaves no partial progression mutation.

API/security tests:

- Authentication, CSRF, rate limits, source allowlists, kill switch, and request limits.
- No client-selected account/effect/quantity.
- Ordinary user, fictional-clearance-only user, and spoofed headers cannot use admin endpoints.
- Staging trigger unavailable in production.
- Simulation requires real permission/elevation and makes no progression changes.
- Ordinary history omits hidden rule/canonical/internal data.
- `/api/v1/me` owner-hiding contract remains unchanged.

Regression tests:

- Every existing backend/server Phase 1-5 suite.
- Existing static OFA and Archive surfaces.
- Phase 5 Control Center, emergency modes, audit, CSRF, and staging harness behavior.
- Backup/restore verification with migration `0005` present.

## Physical Staging Validation

After implementation approval and completion:

1. Pull the Phase 6 branch only; do not merge `main`.
2. Back up the staging SQLite database before migration.
3. Run migration `0005` and verify five migration versions.
4. Run all automated tests and backup/restore validation.
5. Start through the DPAPI-protected launcher on `127.0.0.1:8787`.
6. Confirm health and the existing static OFA site.
7. Run the expanded `RunValidation` from a second PowerShell session.
8. Confirm disposable positive rule execution and provenance.
9. Confirm an unmet compound prerequisite records no-match and no effects.
10. Confirm identical replay returns the prior result and does not duplicate inventory/history.
11. Confirm conflicting replay returns `409`.
12. Confirm a bounded chain applies exactly once in deterministic order.
13. Confirm a forced fixture failure rolls back all progression consequences.
14. Confirm dry-run predicts the same plan but changes no progression state.
15. Confirm event kill switch blocks execution and restores to its exact prior state.
16. Confirm ordinary `/me`, hidden owner behavior, and real-vs-fictional authorization separation.
17. Confirm the validator removes fixture definitions, events, histories, effects, relationships, inventory, accounts, audit rows, and rate-limit buckets and restores operational modes even after a failed check.
18. Perform one manual Control Center inspection/simulation UX check. Destructive real-account testing is not required.

Production-only behavior remains deferred until production exists. Staging does not claim to validate Steam or production integrations.

## Validation Fixture Cleanup

The Phase 6 fixture manager must track every created account, definition/version, event, evaluation, effect, history, relationship discovery, inventory definition/ledger row, Archive State scope/history row, session, elevation, audit request prefix, and rate-limit bucket.

Cleanup rules:

- Random namespaced fixture keys only.
- Never target `noobuus` or any pre-existing account/content key.
- Snapshot operational modes and any touched pre-existing state before mutation.
- Restore snapshots in `finally`, then delete fixtures in foreign-key-safe order.
- On cleanup failure, exit nonzero and print only fixture IDs/keys needed for remediation, never secrets.
- Regression tests verify no fixture-prefixed rows remain after success and after an injected mid-run failure.
- Global session revocation and other non-reversible operations remain excluded from automation.

## Rollback

- Migration `0005` is additive; no Phase 5 table or data is deleted.
- Deploy initially with `authored_events_disabled` enabled until migration, seed, tests, and dry-run pass.
- Emergency rollback first enables `authored_events_disabled`, preventing new event execution while leaving Phase 5 admin recovery available.
- Stop the Phase 6 server and restart the known-good Phase 5 application commit if needed. New additive tables remain unused by Phase 5.
- Restore the pre-migration SQLite backup only if the database itself is damaged or an explicitly approved data rollback is required; do not casually discard valid account activity.
- Because a root execution is atomic, no manual partial-effect rollback should be needed for a failed transaction. Correcting an already committed authored consequence requires a new explicit compensating event/admin operation with provenance, not history deletion.
- Preserve logs, progression history, and security audit evidence during incident response.

## Explicitly Out Of Scope

- Steamworks API integration, Steam authentication/tickets, achievements, inventory synchronization, entitlements, or game synchronization.
- Production deployment, public exposure, reverse proxy/TLS, or production-only security validation.
- Large-scale legacy content or localStorage progression migration.
- Full puzzle campaigns, hard ARG chains, narrative campaign authoring, or bulk event content.
- Uncontrolled random rewards or progression required purely by RNG.
- Economy, currency, marketplace, trading, crafting economy, or monetization systems.
- Full event scheduler, distributed queue, cross-server worker fleet, or external integration dispatcher.
- General event/rule/effect web authoring and publishing workflow.
- Arbitrary admin grants, SQL console, scripting console, command execution, or filesystem access.
- Passwords, production email provider, complete WebAuthn/passkeys, social/community features, or public profiles.
- Public OFA 2.0 redesign, final Inventory 2.0 player UI, unrelated page redesign, or Steam/game UI.
- Full canonical relationship editor or broad content-management system.
- Rewriting the Worker-style request-handler core or abandoning SQLite/repository portability.

## Acceptance Criteria

Phase 6 may close only when:

- The branch started exactly from frozen Phase 5 SHA `1bbde2078d293229ef67939b3ff0b56dfd1c18f3` and prior branches remain untouched.
- Migration `0005` applies cleanly to a Phase 5 database and backup/restore verification succeeds.
- Canonical event identity, source, payload digest, idempotency, lineage, and provenance are persisted without reusable secrets.
- Declarative rule publication rejects unknown, executable, oversized, or invalid structures.
- All approved prerequisite types and compound boolean conditions are evaluated server-side with deterministic explanations.
- Matched effects apply in deterministic order and unmatched rules make no progression change.
- Replays do not duplicate consequences; conflicting idempotency reuse is rejected.
- Root event chains are atomic, bounded, cycle-protected, and rollback completely on failure.
- Progression history explains every committed state change and remains distinct from privileged security audit.
- Concurrent duplicate/racing requests cannot double-grant or drive inventory below zero.
- Clients cannot select authoritative identity or directly grant discoveries, inventory, fictional clearance, relationships, Archive State, roles, or permissions.
- Fictional progression never grants real authorization or reveals hidden owner status.
- Admin inspection/simulation is hidden-role authorized, CSRF/rate-limit/elevation protected as designed, audited, and unavailable to ordinary users.
- Dry-run uses the production evaluator/planner and makes no progression mutation.
- `authored_events_disabled` reliably stops new engine execution without disabling Phase 5 recovery controls.
- Expanded `RunValidation` passes on the physical Windows staging server and proves cleanup.
- Existing Phase 1-5 tests, static OFA behavior, Archive filtering, account security, and Control Center behavior continue to pass.
- Production-only and Steam behavior remain explicitly deferred and unclaimed.

## Approval Decisions Requested

The plan recommends these defaults for approval:

1. Implement the six bounded effect types listed above; defer non-stackable instance effects and external outbox delivery.
2. Evaluate all sibling rules from one pre-effect snapshot; use explicit chained events when one consequence should unlock another rule.
3. Use synchronous atomic chains with depth 4, 32 events, and 128 effects per root.
4. Require elevation for privileged dry-run simulation because it can reveal canonical rule logic and selected-player operational state.
5. Keep initial meaningful production event registration conservative; prove the engine with staging fixtures and server-internal events rather than trusting broad client-reported gameplay claims.
6. Treat `authored_events_disabled` as the rollout/rollback kill switch and deploy Phase 6 to staging initially disabled.

No implementation should begin until these decisions and the overall plan are approved.
