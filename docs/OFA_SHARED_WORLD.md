# Odd Frequency Archive Shared World Plan

This document records the current architecture and the first server-backed expansion layer.

## Current Static Architecture

- `index.html` is the public homepage and keeps the canonical colorful retro layout.
- `pages/*.html` are static GitHub Pages documents with inline handlers.
- `css/style.css` is the global stylesheet, including existing public OFA visuals, scoped corrupted/beyond styles, popup styles, radio styles, inventory/achievement/shop cards, and Living Archive systems.
- `js/main.js` is the existing large compatibility script. It owns legacy/local systems: localStorage inventory, currencies, achievements, fake popups, ad storm, quiet signal, VDO logo/trail, radio, CRT, aquarium, fake desktop, guestbook, corrupted passage, Living Archive, Expansion Wing, quests, shop, and inline handler exports.
- `js/ofa-api.js` is the new progressive-enhancement client. It does not replace `main.js`.
- `js/ofa-unlisted.js` owns hidden Unlisted Wing/case/employee mechanics.
- `assets/audio/` contains local radio station WAV files.
- `assets/cases/` contains original non-identifying SVG case placeholders and a provenance manifest.
- `backend/` contains the Cloudflare Worker/D1/R2 foundation.

## Design Constraint

The public OFA appearance remains the default. Horror/case effects are additive, scoped, reversible, and conservative by default.

Normal public pages must not be redesigned, permanently darkened, or made unusable by story state. Extended public effects require:

- `Restore Public Archive` control
- reduced-motion support
- session/local reset path
- no mutation of inventory, currencies, achievements, settings, or progression

## Progressive Enhancement

1. Static/local OFA works without the backend.
2. `ofa-api.js` creates a random anonymous visitor ID in `localStorage`.
3. If `window.OFA_API_BASE_URL` or `localStorage.oddApiBaseUrl` is set, the frontend tries the Worker API.
4. API failures fall back to deterministic local data.
5. Events are queued locally and retried later.

## Configuring API Base URL

For local testing:

```js
localStorage.oddApiBaseUrl = "http://localhost:8787";
```

For production, inject before `js/ofa-api.js`:

```html
<script>window.OFA_API_BASE_URL = "https://YOUR_WORKER_HOST";</script>
```

No Worker host is hardcoded into the repo.

## New Frontend Systems

- Anonymous visitor badge: `ofaVisitorId`
- Signal of the Day: `GET /api/v1/signal/today` with local fallback
- Global Archive Condition: `GET /api/v1/condition`
- Dynamic archive weather: `GET /api/v1/weather`
- Live anonymous activity feed: `GET /api/v1/activity`
- Shared popup graveyard aggregate: event hook around local popup burial
- Daily collective objectives: `GET /api/v1/objectives`
- Archive Creature: `GET /api/v1/creature`, `POST /api/v1/creature/feed`
- Server/community alchemy hints: `GET /api/v1/alchemy/recipes`
- Artifact Inspection Desk: added inside Object Shrine
- Hidden Unlisted Wing and fictional cases
- Archive Employee Terminal
- Admin foundation page backed by Worker token enforcement

## Hidden Story Entry

The Unlisted Wing is not in normal public navigation or the sitemap.

Entry methods:

- Type `unlisted` on a normal page.
- Open `pages/unlisted.html?dev=1` on localhost or `127.0.0.1` for developer testing.
- Future server events, radio transmissions, artifact outputs, or map anomalies can reveal it.

## Fiction Policy

All case files are fictional. Do not use real missing people, real police files, real agencies, real phone numbers, real addresses, or real missing-person imagery.

Case portraits are original non-identifying SVG placeholders. If later replaced with generated images, generate original fictional archival portraits only and update `assets/cases/manifest.json`.

## Future Optional Accounts

The current implementation uses anonymous local identity only. Future account synchronization should migrate from local keys to server records by attaching a passkey/email-link account to the existing `ofaVisitorId` after explicit user action.

No plaintext password system should be introduced.
