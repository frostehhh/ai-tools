---
date: 2026-11-10T00:00:00+00:00
git_commit: 5ce89dd6af2cbf5b7ec6db08b7ea5430ddf873e7
branch: fm/gcal-sync-spec
repository: ai-tools
---

# Notion ↔ Google Calendar Two-Way Sync

Split the demo into testable modules, then grow it one vertical slice at a time: config + module split, filtered create into a dedicated calendar, Notion-side updates/deletes, Calendar-side edits with conflicts, delete handling, reminders, legacy cleanup, docs. Each phase runs end-to-end and has unit tests for its pure logic. Design recommendations are assumed; any design question the captain answers differently changes the named phase.

## Desired End State

#### Sync behavior

- Active, upcoming tasks are all-day entries in an auto-created "Notion Tasks" calendar, 30 min poll.
- Title/date edits and deletions reconcile both ways against a stored baseline, without echo loops.
- Deleted entries set `Status=Archived/Dropped` and are never recreated.

#### Operability

- Validated `sync.config.json` with env overrides; presets and per-tag reminders; `reapply-reminders` and dry-run-first `cleanup-legacy`.
- `node --test` passes; docs updated.

## Implementation Overview

- [ ] Phase 1: Config, module split, test harness, API probe
- [ ] Phase 2: Filtered create into "Notion Tasks" (all-day)
- [ ] Phase 3: Notion → Calendar update and delete
- [ ] Phase 4: Calendar → Notion edits and conflicts
- [ ] Phase 5: Deleted entry → mark dropped
- [ ] Phase 6: Reminders and reapply
- [ ] Phase 7: Legacy cleanup
- [ ] Phase 8: Docs

---

## Phase 1: Config, module split, test harness, API probe

Behavior-preserving refactor of `server.js` into modules plus validated config. Adds a probe script that records answers to research V1-V14 before later phases depend on them.

### File Changes

- **`sync.config.json`**: defaults per design (30 min, time zone, property names, statuses, calendar name, reminders, twoWay).
- **`src/config.js`**: load file, apply env overrides, validate (interval ≥ 0 integer, IANA zone, statuses non-empty, reminder presets ≤ 5, `byTag` presets exist).
- **`src/state.js`**: `sync-state.json` v2 load/save with atomic write; corrupt file throws instead of resetting.
- **`src/notion.js`, `src/gcal.js`**: shared `request(slug, ...)` wrapper over `makeProxyRequest` (existing pattern).
- **`server.js`**: reduced to wiring; routes unchanged.
- **`scripts/probe-api.mjs`**: manual script that exercises PATCH/DELETE/GET on a scratch calendar and a Notion test page and prints a V1-V14 table.
- **`package.json`**: add `"test": "node --test"`.
- **`test/config.test.js`, `test/state.test.js`**.

```typescript
function loadConfig(env: NodeJS.ProcessEnv, filePath: string): Config { ... }
function loadState(file: string): State { ... }   // { version: 2, calendarId, lastRunAt, pages: {}, tombstones: {} }
```

### Validation

#### Automated Verification

- [ ] `npm test` (config validation and state round-trip, corrupt-file case)
- [ ] `node --check server.js`

#### Manual Verification

- [ ] `npm run dev` starts; `curl -s localhost:3000/api/accounts` works
- [ ] `node scripts/probe-api.mjs`; record V1-V14 results in `docs/research/probe-results.md` and tell the captain which fail

---

## Phase 2: Filtered create into "Notion Tasks" (all-day)

First end-to-end slice: filtered, paginated Notion query → find/create dedicated calendar → create all-day events tagged with `notionPageId`; state stores baseline; poll interval from config; run lock.

### File Changes

- **`src/notion.js`**: `queryTasks(config, todayISO)` with status `or` filter, `Due on_or_after`, cursor loop; `parseTask(page)` → `{ pageId, title, date: {start,end}, status, tags, lastEdited }`.
- **`src/mapping.js`**: `todayInZone(zone, now)`, `toAllDay({start,end})` → `{start:{date}, end:{date exclusive}}`, `fromAllDay`.
- **`src/gcal.js`**: `ensureCalendar(name)` (list, else insert), `createEvent`, event body with `extendedProperties.private.notionPageId`.
- **`src/sync.js`**: `runSync()` creating missing entries; skip pages already in state; in-process lock.
- **`server.js`**: `setInterval` from `pollIntervalMinutes` (0 = off); `/api/sync` returns 409 if running.
- **`test/mapping.test.js`, `test/notion.test.js`** (filter shape, pagination with fake responses), **`test/sync.test.js`** (fake proxy; restart does not duplicate).

```typescript
function toAllDay(d: {start: string, end?: string|null}): {start:{date:string}, end:{date:string}} { ... }
async function runSync(deps: Deps): Promise<SyncResult> { ... }
```

### Validation

#### Automated Verification

- [ ] `npm test` (single-day, range, datetime→date, month/year boundary, pagination, no duplicates on second run)

#### Manual Verification

- [ ] Task due today/Pending appears in "Notion Tasks" as all-day; past-due and Done tasks do not
- [ ] Restart server, `POST /api/sync`: no duplicate

---

## Phase 3: Notion → Calendar update and delete

Adds baseline comparison for the Notion side: title/date change patches the event; leaving status list or window deletes it.

### File Changes

- **`src/reconcile.js`**: pure `decide(n, e, b)` covering the Notion-only branches; `eligible(task, config, today)`.
- **`src/gcal.js`**: `listEvents(calendarId)` (mapped, `showDeleted`), `patchEvent`, `deleteEvent` (entry flagged `pendingDelete` and saved before DELETE; removed after success or 404/410; retried by later runs if DELETE fails).
- **`src/sync.js`**: loop applies actions, saves state after each page, refreshes baseline after write.
- **`test/reconcile.test.js`**: table-driven cases.

```typescript
type Action = { kind: 'create'|'patchEvent'|'deleteEvent'|'patchNotion'|'markDropped'|'noop'; ... }
function decide(n: Task|null, e: EventSnap|'cancelled'|null, b: Baseline|null, cfg: Config): Action[] { ... }
```

### Validation

#### Automated Verification

- [ ] `npm test` (Notion-only change, leave status, leave window, second run is noop)

#### Manual Verification

- [ ] Rename task and shift date in Notion; entry follows after `POST /api/sync`
- [ ] Mark task Done; entry disappears

---

## Phase 4: Calendar → Notion edits and conflicts

Adds Calendar-only and both-changed branches; Notion page patch; echo-loop protection.

### File Changes

- **`src/notion.js`**: `updatePage(pageId, {title, date})`.
- **`src/reconcile.js`**: extend `decide` with eChanged / conflict (newest wins, Notion on tie), log line on conflict.
- **`src/sync.js`**: respects `twoWay.calendarToNotion`; baseline refreshed from values written.
- **`test/reconcile.test.js`**: Calendar-only, both-same, both-differ each way, tie, three consecutive runs → noop.

### Validation

#### Automated Verification

- [ ] `npm test` (including echo-loop sequence test)

#### Manual Verification

- [ ] Edit entry title/date in Calendar; Notion `Name`/`Due` update after sync; next sync changes nothing

---

## Phase 5: Deleted entry → mark dropped

### File Changes

- **`src/reconcile.js`**: cancelled/missing event with mapping → `markDropped` + tombstone; entries flagged `pendingDelete` are excluded, so app-initiated deletes never hit this branch.
- **`src/notion.js`**: `setStatus(pageId, droppedStatus)` honoring status property type (V5).
- **`src/sync.js`**: retry pending tombstones; skip creation while tombstoned; honors `onEventDeleted`.
- **`test/reconcile.test.js`, `test/sync.test.js`**: user delete, failed Notion write retried, no recreate.

### Validation

#### Automated Verification

- [ ] `npm test`

#### Manual Verification

- [ ] Delete an entry in Calendar; task becomes `Archived/Dropped`; not recreated on next two syncs

---

## Phase 6: Reminders and reapply

### File Changes

- **`src/reminders.js`**: presets (`light`, `standard`, `heavy`) for all-day and timed, custom presets, `byTag` first-match, `toOverrides(preset, kind)`, max 5. Defaults use day-before times only; startup validation requires `allDay` and `timed` arrays and non-negative computed minutes.
- **`src/gcal.js`**: event body `reminders: { useDefault: false, overrides }` on create.
- **`src/sync.js`**: `reapplyReminders()`.
- **`server.js`**: `POST /api/reapply-reminders`.
- **`test/reminders.test.js`**.

### Validation

#### Automated Verification

- [ ] `npm test` (tag precedence, >5 rejected, unknown preset rejected)

#### Manual Verification

- [ ] New entry has expected popups; change preset, call reapply, entry updates
- [ ] Confirm all-day reminder timing against V9 on a phone/web

---

## Phase 7: Legacy cleanup

### File Changes

- **`src/legacy.js`**: list `primary` events whose description starts with `Synced from Notion task:`; delete only when `confirm`.
- **`server.js`**: `POST /api/cleanup-legacy` body `{ confirm?: boolean }`, default dry run.
- **`test/legacy.test.js`**: dry run never calls DELETE; confirm deletes only matches.

### Validation

#### Automated Verification

- [ ] `npm test`

#### Manual Verification

- [ ] Dry run lists old entries and deletes none; confirmed run removes them

---

## Phase 8: Docs

### File Changes

- **`.env.example`**: add `SYNC_CONFIG_PATH` (if used) and note config overrides; fix `NOTION_DATE_PROPERTY` default.
- **`README.md`**: two-way behavior, config reference, endpoints, limits (30 min lag, datetime → date).
- **`AGENTS.md`**: replace 60s polling and 09:00 UTC notes; new state file, module layout, `npm test`.
- **`.gitignore`**: `sync-state.json`, `synced-tasks.json`.

### Validation

#### Automated Verification

- [ ] `grep -rn "60" README.md AGENTS.md` shows no stale polling claim

---

## Open Questions

- Pending captain answers to the open Design Questions; phases 2-6 change if those differ.
- Probe results (V1-V14) may require reordering Phase 3-5 if PATCH/DELETE are blocked.
