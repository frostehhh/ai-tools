# Partial-file staging (non-interactive)

## Stage selected hunks

```bash
git diff -U3 -- path/file > /tmp/file.patch
```

Edit `/tmp/file.patch`: keep header (`diff --git`, `index`, `---`, `+++`) and only the `@@` hunks wanted. Then:

```bash
git apply --cached --check /tmp/file.patch && git apply --cached /tmp/file.patch
```

Removing whole hunks is safe; `git apply --recount` fixes counts if lines inside a hunk were edited.

## Split a single hunk

Within a kept hunk:
- Drop an unwanted `+` line: delete it.
- Drop an unwanted `-` line: change leading `-` to ` ` (becomes context).
- Apply with `git apply --cached --recount`.

If hunks are too coarse, regenerate with `-U0` and apply with `--unidiff-zero`, or `-U1` for less context.

## Untracked file, partial

```bash
git add -N path/new-file    # intent-to-add, makes it diffable
git diff -- path/new-file > /tmp/new.patch
```

Then edit + apply as above.

## Check what's staged vs left

```bash
git diff --cached -- path/file   # going into this commit
git diff -- path/file            # left for later commits
```

## Renames / binary

- Binary: stage whole file (`git add`); can't split.
- Renames: `git add -A -- old new` together so git records rename.

## Rewording only (no content change)

Prefer flatten + recommit over `rebase -i`. For one commit at HEAD: `git commit --amend -m "<msg>"`.
