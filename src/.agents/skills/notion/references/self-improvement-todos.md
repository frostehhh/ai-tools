# Self-improvement To-dos

Parent page: **Self-improvement To-dos** - https://app.notion.com/p/32650704f72a805c92c0e85595643be1 

## Core Workflows

Ask the user which of the workflows listed in the `Main Workflows` section to follow

## Main Workflows
### Syncing of Self-improvement points entries to Notion counterpart
<self_improvement_points>
`Personal Odyssey/Guidelines and To-dos/Self-improvement/Points/Tasks`
</self_improvement_points>

This workflow is ONLY for syncing from local files to Notion counterparts.
IMPORTANT: Do not update the obsidian files. The sync direction is local files -> Notion. Only Notion pages will be updated.

In this obsidian vault, these are located in the directory in this block: <self_improvement_points>.
If the `source_url` property has a value:
  - it is a link to the corresponding Notion page.
  - Ask the user if they want to proceed with syncing the

If there are entries with no corresponding `source_url`:
  - List the entries
  - ask the user if they want them to be synced to notion.

#### Syncing Guidelines
Sync the following:
- note name
- status(See <status_mapping> block for guidelines)
- priority
- Note contents

If you need to update local obsidian status, use the obsidian-cli to get existing `status` values.

<status_mapping>
| Obsidian Status |  Notion Status |
|-----------------|----------------|
| 0-open/backlog | Backlog |
| 0-open/pending | Pending |
| 1-onHold/* | On-hold |
| 2-inProgress/* | In Progress |
| 3-completed/* | Completed |
</status_mapping