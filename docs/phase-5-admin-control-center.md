# Phase 5 Admin Control Center

Phase 5 establishes the first privileged OFA operational surface. It does not redesign the public site, expose staging publicly, implement Steam/game sync, or build a general content authoring system.

## Branch

- Branch: `ofa-2-phase-5-admin-control-center`
- Starting checkpoint: Phase 4 frozen SHA `a8fc9a34b67843936a1c8bbd8361121707935305`

## Implemented Scope

- Permanent privileged admin namespace under `/api/v1/admin/...`.
- Private Control Center UI at `/admin/control-center.html`.
- Hidden real-role authorization for `owner` and `system_admin`.
- Ten-minute privileged elevation backed by server-side `admin_elevations`.
- Fresh-auth requirement for elevation confirmation.
- CSRF protection for privileged mutations and content preview.
- Strict admin-operation rate-limit buckets.
- Privileged audit logging for admin reads, elevation, player operations, content preview, operational modes, and session revocation.
- Player Inspector by username for owner/system_admin only.
- Typed discovery grant/revoke.
- Typed Inventory 2.0 grant/revoke for stackable quantity and individual instances.
- Fictional Archive clearance editing.
- One-account session revocation.
- Emergency global session revocation.
- Operational modes for disabling registration, auth initiation, and player mutations.
- Content canonical inspection and filtered representation preview.

## Schema Changes

Migration `backend/migrations-server/0004_phase5_admin_control_center.sql` adds:

- `admin_elevations`
- `operational_modes`
- permissions:
  - `admin.access`
  - `players.inspect`
  - `players.mutate`
  - `operations.manage`
  - `sessions.revoke`
- role-permission mappings for `role_owner` and `role_system_admin`

`authored_events_disabled` is present as an operational mode placeholder but remains schema/interface-only until the event engine exists.

## Admin API Boundaries

Implemented admin routes:

- `GET /api/v1/admin/me`
- `POST /api/v1/admin/elevation/start`
- `POST /api/v1/admin/elevation/confirm`
- `POST /api/v1/admin/staging/fresh-auth-session`
- `GET /api/v1/admin/players/by-username/:username`
- `GET /api/v1/admin/players/:accountId/inventory-ledger`
- `POST /api/v1/admin/players/:accountId/discoveries/grant`
- `POST /api/v1/admin/players/:accountId/discoveries/revoke`
- `POST /api/v1/admin/players/:accountId/inventory/grant`
- `POST /api/v1/admin/players/:accountId/inventory/revoke`
- `POST /api/v1/admin/players/:accountId/fictional-clearance/set`
- `POST /api/v1/admin/players/:accountId/sessions/revoke`
- `GET /api/v1/admin/operations/modes`
- `POST /api/v1/admin/operations/modes/set`
- `POST /api/v1/admin/sessions/revoke-all`
- `GET /api/v1/admin/content/records/:slug`
- `POST /api/v1/admin/content/preview`

The admin namespace has no SQL console, command execution endpoint, filesystem browser, generic mutation endpoint, or arbitrary grant endpoint.

## Privilege Model

Ordinary `/api/v1/me` remains player-safe. It must not expose owner status, permissions, elevation status, internal account IDs, account creation order, session internals, or credential data.

`/api/v1/admin/me` is the privileged-context endpoint. It can show real roles, permissions, and elevation status only after hidden-role authorization succeeds.

Full Player Inspector and typed mutation capabilities are limited to:

- `owner`
- `system_admin`

The following roles do not receive full Player Inspector access in Phase 5:

- `developer_readonly`
- `content_admin`
- `moderator`

Authorization is never based on username. The public username `noobuus` has no special meaning by itself.

Fictional Archive clearance/progression remains separate from real administration permissions and cannot grant admin access.

## Elevation

Privileged mutations require:

- authenticated admin session
- real hidden permission
- valid CSRF token
- active server-side elevation
- exact typed confirmation string
- operation-specific rate-limit allowance

Elevation lasts 10 minutes. Confirmation requires a fresh authentication ceremony. In current staging, that means completing a new local email-link sign-in for the same privileged account, then calling `POST /api/v1/admin/elevation/confirm` with `confirm: "ELEVATE"`.

No permanent privileged cookie is issued. Elevation is stored server-side and tied to the current session.

## CSRF Design

CSRF tokens are stable for the lifetime of an individual authenticated server-side session. `GET /api/v1/me` and `GET /api/v1/admin/me` can recover the token into a newly loaded page or tab through the `X-OFA-CSRF` response header, but these safe reads do not rotate the token or invalidate other tabs.

The token is derived from server-held secret material and the session identity. Plaintext CSRF tokens are not stored in the database, are not placed in URLs, and do not require `localStorage`.

Security properties:

- CSRF remains unguessable and session-bound.
- A CSRF token from session A cannot authorize mutations on session B.
- Logout or session revocation immediately invalidates that session's CSRF authority because authenticated actor lookup fails.
- Fresh login and the staging fresh-auth helper create a new server-side session with a different CSRF token.
- Privileged admin mutations still require CSRF.
- Same-session OFA tabs can operate concurrently without invalidating each other.

### Staging Fresh-Auth Helper

`POST /api/v1/admin/staging/fresh-auth-session` exists only in development, staging, and test. It is a narrow validation helper for local Phase 5 testing when the staging operator has already exhausted normal email-link start limits.

The helper:

- requires an already-authenticated real admin role through the current `ofa_session`
- requires `admin.access`
- requires CSRF
- accepts no account ID or username
- creates a fresh server-side session for the same authenticated account only
- returns the new session only through `Set-Cookie`
- returns the new CSRF token only through `X-OFA-CSRF`
- writes a real audit record
- is rate-limited independently as `admin-op:staging.fresh_auth_session`
- is unavailable in production

This helper does not change or relax normal authentication limits. Production elevation still requires a real fresh authentication ceremony.

## Player Inspector

The Player Inspector looks up accounts by username and returns operational state needed for administration:

- internal account ID
- account status
- display and normalized username
- Archive identity/designation
- fictional clearance state
- discoveries
- recent sessions
- player-authored relationships
- Inventory 2.0 public-safe balances/instances

Internal account IDs are visible here because this is an explicitly privileged admin surface. They remain absent from ordinary player APIs.

## Inventory Operations

Admin inventory grant/revoke is typed.

Stackable items:

- grant creates or reuses an item definition and appends inventory ledger provenance
- revoke reduces quantity explicitly
- revoke cannot make quantity go below zero

Instance items:

- grant creates an individual item instance
- revoke changes backend custody state to `revoked`
- identity and history are preserved
- `inventory_item_history` records the custody transition

Admin inventory operations include actor, reason, target, idempotency key, and backend custody/state transition provenance.

## Operational And Emergency Controls

Fully implemented:

- disable registrations
- disable authentication initiation
- disable player mutations/read-only player-mutation mode
- revoke one account's sessions
- emergency global session revocation

Emergency global session revocation preserves the initiating admin session so the operator can verify and recover the staging environment without immediately losing control. All other active sessions are revoked.

Deferred:

- authored-event disabling behavior, because the full event execution engine does not exist yet
- richer production incident-response automation

## Content Operations

Implemented:

- canonical privileged record inspection
- protected field inspection
- filtered representation preview as:
  - anonymous
  - generic authenticated
  - selected player's current knowledge/discovery state

Deferred:

- record editing
- redaction editing
- publishing workflow
- bulk authoring
- media upload/protection pipeline
- full content management UI

## Audit

Privileged actions write real audit records separate from fictional Archive logs.

Audited actions include:

- admin status reads
- elevation start/confirm
- player inspection
- discovery grant/revoke
- inventory grant/revoke
- fictional clearance changes
- account/global session revocation
- operational mode reads/changes
- content inspection and preview

Audit context may include actor, target, reason, operation result, resource, request ID, and non-secret state transitions. It must not store plaintext auth tokens, email-link tokens, session tokens, CSRF tokens, field-encryption keys, peppers, or other secrets.

## Control Center UI

The private Control Center at `/admin/control-center.html` is intentionally functional and operational, not the public OFA 2.0 redesign.

It supports:

- admin status and CSRF recovery
- elevation start/confirm
- staging-only fresh-auth helper for local validation
- player lookup
- inventory ledger inspection
- typed discovery grant/revoke
- typed inventory grant/revoke
- instance custody revoke
- account session revoke
- operational mode list/set
- emergency global session revoke
- content preview

Unauthorized users receive `404 Not Found` for the page.

## Security Boundaries

- Do not expose staging publicly.
- Do not merge this branch to `main` until explicitly approved.
- Do not modify frozen prior-phase branches.
- Owner/admin state remains hidden from ordinary player surfaces.
- Client headers/parameters cannot request privileged treatment.
- Real authorization is server-side and role/permission based.
- Fictional clearance never grants real authorization.
- Protected content must be server-filtered.
- Dangerous operations require elevation and explicit confirmation.
- Authentication and recovery rate limits remain strict even for owner/system_admin.
- No generic mutation or database-console capability exists.

## Physical Server Validation

### Final closure checkpoint

Phase 5 physical Windows staging validation completed successfully at implementation HEAD `b2e237d3257428d2c5387727b12b8b29e6b434ae` on August 18, 2026. This supersedes the earlier preliminary checkpoint at `57e5e01c59bbc73479144b33c9ca5bce40d44653`.

Confirmed on the physical server:

- `npm test` passed the backend, server, Phase 2-5, and staging-validation harness regression suites.
- `RunValidation` passed health, all four migrations, admin authorization boundaries, ordinary `/me` role hiding, same-session CSRF, staging fresh-auth/elevation, discovery grant/revoke, inventory grant/revoke and ledger, fictional clearance, operational-mode restoration, Archive visibility/content preview, and privileged audit verification with 17 request-linked entries.
- The Control Center is available only in an authenticated, authorized admin context; an ordinary account receives `403 admin_forbidden` from admin APIs.
- Hidden owner authorization for `noobuus` works only in privileged admin context. Ordinary `/api/v1/me` continues to omit owner role, permissions, elevation, internal account ID, and session internals.
- The staging fresh-auth helper and 10-minute elevation flow work.
- Same-session tabs no longer invalidate one another's CSRF authority when another tab calls `/api/v1/me`.
- Player Inspector lookup works and exposes internal account IDs only in privileged context.
- Typed discovery grant/revoke persists provenance and removes revoked discoveries from active state.
- Typed quantity inventory grant/revoke reaches a zero balance while preserving both ledger entries, actor, reason, and timestamps.
- Per-account session revocation immediately invalidates the target account's existing cookie.
- Registration, authentication-initiation, and player-mutation operational modes block only their intended operation and restore correctly.
- `authored_events_disabled` remains a schema/interface flag with reason `schema_only_until_event_engine`; no event execution is claimed.
- Anonymous, authenticated, and selected-player content previews produce distinct server-filtered representations. A selected player with `phase4.signal001.transcript` sees the transcript while unrelated fields remain redacted.
- Privileged browser UX was exercised manually for authentication/elevation, Player Inspector, discovery grant/revoke, inventory grant/revoke and ledger inspection, operational modes, content preview, and emergency global session revocation.

The emergency global session revocation check was run last and passed:

- response status: `200`
- response: `ok: true`, `revoked: 19`, `initiatingSessionPreserved: true`
- the initiating Control Center session subsequently returned `200` from Admin Status, retained the hidden owner role and expected permissions, and remained elevated
- the latest `admin.sessions.revoke_global` audit event recorded `result: allowed`, a populated request ID, `{"revoked":19,"initiatingSessionPreserved":true,"reason":"control-center"}`, and timestamp `2026-08-18 18:24:28`

### Automated staging validator

`npm run validate:staging` runs safe, repetitive end-to-end checks against the already-running loopback staging server and its configured SQLite database. On the Windows staging server, use the DPAPI launcher action so the existing protected secrets are supplied only to the child validation process:

```powershell
cd C:\OFA\staging\repo\backend
.\tools\windows-staging-secrets.ps1 -Action RunValidation
```

The validator:

- refuses any environment other than development, staging, or test
- refuses a non-loopback validation target
- requires the protected runtime secrets and configured SQLite database
- checks health and all repository migration versions
- creates random disposable `system_admin` and ordinary-player fixtures; it never treats `noobuus` or any username as authorization
- performs authorization, ordinary `/me` disclosure, same-session CSRF, staging fresh-auth, and elevation checks through the running HTTP server
- exercises typed discovery, quantity inventory, fictional-clearance, operational-mode, and content-preview behavior
- verifies request-linked privileged audit entries directly in SQLite
- restores the exact pre-run operational-mode rows in a `finally` cleanup path
- removes fixture accounts, sessions, elevations, roles, discoveries, inventory state/definitions, rate-limit buckets, and harness audit rows
- never prints session, CSRF, email-link, encryption, or pepper values
- never invokes emergency global session revocation

Representative output:

```text
PASS            health
PASS            schema migrations - 4 applied
PASS            admin authorization boundary
PASS            ordinary /me role hiding
PASS            same-session CSRF
PASS            staging fresh-auth and elevation
PASS            discovery grant/revoke
PASS            inventory grant/revoke ledger
PASS            fictional clearance typed operation
PASS            operational modes restore
PASS            Archive visibility and preview
PASS            privileged audit history - 17 request-linked entries verified
SKIP            emergency global session revocation - MANUAL REQUIRED; intentionally destructive
SKIP            privileged browser UX - MANUAL REQUIRED
SKIP            production-only security behavior - MANUAL REQUIRED
```

The audit count is informational and may increase as additional audited reads are added. Passing requires the specific grant, revoke, clearance, mode, and preview actions, not an exact count.

### Manual validation disposition

Completed:

- Privileged audit history passed through the physical validator, including required action presence and absence of reusable auth/session/CSRF material in the checked entries.
- The typed fictional-clearance operation passed through the physical validator, including persistence and confirmation that fictional clearance did not grant real admin access.
- Emergency global session revocation passed manually, including audit verification and preservation of the initiating elevated session.
- Privileged browser UX passed based on the Control Center workflows exercised throughout physical Phase 5 validation. No untested browser behavior is claimed.

Deferred, not passed or simulated:

- Production-only security behavior remains deferred until a real production environment exists. Loopback staging is not treated as evidence of production behavior. This does not block Phase 5 closure because production deployment and production-only integration validation are explicitly outside Phase 5 scope.

### Full server update and validation

From `C:\OFA\staging\repo\backend`:

```powershell
git fetch origin
git switch ofa-2-phase-5-admin-control-center
git pull --ff-only
npm run migrate:server
npm run seed:phase4-staging
npm test
npm run backup:server:check
.\tools\windows-staging-secrets.ps1 -Action RunServer
```

With the server running in that PowerShell window, open a second fresh PowerShell window and run:

```powershell
cd C:\OFA\staging\repo\backend
.\tools\windows-staging-secrets.ps1 -Action RunValidation
```

Manual validation:

1. Confirm `GET http://127.0.0.1:8787/api/v1/health` is healthy.
2. Confirm `http://127.0.0.1:8787/` still loads the existing OFA site.
3. Confirm ordinary `/api/v1/me` for `noobuus` does not expose owner, permissions, elevation, internal ID, or creator/order data.
4. Confirm `/admin/control-center.html` returns 404 for ordinary accounts.
5. Confirm `/admin/control-center.html` loads for `noobuus` only because of hidden real owner authorization.
6. Start a fresh email-link authentication ceremony for `noobuus`.
7. If the staging email-link start limit has already been reached during validation, use the Control Center's staging fresh-auth helper instead.
8. Confirm elevation from the fresh session and verify the 10-minute elevation state only inside `/api/v1/admin/me`.
9. Inspect a test player by username.
10. Grant and revoke a test discovery.
11. Grant and revoke stackable test inventory without allowing negative quantity.
12. Grant and revoke an individual instance item without deleting item identity/history.
13. Toggle registration/auth/player-mutation operational modes and confirm they affect only the intended flows.
14. Revoke one test account's sessions and confirm that account receives 401 afterward.
15. Run emergency global session revocation and confirm the initiating admin session is preserved.
16. Confirm staging remains bound to `127.0.0.1`.

## Acceptance Criteria

Status: complete. Phase 5 is formally closed at the documentation checkpoint that records the successful physical validation above. The branch is frozen after that checkpoint unless an explicitly approved bug or security fix requires reopening it.

- [x] Branch starts from frozen Phase 4 checkpoint.
- [x] Existing static OFA remains unchanged and functional.
- [x] `/api/v1/health` remains healthy.
- [x] Existing Phase 1-4 regression tests pass.
- [x] Phase 5 and staging-validation harness tests pass.
- [x] Admin API namespace is hidden-role authorized.
- [x] `/admin/control-center.html` is unavailable to ordinary accounts.
- [x] Ordinary `/api/v1/me` remains player-safe for owner.
- [x] Owner/system_admin can use Player Inspector.
- [x] Developer/content/moderator roles cannot use full Player Inspector.
- [x] Username, fictional clearance, and client-supplied headers cannot escalate privileges.
- [x] Elevation requires fresh auth, CSRF, exact confirmation, server-side hidden permission, and expires after 10 minutes.
- [x] Staging fresh-auth helper is unavailable in production configuration and cannot be used by ordinary users or fictional-clearance-only accounts.
- [x] Typed discovery/inventory/session/operational-mode mutations are audited.
- [x] Stack inventory revoke cannot go negative.
- [x] Instance revoke preserves item identity/history.
- [x] Emergency global session revocation is gated, audited, and physically validated.
- [x] Authentication/recovery limits remain strict for privileged accounts.
- [x] Content preview can compare canonical truth to filtered representations.
- [x] No Phase 6 implementation was started.

## Deferred

- Public OFA 2.0 redesign.
- Steam integration.
- Game synchronization.
- Full event execution engine.
- Production email delivery.
- WebAuthn/passkey implementation.
- Public profiles/social features.
- Full content authoring/redaction/publishing UI.
- Final Inventory 2.0 player UI.
- Unrestricted SQL/server/filesystem access.
- Generic arbitrary grant/mutation endpoints.
