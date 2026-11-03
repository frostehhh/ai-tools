---
name: sync-links
description: Create, repair and audit every link from this repo to its consumers from links.json, via tools/syncLinks/sync.py. Use after adding, moving or removing a link, after a fresh clone or machine setup, when a consumer can't see src config, or when the user asks to audit or fix links.
---

# sync-links

`links.json` (repo root) is the single map of every link to a consumer. `tools/syncLinks/sync.py` makes the filesystem match it. Never run `mklink` by hand. Full details: `tools/syncLinks/README.md`.

## Run

From the repo root:

```
python tools/syncLinks/sync.py                 # create missing / fix wrong links
python tools/syncLinks/sync.py --check          # audit only, exit 1 if anything is off
python tools/syncLinks/sync.py --group <name>   # one or more groups from links.json
python tools/syncLinks/sync.py --dry-run        # preview
python tools/syncLinks/sync.py --config <path>  # another links file
```

Prefer `--check` or `--dry-run` first when unsure. Restart opencode after changes.

## Workflow: add, move or remove a link

1. Edit `links.json` (`vars`, then the group's `links`).
2. `python tools/syncLinks/sync.py --dry-run --group <group>`.
3. Run without `--dry-run`, then `--check`.

## Per-link behaviour

- Missing: created, parent folders too.
- Wrong target: link removed (only the link), recreated.
- Empty real folder in the way: removed, link created.
- Non-empty real folder or file in the way: warning, left alone, counts as not ok.
- Target missing: warning, skipped.
- Undeclared links are ignored.

## Rules

- `type`: `symlink` (needs elevated shell or Developer Mode on Windows) or `junction` (directories only, no admin).
- `mode: "perFile"` links each matching item into a real folder.
- Skill junctions inside `src` belong to `link-skills`, not this skill.
- Never recursively delete a link; use `rm <link>` (Unix) or `rmdir <link>` (Windows).
- Cross-platform: works on macOS, Linux, and Windows.
