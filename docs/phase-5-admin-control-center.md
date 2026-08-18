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

Manual validation:

1. Confirm `GET http://127.0.0.1:8787/api/v1/health` is healthy.
2. Confirm `http://127.0.0.1:8787/` still loads the existing OFA site.
3. Confirm ordinary `/api/v1/me` for `noobuus` does not expose owner, permissions, elevation, internal ID, or creator/order data.
4. Confirm `/admin/control-center.html` returns 404 for ordinary accounts.
5. Confirm `/admin/control-center.html` loads for `noobuus` only because of hidden real owner authorization.
6. Start a fresh email-link authentication ceremony for `noobuus`.
7. Confirm elevation from the fresh session and verify the 10-minute elevation state only inside `/api/v1/admin/me`.
8. Inspect a test player by username.
9. Grant and revoke a test discovery.
10. Grant and revoke stackable test inventory without allowing negative quantity.
11. Grant and revoke an individual instance item without deleting item identity/history.
12. Toggle registration/auth/player-mutation operational modes and confirm they affect only the intended flows.
13. Revoke one test account's sessions and confirm that account receives 401 afterward.
14. Run emergency global session revocation and confirm the initiating admin session is preserved.
15. Confirm staging remains bound to `127.0.0.1`.

## Acceptance Criteria

- Branch starts from frozen Phase 4 checkpoint.
- Existing static OFA remains unchanged and functional.
- `/api/v1/health` remains healthy.
- Existing Phase 1-4 regression tests pass.
- Phase 5 tests pass.
- Admin API namespace is hidden-role authorized.
- `/admin/control-center.html` is unavailable to ordinary accounts.
- Ordinary `/api/v1/me` remains player-safe for owner.
- Owner/system_admin can use Player Inspector.
- Developer/content/moderator roles cannot use full Player Inspector.
- Username, fictional clearance, and client-supplied headers cannot escalate privileges.
- Elevation requires fresh auth, CSRF, exact confirmation, server-side hidden permission, and expires after 10 minutes.
- Typed discovery/inventory/session/operational-mode mutations are audited.
- Stack inventory revoke cannot go negative.
- Instance revoke preserves item identity/history.
- Emergency global session revocation is gated and audited.
- Authentication/recovery limits remain strict for privileged accounts.
- Content preview can compare canonical truth to filtered representations.
- No Phase 6 implementation is started.

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
