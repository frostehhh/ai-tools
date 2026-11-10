---
date: 2026-11-10T00:00:00+00:00
git_commit: 5ce89dd6af2cbf5b7ec6db08b7ea5430ddf873e7
branch: fm/gcal-sync-spec
repository: ai-tools
---

# Notion ↔ Google Calendar Two-Way Sync Implementation Plan

## Overview

Make `tools/pipedream/notion-to-google-calendar` a two-way sync between the Notion "Todos" database and a dedicated "Notion Tasks" Google Calendar. Paths below are relative to that tool directory (`T/`). Design recommendations are assumed (module split, `node:test`, per-run full compare, state v2, tombstones).

## Current State Analysis

Single-file create-only sync; see `research.md`.

### Key Discoveries:
- Only `POST` is used through `pd.makeProxyRequest`; PATCH/DELETE/GET unproven (`server.js:57-75`, research V1-V3).
- State holds page IDs only; no event IDs (`server.js:28-41`), so update/delete is impossible today.
- Date prop default is `Due date`; task says `Due` (`server.js:24`).
- State is saved once per pass, and a read error resets it silently (`server.js:30-34,167`).
- No tests, no `test` script (`package.json`).
- Must keep: SDK v1.8 call shapes (`AGENTS.md`), `USER_ID = demo-user-1`, `development` environment, `POST /api/sync`, `/api/notion-to-google-calendar`, UI routes.

## Desired End State

Per `task.md` acceptance. Verify with `npm test` plus the manual checks per phase.

## What We're NOT Doing

Syncing reminders/status/tags back (beyond `markDropped`); creating Notion pages from Calendar; multiple DBs/users; production Pipedream; webhooks; touching calendars other than "Notion Tasks" (except confirmed legacy cleanup in `primary`).

## Implementation Approach

Vertical slices, each runnable. Pure logic (mapping, reconcile, reminders, config) is isolated from I/O so it is covered by `node --test` with a fake `request`. Phase 1 includes a probe script so blocked-proxy risks surface before later phases.

---

## Phase 1: Config, module split, test harness, API probe

### Overview
Behavior-preserving split plus validated config, state v2, and a risk probe.

### Changes Required:

- [ ] 1.1 Config file

**File**: `T/sync.config.json` (new)
**Changes**: committed defaults, no secrets.

```json
{
  "pollIntervalMinutes": 30,
  "timeZone": "Asia/Manila",
  "notion": {
    "databaseId": null,
    "titleProperty": "Name",
    "dateProperty": "Due",
    "statusProperty": "Status",
    "tagsProperty": "Tags",
    "syncStatuses": ["Pending", "In progress", "On-hold"],
    "droppedStatus": "Archived/Dropped"
  },
  "calendar": { "name": "Notion Tasks" },
  "twoWay": { "calendarToNotion": true, "onEventDeleted": "markDropped" },
  "reminders": {
    "defaultPreset": "standard",
    "presets": {
      "light":    { "allDay": [{ "daysBefore": 1, "at": "18:00" }], "timed": [{ "minutes": 10 }] },
      "standard": { "allDay": [{ "daysBefore": 1, "at": "18:00" }, { "daysBefore": 1, "at": "21:00" }], "timed": [{ "minutes": 30 }, { "minutes": 10 }] },
      "heavy":    { "allDay": [{ "daysBefore": 2, "at": "18:00" }, { "daysBefore": 1, "at": "18:00" }, { "daysBefore": 1, "at": "21:00" }, { "daysBefore": 1, "at": "23:00" }], "timed": [{ "minutes": 1440 }, { "minutes": 60 }, { "minutes": 10 }] }
    },
    "byTag": {}
  }
}
```

Startup validation also requires every preset to have both `allDay` and `timed` arrays, and every computed all-day minutes value (`daysBefore*1440 - mins(at)`) to be a non-negative integer. A preset failing either check is a config error at startup, not a runtime throw.

Time zone value is a placeholder; the captain's zone is an open question.

- [ ] 1.2 Config loader

**File**: `T/src/config.js` (new)
**Changes**: file < env override, validation that throws one aggregated error at startup.

```js
import fs from 'fs';

const REQUIRED_ENV = ['PIPEDREAM_CLIENT_ID', 'PIPEDREAM_CLIENT_SECRET', 'PIPEDREAM_PROJECT_ID'];

export function loadConfig(env = process.env, file = env.SYNC_CONFIG_PATH || 'sync.config.json') {
  const base = JSON.parse(fs.readFileSync(file, 'utf8'));
  const cfg = structuredClone(base);
  if (env.NOTION_DATABASE_ID) cfg.notion.databaseId = env.NOTION_DATABASE_ID;
  if (env.NOTION_TITLE_PROPERTY) cfg.notion.titleProperty = env.NOTION_TITLE_PROPERTY;
  if (env.NOTION_DATE_PROPERTY) cfg.notion.dateProperty = env.NOTION_DATE_PROPERTY;
  if (env.POLL_INTERVAL_MINUTES) cfg.pollIntervalMinutes = Number(env.POLL_INTERVAL_MINUTES);
  if (env.SYNC_TIME_ZONE) cfg.timeZone = env.SYNC_TIME_ZONE;
  validate(cfg, env);
  return cfg;
}

export function validate(cfg, env = {}) {
  const errs = [];
  if (!Number.isInteger(cfg.pollIntervalMinutes) || cfg.pollIntervalMinutes < 0)
    errs.push('pollIntervalMinutes must be an integer >= 0');
  try { new Intl.DateTimeFormat('en-US', { timeZone: cfg.timeZone }); }
  catch { errs.push(`invalid timeZone: ${cfg.timeZone}`); }
  if (!cfg.notion.syncStatuses?.length) errs.push('notion.syncStatuses must be non-empty');
  if (!cfg.calendar?.name) errs.push('calendar.name required');
  if (!['markDropped', 'ignore'].includes(cfg.twoWay.onEventDeleted))
    errs.push('twoWay.onEventDeleted must be markDropped|ignore');
  const presets = cfg.reminders.presets;
  for (const [name, p] of Object.entries(presets))
    for (const kind of ['allDay', 'timed'])
      if ((p[kind]?.length ?? 0) > 5) errs.push(`preset ${name}.${kind} has more than 5 reminders`);
  for (const name of [cfg.reminders.defaultPreset, ...Object.values(cfg.reminders.byTag)])
    if (!presets[name]) errs.push(`unknown preset: ${name}`);
  for (const k of REQUIRED_ENV) if (!env[k] && env === process.env) errs.push(`${k} not set`);
  if (errs.length) throw new Error(`Invalid config:\n- ${errs.join('\n- ')}`);
}
```

- [ ] 1.3 State v2

**File**: `T/src/state.js` (new)
**Changes**: atomic write; corrupt file throws; missing file yields empty state.

```js
import fs from 'fs';

export const emptyState = () => ({ version: 2, calendarId: null, lastRunAt: null, pages: {}, tombstones: {} });

export function loadState(file) {
  if (!fs.existsSync(file)) return emptyState();
  const s = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (s.version !== 2) throw new Error(`Unsupported state version in ${file}`);
  return s;
}

export function saveState(file, state) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, file);
}
```

- [ ] 1.4 Vendor wrappers

**File**: `T/src/vendor.js` (new)
**Changes**: move `getAccountBySlug` and a shared `request` here (pattern from `server.js:45-49,57-75`); `makeVendor(pd, userId)` returns `{ request }` so tests can inject a fake.

```js
export function makeVendor(pd, userId) {
  return {
    async request(slug, { url, method = 'GET', body }) {
      const resp = await pd.getAccounts({ external_user_id: userId });
      const account = (resp?.data || []).find((a) => a.app?.name_slug === slug);
      if (!account) throw new Error(`No ${slug} account connected.`);
      return pd.makeProxyRequest(
        { searchParams: { external_user_id: userId, account_id: account.id } },
        { url, options: { method, headers: { 'Content-Type': 'application/json', 'Notion-Version': '2022-06-28' },
                          body: body === undefined ? undefined : JSON.stringify(body) } }
      );
    },
  };
}
```

Note: sending `Notion-Version` to Google is harmless but should be set only for `notion` in implementation; keep per-slug headers.

- [ ] 1.5 Probe script

**File**: `T/scripts/probe-api.mjs` (new)
**Changes**: creates a scratch calendar "zz-probe", then for V1-V3, V9-V11, V14 does insert / GET / PATCH / DELETE of an all-day event with reminders, `events.list showDeleted`, and a second GET after delete; for Notion does GET database (V5-V7) and a PATCH on a page the captain passes via `PROBE_PAGE_ID` (V2, no-op patch of its own title). Prints a `V# | pass/fail | note` table; always deletes the scratch calendar. Never touches other calendars.

- [ ] 1.6 Wire server and test script

**File**: `T/server.js`, `T/package.json`
**Changes**: `server.js` loads config/state through the new modules, routes unchanged. Add `"test": "node --test"`.

- [ ] 1.7 Tests

**File**: `T/test/config.test.js`, `T/test/state.test.js` (new)

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../src/config.js';
import base from '../sync.config.json' with { type: 'json' };

test('rejects negative interval', () => {
  const cfg = structuredClone(base); cfg.pollIntervalMinutes = -1;
  assert.throws(() => validate(cfg, {}), /pollIntervalMinutes/);
});
test('rejects preset with 6 reminders', () => {
  const cfg = structuredClone(base);
  cfg.reminders.presets.heavy.timed = Array(6).fill({ minutes: 5 });
  assert.throws(() => validate(cfg, {}), /more than 5/);
});
test('rejects unknown byTag preset', () => {
  const cfg = structuredClone(base); cfg.reminders.byTag = { Work: 'nope' };
  assert.throws(() => validate(cfg, {}), /unknown preset/);
});
```

### Success Criteria:

#### Automated Verification:
- [ ] `npm test` passes
- [ ] `node --check server.js`

#### Manual Verification:
- [ ] `npm run dev` starts; `curl -s localhost:3000/api/accounts` returns accounts
- [ ] `node scripts/probe-api.mjs` run; results saved to `docs/research/probe-results.md` and add a row under `## Additional Spec Docs` in `research.md`; failures reported to the captain

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Filtered create into "Notion Tasks" (all-day)

### Overview
First end-to-end slice with filtered paginated query, dedicated calendar, all-day create, run lock, config-driven poll.

### Changes Required:

- [ ] 2.1 Date mapping

**File**: `T/src/mapping.js` (new)
**Changes**: pure functions; Google all-day `end.date` is exclusive (V8).

```js
const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export function todayInZone(zone, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(now); // YYYY-MM-DD
}

export function dateOnly(s, zone) {
  if (!s) return null;
  if (s.length <= 10) return s;
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(new Date(s));
}

export function toAllDay({ start, end }, zone) {
  const s = dateOnly(start, zone);
  const e = end ? dateOnly(end, zone) : null;
  const lastDay = e && e > s ? e : s;
  return { start: { date: s }, end: { date: addDays(lastDay, 1) } };
}

export function fromAllDay(ev) {
  const start = ev.start.date;
  const lastDay = addDays(ev.end.date, -1);
  return { start, end: lastDay > start ? lastDay : null };
}
```

- [ ] 2.2 Notion query and parse

**File**: `T/src/notion.js` (new)
**Changes**: filter + cursor loop; property type for status per V5 (assume `status`, fall back to `select` when config `statusType` is set).

```js
export async function queryTasks(vendor, cfg, today) {
  const n = cfg.notion;
  const filter = {
    and: [
      { property: n.dateProperty, date: { on_or_after: today } },
      { or: n.syncStatuses.map((s) => ({ property: n.statusProperty, status: { equals: s } })) },
    ],
  };
  const pages = []; let cursor;
  do {
    const resp = await vendor.request('notion', {
      url: `https://api.notion.com/v1/databases/${n.databaseId}/query`, method: 'POST',
      body: { page_size: 100, filter, ...(cursor && { start_cursor: cursor }) },
    });
    pages.push(...resp.results);
    cursor = resp.has_more ? resp.next_cursor : undefined;
  } while (cursor);
  return pages.map((p) => parseTask(p, n));
}

export function parseTask(page, n) {
  const p = page.properties;
  return {
    pageId: page.id,
    url: page.url,
    title: (p[n.titleProperty]?.title || []).map((t) => t.plain_text).join(''),
    date: p[n.dateProperty]?.date ? { start: p[n.dateProperty].date.start, end: p[n.dateProperty].date.end } : null,
    status: p[n.statusProperty]?.status?.name ?? p[n.statusProperty]?.select?.name ?? null,
    tags: (p[n.tagsProperty]?.multi_select || []).map((t) => t.name),
    lastEdited: page.last_edited_time,
  };
}
```

- [ ] 2.3 Calendar helpers

**File**: `T/src/gcal.js` (new)
**Changes**: `ensureCalendar`, `createEvent`.

```js
const BASE = 'https://www.googleapis.com/calendar/v3';

export async function ensureCalendar(vendor, name) {
  const list = await vendor.request('google_calendar', { url: `${BASE}/users/me/calendarList?minAccessRole=owner` });
  const hit = (list.items || []).find((c) => c.summary === name);
  if (hit) return hit.id;
  const made = await vendor.request('google_calendar', { url: `${BASE}/calendars`, method: 'POST', body: { summary: name } });
  return made.id;
}

export function eventBody(task, cfg) {
  const { start, end } = toAllDay(task.date, cfg.timeZone);
  return {
    summary: task.title, start, end,
    description: task.url ? `Notion: ${task.url}` : undefined,
    extendedProperties: { private: { notionPageId: task.pageId } },
  };
}

export const createEvent = (vendor, calId, body) =>
  vendor.request('google_calendar', { url: `${BASE}/calendars/${encodeURIComponent(calId)}/events`, method: 'POST', body });
```

- [ ] 2.4 Orchestration with lock

**File**: `T/src/sync.js` (new)
**Changes**: `runSync` creates missing entries, saves state after each page, records baseline.

```js
let running = false;

export async function runSync(deps) {
  if (running) return { skipped: true };
  running = true;
  try {
    const { vendor, cfg, state, save } = deps;
    const today = todayInZone(cfg.timeZone);
    state.calendarId ??= await ensureCalendar(vendor, cfg.calendar.name);
    const tasks = (await queryTasks(vendor, cfg, today)).filter((t) => t.title && t.date?.start);
    const result = { created: [], errors: [] };
    for (const t of tasks) {
      if (state.pages[t.pageId]) continue;
      try {
        const ev = await createEvent(vendor, state.calendarId, eventBody(t, cfg));
        state.pages[t.pageId] = { eventId: ev.id, baseline: { title: t.title, date: normalizeDate(t.date, cfg) } };
        save(); result.created.push(t.pageId);
      } catch (e) { result.errors.push({ pageId: t.pageId, error: e.message }); }
    }
    state.lastRunAt = new Date().toISOString(); save();
    return result;
  } finally { running = false; }
}
```

- [ ] 2.5 Server wiring

**File**: `T/server.js`
**Changes**: timer from config; 409 on skipped.

```js
if (cfg.pollIntervalMinutes > 0 && cfg.notion.databaseId) {
  setInterval(() => runSync(deps).catch((e) => console.error('[auto-poll]', e.message)),
    cfg.pollIntervalMinutes * 60_000);
}
app.post('/api/sync', async (req, res) => {
  const r = await runSync(deps);
  res.status(r.skipped ? 409 : 200).json({ success: !r.skipped, ...r });
});
```

- [ ] 2.6 Tests

**File**: `T/test/mapping.test.js`, `T/test/sync.test.js` (new)

```js
test('single day -> exclusive next day', () => {
  assert.deepEqual(toAllDay({ start: '2026-12-31' }, 'UTC'), { start: { date: '2026-12-31' }, end: { date: '2027-01-01' } });
});
test('range 10..12 -> end 13', () => {
  assert.equal(toAllDay({ start: '2026-11-10', end: '2026-11-12' }, 'UTC').end.date, '2026-11-13');
});
test('round trip', () => {
  const ev = toAllDay({ start: '2026-11-10', end: '2026-11-12' }, 'UTC');
  assert.deepEqual(fromAllDay(ev), { start: '2026-11-10', end: '2026-11-12' });
});
test('datetime uses config zone date', () => {
  assert.equal(dateOnly('2026-11-10T20:00:00.000Z', 'Asia/Manila'), '2026-11-11');
});
```

`sync.test.js` uses a fake vendor recording calls: two pages across two `has_more` pages create two events; a second `runSync` with the loaded state creates none.

### Success Criteria:

#### Automated Verification:
- [ ] `npm test`

#### Manual Verification:
- [ ] Pending task due today appears as all-day in "Notion Tasks"; past-due and Done tasks absent
- [ ] Restart server then `curl -s -X POST localhost:3000/api/sync`: no duplicate

**Implementation Note**: pause for human confirmation.

---

## Phase 3: Notion → Calendar update and delete

### Overview
Compare Notion side to baseline; patch or delete the event.

### Changes Required:

- [ ] 3.1 Pure decision function (Notion-only branches)

**File**: `T/src/reconcile.js` (new)

```js
export const sameSnap = (a, b) => a && b && a.title === b.title && a.date.start === b.date.start && (a.date.end ?? null) === (b.date.end ?? null);

export function decide({ task, event, baseline }) {
  if (!baseline) return task ? [{ kind: 'create' }] : [];
  if (!task) return [{ kind: 'deleteEvent', appInitiated: true }];
  const nChanged = !sameSnap(snap(task), baseline);
  if (nChanged) return [{ kind: 'patchEvent' }];
  return [];
}
```

Phase 3 treats Notion as the only changing side; event-side branches arrive in Phase 4.

- [ ] 3.2 Event list/patch/delete

**File**: `T/src/gcal.js`
**Changes**: add `listMapped(calId)` (paginated `events.list` with `showDeleted=true`, `singleEvents=true`, filter `privateExtraProperty=notionPageId` via client-side check), `patchEvent`, `deleteEvent` (ignore 404/410).

```js
export const patchEvent = (vendor, calId, id, body) =>
  vendor.request('google_calendar', { url: `${BASE}/calendars/${encodeURIComponent(calId)}/events/${id}`, method: 'PATCH', body });
export const deleteEvent = (vendor, calId, id) =>
  vendor.request('google_calendar', { url: `${BASE}/calendars/${encodeURIComponent(calId)}/events/${id}`, method: 'DELETE' })
    .catch((e) => { if (!/40[4]|410/.test(e.message)) throw e; });
```

- [ ] 3.3 Orchestrator

**File**: `T/src/sync.js`
**Changes**: query now returns eligible tasks only, so a mapped `pageId` missing from the result means "left status list or window": delete event, set `state.pages[id].pendingDelete = true` and `save()` **before** the DELETE call, then DELETE; on success or 404/410 `delete state.pages[id]` and `save()`. On any other failure (network, 5xx) the flagged entry stays and a later run retries the DELETE. Entries flagged `pendingDelete` are never treated as user-deleted and never recreated; they are only retried. Patch path rewrites baseline from the task after success.

- [ ] 3.4 Tests

**File**: `T/test/reconcile.test.js` (new)

```js
test('title change -> patchEvent', () => {
  const baseline = { title: 'A', date: { start: '2026-11-10', end: null } };
  const task = { title: 'B', date: { start: '2026-11-10' } };
  assert.deepEqual(decide({ task, event: {}, baseline }), [{ kind: 'patchEvent' }]);
});
test('task gone -> deleteEvent', () => {
  assert.equal(decide({ task: null, event: {}, baseline: { title: 'A', date: { start: 'x' } } })[0].kind, 'deleteEvent');
});
test('unchanged -> noop', () => { /* equal snapshots -> [] */ });
```

### Success Criteria:

#### Automated Verification:
- [ ] `npm test`

#### Manual Verification:
- [ ] Rename task and change date in Notion; `POST /api/sync`; entry follows
- [ ] Set Status to Done; entry disappears; state has no entry for the page

**Implementation Note**: pause for human confirmation.

---

## Phase 4: Calendar → Notion edits and conflicts

### Overview
Add event-side change detection and conflict resolution.

### Changes Required:

- [ ] 4.1 Extend decide

**File**: `T/src/reconcile.js`

```js
export function decide({ task, event, baseline }, { calendarToNotion = true } = {}) {
  // ...no-baseline and no-task branches as before
  const nSnap = snap(task);
  const eSnap = eventSnap(event);          // { title, date:{start,end} } via fromAllDay
  const nChanged = !sameSnap(nSnap, baseline);
  const eChanged = calendarToNotion && !sameSnap(eSnap, baseline);
  if (!nChanged && !eChanged) return [];
  if (nChanged && !eChanged) return [{ kind: 'patchEvent' }];
  if (!nChanged && eChanged) return [{ kind: 'patchNotion' }];
  if (sameSnap(nSnap, eSnap)) return [{ kind: 'rebaseline' }];
  const eWins = new Date(event.updated) > new Date(task.lastEdited);   // tie -> Notion
  return [{ kind: eWins ? 'patchNotion' : 'patchEvent', conflict: true }];
}
```

- [ ] 4.2 Notion page update

**File**: `T/src/notion.js`

```js
export const updatePage = (vendor, cfg, pageId, { title, date }) =>
  vendor.request('notion', { url: `https://api.notion.com/v1/pages/${pageId}`, method: 'PATCH', body: { properties: {
    [cfg.notion.titleProperty]: { title: [{ text: { content: title } }] },
    [cfg.notion.dateProperty]: { date: { start: date.start, end: date.end ?? null } },
  } } });
```

- [ ] 4.3 Orchestrator

**File**: `T/src/sync.js`
**Changes**: fetch `listMapped` once per run; join with tasks by `notionPageId`; apply actions; after any write set `baseline` to the values written (not re-read), `console.log` conflicts as `[conflict] pageId winner=notion|calendar`.

- [ ] 4.4 Tests

**File**: `T/test/reconcile.test.js`
**Changes**: calendar-only; both-same → rebaseline; both-differ with each side newer; tie → Notion; echo-loop test: apply `decide` + baseline refresh three times, assert actions `[]` on runs 2 and 3.

### Success Criteria:

#### Automated Verification:
- [ ] `npm test`

#### Manual Verification:
- [ ] Edit title/date in Calendar; sync; Notion `Name`/`Due` match; sync again changes nothing (check Notion `last_edited_time` unchanged)
- [ ] Edit both sides; newest wins; log line printed

**Implementation Note**: pause for human confirmation.

---

## Phase 5: Deleted entry → mark dropped

### Overview
User-deleted entry sets `Archived/Dropped` and is not recreated.

### Changes Required:

- [ ] 5.1 Decide branch

**File**: `T/src/reconcile.js`
**Changes**: before change comparison, `if (baseline && task && (event === 'cancelled' || event == null)) return cfgDelete === 'markDropped' ? [{ kind: 'markDropped' }] : [{ kind: 'forget' }];`. App deletes never reach here because entries flagged `pendingDelete` are handled by the Phase 3 retry path and excluded from this branch.

- [ ] 5.2 Set status

**File**: `T/src/notion.js`

```js
export const setStatus = (vendor, cfg, pageId, name) =>
  vendor.request('notion', { url: `https://api.notion.com/v1/pages/${pageId}`, method: 'PATCH', body: { properties: {
    [cfg.notion.statusProperty]: { status: { name } },
  } } });
```

- [ ] 5.3 Tombstones

**File**: `T/src/sync.js`
**Changes**: on `markDropped`: `state.tombstones[id] = now; delete state.pages[id]; save()`, then `setStatus`; on success remove tombstone. Each run first retries tombstones with `setStatus`; tasks with a tombstone are never created.

- [ ] 5.4 Tests

**File**: `T/test/sync.test.js`
**Changes**: user delete → status patched, no create; failed `setStatus` leaves tombstone, retried next run; app-initiated delete (status Done) never calls `setStatus`.

### Success Criteria:

#### Automated Verification:
- [ ] `npm test`

#### Manual Verification:
- [ ] Delete an entry in Calendar; after sync the page is `Archived/Dropped`; two further syncs do not recreate

**Implementation Note**: pause for human confirmation.

---

## Phase 6: Reminders and reapply

### Overview
Popup reminders from presets with tag overrides, plus reapply.

### Changes Required:

- [ ] 6.1 Reminder resolution

**File**: `T/src/reminders.js` (new)
**Changes**: all-day offsets are minutes before 00:00 of the event day (assumption V9: `daysBefore*1440 - minutesOfDay(at)`).

```js
const mins = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

export function presetFor(task, cfg) {
  for (const tag of task.tags) if (cfg.reminders.byTag[tag]) return cfg.reminders.byTag[tag];
  return cfg.reminders.defaultPreset;
}

export function overridesFor(task, cfg) {
  const preset = cfg.reminders.presets[presetFor(task, cfg)];
  return preset.allDay.map((r) => ({
    method: 'popup',
    minutes: r.minutes ?? r.daysBefore * 1440 - mins(r.at),
  }));
}
```

Example: `{daysBefore:1, at:"18:00"}` → 1440 - 1080 = 360. Same-day clock times (e.g. `{daysBefore:0, at:"09:00"}` → -540) cannot be expressed as an all-day popup offset because Google rejects negative values; config validation rejects them and the shipped presets use only day-before times. Recorded under Unresolved Questions.

The config validator rejects any preset lacking `allDay` or `timed`, so `overridesFor` never sees a missing key.

- [ ] 6.2 Apply on create

**File**: `T/src/gcal.js`
**Changes**: `eventBody` adds `reminders: { useDefault: false, overrides }`.

- [ ] 6.3 Reapply

**File**: `T/src/sync.js`, `T/server.js`
**Changes**: `reapplyReminders(deps)` queries tasks, PATCHes `reminders` for each mapped event; `POST /api/reapply-reminders` returns `{ updated, errors }`.

- [ ] 6.4 Tests

**File**: `T/test/reminders.test.js` (new)

```js
test('first matching tag wins', () => {
  const cfg = { reminders: { defaultPreset: 'standard', byTag: { Work: 'heavy', Home: 'light' } } };
  assert.equal(presetFor({ tags: ['Home', 'Work'] }, cfg), 'light');
});
test('default when no tag matches', () => {
  assert.equal(presetFor({ tags: [] }, { reminders: { defaultPreset: 'standard', byTag: {} } }), 'standard');
});
```

### Success Criteria:

#### Automated Verification:
- [ ] `npm test`

#### Manual Verification:
- [ ] New entry shows expected popups in Google Calendar
- [ ] Change `byTag`, restart, `curl -s -X POST localhost:3000/api/reapply-reminders`; entry updates
- [ ] A real notification fires at the expected time for an all-day entry

**Implementation Note**: pause for human confirmation.

---

## Phase 7: Legacy cleanup

### Overview
Dry-run-first removal of old events in `primary`.

### Changes Required:

- [ ] 7.1 Legacy module

**File**: `T/src/legacy.js` (new)

```js
const PREFIX = 'Synced from Notion task:';

export async function cleanupLegacy(vendor, { confirm = false } = {}) {
  const found = []; let pageToken;
  do {
    const q = new URLSearchParams({ q: PREFIX, maxResults: '250', singleEvents: 'true', ...(pageToken && { pageToken }) });
    const r = await vendor.request('google_calendar', { url: `${BASE}/calendars/primary/events?${q}` });
    found.push(...(r.items || []).filter((e) => e.description?.startsWith(PREFIX)));
    pageToken = r.nextPageToken;
  } while (pageToken);
  const list = found.map((e) => ({ id: e.id, summary: e.summary, start: e.start }));
  if (!confirm) return { dryRun: true, count: list.length, events: list };
  for (const e of list) await deleteEvent(vendor, 'primary', e.id);
  return { dryRun: false, deleted: list.length };
}
```

- [ ] 7.2 Route

**File**: `T/server.js`
**Changes**: `POST /api/cleanup-legacy`, `confirm` only when body `confirm === true` (strict).

- [ ] 7.3 Tests

**File**: `T/test/legacy.test.js` (new)
**Changes**: fake vendor; dry run makes zero DELETE calls; confirm deletes only events whose description starts with the prefix.

### Success Criteria:

#### Automated Verification:
- [ ] `npm test`

#### Manual Verification:
- [ ] `curl -s -X POST localhost:3000/api/cleanup-legacy` lists old entries, deletes none
- [ ] `curl -s -X POST localhost:3000/api/cleanup-legacy -H 'Content-Type: application/json' -d '{"confirm":true}'` removes them

**Implementation Note**: pause for human confirmation.

---

## Phase 8: Docs

### Overview
Docs match behavior.

### Changes Required:

- [ ] 8.1 Env and ignore files

**File**: `T/.env.example`, `T/.gitignore`
**Changes**: fix `NOTION_DATE_PROPERTY` default comment, add optional `POLL_INTERVAL_MINUTES`, `SYNC_TIME_ZONE`, `SYNC_CONFIG_PATH`; ignore `sync-state.json`, `synced-tasks.json`.

- [ ] 8.2 README

**File**: `T/README.md`
**Changes**: rewrite "What it does", "How the sync works", endpoint table (add `reapply-reminders`, `cleanup-legacy`), config reference, limitations (up to 30 min lag, time-of-day dropped when editing from Calendar, only "Notion Tasks" calendar touched).

- [ ] 8.3 AGENTS

**File**: `T/AGENTS.md`
**Changes**: layout table for `src/`, `sync.config.json`, `sync-state.json`; replace "Polling (setInterval, 60s)", "synced-tasks.json" dedupe and "09:00 UTC / 1 hour" notes; replace "No test suite" with `npm test`.

### Success Criteria:

#### Automated Verification:
- [ ] `npm test`
- [ ] `grep -nE "60s|60 seconds|09:00 UTC|synced-tasks" T/README.md T/AGENTS.md` returns only intentional migration notes

---

## Unresolved Questions

- Time zone for config? (placeholder `Asia/Manila`)
- Notion `Status` type `status` or `select`? (V5)
- Does the proxy allow PATCH/DELETE/GET? Probe in Phase 1. If blocked, scope changes.
- Same-day-at-09:00 all-day reminders need a negative offset, which Google rejects, so they are unsupported and shipped defaults use day-before times only. Does the captain want a different way to express "morning of"? (V9)
- Keep the dropped-status name `Archived/Dropped` exactly? (V6)
- OK to drop time-of-day when `Due` has a time and the entry is edited in Calendar?
- OK to ignore old `synced-tasks.json` rather than migrate?
- Design Questions in `design.md` still open for the captain.
