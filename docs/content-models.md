# OFA 2.0 Content Models

OFA 2.0 should not treat every object as a case. The Archive needs first-class types that can reference each other.

## Core Types

### Record

Generic archival document and parent model for most public content.

Fields:

- `id`
- `slug`
- `record_type`
- `title`
- `summary`
- `body`
- `status`
- `visibility`
- `clearance_level`
- `tags_json`
- `related_record_ids_json`
- `created_at`
- `updated_at`
- `published_at`

Record types:

- `case`
- `incident`
- `transmission`
- `artifact`
- `media`
- `facility`
- `personnel`
- `notice`
- `entity`
- `work_order`

### Case

Formal investigation. Current `case_files` can evolve into this model.

Additional fields:

- `record_id`
- `case_number`
- `risk_level`
- `containment_status`
- `assigned_unit`
- `fiction_disclaimer`
- `progression_rules_json`

### Incident

An event that occurred.

Fields:

- `id`
- `record_id`
- `incident_code`
- `severity`
- `started_at`
- `ended_at`
- `affected_systems_json`
- `facility_id`
- `resolution_status`

### Transmission

Signal, broadcast, frequency event, recording, or decoded message.

Fields:

- `id`
- `record_id`
- `channel`
- `frequency`
- `source`
- `transcript`
- `media_asset_id`
- `signal_strength`
- `decoded_state`
- `available_from`
- `available_until`

### Artifact

Recovered physical or digital object.

Fields:

- `id`
- `record_id`
- `artifact_code`
- `name`
- `classification`
- `description`
- `handling_notes`
- `effects_json`
- `media_asset_id`

### Media Asset

Image, audio, video, document scan, or future evidence file.

Fields:

- `id`
- `storage_provider`
- `storage_key`
- `public_url`
- `mime_type`
- `size_bytes`
- `width`
- `height`
- `duration_seconds`
- `provenance`
- `moderation_status`

### Facility

OFA facility, room, monitored location, or internal system.

Fields:

- `id`
- `slug`
- `name`
- `facility_type`
- `parent_id`
- `access_level`
- `state_key`
- `description`
- `coordinates_json`

## Accounts

Accounts should be optional at first. Anonymous public browsing remains supported.

### User

- `id`
- `display_name`
- `created_at`
- `last_seen_at`
- `status`
- `role`

### User Identity

- `id`
- `user_id`
- `provider`
- `provider_subject`
- `email_hash`
- `created_at`

Providers:

- `anonymous_visitor`
- `email_magic_link`
- `passkey`
- `steam`

Steam IDs are provider subjects, not primary user IDs. A user can link multiple identities over time.

### User Progress

- `user_id`
- `progress_key`
- `value_json`
- `updated_at`

Progress keys include:

- `records`
- `cases`
- `rooms`
- `transmissions`
- `achievements`
- `puzzle_flags`
- `archive_state_seen`
- `game_sync`

## Inventory 2.0

Existing local `oddInventory` remains valid. Server sync must be explicit and consent-based.

### Inventory Item

Canonical definition.

- `id`
- `slug`
- `name`
- `item_type`
- `rarity`
- `description`
- `stackable`
- `tradeable`
- `steam_mappable`
- `effects_json`
- `source_record_id`

### User Inventory

Current state per account.

- `user_id`
- `item_id`
- `quantity`
- `state_json`
- `created_at`
- `updated_at`

### Inventory Ledger

Append-only source of truth.

- `id`
- `user_id`
- `item_id`
- `delta`
- `reason`
- `source_event_id`
- `idempotency_key`
- `created_at`

## Archive State

Archive State replaces unrelated random gimmicks with authored, inspectable state.

State categories:

- `signal_activity`
- `integrity`
- `containment_state`
- `network_condition`
- `facility_state`
- `active_event`
- `current_transmissions`
- `observer_state`
- `global_flags`

### Archive Event

- `id`
- `event_type`
- `scope`
- `status`
- `starts_at`
- `ends_at`
- `priority`
- `eligibility_json`
- `effects_json`
- `completion_json`
- `reward_json`
- `created_by`
- `created_at`

Scopes:

- `global`
- `visitor`
- `account`
- `facility`
- `record`
- `session`

## Authorization

Every protected resource should answer this independently:

Can this exact actor access this exact resource right now?

Roles:

- `public`
- `account`
- `tester`
- `moderator`
- `content_admin`
- `system_admin`
- `developer_readonly`
- `owner`

Frontend navigation is not authorization.

