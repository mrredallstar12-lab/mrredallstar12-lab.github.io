# Odd Frequency Archive Storage Schema

Existing `odd*` keys remain owned by `js/main.js`. The new shared-world layer uses `ofa*` keys and does not clear or rename existing data.

## New `ofa*` Keys

- `ofaVisitorId`: random opaque anonymous visitor ID.
- `ofaApiStatus`: latest API status string.
- `ofaWorldSettings`: shared-world settings object.
- `ofaSignalCache`: latest signal response or fallback.
- `ofaConditionCache`: latest condition response or fallback.
- `ofaWeatherCache`: latest archive weather response or fallback.
- `ofaActivityCache`: latest privacy-safe activity feed.
- `ofaObjectivesCache`: latest shared objectives.
- `ofaCreatureCache`: latest shared creature state.
- `ofaPendingEvents`: queued events to retry when API is reachable.
- `ofaUnlistedEntered`: local flag that the hidden wing was entered.
- `ofaPublicArchiveRestored`: session/local flag suppressing public mutations.
- `ofaEmployeeRecord`: fictional employee terminal state.
- `ofaCaseProgress`: Unlisted Wing/case stage state.
- `ofaCaseConclusions`: local in-story answers about Case 000.
- `ofaClerkLog`: scripted Records Clerk transcript.
- `ofaArtifactDeskLog`: Object Shrine artifact inspection log.

## Privacy Rules

- Do not store IP address, geolocation, browser fingerprint, email, name, or real identity.
- Visitor identity must remain random and resettable.
- Server tables store hashed visitor IDs for rate limiting/contribution dedupe.
- Public activity displays short labels like `VISITOR 1840`, never full IDs.

## Migration Strategy

Future optional accounts should:

1. Read existing local `odd*` and `ofa*` keys.
2. Ask for explicit user consent to sync.
3. Attach data to a server account created with passkeys or emailed sign-in links.
4. Preserve local play if the user declines.
5. Never silently delete local progress.
