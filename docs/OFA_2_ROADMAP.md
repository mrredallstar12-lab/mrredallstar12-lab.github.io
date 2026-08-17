# OFA 2.0 Roadmap

This document is the working Phase 0/1 source of truth for the OFA 2.0 migration.

## North Star

Odd Frequency Archive should feel like a functioning organization, not a website trying to be scary. The public surface should read as institutional, procedural, and credible. The abnormal material should emerge through contradictions, omissions, altered records, authorization boundaries, unusual system behavior, and rare breaks in tone.

The current site is not being discarded. OFA 1.0 contains useful prototypes: inventory, radio, objects, locked rooms, local progress, hidden records, Case 000, Unlisted Wing, shared API work, and backend foundations. OFA 2.0 should promote the strongest pieces into intentional systems.

## Production Rule

Do not destructively replace the live site until replacement systems are tested and ready.

The current GitHub Pages behavior remains valid:

- static pages work without a backend
- `js/main.js` keeps ownership of existing `odd*` localStorage keys
- `js/ofa-api.js` stays progressive and optional
- server-backed features must fail closed or fall back safely
- no forced accounts during Phase 0/1

## Phase 0 - Freeze And Audit

Goals:

- preserve the current production baseline
- document what exists
- classify every page and major feature
- identify safe incremental changes
- avoid runtime changes until architecture is explicit

Tasks:

- create a planning branch
- add a page/feature audit
- keep current production deployment untouched
- record the backend/API surface that already exists
- define migration guardrails
- confirm tests can run in the local environment

## Phase 1 - Architecture

Goals:

- define the OFA 2.0 information architecture
- define content, account, inventory, and event models
- define Lucas's physical server as the primary initial deployment target
- define staging, production, logging, backup, and security boundaries around that server
- preserve portability so OFA can later move to another physical server, VPS, or cloud host without application rewrites
- identify first additive backend changes

Phase 1 does not:

- redesign the whole public site
- delete pages
- force login
- expose secret content through frontend-only checks
- implement Steam linking
- enable user uploads
- move the production domain

## Information Architecture

Target public categories:

- Home
- Records
- Incidents
- Transmissions
- Recovered Media
- Artifacts
- Facilities
- Notices
- Archive Search
- Account
- Archive Status
- About / Policies

Current joke-first names can remain during migration, but should be recontextualized over time. Example: `Cursed Radio` becomes `Transmission Monitoring`; `Object Shrine` becomes `Artifact Registry`; `Fake Desktop` or `OddOS` becomes `Archive Workstation`.

## Security Principles

- never trust the client
- authentication is not authorization
- protected content requires server-side authorization
- important inventory/progression grants are server-authoritative
- admin features are server-enforced and audited
- no hidden developer backdoors
- developer access must be scoped, revocable, and logged
- OFA is not malware
- do not inspect unrelated files, browser history, apps, or private data
- designed technical rabbit holes are allowed; real vulnerabilities are not

## Environment Plan

Development:

- local testing
- disposable data
- fake accounts
- event simulation

Staging:

- production-like environment on Lucas's server or a server-equivalent host
- separate database and secrets
- API configured
- server deployment rehearsals
- logging and backup rehearsals
- tester/developer features enabled only when intended

Production:

- current public site remains stable
- separate production database and secrets
- production services initially target Lucas's server after staging proves the path
- no experimental feature flags unless explicitly promoted
- rollback path remains available

Portability:

- do not hard-code server IPs, home network topology, DNS details, filesystem paths, or physical location into application logic
- keep hostnames, ports, database URLs, storage paths, secrets, backup targets, and public API origins in environment-specific config
- use the same application package and migration flow across development, staging, and production
- document server assumptions as deployment configuration, not source-code behavior

## Server Deployment Sequence

1. Keep `oddfrequencyarchive.com` on the current production deployment.
2. Configure Lucas's server as the primary staging target.
3. Serve the current static repo unchanged from staging.
4. Run the OFA 2.0 backend on the server behind environment-specific config.
5. Configure staging to inject `window.OFA_API_BASE_URL`.
6. Preserve the existing `/api/v1` backend contract during the transition.
7. Apply staging migrations and seed data.
8. Configure server-side logs, health checks, and backup rehearsals.
9. Verify health, CORS, fallback behavior, admin rejection, and admin token acceptance.
10. Smoke-test static fallback and API-backed modes.
11. Add production API host only after staging passes.
12. Enable production API with a config-only change.
13. Move static production hosting later, only when rollback is understood.

## Implementation Order

1. Documentation and audit.
2. Additive schema foundations.
3. Read-only aggregate APIs.
4. Tests for security boundaries and fallback behavior.
5. Staging config.
6. Auth/authorization foundation.
7. Accounts and local progress migration.
8. Admin/content tooling.
9. Public rewrite.
10. Core system rebuilds.
11. Authored anomaly engine.
12. Restricted systems and hard puzzle chains.
13. Steam-ready integration.
14. Serious game development.

## First Safe Code Changes

These can happen before touching production behavior:

- add `docs/page-audit.json`
- add `docs/content-models.md`
- add `docs/server-migration.md`
- add additive-only schema migration for OFA 2.0 tables
- add read-only `GET /api/v1/archive-state`
- add read-only inventory catalog endpoint
- add backend tests for CORS, admin rejection, archive-state fallback, and catalog reads
- add staging-only API base injection
- add server deployment documentation with externalized env vars, logging, backups, and rollback steps
