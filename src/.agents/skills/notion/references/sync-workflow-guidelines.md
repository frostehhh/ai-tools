# Sync Workflow Guidelines (generic)

Rules for any workflow that reconciles a folder of Obsidian notes with a Notion database. Per-workflow docs (e.g. `fleeting-notes-sync.md`) supply the specifics and reference this file.

## Per-workflow config (each sync doc must define)

- Notion data source (`collection://...`) and its schema (`notion-fetch` the database for the `<sqlite-table>`).
- Obsidian folder and baseline frontmatter.
- Direction: pull (Notion → Obsidian), push (Obsidian → Notion), or both.
- Field mappings (title, tags, status, dates) in each direction.

## Link signal

A note is **linked** only when its frontmatter has both `source_url: <notion page url>` and `Source: Notion`. Never fuzzy-match on titles or text, even if two entries look identical.

Compare by **page id**, not URL string: Notion URLs appear as `app.notion.com/<id>`, `app.notion.com/p/<id>`, and with dashes. Normalize to the 32-hex id (strip dashes, take the last 32 hex chars) on both sides.

## Standard run order (cost tracks changes, not total records)

1. **Counts**: Notion `SELECT COUNT(*)`; local linked count and unlinked count via `grep` (see below). If Notion total == linked count and there are no unlinked local files, report "in sync" and stop.
2. **Diff in the shell**: write the Notion page ids to a scratch file (selecting only `url`); extract linked ids and unlinked filenames with `grep`; use `comm`/`sort`/`jq` to get (a) Notion ids with no local note (Notion to Obsidian candidates) and (b) local files with no link (Obsidian to Notion candidates). Only these small lists come back into context.
3. **Fetch details only for candidates**: `Name`, `Tags`, `Status`, `Created time` for Notion to Obsidian candidates; frontmatter/body for Obsidian to Notion candidates. Fetch a Notion page body only if it may be non-blank.
4. **Compute the plan without writing**, then stop at the confirmation checkpoint.

Reference commands (run from the sync folder):

```sh
grep -L '^source_url:' *.md                      # unlinked notes (Obsidian to Notion candidates)
grep -h '^source_url:' *.md | grep -oE '[0-9a-f]{32}|[0-9a-f-]{36}' | tr -d '-' | sort -u   # linked ids
grep -l '^source_url:' *.md | wc -l              # linked count
```

## Token-saving rules

- Do set-diffs and counts in the shell, never by reading rows/files into context.
- Select the minimum columns; never `SELECT *` the whole table on a normal run.
- Cap a run at ~25 items; the remainder is picked up next run. Use one `notion-create-pages` call with an array, and write frontmatter back with one shell loop rather than one Edit per file.
- Keep the checkpoint compact: grouped one-liners; for 25+ same-shape items show a few samples plus counts and offer the full list on request.
- Optionally cache slow-changing lookups (vault tag list, TaskNotes `customStatuses` mapping, Notion tag options) in a small state file; refresh only when a mapping misses.
- For runs touching many items, delegate the mechanical execution to a subagent or script and return only a summary.
- Keep sync reference docs short; split rarely-needed detail into separate files so a no-op run reads only the core workflow.
- **Full reconcile is opt-in** (user says "full sync"): scans everything. It is the only way to detect Notion deletions/archived rows, which the count/diff flow can't see. Mention this limit when reporting.

## Confirmation checkpoint (mandatory)

Treat every run as read-only until the user has approved the exact plan. Never create a Notion page, create an Obsidian file, or edit frontmatter before it.

Present:
- New Obsidian notes to create (one line each: filename, mapped tags, status, dateCreated).
- New Notion pages to create (one line each: name, mapped tags, status).
- Frontmatter write-backs on existing files (each push needs one).
- Count of already-linked notes (don't itemize).

Then ask one explicit question (`AskUserQuestion`, or plain text and wait): proceed with all, a subset, or adjust a mapping. Never proceed on an assumed yes; apply only what the user confirms and fix flagged mappings first.

## Pull: Notion → Obsidian

- Filename/title = Notion title verbatim.
- Map tags and status (below); keep the workflow's base tag.
- Copy Notion `Created time` to `dateCreated` in the vault's offset-free local format.
- Always set `source_url` and `Source: Notion` on created notes.
- Carry over the page body only if non-blank.

## Push: Obsidian → Notion

- Create pages via `notion-create-pages` with `parent: {"type": "data_source_id", ...}`.
- Map tags back (below); default status to the schema's initial value unless the note's own status maps cleanly.
- **Immediately after creation**, write `source_url` and `Source: Notion` back into the note, otherwise the next run duplicates the page.
- Flag API-immutable fields to the user (Notion `Created time` is set to now and can't be set), rather than silently absorbing the mismatch.

## Mapping guidance

- **Tags (Notion → Obsidian)**: reuse an existing vault tag on a case-insensitive match (check flat tags and hierarchical leaf segments; read the live vault tag list, don't trust a snapshot). Otherwise create `notion/<kebab-case>`.
- **Tags (Obsidian → Notion)**: strip a leading `notion/`, match existing Notion options case-insensitively, otherwise pass through (Notion auto-creates options). Skip vault-only tags.
- **Status**: never hardcode values. Read `.obsidian/plugins/tasknotes/data.json` → `customStatuses` fresh, match by meaning, write the entry's `value` under the `status` key. If a Notion status has no clear match (e.g. Archived/Dropped vs Done), call it out as a judgment call or ask.
- Option lists drift: re-fetch the data source schema when something doesn't map, rather than forcing it.

## Re-sync of already-linked notes

Leave linked notes alone unless the user asks. If asked, compare Notion `Last edited time` against the note's file mtime for just those notes; do not add a "last synced" column.

## Reporting

End every run with what was created, edited, skipped, and left unresolved (counts plus notable items).

## Template for a new sync reference doc

```md
# <Name> Sync
Parent page / database / data source (`collection://...`)
## What this syncs            (the two stores; link signal = source_url + Source: Notion)
## Notion schema             (sqlite-table + option lists that drift)
## Obsidian side             (folder, baseline frontmatter, linked frontmatter)
## Core workflow             (counts → short-circuit → shell diff → plan; concrete commands)
## Pull / Push specifics     (field mappings that differ from the generic rules)
## Mapping specifics         (tag/status quirks)
```
Then register it in the `<known_workflows>` table in `SKILL.md`.
