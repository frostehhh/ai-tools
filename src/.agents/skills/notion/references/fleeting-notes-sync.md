# Fleeting Notes Sync

Parent page: **Fleeting Notes** — https://app.notion.com/p/Fleeting-Notes-2b650704f72a80ee9273c857fe94af2f
Inline database: https://app.notion.com/p/2ad50704f72a8016a2a4e8992409a6ee
Data source: `collection://2ad50704-f72a-808b-9243-000b43fb3b1e`

Generic rules (link signal, token-saving run order, checkpoint, mapping) live in `sync-workflow-guidelines.md` — read it first; this doc holds the Fleeting Notes specifics.

## What this syncs

Keeps two independent fleeting-note inboxes reconciled: the Odyssey vault's `Fleeting Notes/Notes/` folder and the Notion Fleeting Notes database. A note only counts as "linked" once its Obsidian file carries **both** `source_url` and `Source: Notion` in frontmatter — that's the only signal this workflow trusts. Don't fuzzy-match by title/question text even when two entries look similar (e.g. Notion's "How would I describe my psychology to someone else?" and Obsidian's "How would I describe my mindset to someone else" are two separate, unlinked entries as far as this workflow is concerned) — only the frontmatter link makes something "the same note."

## Notion schema

```sql
CREATE TABLE "collection://2ad50704-f72a-808b-9243-000b43fb3b1e" (
  url TEXT UNIQUE,
  "Created time" TEXT NOT NULL, -- ISO-8601, auto-set by Notion at page-creation time, NOT settable via the API
  "Last edited time" TEXT NOT NULL,
  "Name" TEXT,             -- title; the fleeting note/question itself — page body is usually blank
  "Status" TEXT,           -- one of ["Not started","In progress","On-hold","Archived/Dropped","Done"]
  "Tags" TEXT              -- JSON array, multi_select — see options below
)
```

**Tags** options (drift over time — re-fetch the data source if a vault tag doesn't map to anything here, rather than forcing it): Philosophy, Religion, Software Engineer, Psychology, Self-help, General, Productivity, Note-taking, Cognitive Science, Relationships.

## Obsidian side

Folder: `Fleeting Notes/Notes/` — one file per note, filename = the note/question text (matches Notion's `Name`).

Baseline frontmatter (see `--Obsidian Template--/Frontmatter/Fleeting Notes/Note.md`):
```yaml
tags:
  - fleeting-note
dateCreated: 2026-09-13T02:29:44
author: Luis Capuyon
isDraft: true
```

A **linked** note additionally carries:
```yaml
source_url: https://app.notion.com/p/<page-id>
Source: Notion
```

## Core workflow

Don't read every row or file into context — follow the count/diff flow from the generic guidelines:

1. **Counts**: `SELECT COUNT(*) FROM "collection://2ad50704-f72a-808b-9243-000b43fb3b1e"` via `notion-query-data-sources`; locally, from `Fleeting Notes/Notes/`, `grep -l '^source_url:' *.md | wc -l` (linked) and `grep -L '^source_url:' *.md` (unlinked). If Notion total == linked count and no unlinked files, report "in sync" and stop.
2. **Diff in the shell**: query only `url` from Notion, extract page ids (32 hex, dashes stripped) to a scratch file, extract linked ids from `source_url` lines, and `comm` the two. Notion ids with no local note are Notion to Obsidian candidates; unlinked files are Obsidian to Notion candidates. Linked notes are never opened.
3. **Fetch details for candidates only**: `Name`, `Status`, `Tags`, `"Created time"` for Notion to Obsidian candidates (and the page body only if it may be non-blank); frontmatter for Obsidian to Notion candidates. Cap at ~25 items per run.
4. Work out what each candidate would become (filename, tags, mapped status — per the sections below) *without creating or editing anything yet*, then stop at the confirmation checkpoint below.

## Confirmation checkpoint — always stop here before writing anything

This sync can mean dozens of new pages and files in one pass, so treat every run as read-only until the user has seen and approved the exact plan. Never create a Notion page, create an Obsidian file, or edit an existing file's frontmatter before this checkpoint, no matter how unambiguous the mapping looks.

Present the full plan, then ask a single explicit question before proceeding (use `AskUserQuestion` if available; otherwise ask in plain text and wait for a reply — either way, do not proceed on an assumed "yes"):

- **New Obsidian notes to create** (from unmatched Notion rows) — one line each: filename, mapped tags, mapped status, dateCreated.
- **New Notion pages to create** (from unmatched Obsidian notes) — one line each: `Name`, mapped tags, status.
- **Frontmatter edits to existing files** — every push to Notion requires writing `source_url`/`Source: Notion` back into that Obsidian file afterward; list these as edits too, not just the new-page creations.
- **Already-linked notes** — mention the count so the user has the full picture, but don't itemize them since no action is planned.

Ask something like: "Here's the sync plan above — N new Obsidian notes, M new Notion pages, and M frontmatter edits. Proceed with all of it, a subset, or would you like to adjust any of the mappings first?" Apply only what the user confirms — if they approve a subset, or flag a specific mapping (a tag, a status, a title) as wrong, fix that before writing rather than pushing ahead with the original plan.

## Pull: Notion → Obsidian (create Obsidian notes from unmatched Notion rows)

Only after the confirmation checkpoint above. For each unmatched Notion row:

- **Filename / title**: the row's `Name` verbatim — matches the vault's convention of using the filename as the note itself.
- **Tags**: map each Notion tag to an Obsidian tag (see "Tag mapping" below). Always keep `fleeting-note` in the list, same as manually created notes.
- **Status**: map the Notion `Status` to a TaskNotes status value (see "Status mapping" below) and set it under the `status` frontmatter key — that's the key TaskNotes reads/writes (`fieldMapping.status` in `.obsidian/plugins/tasknotes/data.json`).
- **dateCreated**: copy Notion's `Created time` into the `dateCreated` frontmatter key, reformatted to the vault's local, offset-free shape (`YYYY-MM-DDTHH:mm:ss` — see existing notes for the exact pattern).
- **source_url** / **Source**: required on every note this workflow creates — `source_url: <the Notion page URL>` and `Source: Notion`. This is what marks the note as linked on the next sync run.
- **Body**: fetch the Notion page itself — most rows are blank, but if one has body content beyond the title, carry it into the note body; otherwise leave the body empty like existing fleeting notes.
- Place the new file in `Fleeting Notes/Notes/`.

### Tag mapping (Notion tag → Obsidian tag)

For each Notion tag on the row:

1. Check whether an existing Obsidian tag already means the same thing — case-insensitively, and check both flat tags and the leaf segment of hierarchical ones (the vault already has flat tags like `philosophy`, `psychology`, `cognitive-science`, `productivity` that line up directly with several Notion tag names). Get the *current* vault tag list yourself (grep `tags:` blocks in frontmatter across the vault, or use whatever tag-listing the session has available) rather than trusting a fixed list — tags accumulate over time and any snapshot here would go stale.
2. If a match exists, reuse it exactly as it's cased/nested in the vault.
3. If nothing matches, create the tag as `notion/<tag-name-in-kebab-case>` (e.g. `Software Engineer` → `notion/software-engineer`). This namespaces net-new Notion-originated tags so they're easy to find and reconcile later, instead of guessing where they'd fit in the vault's existing hierarchy.

### Status mapping (Notion Status → TaskNotes status)

TaskNotes statuses are entirely user-configurable, so never hardcode a `value` string — read `.obsidian/plugins/tasknotes/data.json` → `customStatuses` fresh on every run and match against whatever's actually defined there. Each entry looks like:

```json
{"id": "open", "value": "0-open/backlog", "label": "Backlog", "isCompleted": false, "order": 1, ...}
```

Write the entry's `value` (not its `label` or `id`) into the note's `status` frontmatter key — that's the string TaskNotes actually reads via `fieldMapping.status` in the same file.

Match each Notion `Status` to a `customStatuses` entry by meaning, not position:
- **Not started** → the lowest-`order`, `isCompleted: false` entry that reads as an open/backlog state (label like "Backlog" or "None").
- **In progress** → the `isCompleted: false` entry whose label suggests active work ("In progress").
- **On-hold** → the entry whose label suggests waiting/blocked/on hold.
- **Done** → the entry with `isCompleted: true`.
- **Archived/Dropped** → there's usually no "won't do"/"dropped" entry distinct from "Done" — if none exists, treat the `isCompleted: true` entry as the closest "closed" state, but call this out to the user as a judgment call (the item is closed either way, not literally completed) rather than presenting it as an exact match.

As of the last time this was checked, the vault's `customStatuses` produced: Not started → `0-open/backlog`, In progress → `2-inProgress/in-progress`, On-hold → `1-onHold/on-hold`, Done and Archived/Dropped → `3-completed/done`. Treat that only as a worked example — re-derive it from the live file rather than reusing these values directly, and if a Notion status doesn't clearly map to anything currently defined, ask the user which status to use instead of guessing.

## Push: Obsidian → Notion (create Notion rows from unmatched Obsidian notes)

Only after the confirmation checkpoint above. For each Obsidian note without `source_url`/`Source: Notion`:

- Create a page via `notion-create-pages` with `parent: {"type": "data_source_id", "data_source_id": "2ad50704-f72a-808b-9243-000b43fb3b1e"}`.
- `Name` = the note's filename/title.
- `Tags` = the note's Obsidian tags, mapped back to Notion's Tags options: strip a leading `notion/` first (that's this workflow's own namespacing, not a real vault tag), then reuse an existing Notion option on a case-insensitive match. Otherwise pass the tag through as-is — Notion's API auto-creates new multi-select options on write, so an unrecognized tag just becomes a new option rather than failing. Skip the vault-only `fleeting-note` tag; it has no Notion counterpart.
- `Status` = `Not started`, unless the Obsidian note's own `status` maps cleanly back through the table above; default to `Not started` rather than guessing when it doesn't.
- **After the page is created**, write `source_url: <new Notion page URL>` and `Source: Notion` back into the Obsidian file's frontmatter — otherwise the next sync run will create a duplicate Notion page for the same note.
- Flag this asymmetry to the user rather than silently absorbing it: Notion's `Created time` is a system property set to *now* at creation time and isn't settable via the API, so a note pushed today shows today's date in Notion even if its Obsidian `dateCreated` is months old. There's no way around this without adding a custom date property to the Notion schema.
