# Phase 4 Archive Surfaces

Phase 4 creates the first server-filtered Archive reading surfaces. This phase does not redesign the public website and does not build the full gameplay, event engine, content-admin system, media pipeline, or Steam/game integration.

## Implemented Scope

- Additive visibility/disclosure schema for Archive resources.
- Field-level disclosure support separate from whole-resource existence.
- Read-only `/api/v1/archive/...` API routes.
- Server-side filtering for anonymous, authenticated, discovered, and withheld states.
- Intentional unauthorized-existence behavior:
  - ordinary not found
  - known but restricted
  - catalog stub with details omitted
- Public slugs as locators, not authorization.
- Ordinary Archive responses avoid opaque internal database IDs.
- Relationship API returns only relationships appropriate to the actor's current knowledge.
- Staging-only Archive browser at `/staging/archive-test.html`.
- Staging-only account tester controls for granting approved Phase 4 discovery keys one at a time.
- Staging seed data proving public catalog, authenticated detail, discovery-gated fields, withheld content, and discovery-gated relationships.
- Narrow Phase 4 staging discovery keys rather than arbitrary Phase 4 unlocks.

## Still Schema / Interface Only

- Full content authoring/admin UI.
- Full redaction editor.
- Real protected media serving.
- Real media upload/processing.
- Public production content publishing workflow.
- Advanced search/ranking.
- Advanced relationship graph UI.
- Full authored-event execution.
- Steam/game sync.
- Hard ARG puzzle-chain execution.
- Public OFA 2.0 visual redesign.

## API Routes

Read-only Archive routes:

- `GET /api/v1/archive/records`
- `GET /api/v1/archive/records/:slug`
- `GET /api/v1/archive/cases`
- `GET /api/v1/archive/incidents`
- `GET /api/v1/archive/transmissions`
- `GET /api/v1/archive/artifacts`
- `GET /api/v1/archive/facilities`
- `GET /api/v1/archive/media`
- `GET /api/v1/archive/relationships`

Existing account/discovery routes remain under `/api/v1/me/...`.

Phase 4 adds a narrow staging unlock policy for `POST /api/v1/me/discoveries` when `discoveryType` is `phase4_staging`. Only authored Phase 4 staging keys are accepted.

The staging-only account tester at `/staging/account-test.html` exposes one explicit button per approved Phase 4 discovery key:

- `phase4.signal001.transcript`
- `phase4.caseecho.personnel`
- `phase4.relationship.echo`
- `phase4.withheld.null`

It does not expose a generic arbitrary Phase 4 discovery textbox.

## Visibility Model

Visibility is not modeled as only `visible = true/false`.

Each protected resource can define:

- catalog access
- field-level access rules
- relationship access rules
- unauthorized existence behavior

Supported access states include:

- `public`
- `authenticated`
- `discovered`
- `fictional_clearance`
- `withheld`
- `redacted`
- `unavailable`

Redaction is server-side omission or substitution. Protected plaintext is not sent to the client and hidden with frontend code.

## Canonical Truth And Player Knowledge

Canonical entity relationships remain backend truth.

Archive APIs return only relationships appropriate to the current actor. `GET /api/v1/archive/relationships` must not become a complete canonical lore dump.

Discoveries may reveal:

- additional fields on visible resources
- additional relationships
- additional list/search results
- entirely new resources

Discovery state remains server-authoritative.

## Future Admin Control Surface

Later phases need a dedicated privileged owner/admin control surface where authorized operators can deliberately grant inventory items, discoveries, fictional permissions/clearances, event/test state, and related operational state.

That future surface must use real authorization checks, audit logging, clear confirmation flows, reauthentication for dangerous actions where appropriate, and strict separation from ordinary player-facing APIs. Phase 4 does not implement that surface.

## Staging Seed

Run after migrations on staging:

```powershell
cd C:\OFA\staging\repo\backend
npm run seed:phase4-staging
```

Seed content:

- `phase4-signal-001`: public catalog, authenticated body, discovery-gated transcript, withheld operator note
- `phase4-case-echo`: authenticated catalog/detail, discovery-gated personnel linkage
- `phase4-withheld-null`: behaves as not found until the required discovery exists
- one discovery-gated canonical relationship between the signal and case

The seed is idempotent.

## Security Boundaries

- Owner role remains invisible on ordinary/public/in-universe surfaces.
- Real authorization remains separate from fictional Archive clearance.
- Fictional clearance can affect content/gameplay access but never real administrative permissions.
- Protected content is filtered server-side.
- Secret fields and protected media references must not be shipped to unauthorized clients.
- Slug knowledge is never authorization.
- Local email-link token logging remains impossible outside development/staging/test.
- Staging remains local-only.

## CSRF Recovery

The staging account tester calls `GET /api/v1/me` when it loads. If the browser still has a valid `ofa_session` cookie after refresh or navigation, the server returns the stable session-bound CSRF token in the `X-OFA-CSRF` response header.

This design keeps CSRF server-authoritative:

- plaintext CSRF tokens are not stored in the database
- CSRF is derived from server-held secret material and the server-side session identity
- tokens from one session cannot authorize mutations on another session
- logout or session revocation immediately kills the associated CSRF authority
- repeated safe reads do not invalidate other same-session tabs
- ordinary `/api/v1/me` still returns only safe account information and does not expose roles, permissions, internal account IDs, creator status, or session internals

## Rate Limits

Authentication, recovery, and security-sensitive endpoints remain strictly rate-limited and do not receive OWNER elevation:

- registration: 5 attempts per email digest per hour
- email-link start: 8 attempts per email digest per hour
- email-link complete: 30 attempts per host per 15 minutes

Approved non-sensitive authenticated staging-style operations are rate-limited per account and operation:

- normal account: 20 per hour
- hidden real OWNER role: 500 per hour

Current elevated-operation scope:

- `POST /api/v1/me/discoveries`
- `POST /api/v1/staging/grant-test-item`

The elevated policy is server-authoritative and uses the real hidden role assignment. It is not based on client input and does not make owner status visible through ordinary player-facing responses.

## Physical Server Validation

From `C:\OFA\staging\repo\backend`:

```powershell
git fetch origin
git switch ofa-2-phase-4-archive-surfaces
git pull --ff-only
npm run migrate:server
npm run seed:phase4-staging
npm test
npm run backup:server:check
.\tools\windows-staging-secrets.ps1 -Action RunServer
```

Manual validation:

1. Confirm `GET /api/v1/health` is healthy.
2. Open `http://127.0.0.1:8787/` and confirm the existing OFA site still loads.
3. Open `http://127.0.0.1:8787/staging/archive-test.html`.
4. As anonymous, confirm `phase4-signal-001` catalog/detail returns no protected transcript plaintext.
5. As anonymous, confirm `phase4-case-echo` returns restricted rather than leaking body text.
6. As signed-in `noobuus`, confirm authenticated fields appear where intended.
7. Grant only approved Phase 4 staging discoveries and confirm protected fields/relationships appear.
8. Confirm unknown Phase 4 staging discovery keys are rejected.
9. Confirm owner status does not change ordinary Archive responses.
10. Confirm staging remains bound to `127.0.0.1`.

## Acceptance Criteria

- Existing static OFA still loads unchanged.
- `GET /api/v1/health` still works.
- Existing Phase 1-3 tests pass.
- Phase 4 tests pass.
- Anonymous, authenticated, discovered, and protected visibility states are proven.
- Field-level protected content is omitted or substituted server-side.
- Unauthorized existence behavior is intentional per resource.
- Relationship API does not expose the complete canonical graph.
- Owner/admin status does not leak through ordinary Archive/account APIs.
- Staging remains local-only.
- Backup/restore validation succeeds with all migrations present.
- Physical-server validation is recorded before Phase 4 closes.

## Final Physical Validation Checkpoint

Phase 4 physical-server validation is complete on branch `ofa-2-phase-4-archive-surfaces` at validated implementation SHA `4f998661c69938b8773b207b6cec353dbfa17c23`.

Confirmed on the actual OFA Windows staging server:

- staging server starts successfully through the DPAPI-protected launcher
- `/api/v1/health` remains healthy
- existing static OFA remains functional
- Phase 1-4 automated regression tests pass
- `/staging/archive-test.html` operates correctly
- `/staging/account-test.html` operates correctly
- anonymous catalog-safe content is available where intended
- authenticated content becomes available where intended
- protected fields are filtered server-side rather than merely hidden client-side
- unauthorized resources can intentionally appear nonexistent
- protected canonical relationships are not dumped to unauthorized clients

Signal 001 validation:

- before `phase4.signal001.transcript`, Signal 001 is visible, safe body is available, transcript is withheld, and operator note is redacted
- after granting `phase4.signal001.transcript`, transcript becomes `WE WERE NEVER ONLY RECEIVING.`
- after transcript discovery, operator note remains `[REDACTED]`
- unrelated relationship visibility remains unchanged
- this validates independent field-level disclosure

Relationship discovery validation:

- before `phase4.relationship.echo`, relationships return an empty list
- after granting `phase4.relationship.echo`, exactly the intended relationship becomes visible: `Signal 001 / Catalog Envelope` `recurs_with` `Case Echo / Recurrence Test`
- no canonical relationship graph dump occurred

Case Echo personnel validation:

- before `phase4.caseecho.personnel`, `personnelLinkage` is empty
- after granting `phase4.caseecho.personnel`, `personnelLinkage` becomes `subject-withheld` and `witness-withheld`
- this validates discovery-specific field disclosure independently from authenticated case-body access

Fully withheld resource validation:

- before `phase4.withheld.null`, requesting `phase4-withheld-null` returns ordinary `404 not_found` with no indication that a protected record exists
- after granting `phase4.withheld.null`, the same identifier returns `200` and the intended record/body becomes available
- this validates intentional existence withholding and discovery-triggered resource visibility

OWNER isolation validation:

- the hidden real `owner` role on `noobuus` does not grant fictional Archive knowledge
- the hidden real `owner` role does not bypass ordinary Archive discovery requirements
- real authorization and fictional Archive clearance/progression remain separate
- OWNER status remains absent from ordinary `/api/v1/me`, Archive responses, usernames, designations, badges, and player-facing metadata
- `noobuus` behaves like an ordinary player during normal OFA gameplay unless an explicitly privileged administration surface is being used

CSRF recovery validation:

- authenticated `/api/v1/me` returns a session-bound CSRF token without rotating it
- plaintext CSRF is returned only through `X-OFA-CSRF`
- plaintext CSRF is not persisted
- repeated `/api/v1/me` calls do not invalidate already valid same-session mutation tokens
- staging account tester automatically obtains a usable CSRF token from an existing authenticated session after refresh/navigation
- another email-link authentication ceremony is not required merely because the staging tester was refreshed
- production does not expose staging tester mechanisms

Role-aware rate-limit validation:

- normal account approved staging operations remain `20/hour` per account/operation
- hidden OWNER receives `500/hour` for approved non-sensitive operations
- current elevated operations remain `POST /api/v1/me/discoveries` and `POST /api/v1/staging/grant-test-item`
- elevation comes only from server-authoritative hidden role lookup
- username `noobuus` is not itself privileged
- fictional clearance/designation cannot obtain elevated limits
- client headers/parameters cannot request OWNER treatment
- security-sensitive authentication limits remain unchanged even for OWNER:
  - registration: `5/hour` per email digest
  - email-link start: `8/hour` per email digest
  - email-link complete: `30/15 minutes` per host

Deferred intentionally from Phase 4:

- production email provider
- passwords
- full WebAuthn/passkey implementation
- Steam linking
- game synchronization
- public profiles/social systems
- unrestricted discovery/item/permission grants
- full owner/admin control center
- production deployment
- full public Archive redesign
- hard ARG puzzle chains

The future owner/admin control surface remains an explicit requirement. It should eventually allow appropriately authorized management/grant/revoke operations for discoveries, items, permissions, content, and related administrative state, with strong authorization, auditing, CSRF protection, rate-limit policy, and no leakage of OWNER status into ordinary gameplay.

All Phase 4 acceptance criteria are complete as of this checkpoint. After this checkpoint, treat Phase 4 as frozen unless a later explicitly approved bug or security fix requires reopening it.
