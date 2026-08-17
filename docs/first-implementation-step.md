# First Implementation Step

Recommended first implementation step after Phase 0/1 approval:

Build a server-hosted staging skeleton on Lucas's physical server that serves the current static site unchanged and exposes a read-only `/api/v1/health` endpoint from the future OFA 2.0 backend runtime.

## Why This First

It proves the deployment path without changing production behavior or migrating data.

It also forces the right operational questions early:

- how the server process runs
- how environment variables are supplied
- how logs are collected
- how TLS/reverse proxying works
- how staging differs from production
- how deployment and rollback will work
- how the app remains portable to another host

## Scope

Do:

- create server runtime skeleton
- externalize config
- serve current static files in staging
- expose `GET /api/v1/health`
- add basic structured logs
- document start/stop/deploy/rollback
- add a no-data backup rehearsal placeholder
- keep existing frontend behavior unchanged

Do not:

- move production
- change DNS for production
- migrate user data
- force accounts
- replace the current backend API in production
- expose admin tools publicly
- enable uploads
- implement Steam linking

## Acceptance Criteria

- staging URL loads the same current OFA static site
- `GET /api/v1/health` responds from the server runtime
- app config contains no hard-coded server IP or local network details
- logs show request and error entries without private visitor data
- deployment can be repeated from a clean checkout
- rollback procedure is written down
- production remains untouched

