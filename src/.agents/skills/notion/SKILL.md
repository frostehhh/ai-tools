---
name: notion
description: Search, read, query, and update pages/databases in the connected Notion workspace using the Notion MCP tools. Use when the user asks to view, find, summarize, or edit a Notion page or database, or references a Notion todo/board/note.
---

# Notion

Use the `mcp__claude_ai_Notion__*` (or `mcp__notion__*`, depending on which server is connected) tools. Load each tool's schema via `ToolSearch` (e.g. `select:mcp__claude_ai_Notion__notion-fetch`) before calling — they're deferred.

<known_workflows>
| Workflow/Module | Source URL | Reference Doc | When to Use |
|---|---|---|---|
| Self-improvement To-dos | https://app.notion.com/p/32650704f72a805c92c0e85595643be1 | — | Use when user mentions self-improvement to-dos |
| Expense Tracking & Planning | https://app.notion.com/p/1de8b8217a2c4f2f811d3e7d236daf9c | `references/expenses.md` | Querying, creating, or editing expense entries — read the reference doc first for the full schema, tag/debtor option lists, and worked examples. |
| Add reminders to Today's Due To-dos | https://app.notion.com/p/2bd50704f72a805e9d04d6579525537f?v=2c050704f72a801bb0d3000cde4bb585&source=copy_link  | `references/add-reminders-on-todos.md` | Use when user asks to add reminders or notifications to today's due to-dos |
| Fleeting Notes Sync | https://app.notion.com/p/Fleeting-Notes-2b650704f72a80ee9273c857fe94af2f | `references/fleeting-notes-sync.md` | Use when the user asks for the `sync-fleeting-notes` workflow, or otherwise asks to sync/reconcile the Odyssey vault's `Fleeting Notes/Notes/` folder with the Notion Fleeting Notes database — read the reference doc first for the schema, matching rules, and the tag/status mapping guidelines for notes created in either direction. |
| Task Management | https://app.notion.com/p/739b17d8d6734bf2bc60797d94eb739f | `references/task-management.md` | Use when the user asks about their task management system: the Notion To-dos pages (Plan Today, Today, Weekly Review, Foundation Tasks, Pending & Backlogs), planning workflows, or their views — read the reference doc first; it points to the Obsidian Odyssey vault guidelines. |
</known_workflows>

## Core Workflow

1. Ask the user which of the known workflows to go through. See the <known_workflows> block. If the user decides on a workflow/module, read the configured `Reference Doc`
2. If the user decides a flow that is not recognized, see the `./references/generic.md` document.
3. For any sync between the vault and a Notion database (new or existing), also read `./references/sync-workflow-guidelines.md` — it defines the link signal, the token-cheap count/diff run order, the confirmation checkpoint, and a template for registering a new sync in `<known_workflows>`.
