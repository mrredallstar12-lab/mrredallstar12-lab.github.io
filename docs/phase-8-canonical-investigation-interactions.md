# Phase 8: Canonical Investigation & Interaction Foundation

Status: planning only; implementation requires explicit approval.

## Branch Record

- Planning branch: `ofa-2-phase-8-planning`
- Exact base: frozen Phase 7 SHA `f19765a1d5b9f9c4edd8bacff8eff0ec7e0580d0`
- Frozen source branch: `ofa-2-phase-7-player-state-integration`
- Protected branches: do not modify `main` or any frozen Phase 0-7 branch.
- Planning artifact: `docs/phase-8-canonical-investigation-interactions.md`

## Recommendation

Phase 8 should build the **Canonical Investigation & Interaction Foundation**.

The website and future game need a shared server-authoritative way to express meaningful player actions without letting either client declare progression. Phase 6 can evaluate deterministic consequences, and Phase 7 can project safe canonical state, but the only implemented real player command is record review. That route directly coordinates authorization, idempotency, event construction, progression, audit, and projection refresh. Repeating that endpoint-specific pattern for cases, evidence, puzzles, transmissions, artifacts, and a future game client would create inconsistent trust and replay boundaries.

Phase 8 should add a typed internal interaction service, canonical case-investigation state, deterministic answer attempts, and typed evidence pins. It should prove the architecture with one disposable case investigation. It should not build a campaign, redesign the public site, or expose a generic event-ingestion endpoint.

This is primarily a backend and staging-validation phase. A staging-only tester is appropriate; broad public UI work is not.

## Why This Comes Next

Phases 0-7 established:

- portable server runtime, SQLite migrations, repositories, backup/restore, and physical staging
- opaque account sessions, hidden real roles, CSRF, rate limits, privileged elevation, and security audit
- canonical records, field-level visibility, authored existence behavior, and filtered relationships
- Inventory 2.0 custody and append-oriented ledger foundations
- Archive State history
- deterministic authored events with provenance, idempotency, immutable sibling snapshots, bounded chains, rollback, and serialized SQLite writes
- a player-safe canonical projection with opaque revision and ETag
- one server-authorized record-review progression loop
- operational controls and disposable validation infrastructure

The remaining dependency gap is the application layer between a validated actor action and the progression engine:

- no reusable typed command boundary exists
- case rows are mostly schema-shaped; there is no account-bound investigation lifecycle
- account annotations and speculative relationships have no player API or case ownership boundary
- there is no puzzle definition, attempt, replay, or answer-secret model
- there is no evidence-board state that remains distinct from canonical truth
- adding website or game actions today would require new one-off orchestration in each route
- Steam/game source authentication cannot be designed safely around broad client-authored progression claims

An interaction service solves that dependency without pretending Steam authentication or the final player experience already exists.

## Alternatives Considered

### Broader Authenticated Archive UI

Wait. Phase 7 proved progressive enhancement and safe projection. Expanding UI before shared investigation commands exist would bind new pages to one-off endpoints and likely require another integration rewrite.

### Broader Canonical Progression Projection

Wait except for the investigation summary needed by this phase. Projecting more discoveries, credentials, or history without an authored player-facing purpose risks turning `/me/state` into a lore dump or internal-state serialization.

### Inventory Economy, Trading, Or Crafting

Wait. Inventory custody and quantity/instance foundations already support evidence prerequisites and consequences. Economy, value, trading, and crafting introduce fraud and balancing problems but are not prerequisites for investigations.

### Canonical Case/Evidence State Without An Interaction Service

Rejected. Tables alone would leave routes to repeat Phase 7's orchestration and would not establish the future website/game boundary.

### Generic Cross-Surface Event Ingestion

Rejected. A public `/events` or `/interactions` endpoint that accepts arbitrary types or payloads would weaken the Phase 6 source registry. Cross-surface compatibility should exist as an internal service with code-registered commands and trusted source adapters.

### Steam Linking Or Game Authentication

Wait. `external_identities` provides a minimal stable account linkage point, but Steam ticket verification, ownership, service credentials, account-conflict recovery, and game protocol design should use a mature interaction service. Phase 8 must not guess at unverified Steamworks APIs.

### Legacy localStorage Migration

Wait. Legacy state remains untrusted. Investigation targets and trust policies should exist before any individual local case system is proposed for deliberate import.

### Passkeys Or Production Email Delivery

Important before public account rollout, but not the immediate domain dependency for staging-only canonical gameplay. They remain separate security phases and must be completed before production exposure requires them.

### Full Content/Event Authoring UI

Wait. Phase 8 can create definitions through repositories and disposable fixtures. A generalized authoring UI needs draft validation, revision workflows, secret handling, previews, and publishing controls beyond this bounded foundation.

## Core Invariants

1. The server derives the real account from an authenticated session or a future trusted source adapter.
2. Clients submit only bounded action input. They never select events, rules, consequences, account IDs, clearances, discoveries, inventory grants, or canonical relationships.
3. The interaction service is internal. Public routes are typed adapters, not a generic command or event endpoint.
4. Real authorization roles never satisfy fictional investigation prerequisites and never bypass normal player progression.
5. Fictional credentials never grant real administration permissions.
6. Canonical Archive truth, account-discovered truth, and player-authored evidence organization remain separate.
7. Secret puzzle verifiers and hidden conditions are never projected or returned to clients.
8. Submitted answers are never stored or logged as reusable plaintext.
9. Required progression is deterministic. No required step depends on uncontrolled RNG.
10. Correct resolution, canonical event ingestion, progression effects, and investigation state commit atomically or not at all.
11. Existing localStorage case state remains independent and untrusted.
12. `noobuus` remains an ordinary player outside explicitly privileged surfaces and receives no investigation advantage from OWNER.

## Fully Implemented Phase 8 Scope

### Typed Interaction Service

Add an internal `CanonicalInteractionService` (name may follow repository conventions) that accepts only a code-registered command and a server-constructed actor/source context.

Initial commands:

- `archive.record.review` migrated internally from the Phase 7 route without changing its public API contract
- `archive.case.investigation.start`
- `archive.case.evidence.pin`
- `archive.case.evidence.unpin`
- `archive.case.step.attempt`

Each command definition specifies:

- allowed trusted source types
- allowed environments
- bounded input schema
- resource resolver
- authorization and existence behavior
- idempotency derivation
- rate-limit policy
- whether progression execution is required
- player-safe receipt shape

Only `browser_session` is implemented as a real player source in Phase 8. `server_internal` may be used for tests/internal orchestration. Future game and Steam adapters remain unregistered.

There is no generic client route such as `POST /api/v1/interactions`.

Interaction-command source and progression-event source are distinct. A browser session may request a typed command, but a successfully validated new investigation resolution emits `archive.case.step.resolved` from a code-registered trusted `interaction_service` source. Browser or future game clients cannot emit that event source directly. Provenance retains the originating trusted adapter without treating it as authority over the outcome.

### Canonical Investigation Lifecycle

Implement versioned authored investigation definitions linked to canonical case records.

- New starts bind to the current published investigation version.
- Existing account investigations remain pinned to their immutable version.
- Draft, published, withdrawn, and retired states are explicit.
- Withdrawal can make a version unavailable without deleting account history.
- No automatic migration between versions occurs.
- Case resource visibility is re-authorized for every read and mutation.

Account investigation states are intentionally small:

- `active`
- `resolved`
- `closed`

Phase 8 does not implement branching campaign state machines. Step visibility and eligibility use the existing validated declarative condition language where possible.

### Deterministic Exact-Answer Step

Fully implement one verifier type: `exact_normalized_secret`.

- The authored expected value is normalized at definition time and encrypted using the existing field-encryption system with a recorded key ID.
- Runtime comparison decrypts only inside the trusted service and uses timing-safe comparison.
- Submitted answers have a conservative byte/character limit and a versioned normalization policy.
- The database stores only a domain-separated keyed fingerprint of the normalized submission, outcome, timing, and provenance; never the plaintext answer.
- The same account submitting the same normalized answer to the same immutable step version is idempotent.
- Different guesses are distinct attempts and remain rate-limited.
- Incorrect attempts do not emit progression events or reveal hidden conditions.
- A correct attempt resolves the step once and emits a server-constructed canonical event.
- Rich verifier types, fuzzy matching, regular expressions, scripts, external validation, and AI judging are deferred.

The implementation should derive a domain-specific fingerprint key from existing protected key material using a standard KDF and explicit context, rather than reusing raw identity/session pepper semantics. If implementation review concludes a separate puzzle secret is materially safer, secret provisioning becomes an explicit approval item before coding that portion.

### Typed Evidence Pins

Implement account-owned evidence pins inside an active investigation.

Allowed initial targets:

- a canonical record the account is currently authorized to know exists
- a canonical relationship already visible to that account
- a public-safe Inventory 2.0 definition or instance currently held by that account

Pins organize the player's investigation but do not assert canonical truth, create canonical relationships, or satisfy a prerequisite merely because the client named an identifier. The server resolves public locators, rechecks visibility/custody, and stores stable internal references.

Phase 8 does not add freeform notes, uploads, arbitrary URLs, or unrestricted graph edges. Existing `account_annotations` and `account_relationships` remain schema-only for later deliberate design.

Evidence pin/unpin operations are authoritative account state but do not automatically emit progression events in Phase 8. Authored step eligibility may inspect valid current pins through an approved condition leaf only if implemented with bounded snapshot semantics.

### Investigation Projection

Extend `GET /api/v1/me/state` with an explicitly authored `investigations` collection containing only player-safe state:

- case catalog ID, title, and investigation status
- published investigation version as an opaque revision, not an internal ID
- visible step keys, safe labels/prompts, and resolved state
- safe evidence references already visible to the actor
- bounded safe attempt/result receipts where authored
- investigation projection revision contribution

Omit:

- internal IDs
- verifier type/config/ciphertext
- expected answer or submission fingerprint
- hidden steps and hidden prerequisites
- condition trees and actual/expected evaluation values
- unpublished definitions
- canonical relationships the player has not discovered
- real roles, permissions, elevation, security audit, and session data

Unknown investigation state is omitted rather than blacklisted field by field.

### One Disposable Vertical Slice

Provide one staging/test investigation fixture:

1. An authenticated disposable player starts an accessible case investigation.
2. The player sees one deterministic step and a protected case field remains withheld.
3. The player pins an authorized record or held evidence item.
4. An incorrect exact-answer attempt records a safe attempt without changing progression.
5. A correct attempt emits `archive.case.step.resolved`.
6. Phase 6 evaluates authored prerequisites and applies bounded consequences.
7. `/me/state` and the filtered case surface reveal only the intended new state.
8. Replay does not duplicate attempts, resolution, inventory, relationships, or receipts.

The fixture is validation content, not permanent lore or campaign material.

## Schema/Interface-Only Preparation

The following boundaries may be represented but are not operational integrations in Phase 8:

- a trusted source-adapter interface exists, but only authenticated browser sessions and internal test/service calls are implemented
- investigation versions allow future step kinds, but unknown kinds are rejected and only `exact_normalized_secret` executes
- attempt provenance can identify an adapter, but no Steam ticket, game device, offline queue, or external service credential exists
- immutable definitions support future authoring workflows, but no general create/edit/publish API or UI is exposed
- evidence target typing can expand later, but Phase 8 accepts only the three explicitly authorized target families
- progression events retain future external outbox compatibility, but no external dispatch or game synchronization is implemented
- privileged inspection supports operations and validation, but mutation remains fixture/repository-driven rather than a puzzle authoring console

## Schema Proposal

Proposed additive migration: `0007_phase8_canonical_investigations.sql`.

### `canonical_interactions`

- immutable internal ID
- account ID
- interaction type and schema version
- source type and source subject
- resource type, resource ID, and immutable resource revision/version
- server-derived idempotency key
- canonical input digest; no raw secret submission
- status/result code
- linked progression root event ID when applicable
- request/trace ID and sanitized provenance
- received/completed timestamps

Unique replay boundary: `(source_type, source_subject, idempotency_key)`.

### `case_investigation_definitions`

- stable immutable ID
- stable authored key
- canonical case record ID
- created/updated timestamps

The canonical record must be a case record. Public slug remains a locator, not relational identity or authorization.

### `case_investigation_versions`

- immutable version ID
- definition ID
- monotonically increasing version number
- status: draft/published/withdrawn/retired
- player-safe title/summary
- validated eligibility condition JSON
- created by, created at, published at, withdrawn at
- unique `(definition_id, version_number)`

At most one current published version is selected by repository policy. Publishing/authoring APIs are deferred; fixtures/repository setup prove persistence.

### `case_investigation_steps`

- immutable step version ID
- investigation version ID
- public step key unique within version
- deterministic sort order
- step kind (`exact_normalized_secret` initially)
- player-safe label/prompt metadata
- validated visibility and eligibility conditions
- encrypted verifier payload and key ID
- normalization version
- attempt policy JSON with strict schema
- created timestamp

### `account_case_investigations`

- immutable ID
- account ID
- pinned investigation version ID
- status
- started/resolved/closed/last-activity timestamps
- server-derived state revision material
- unique `(account_id, investigation_version_id)`

### `case_investigation_attempts`

- immutable ID
- account investigation ID
- step version ID
- canonical interaction ID
- keyed submission fingerprint
- outcome (`incorrect`, `resolved`, `duplicate`, `blocked`, `error`) where persistence is appropriate
- attempt ordinal
- sanitized provenance and request ID
- created timestamp

No plaintext answer, encrypted player answer, or near-match debug value is stored. Unique account/step/fingerprint constraints provide replay safety.

### `case_investigation_resolutions`

- account investigation ID
- step version ID
- accepted attempt ID
- progression event ID
- resolved timestamp
- unique `(account_investigation_id, step_version_id)`

### `case_evidence_pins`

- immutable ID
- account investigation ID
- account ID
- typed target kind and stable internal target ID
- canonical interaction ID
- pinned/unpinned timestamps and status
- unique active pin boundary

The schema must not treat these pins as canonical `entity_relationships`.

### Indexes And Portability

Indexes should support account investigation projection, published definition lookup, step ordering, attempt rate/replay lookup, and cleanup. Repository APIs must avoid leaking SQLite-specific SQL into services. PostgreSQL portability remains a design constraint.

No destructive rewrite or backfill of Phase 1-7 tables is proposed. Existing record review progression history is preserved; no historical interaction-ledger reconstruction is required.

## Transaction Architecture

Phase 8 needs one documented change to the Phase 6 boundary: the progression engine should support execution inside a caller-owned repository transaction while preserving the existing `ingest()` API.

Recommended shape:

- `ingest()` continues opening its own portable transaction for existing callers.
- an internal `ingestInTransaction(tx, input)` or equivalent accepts only an established transaction context.
- duplicate checks, event insertion, rule evaluation, effects, history, investigation resolution, and interaction completion share one transaction for correct puzzle resolution.
- no nested independent SQLite write transaction is used.
- injected failures after attempt validation, event insertion, or effects must roll back interaction, resolution, and consequences together.

This is the highest-risk implementation stage and must retain all Phase 6 concurrency, replay, chain, and rollback tests.

Incorrect attempts may commit their append-only attempt row without invoking progression. Correctness must not be returned if progression cannot commit; an engine/kill-switch failure returns a generic unavailable result and leaves no accepted resolution.

## API Proposal

All routes remain under `/api/v1`.

### Player Reads

`GET /api/v1/archive/cases/:slug/investigation`

- requires authentication for account investigation state
- re-authorizes case visibility and authored existence behavior
- returns only the current actor's filtered investigation representation
- supports ETag/no-store behavior where appropriate
- does not expose internal IDs, verifier data, or hidden steps

### Player Mutations

`POST /api/v1/archive/cases/:slug/investigation/start`

- authenticated, CSRF-protected, rate-limited
- server selects current published version
- server derives idempotency from account, command, definition, and immutable version
- returns a safe interaction receipt and updated state revision

`POST /api/v1/archive/cases/:slug/investigation/evidence`

- body is a typed public locator only, such as `{ "targetType": "record", "catalogId": "..." }`
- server resolves and re-authorizes target
- no internal IDs, canonical relationship claims, event names, or consequence fields accepted

`DELETE /api/v1/archive/cases/:slug/investigation/evidence/:publicRef`

- unpins only the current account's pin
- public reference must be opaque or authored and must not become authorization

`POST /api/v1/archive/cases/:slug/investigation/steps/:stepKey/attempt`

- body accepts only `{ "answer": "..." }` within conservative limits
- account, case, version, step, verifier, idempotency, event, and effects are server-derived
- response is intentionally coarse: accepted/resolved, not accepted, duplicate, cooldown/rate limit, unavailable
- never echoes the answer or hidden expected value

### Existing Record Review

`POST /api/v1/archive/records/:slug/review` retains its Phase 7 request and response contract. Internally it should use the typed interaction service. Existing idempotency, visibility, OWNER parity, kill-switch behavior, and tests remain unchanged.

Existing record-review progression identity is a compatibility boundary. The adaptation must preserve its current event source, source subject, and server-derived idempotency semantics so previously reviewed record revisions cannot execute again merely because orchestration moved behind a new service. No historical review backfill is required.

### Administrative/Staging Reads

Add only the minimum privileged inspection needed to validate operations:

- inspect definition/version/step metadata with verifier values always masked
- inspect a selected player's investigation status, pins, attempt outcomes, and linked progression event IDs
- no plaintext answers or decrypted verifier in the Control Center

A staging-only fixture setup/cleanup and tester may submit known fixture answers. There is no general production answer-testing or puzzle-authoring endpoint.

## Security And Abuse Boundaries

### Authentication And Authorization

- browser mutations require active opaque session and CSRF
- real OWNER/system_admin roles do not bypass case visibility, step eligibility, attempt policy, or gameplay rate limits
- fictional clearance may satisfy authored fictional eligibility only
- public slugs and step keys are locators, never authorization
- authored existence behavior applies independently at case and hidden-step boundaries

### Secret Handling

- verifier ciphertext and key ID are server-only
- routine admin APIs and logs never decrypt or return verifier values
- submitted answer plaintext exists only in bounded request memory and comparison scope
- request bodies are not logged
- fingerprints use domain-separated keyed derivation
- timing-safe exact comparison is required
- key rotation behavior must be documented before production content exists

### Brute Force And Enumeration

- conservative per-account/per-step attempt limits
- host-level abuse boundary for unauthenticated or repeated invalid requests
- repeated identical guesses are idempotent and do not consume unlimited rows
- no OWNER gameplay limit elevation
- no fuzzy distance, partial correctness, hidden prerequisite explanation, or answer-shape leak unless explicitly authored later
- consistent coarse errors avoid distinguishing hidden case, hidden step, invalid verifier, and unmet secret prerequisite when authored policy requires nonexistence

### Data And Content Safety

- evidence targets are server-resolved allowlisted types
- no arbitrary URLs, HTML, files, SQL, scripts, regex verifiers, or commands
- no player freeform text in Phase 8
- evidence pins do not mutate canonical relationships
- privileged security audit remains separate from canonical gameplay interaction history
- audit context excludes answer text, verifier data, session/CSRF tokens, and secret keys

### Future Game Boundary

Phase 8 defines an internal source adapter interface but does not implement a game source. A future game adapter must independently verify a service credential or platform ticket, resolve it to an OFA account, enforce source-specific replay/clock policy, and then call the same typed service. Merely sending an account ID, Steam ID, event name, or client result will never be sufficient.

## Operational Controls

Add `investigations_disabled`, default `true` in migration `0007`.

Effective mutation gates:

- `investigations_disabled`: blocks Phase 8 investigation reads/actions as authored policy specifies
- `player_surfaces_disabled`: continues disabling canonical player surfaces
- `player_mutations_disabled`: blocks all player investigation mutations
- `authored_events_disabled`: blocks actions that require consequence execution; correct attempts must not partially resolve

Recommended behavior:

- investigation reads return a safe unavailable response when investigation rollout is disabled
- start, evidence, and attempt mutations fail closed
- record review preserves its existing Phase 7 gates and behavior
- staging validation may temporarily disable the relevant modes using exact snapshots
- physical validation must finish with `investigations_disabled=true`, `player_surfaces_disabled=true`, and `authored_events_disabled=true`

Do not overload unrelated controls such as registration or authentication initiation.

## Rollback

1. Enable `investigations_disabled`, `player_surfaces_disabled`, and `authored_events_disabled`.
2. If needed, enable `player_mutations_disabled` as the broader emergency stop.
3. Stop the Phase 8 runtime and restart the frozen Phase 7 code.
4. Phase 7 ignores additive Phase 8 tables and the new mode.
5. Preserve interaction, attempt, resolution, progression, and audit history during ordinary rollback.
6. Restore a verified pre-migration backup only for database corruption or explicitly approved destructive rollback.
7. Do not delete or rewrite legacy localStorage.

Record-review adaptation must be deployable behind tests without requiring a public route change. If that adaptation is unsafe, it can be reverted independently while the new investigation mode remains disabled.

## Staging Fixtures

Extend the established disposable lifecycle rather than creating permanent test accounts or using `noobuus`.

Fixture requirements:

- one ordinary account with no real roles
- one visible canonical case and immutable investigation version
- one hidden/unavailable case or step for enumeration tests
- one exact-answer step with encrypted verifier
- one authorized evidence record and one unauthorized target
- one held public-safe Inventory 2.0 item
- one discovery, fictional credential, relationship, protected field, and receipt consequence
- one authored `archive.case.step.resolved` rule
- mode snapshot manifest and idempotent cleanup

The safe manifest may print disposable username/email, case slug, step key, fixture answer, expected before/after state, and cleanup command. The answer is a disposable staging content secret, not an authentication secret; it must still never be written into security audit or persistent attempt rows. Production verifier values are never printed.

Cleanup removes all fixture account, session, challenge, interaction, investigation, pin, attempt, resolution, progression, inventory, content, definition, policy, audit/rate-limit, and lifecycle state, then restores the exact mode snapshot. Setup failure at every stage must invoke the same cleanup path.

## Automated Validation Strategy

All Phase 1-7 suites remain mandatory. Add Phase 8 tests for:

### Schema And Repository

- migration `0007` applies additively and existing data remains readable
- immutable definition/version behavior and one-current-published selection
- repository boundary works through the portable adapter
- nullable/unknown authored state fails closed
- indexes and unique constraints enforce replay boundaries

### Typed Command Boundary

- unknown commands and fields are rejected
- source/environment allowlists are enforced
- clients cannot submit account ID, event type, consequences, internal IDs, rule selection, or hidden state
- browser routes construct actor/source/resource/version/idempotency server-side
- no generic event/interaction ingestion route exists
- Phase 7 record-review request/response and idempotency remain unchanged after internal adaptation

### Investigation And Visibility

- inaccessible case and hidden step obey authored existence behavior
- published version is selected for new starts; existing runs stay pinned
- safe representation omits unpublished/hidden/internal/verifier data
- unknown investigation state is omitted by allowlist projection
- evidence pins require current visibility/custody
- evidence pins remain player organization, not canonical relationships

### Verifier And Attempts

- exact normalization is deterministic and versioned
- timing-safe comparison path is used
- plaintext fixture answer is absent from database rows, logs, audit, projection, and error responses
- same normalized guess replay is idempotent
- different guesses are rate-limited and bounded
- incorrect attempt creates no progression event or consequence
- correct attempt resolves once
- concurrent correct attempts create one resolution and one consequence set
- OWNER receives no correctness, eligibility, or rate-limit advantage

### Transactions And Progression

- correct resolution, event, effects, history, and interaction completion are atomic
- injected failure before event, after event, and during effects rolls everything back
- existing Phase 6 replay, sibling snapshot, chain limits, dry run, and serialized concurrency remain unchanged
- kill switches leave no partial correct resolution
- fictional progression never changes real roles

### Projection And Legacy Separation

- investigation projection is explicit allowlist, deterministic after restart, bounded, and contributes to opaque revision
- incorrect hidden attempts do not change visible revision unless an authored safe receipt says they should
- correct resolution changes revision once; replay remains stable
- no protected canonical state is written to localStorage
- legacy localStorage remains semantically unchanged

### Fixture Lifecycle

- setup/cleanup succeeds
- cleanup is idempotent
- injected setup and execution failures clean all rows/files
- exact operational-mode snapshot is restored
- production/non-loopback lifecycle use is refused

## Physical Staging Validation

Before implementation closure:

1. Create and hash a pre-migration SQLite backup under `E:\OFA\backups\staging`.
2. Apply migration `0007` and verify seven applied migrations.
3. Run all Phase 1-8 tests and separate backup/restore verification.
4. Start through the DPAPI-protected Windows launcher on `127.0.0.1:8787`.
5. Run expanded `RunValidation` and confirm transaction, source, replay, visibility, security, and cleanup checks.
6. Use the disposable Phase 8 browser fixture and staging-only investigation tester.
7. Authenticate only the disposable ordinary player through local email-link testing.
8. Validate start, safe state, evidence pin, incorrect attempt, correct resolution, reveal, revision, and replay.
9. Verify answer plaintext is absent through read-only database/log/audit inspection.
10. Verify anonymous and inaccessible resource behavior.
11. Verify OWNER hiding/parity only through safe non-progression checks or a disposable owner fixture; do not mutate `noobuus` gameplay state.
12. Run cleanup twice and verify all fixture rows/files are gone.
13. Confirm `investigations_disabled=true`, `player_surfaces_disabled=true`, and `authored_events_disabled=true` afterward.
14. Run backup/restore validation against the seven-migration database.

Production-only security, public ingress, and Steam/game behavior remain deferred and must not be claimed from loopback validation.

## Public And Staging UI Scope

Fully implement only a functional staging investigation tester or a narrowly scoped extension of existing staging pages. It should show safe state, permit evidence pin/unpin, submit the disposable answer, and display coarse receipts.

Do not redesign home, cases, inventory, account, navigation, or login. Public pages may receive no changes in Phase 8. If the implementation needs a tiny additive hook to prove the shared service, it must remain hidden behind existing disabled canonical surfaces and preserve Phase 7 fallback behavior.

## Compatibility With Legacy State

- `ofaCaseProgress`, case conclusions, `oddInventory`, achievements, quests, room stamps, radio state, currencies, and other localStorage keys remain untouched.
- No legacy value starts or resolves a canonical investigation.
- No legacy evidence or answer is imported.
- Canonical investigation data remains account-backed and memory-only in browser integration.
- Later migration of a specific legacy case requires an explicit mapping, trust policy, consent/UX decision, and rollback plan.
- Existing Unlisted Wing and Case 000 remain functional local experiences until separately evolved.

## Explicit Non-Goals

- Steamworks integration, Steam ticket verification, ownership, achievements, inventory sync, or account linking UI
- game service credentials, game client protocol, offline game synchronization, or conflict resolution
- broad client-authored event or interaction ingestion
- public OFA 2.0 redesign or authenticated navigation redesign
- migration or deletion of legacy localStorage systems
- full puzzle campaigns, ARG chains, global/cohort investigations, or live operations
- probabilistic required progression
- fuzzy, regex, script, executable, AI-judged, or external puzzle verifiers
- freeform player notes, uploads, links, chat, or social evidence sharing
- generalized content/investigation/event authoring and publishing UI
- inventory economy, trading, crafting, marketplace, or Steam item mappings
- production email delivery, passkey implementation, or production account rollout
- production deployment or public exposure
- broad account profiles/community systems

## What Phase 8 Enables

After Phase 8, later phases can safely add:

- richer case workspaces and evidence-board UI
- multiple deterministic puzzle types and authored hint policies
- cross-record, transmission, artifact, facility, and inventory interactions using one command boundary
- deliberate migration of selected legacy cases into canonical investigations
- a game adapter that authenticates a source and invokes the same typed service
- Steam linkage without coupling Steam identity directly to progression rules
- campaign/ARG tooling built on immutable investigation versions and attempt history
- player-facing Archive redesign based on stable canonical contracts
- operational analytics and support tooling without reading raw answers

## Proposed Implementation Sequence

### Stage 1: Migration And Repositories

- additive migration `0007`
- definition/version/step, account investigation, interaction, attempt, resolution, and evidence repositories
- encrypted verifier storage and normalization/fingerprint primitives
- default-enabled `investigations_disabled`

### Stage 2: Transaction-Compatible Interaction Core

- code-registered interaction commands and source schemas
- internal actor/resource/idempotency context
- Phase 6 transaction-context extension with complete regression coverage
- atomic interaction/progression coordination

### Stage 3: Investigation Reads And Projection

- visibility-aware investigation resolver
- player-safe case investigation representation
- `/me/state` investigation projection and revision behavior
- privileged masked inspection

### Stage 4: Typed Mutations

- start investigation
- evidence pin/unpin
- exact-answer attempt and coarse receipt
- rate limits, CSRF, audit boundaries, and kill switches

### Stage 5: Record Review Adaptation

- move Phase 7 review orchestration behind the interaction service
- preserve exact API behavior and all Phase 7 tests
- keep adaptation independently reversible

### Stage 6: Disposable Validation Infrastructure

- staging fixture setup/cleanup
- staging-only browser tester
- expanded `RunValidation`
- injected-failure and restart determinism tests

### Stage 7: Physical Validation And Freeze

- backup, migration, all tests, restore check
- physical `RunValidation`
- disposable browser validation
- plaintext-answer absence inspection
- cleanup and exact mode restoration
- documentation closure only after explicit acceptance

## Major Risks

### Transaction Regression

Allowing the Phase 6 engine to participate in a caller-owned transaction can break replay, mutex, rollback, or concurrency guarantees. Implement and verify this before higher-level behavior.

### Secret Leakage

Puzzle answers can leak through database rows, logs, audit context, admin previews, fixtures, exceptions, or projections. Tests must search every persistence/output path. Production authoring remains deferred until key rotation and operational handling are mature.

### Brute Force And Oracle Behavior

Exact-answer endpoints can become enumeration or timing oracles. Conservative normalization, timing-safe comparison, coarse responses, idempotent repeated guesses, and per-step limits are mandatory.

### Over-Generalization

A generic command bus or puzzle DSL could expand indefinitely. Phase 8 supports five typed commands, one verifier, bounded evidence targets, and one disposable vertical slice.

### Canonical/Speculative Confusion

Player evidence pins must not silently become canonical truth or discovered canonical relationships. Separate tables and response labels are required.

### Content Revision Semantics

Changing a puzzle after players begin can invalidate fairness or idempotency. Immutable versions and pinned account runs are required; automatic migration is deferred.

### Future Game Assumptions

Designing source adapters too specifically around a nonexistent game protocol would create false certainty. Phase 8 defines the trusted internal interface but implements only browser sessions.

## Recommended Defaults Requiring Approval

1. Use the name **Phase 8: Canonical Investigation & Interaction Foundation**.
2. Fully implement five typed commands and one `exact_normalized_secret` verifier only.
3. Implement evidence pins without freeform notes and keep them separate from canonical relationships.
4. Reuse the existing declarative condition evaluator for investigation visibility/eligibility where practical; do not create a second rules language.
5. Derive answer fingerprints with a domain-separated KDF from protected key material unless security review requires a separately provisioned puzzle secret.
6. Pin account investigations to immutable published versions; do not auto-migrate active runs.
7. Adapt the existing record-review route to the internal service only after the new transaction and command invariants pass.
8. Keep all three rollout switches enabled in their disabled-state posture after validation.
9. Use only disposable accounts/content for progression-changing validation; never use `noobuus`.
10. Keep public pages unchanged and implement only a staging tester in this phase.

## Acceptance And Freeze Criteria

Phase 8 may close only when:

- approved scope is implemented without adding deferred features
- migration `0007` is additive and seven-migration backup/restore succeeds
- all Phase 1-8 regressions pass
- Phase 6 transaction, replay, chain, snapshot, rollback, and concurrency invariants remain intact
- typed source/command boundaries and absence of a generic client ingestion route are verified
- exact-answer secrecy, normalization, timing-safe comparison, rate limits, and coarse responses are verified
- correct resolution is atomic with canonical event/effects/history
- investigation/evidence/projection authorization and canonical/speculative separation are verified
- record review preserves its Phase 7 contract after internal adaptation
- disposable setup, injected-failure cleanup, repeated cleanup, and mode restoration pass
- physical Windows staging migration, `RunValidation`, browser validation, and plaintext-answer absence checks pass
- `investigations_disabled=true`, `player_surfaces_disabled=true`, and `authored_events_disabled=true` remain restored
- production, Steam, game, public redesign, and legacy migration behavior remain explicitly unclaimed
- physical evidence is reviewed and closure is explicitly authorized

After closure, freeze the implementation branch at the accepted SHA. Do not begin the next phase automatically.
