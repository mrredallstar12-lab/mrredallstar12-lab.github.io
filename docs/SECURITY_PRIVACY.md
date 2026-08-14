# Security and Privacy Notes

## XSS and HTML Injection

- Frontend renderers escape dynamic text with local `clean()` helpers.
- Worker input is sanitized with `cleanText()`.
- Public submissions are stored as text and remain pending moderation.
- Do not render untrusted submission HTML as HTML.

## SQL Injection

- Worker database writes use D1 prepared statements and bound parameters.
- Migration SQL defines fixed schemas; user values are never concatenated into SQL.

## Rate Limiting and Replay Protection

- Worker uses a D1 `rate_limits` table where DB is available.
- Objective and creature endpoints support idempotency keys.
- Event ingestion caps amount values and body sizes.

## CORS

Allowed origins:

- `https://oddfrequencyarchive.com`
- `https://www.oddfrequencyarchive.com`
- `https://mrredallstar12-lab.github.io`
- localhost/127.0.0.1 development origins

Origins are normalized before comparison.

## CSRF

Public endpoints accept anonymous fictional events only and do not mutate account data.

Admin endpoints require an `Authorization: Bearer <ADMIN_TOKEN>` header checked in the Worker. They should not be exposed through cookies, which reduces CSRF risk for the initial foundation.

## Secrets

- Real `wrangler.toml`, `.dev.vars`, API tokens, Cloudflare IDs, and local logs are ignored.
- Use Wrangler secrets for `ADMIN_TOKEN` and `TURNSTILE_SECRET_KEY`.

## Moderation and Uploads

The initial backend stores text submissions only. R2 is reserved for future evidence media. Before enabling uploads, implement:

- allowed MIME list
- size limits
- safe generated filenames
- extension validation
- image dimension checks
- malware scanning where available
- moderation before publication
- report/appeal workflow

## Logging

Do not log full IP addresses in application tables. If platform-level logs contain IPs transiently, do not expose them to visitors or admins in OFA interfaces.
