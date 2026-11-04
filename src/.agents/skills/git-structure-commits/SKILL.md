---
name: git-structure-commits
description: Restructure uncommitted changes or unpushed local commits into clean, logical, atomic commits (split, squash, reorder, reword) with a backup ref and a tree-equality check. Use when user asks to split changes into commits, organize/clean up/restructure commits, rewrite local history before pushing, or "commit this in logical chunks".
tags:
  - git
---

# Git Structure Commits

Turn a messy diff or messy local history into a reviewable sequence of atomic commits. Final tree must be byte-identical to the starting tree.

## Rules

- Never rewrite pushed commits. If the range has commits on the upstream (`git branch -r --contains <sha>`), stop and tell the user.
- Abort if range contains merge commits.
- Non-interactive git only (no `git add -p`, `rebase -i`, editors). Use patch files + `git apply --cached`. See [REFERENCE.md](REFERENCE.md).
- Avoid `git stash`, `git checkout`, `git clean`, `git reset --hard`. Only `git reset --soft` / `--mixed`.
- Always show plan table, end turn, wait for user's reply approving it before creating commits.

## Workflow

### 1. Inspect

```bash
git status --short
git log --oneline -20          # learn message style
git log @{u}..HEAD --oneline   # unpushed commits (if rewriting history)
```

Message style: infer from `git log` (Conventional Commits? scopes used? casing? length?). Match it.

### 2. Backup + snapshot

```bash
TS=$(date +%Y%m%d-%H%M%S)
git branch backup/structure-$TS            # HEAD backup
TMPIDX=$(mktemp); cp "$(git rev-parse --git-path index)" "$TMPIDX"
GIT_INDEX_FILE="$TMPIDX" git add -A
TARGET_TREE=$(GIT_INDEX_FILE="$TMPIDX" git write-tree)   # tree incl. worktree changes
rm "$TMPIDX"
```

If user excluded some files from restructuring, exclude them from snapshot too (`git add -A -- . ':!path'`).

### 3. Flatten (existing commits only)

```bash
git reset --mixed <base>   # base = oldest commit to rewrite's parent, e.g. @{u}
```

All changes now uncommitted; same flow as uncommitted case from here.

### 4. Plan

Read `git diff` + untracked files. Group into commits by intent: one logical change each, each commit ideally builds. Order: refactors/deps → features → tests → docs.

Show plan as markdown table in chat output first, with these exact columns. Number commits 1..N in commit order. Body column: commit message body, or description of changes if commit has no body. List files/hunks in it.

```md
| # | Commit title | Commit message body / description of changes |
|---|--------------|----------------------------------------------|
| 1 | refactor(auth): extract token parser | Move parsing to `src/auth/token.ts` (new); `src/auth/login.ts` hunks 1-2 |
| 2 | feat(auth): add refresh flow | Refresh expired tokens on 401; `src/auth/login.ts` hunk 3 |
```

Approval = plain-text turn, not a tool call:
- Table must be the final reply text of the turn. End with: `Reply "ok" to execute, or describe changes.` Then stop.
- No question/ask-user tool for plan approval (overrides any global "use question tool" rule; tool UI hides the table).
- No tool calls after table in same turn.
- User's next message = approval or adjustments. Don't execute until explicit approval.
- If user adjusts, show full updated table, end turn again.

### 5. Execute

Per planned commit:
- Whole files: `git add -- <paths>`
- Partial files: build patch, `git apply --cached` (REFERENCE.md)
- `git diff --cached --stat` sanity check, then `git commit -m "<msg>"`

### 6. Verify

```bash
git diff --stat $TARGET_TREE HEAD   # must be empty
git status --short                   # only intentionally excluded files left
git log --oneline <base>..HEAD
```

If diff non-empty: commit remaining pieces or fix. To fully undo: `git reset --mixed backup/structure-$TS` (restores history; worktree untouched).

### 7. Report

Show new log. Mention backup branch name; suggest `git branch -D backup/structure-$TS` once user is happy.
