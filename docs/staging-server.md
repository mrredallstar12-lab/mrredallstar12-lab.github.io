# Staging Server Skeleton

This is the first implementation step after Phase 0/1 approval.

## Locked Decisions

- Lucas's physical server is the primary initial deployment target.
- The backend keeps the Worker-style request-handler core.
- The server runtime is a thin adapter around standard `Request`/`Response`.
- SQLite is the initial staging database.
- Database access is kept behind an adapter boundary so PostgreSQL can replace it later.
- Production remains untouched.

## What The Skeleton Does

- serves the current static OFA site unchanged
- exposes `GET /api/v1/health`
- keeps other `/api/*` routes disabled in the server skeleton for now
- reads environment-specific config externally
- emits basic structured JSON logs
- can initialize a SQLite-backed D1-like adapter when `OFA_SQLITE_PATH` is set

## Local Run

This first staging deployment is local-only on the Windows 11 Pro x64 server.

Assumptions:

- Node 24 LTS is installed and available as `node`.
- Repository path is `C:\OFA\staging\repo`.
- Server binds to `127.0.0.1:8787`.
- No public hostname yet.
- No reverse proxy or TLS yet.
- Manual process only. Do not install Docker, PM2, NSSM, or another wrapper for this first validation.
- SQLite database path is under `C:\OFA\staging\data`.
- SQLite staging backups go to `E:\OFA\backups\staging`.
- Staging logs go to `E:\OFA\logs\staging`.

### 1. Prepare Folders

Run in PowerShell:

```powershell
New-Item -ItemType Directory -Force -Path C:\OFA\staging\repo
New-Item -ItemType Directory -Force -Path C:\OFA\staging\data
New-Item -ItemType Directory -Force -Path E:\OFA\backups\staging
New-Item -ItemType Directory -Force -Path E:\OFA\logs\staging
```

### 2. Install Node

Install Node 24 LTS for Windows x64 from the official Node.js installer.

Verify:

```powershell
node --version
```

Expected major version:

```text
v24.x.x
```

### 3. Place The Repository

Clone or copy the repo into:

```text
C:\OFA\staging\repo
```

The backend directory should exist at:

```text
C:\OFA\staging\repo\backend
```

### 4. Create Server Config

From `C:\OFA\staging\repo\backend`:

```powershell
Copy-Item .env.server.example .env.server
```

Confirm `backend\.env.server` contains:

```text
OFA_ENV=staging
OFA_HOST=127.0.0.1
OFA_PORT=8787
OFA_PUBLIC_BASE_URL=http://127.0.0.1:8787
OFA_ALLOWED_ORIGINS=http://127.0.0.1:8787,http://localhost:8787
OFA_STATIC_ROOT=..
OFA_SQLITE_PATH=C:\OFA\staging\data\ofa-staging.sqlite
OFA_LOG_LEVEL=info
```

Do not put production secrets in this file for the first staging validation.

### 5. Run Tests

From `C:\OFA\staging\repo\backend`:

```powershell
node tests/run-tests.mjs
node tests/run-server-tests.mjs
```

Expected:

```text
5 backend validation tests passed
server staging skeleton tests passed
```

### 6. Start Local Staging

From `C:\OFA\staging\repo\backend`:

```powershell
node src/server/server.js *> E:\OFA\logs\staging\ofa-staging-$(Get-Date -Format yyyyMMdd-HHmmss).log
```

Keep that PowerShell window open. Stop staging with `Ctrl+C`.

Then open locally on the server:

- `http://127.0.0.1:8787/`
- `http://127.0.0.1:8787/api/v1/health`

Expected health response includes:

```json
{
  "ok": true,
  "version": "v1",
  "db": true
}
```

The response also includes `r2` and `now`.

### 7. Create A Manual SQLite Backup

This staging skeleton only creates the SQLite file and exposes health. For the first manual backup, stop the server with `Ctrl+C`, then run:

```powershell
Copy-Item -LiteralPath C:\OFA\staging\data\ofa-staging.sqlite -Destination E:\OFA\backups\staging\ofa-staging-$(Get-Date -Format yyyyMMdd-HHmmss).sqlite -Force
```

If the SQLite file does not exist yet, start staging once and hit `/api/v1/health`, then stop it and retry.

## Configuration

Use `backend/.env.server` or process environment variables.

Required for staging:

- `OFA_ENV`
- `OFA_HOST`
- `OFA_PORT`
- `OFA_PUBLIC_BASE_URL`
- `OFA_ALLOWED_ORIGINS`
- `OFA_STATIC_ROOT`
- `OFA_SQLITE_PATH`
- `OFA_LOG_LEVEL`

Do not hard-code:

- server IP
- home network topology
- physical location
- router details
- DNS provider details
- secrets
- absolute machine-specific paths in source

## Deployment Notes

1. Clone or update the repository at `C:\OFA\staging\repo`.
2. Create `backend\.env.server` from `backend\.env.server.example`.
3. Keep first staging bound to `127.0.0.1:8787`.
4. Start the server manually with Node from `C:\OFA\staging\repo\backend`.
5. Redirect process output to `E:\OFA\logs\staging`.
6. Verify `/api/v1/health`.
7. Verify the static homepage.
8. Create a manual SQLite backup in `E:\OFA\backups\staging`.
9. Do not expose staging externally.
10. Do not point production DNS at this skeleton.

## Rollback Notes

For staging:

1. Stop the manual PowerShell process with `Ctrl+C`.
2. Revert the working tree to the previous known-good revision if needed.
3. If a later migration has run, stop the server and copy the chosen backup from `E:\OFA\backups\staging` back to `C:\OFA\staging\data\ofa-staging.sqlite`.
4. Start the server manually again.

For production:

- no rollback action should be needed from this step because production is not changed.

## Validation Checkpoint

Physical-server staging validation passed.

Environment:

- Windows 11 Pro x64
- Node 24.19.0
- Git branch: `ofa-2-phase-0-1-planning`
- Commit: `cfe111728a826d9e2e2d096467779c302f5f7784`
- Bind: `127.0.0.1:8787`

Confirmed:

- backend tests pass
- staging-server tests pass
- `npm run dev:server` stays running
- startup log contains `ofa_staging_server_started`
- `GET /api/v1/health` returns `ok: true`, `version: v1`, and `db: true`
- existing OFA static website loads at `http://127.0.0.1:8787/`
- staging remains local-only
- production and `main` remain untouched
