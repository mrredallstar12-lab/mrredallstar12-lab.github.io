# Server Migration Plan

Lucas's current physical server is the primary initial deployment target for OFA 2.0. Phase 0/1 should design the backend, database, admin services, staging environment, logging, backups, and deployment flow around that server from the beginning.

This does not mean the application should depend on that specific machine forever. The architecture must remain portable to another physical server, VPS, or cloud host without application rewrites.

Do not make destructive server or production changes during Phase 0/1.

## Current Backend Shape

The repo currently targets Cloudflare Workers, D1, and future R2:

- API entry: `backend/src/index.js`
- migration: `backend/migrations/0001_initial.sql`
- seed data: `backend/seed.sql`
- config template: `backend/wrangler.toml.example`

The frontend already supports a configurable API base URL through:

- `window.OFA_API_BASE_URL`
- `localStorage.oddApiBaseUrl`

## Primary Initial Hosting Shape

Use Lucas's server as the first real OFA 2.0 deployment target:

- static staging host
- backend/API host
- database host
- admin service host
- logging target
- backup origin
- deployment rehearsal target

Preserve the existing `/api/v1` contract so the current frontend client can keep working while the runtime evolves.

## Portability Rules

- no hard-coded server IPs
- no hard-coded home network topology
- no hard-coded physical location
- no source-code assumptions about DNS provider, router, LAN, or machine name
- no committed secrets or machine-specific credentials
- environment-specific settings live in `.env`, service manager config, reverse proxy config, or secret storage
- database and file paths are config values
- public origins and CORS allowlists are config values
- backup destinations are config values
- deployment scripts should accept target/environment parameters

The same application package should be able to run on:

- Lucas's current physical server
- a replacement physical server
- a VPS
- a cloud VM/container host

## Backend Runtime Direction

The existing Worker code should be treated as the API contract and logic prototype. For the physical server target, Phase 1 should decide whether to:

1. adapt the current Worker-compatible handlers to a server runtime, or
2. keep a Worker-like request handler interface behind a small server adapter.

Either way:

- endpoint paths remain stable
- response shapes remain stable
- tests remain portable
- DB access is abstracted enough to migrate away from D1 if needed
- admin auth and rate limiting remain server-side

Do not make the frontend care which host implements `/api/v1`.

## Database Plan

Initial physical-server deployment should use a server-managed database with explicit backups. SQLite can work for early staging if the deployment is single-node and backups are disciplined; Postgres is the better long-term default once accounts, inventory ledger, admin tooling, and Steam sync become real.

Database rules:

- migrations are versioned in the repo
- staging and production use separate databases
- backups are automated before production writes matter
- restore is tested, not just assumed
- DB connection details stay externalized
- production data is never copied into development without deliberate redaction

## Admin Services

Admin tooling should run on the server but remain separated from public access:

- server-enforced roles
- audit logs for all content/security-sensitive actions
- no frontend-only admin gates
- no persistent admin token in browser localStorage
- scoped developer/admin credentials
- separate staging admin from production admin

## Logging

Server-hosted OFA 2.0 needs operational and security logs from the beginning:

- API errors
- auth attempts
- authorization denials
- admin actions
- content publishing
- inventory grants/revokes
- Archive State changes
- suspicious rate-limit activity
- deployment events
- backup/restore results

Logs should avoid storing private visitor data. Public anonymous visitor labels remain privacy-safe.

## Backups

Backups should cover:

- database
- uploaded/recovered media once enabled
- admin/content configuration
- environment configuration inventory, excluding raw secret values
- deployment artifacts or tagged git revisions

Minimum expectations before production account data:

- scheduled database backups
- pre-deploy backup hook
- restore rehearsal in staging
- documented retention period
- documented rollback procedure

## Staging Checklist

- staging hostname resolves to server
- current static site served unchanged
- staging injects API base before `js/ofa-api.js`
- backend runs on Lucas's server or the server-equivalent adapter
- database uses staging credentials and staging data only
- API health endpoint responds
- CORS allows staging and rejects unknown origins
- admin endpoint rejects missing token
- admin endpoint accepts valid token only over HTTPS
- logs capture API/admin/security events
- backup job can run and restore can be rehearsed
- submissions remain pending
- visitor IDs are opaque and hashed server-side
- static fallback still works when API base is absent

## Production Cutover Rules

- no domain cutover until staging passes smoke tests
- no data migration without backup
- no account sync without user consent
- no protected content delivered only by hiding frontend links
- no Steam entitlement checks until current Steam API behavior is verified
- rollback path must be clear before any production switch
- no production cutover until server logs, backups, and restore rehearsal are in place
- no source change should be required to migrate from Lucas's current server to a different host

## Initial Smoke Tests

Static fallback:

- homepage loads
- inventory renders
- radio renders and can tune
- fake login stores no password
- Unlisted Wing is not in normal navigation
- admin page grants no access without backend token

API-backed staging:

- `/api/v1/health`
- `/api/v1/config`
- `/api/v1/signal/today`
- `/api/v1/condition`
- `/api/v1/weather`
- `/api/v1/activity`
- `/api/v1/objectives`
- `/api/v1/creature`
- `/api/v1/cases`
- `/api/v1/admin/submissions` rejects missing token
