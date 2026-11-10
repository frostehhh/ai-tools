# Task

Make `tools/pipedream/notion-to-google-calendar` a two-way sync between one Notion tasks database and a dedicated Google Calendar. Currently one-way, create-only, unfiltered, 60s hardcoded poll.

## Goal

Tasks due today or later, with active statuses, show as all-day entries in a "Notion Tasks" Google Calendar with notifications. Edits sync both ways.

## Context

- Notion DB: "Todos" (`8b56a66a74b0470aa8bfaf8dabd78b87`). Title prop `Name`, date prop `Due`, status prop `Status`, tags prop `Tags`.
- Current behavior (`server.js`): polls every 60s, unfiltered query (100 max, no pagination), creates event on `primary` calendar, stores only page IDs in `synced-tasks.json`. No update, delete, status, or reminder handling. Date-only becomes 09:00 UTC, 1h.
- Legacy events in `primary` have description `Synced from Notion task: <title>`.

## Requirements

1. **Config file** `sync.config.json` (no secrets): poll interval, time zone, Notion DB/property names, statuses, calendar name, reminders, two-way options. Env vars still override. Validated at startup.
2. **Interval**: every 30 min (`pollIntervalMinutes: 30`). `0` disables auto-poll. `POST /api/sync` stays for on-demand.
3. **Window**: pages with `Due >= start of today` (config time zone), no upper bound. Paginate Notion query.
4. **Statuses**: sync Pending, In progress, On-hold. Configurable list.
5. **Calendar**: dedicated "Notion Tasks" calendar, auto-created if missing. Never touch other calendars.
6. **Entries**: all-day. Title = task `Name`.
7. **Notion → Calendar**: create, update on title/date change, delete when task leaves status list or window.
8. **Calendar → Notion**: changed entries since last run write title to `Name` and date to `Due`. Deleted entry sets `Status` to `Archived/Dropped` (`onEventDeleted: markDropped`). New entries created in Calendar are ignored.
9. **Mapping/state**: entry carries `extendedProperties.private.notionPageId`. State stores `pageId -> { eventId, baseline }`. Baseline = title/date at last sync.
10. **Conflicts**: compare each side to baseline. One side changed -> copy. Both changed -> latest edit wins, log it. Refresh baseline after every write to avoid echo loops.
11. **Reminders**: popup notifications set on create. Presets `light`, `standard` (default), `heavy`, separate for all-day and timed. Custom presets and per-tag override (`byTag`, first matching tag wins). Max 5 per entry, validated. `POST /api/reapply-reminders` refreshes existing.
12. **Legacy cleanup**: `POST /api/cleanup-legacy`, dry run by default, lists `primary` entries with the legacy description. Deletes only after explicit confirm.
13. **Docs**: update `.env.example`, `README.md`, `AGENTS.md` (60s polling note).

## Out of scope

- Syncing reminders, status, or tags back to Notion.
- Creating Notion pages from Calendar entries.
- Multiple databases or users (`USER_ID` stays `demo-user-1`).
- Production Pipedream environment.

## Acceptance

- Task due today with an active status appears in "Notion Tasks" within one poll, with default reminders.
- Changing title/date in Notion updates the entry. Changing it in Calendar updates Notion. No echo loops across consecutive runs.
- Completing a task in Notion removes its entry.
- Deleting an entry sets the task to `Archived/Dropped`, and it is not recreated.
- Restart does not duplicate entries.
- Legacy dry run lists old entries, deletes none.

## Risks

- Pipedream dev proxy may block `PATCH`/`DELETE` on Google Calendar or Notion. Verify first.
- All-day end dates are exclusive in Google. Date ranges need mapping tests.
- Edits take up to 30 min to appear on the other side.
- Calendar all-day reminders count from 00:00 of event day. Verify in testing.

## Open Questions

- None.
