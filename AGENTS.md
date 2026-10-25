# AGENTS.md

Repo-specific instructions for `ai-tools`. User-wide conventions live in `src/AGENTS.md` and also apply. See `README.md` for the full layout.

## What this repo is

Shareable AI config (skills, Claude Code and opencode config, OpenSpec) under `src/`. The by-category skill view is generated junctions, so a careless edit or move can break other places.

## Rules

- Edit skills only in `src/.agents/skills/<name>`. `src/skills/<category>/` are generated junctions (gitignored). Never put real content there.
- `src/.claude/skills/<name>` are pointer files (git symlinks) into `src/.agents/skills`; don't replace them with real folders.
- After adding, removing or renaming a skill, or after a fresh clone, run `pwsh tools/linkSkills/sync.ps1`.
- Skill category comes from `tools/linkSkills/categories.json` (explicit lists, then prefixes, default `general`). Skill names must not change.
- Any link added, moved or removed: update `links.json`, then run `pwsh tools/syncLinks/sync.ps1` (`-Check` to audit). Do not run `mklink` by hand.

## Git and filesystem safety

- Do not run `git checkout` / `git switch` / `git stash` / `git clean` / `git reset --hard` with generated junctions present. Git follows them badly on Windows and can delete files through them.
- Delete a junction or symlink with `cmd /c rmdir <link>` or `Remove-Item` without `-Recurse`. Never `-Recurse` on a link: it can delete the target's contents.
- Symlinks need admin or developer mode. Junctions (directories only) do not.

## Tools

Each tool has its own README. Read it before changing the tool or its data file.

- `tools/linkSkills/README.md`: builds the generated skill junctions from `src/.agents/skills` and `categories.json`.
- `tools/syncLinks/README.md`: creates, repairs and audits every link in `links.json`.
- `tools/herdr-plugins/`: local Herdr plugins (machine-specific).
