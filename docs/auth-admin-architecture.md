# Auth, Authorization, Admin, And Developer Access

This is a Phase 1 architecture document. It is not an implementation and does not change production behavior.

## Core Rules

- Never trust the client.
- Authentication is not authorization.
- Frontend navigation and hidden pages are not security.
- Important content access, progression, inventory grants, Steam entitlement, admin actions, and rare event eligibility are server decisions.
- OFA should not include hidden developer backdoors. Developer access must be deliberate, scoped, revocable, and logged.

## Authentication Direction

Phase 1 keeps anonymous public access. Accounts are planned but not forced.

Allowed identity providers over time:

- anonymous visitor ID
- email magic link
- passkey
- Steam

Avoid adding a plaintext-password system unless there is a strong reason. If passwords are ever added, use modern password hashing and normal account security controls.

## Session Model

Future account sessions should use secure, server-issued sessions:

- `HttpOnly`
- `Secure`
- `SameSite=Lax` or stricter where possible
- short-lived session plus refresh/re-auth pattern if needed
- server-side revocation support

Admin access should not store raw bearer tokens in browser localStorage.

## Authorization Model

Every protected resource should independently check whether the current actor can perform the exact requested action.

Examples:

- a user may read a public record but not a restricted fragment
- a logged-in account may read its own inventory but not another account's inventory
- a moderator may review submissions but not change Archive State
- a content admin may draft a transmission but not grant rare inventory
- a developer may inspect staging logs but not read production account data unless explicitly granted

## Role Set

Initial roles:

- `public`: anonymous visitor; public reads and moderated submissions
- `account`: authenticated user; own progress and inventory
- `tester`: staging-only feature testing
- `moderator`: submission/reports review
- `content_admin`: content, records, notices, transmissions, facilities, events
- `system_admin`: deployment/config/security operations
- `developer_readonly`: scoped code/state/log inspection, preferably staging-first
- `owner`: break-glass production control

Roles should be additive but not vague. Admin UI actions should map to explicit permissions.

## Permission Areas

- `records.read.public`
- `records.read.restricted`
- `records.write`
- `records.publish`
- `submissions.review`
- `archive_state.write`
- `events.schedule`
- `inventory.catalog.write`
- `inventory.grant`
- `accounts.read`
- `accounts.modify`
- `steam.review`
- `logs.read`
- `deploy.manage`
- `security.manage`

## Admin System

The future admin system should allow Lucas to manage OFA without raw code edits for ordinary content/world changes.

Target capabilities:

- create/edit/publish/unpublish records
- manage cases, incidents, transmissions, artifacts, facilities, notices, media
- upload and moderate media once uploads are safe
- create inventory definitions
- grant/revoke inventory with audit records
- create and activate Archive State events
- simulate events in staging
- review accounts and Steam linkage
- review submissions
- inspect audit/security logs
- push content revisions

## Developer And Codex Access

Developer tooling should remain possible after security hardens.

Acceptable access patterns:

- GitHub remains source of truth for code
- staging credentials separate from production credentials
- scoped service tokens for automated/dev tasks
- short-lived credentials where practical
- audit logs for privileged API actions
- read-only production diagnostics by default

Do not:

- create a secret URL that bypasses authorization
- embed dev master keys in frontend code
- give broad production database access when a scoped task token is enough

## Audit Logging

Log security/content-sensitive actions:

- login attempts and failures
- authorization denials
- admin actions
- content publishing
- Archive State changes
- inventory grants/revokes
- Steam linkage changes
- moderation actions
- deployment events
- backup and restore events

Logs must avoid storing unnecessary personal data.

