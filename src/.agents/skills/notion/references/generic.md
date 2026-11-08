
## Generic workflow

1. **Find the page**: Check if the page exists in the `<known_workflows>` table in `SKILL.md`. Otherwise, use `notion-search` with a plain-language query. Returns `id`, `title`, `url`, `type` (page/database). If the user names a page, search for it verbatim first rather than guessing an ID. 
2. **Read it**: `notion-fetch` with the `id` or URL. Returns Notion-flavored Markdown plus `<properties>` (a JSON map of the page's database properties, if any) and `<ancestor-path>` (parent database/page chain). Large pages come back `truncated: true` — re-fetch or narrow scope if you need more.
3. **If it's a database row with sub-items or an inline database**: don't stop at the parent page's `<properties>` — sub-item relations there are just a list of URLs, not the actual row data. Fetch the inline `<database url="...">` block or query it directly (see below) to get real rows.
4. **Edit it**: `notion-update-page`.

## Querying database rows (sub-items, filtered lists)

Two options — prefer SQL unless you specifically want a view's saved filters:

- **`notion-query-data-sources` (SQL mode, preferred for completeness)**: run SQLite against the data source. Get the data source URL (`collection://...`) from the `<data-source url="...">` tag in a `notion-fetch` result on the database. Relation columns (e.g. `Parent item`, `Sub-item`, `Blocked by`) store a JSON array of page URLs — filter with `LIKE '%<page-id-no-dashes>%'` since exact-match on the JSON string is fragile.
  ```sql
  SELECT Name, Status, Priority FROM "collection://<id>"
  WHERE "Parent item" LIKE '%<parent-page-id>%'
  ```
- **`notion-query-database-view` / SQL mode `view`**: replays a saved view's filters/sorts. **Caveat**: views can carry filters that silently narrow results in surprising ways (e.g. a "Board is [blank]" filter left over from grouping) — if a view returns fewer rows than expected, fall back to SQL mode and query the data source directly with your own WHERE clause instead of trusting the view.

Use `notion-fetch` on the database first to get the SQLite table definition (column names/types) shown in `<sqlite-table>` — property names with spaces need double quotes in SQL.

## Updating pages

`notion-update-page` commands:
- `update_properties` — set property values. Use the exact schema property names from the data source's SQLite table def. Dates split into `date:{prop}:start` / `:end` / `:is_datetime`. Checkboxes use `"__YES__"` / `"__NO__"`. Relations take an array of page URLs/IDs. Properties literally named `id` or `url` must be prefixed `userDefined:`.
- `insert_content` — append (`position: {"type":"end"}`) or prepend (`{"type":"start"}`) markdown. Cheapest way to add a note/line to a page.
- `update_content` — targeted search-and-replace (`old_str`/`new_str` pairs); fails if `old_str` isn't unique unless `replace_all_matches: true`.
- `replace_content` — replaces the whole page body; needs `allow_deleting_content: true` if it would remove child pages/databases.
- `apply_template` — append a page template by its template ID (find template IDs in a database's `<templates>` block from `notion-fetch`).

For non-trivial Markdown (tables, callouts, toggle blocks, etc.), fetch `notion://docs/enhanced-markdown-spec` via `notion-fetch` first rather than guessing syntax.

## IDs

Page/data-source IDs work with or without dashes; either form is fine to pass as `page_id`/`id`.

