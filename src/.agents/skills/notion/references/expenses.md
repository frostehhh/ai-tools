# Expense Tracking

Parent page: **Expense Tracking & Planning** — https://app.notion.com/p/1de8b8217a2c4f2f811d3e7d236daf9c

It holds four inline databases:

| Database | URL | Data source |
|---|---|---|
| **Expenses** (the day-to-day log) | https://app.notion.com/p/f8cc250eb8c847ad9774d049636e98e4 | `collection://751c0e33-727d-4985-bebd-44e3695ec061` |
| Regular Monthly Expenses | https://app.notion.com/p/31dda0e143664c338bcb6480cb3bf133 | `collection://b6ddc751-2af1-4990-8364-de2069638666` |
| Planned Expenses | https://app.notion.com/p/a3b7f549da8044c186090c60f1066e31 | `collection://9de200df-7377-472a-90fb-f9ab8539fcda` |
| (unnamed 4th database) | https://app.notion.com/p/b5e2f1b0fec347208eaa8a7da30c7533 | — |

Unless the user says otherwise, "log an expense" / "add an expense entry" means a new row in **Expenses** (`collection://751c0e33-727d-4985-bebd-44e3695ec061`).

## Core Workflows
### Create new expense records

When the user asks to create new expense records, show a template to guide how the user will input the information, which is documented under `Template to show the user`

### Update pending credit 

When the user asks to update the pending credit payments to mark them as paid, this refers to the `Pending Credit Card Payments` via in the `Expenses` database. For this flow:
- records in this view will have their `Amount` value updated based on the `Pending Credit` value. Essentially, this means that the `Pending Credit` is paid for. 
- The `Pending Credit` value will be retained.

Ask the user the date range of records. By default, ask the user if they want to pay for the pending credit from the previous credit card statement. See the <credit_statement_guidelines> for info about this. Otherwise, ask the user to specify a date range.

After the user provides a response, do the following:
- prompt the user and confirm if your understanding is correct.
- Check if the input tag values actually exist in the database. If not, let the user know. Recommend a similar existing tag based on the input if any. Let the user know that the input tag does not match any existing tag, and ask them if they want to see the detailed list of tag values.
- Do not create new tag values unless explicitly prompted by the user.

Proceed to update the records afterwards.

<credit_statement_guidelines>
If today is 2026/08/28, last month's credit card statement will consist of records from 2026/07/10 up until 2026/08/09. 2026/08/09
- 9th of the month marks the cutoff of a credit card statement
</credit_statement_guidelines>

## Expenses schema

```sql
CREATE TABLE "collection://751c0e33-727d-4985-bebd-44e3695ec061" (
  url TEXT UNIQUE,
  createdTime TEXT,              -- ISO-8601, auto-set
  "Expense" TEXT,                 -- title, required
  "Amount" FLOAT,                 -- PHP, money already paid out
  "Pending Credit" FLOAT,         -- PHP, money owed/on credit (e.g. credit card, not yet paid)
  "Tags" TEXT,                    -- JSON array, multi_select, see options below
  "Comment" TEXT,
  "Debtee" TEXT,                  -- select, one of ["Luis Capuyon"]
  "Debtor" TEXT,                  -- select, who owes *you* — see options below
  "date:Date:start" TEXT,         -- ISO-8601 date
  "date:Date:end" TEXT,           -- only for date ranges, else NULL
  "date:Date:is_datetime" INTEGER,-- 0 unless a specific time matters
  "Planned Expenses" TEXT,        -- relation → collection://9de200df-7377-472a-90fb-f9ab8539fcda
  "Related Expense" TEXT          -- relation → self (collection://751c0e33-727d-4985-bebd-44e3695ec061)
)
```

`Pay Credit` is a button property — read-only, not settable, and excluded from SQL queries (`notAvailableInQuerySql`).

**Tags** (multi_select options): Loan, Home, Food, Entertainment, Needs, Kyla, Gift, Transportation, Returned Loan, Medical, Clothing, Games, Bills, Pet, Credit Card Payment, Electronics, Cosmetics, Education, Bike, Vacation, Travel, Others, Productivity, Movie, Hygiene, Software Engineer, Kitchen, Skincare, Food Supply, Savings, Personal, Network, Warranty, Books, Emergency, Health, Work Allowance.

**Debtor** (select options, someone who owes the user for this expense): Joseph Catanoan, Tromarc Sente, Kyla Cheska Dablo, Alwyn Aligaen, Angela (Dani's Friend), Antonio Gabriel Cruz, Mary Lynvi Benitez, Dani (Seph's Girlfriend), Christian Bergantin, Louise Capuyon, Christian Mirano, Alexis Kyle Sales, Calvin Pryce Codorniz, Jhune, Me, Nelia Razo, Luis C Capuyon, Imelda Capuyon, Janelle Therizze Dela Cruz, Ricalyn Piones.

Tags/Debtor option lists drift over time — re-fetch the data source (`notion-fetch` on the `collection://` URL) if a value the user gives doesn't match anything above, rather than forcing it into the closest existing option.

## Tag Notes

- Credit Card Payment - when this is included, write the provided amount to 

## Querying

Use `notion-query-data-sources` in SQL mode against `collection://751c0e33-727d-4985-bebd-44e3695ec061`.

- **Today / date range**: `WHERE date("date:Date:start") = date('YYYY-MM-DD')`, or `BETWEEN` for ranges.
- **Sum by day/tag**: `Tags` is a JSON array — filter with `Tags LIKE '%"Food"%'` (exact-match on the JSON string is fragile). Sum with `SUM(COALESCE(Amount,0))`.
- **Total spend** should typically combine `Amount` (paid) and `Pending Credit` (owed) separately — don't silently add them together unless the user asks for a combined figure, since one is money already gone and the other is still outstanding.
- Order by date with `ORDER BY "date:Date:start"`.

Example — today's entries:
```sql
SELECT "Expense", "Amount", "Pending Credit", "Tags", "Comment", "date:Date:start"
FROM "collection://751c0e33-727d-4985-bebd-44e3695ec061"
WHERE date("date:Date:start") = date('2026-08-09')
ORDER BY "date:Date:start"
```

## Creating entries

Use `notion-create-pages` with `parent: {"type": "data_source_id", "data_source_id": "751c0e33-727d-4985-bebd-44e3695ec061"}`.

Minimum viable entry needs `Expense` (title) and a date; ask the user for `Amount` vs `Pending Credit` (paid vs owed) and `Tags` if not given — see the conversational checklist below for what to collect before creating.

**When the user asks to create expense(s) but hasn't given full details yet**, don't just ask a bare list of questions — show them the template/structure below (plain text is fine, no need for an artifact) with one filled-in example so they can see the shape and reply in kind, e.g. by pasting a list. This is especially useful when they want to log several entries at once.

### Template to show the user

```
Expense, Date, Amount OR Pending Credit, Tags (semicolon-separated), Comment, Debtor
```

- **Date**: `YYYY-MM-DD`, defaults to today if left blank.
- **Amount vs Pending Credit**: give one bare number — if `Credit Card Payment` is among the tags it's treated as Pending Credit, otherwise Amount. To be explicit, prefix with `paid:` or `credit:` (e.g. `credit:225`).
- **Tags**: separate multiple tags with `;` since the field itself is comma-separated.
- **Comment** / **Debtor**: optional, leave blank (just the commas) if not needed.
- For multiple entries, one line per expense.

### Worked example

```
CBTL, 2026-08-09, credit:225, Personal;Food;Credit Card Payment
```

maps to:

```json
{
  "properties": {
    "Expense": "CBTL",
    "Pending Credit": 225,
    "Tags": ["Personal", "Food", "Credit Card Payment"],
    "date:Date:start": "2026-08-09"
  }
}
```

`notion-create-pages` accepts a `pages` array, so batch multiple entries from a user-supplied list in one call rather than one call per row.

### What to ask the user for a new entry

- **Expense** (required) — short name/title.
- **Date** — default to today if not given.
- **Amount** or **Pending Credit** — clarify which: Amount = already paid, Pending Credit = on credit/owed. If the user includes the `Credit Card Payment` tag, then it is `Pending Credit`. Otherwise, it is an `Amount`
- **Tags** — offer the option list above if they're unsure.
- Optional: **Comment**, **Debtor** (only if someone else owes the user for this specific expense).

## Editing entries

Use `notion-update-page` with `command: "update_properties"` on the row's page URL/ID (fetch or query first to find it — don't guess IDs).

- Amount/Pending Credit changes: pass the new numeric value directly.
- Tags: pass the full replacement array (not a diff) — `["Food", "Personal"]` overwrites, it doesn't append. Fetch the row first if you need to add to existing tags rather than replace them.
- Date changes: use `date:Date:start` (and `:end`/`:is_datetime` only if relevant).
- Marking a credit entry as paid: don't manually null out `Pending Credit` unless the user confirms — check whether the `Pay Credit` button/workflow is what they actually mean, since it's a distinct action from editing the field.
