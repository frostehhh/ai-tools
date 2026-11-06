# opencode-summary

TUI plugin for opencode V2. `/summary` opens a modal that generates and shows a summary of the current session using
`session.generate` (session's current model; history is not changed). The summary is stored in session metadata
(`metadata["opencode-summary"]`).

## Install

1. Copy the `opencode-plugins` group from `links.example.json` into `links.json`.
2. `python tools/syncLinks/sync.py` then `python tools/syncLinks/sync.py --check`.
3. Restart opencode. The TUI discovers `~/.config/opencode/plugins/opencode-summary`.

## Use

`/summary` (or the palette, "Session summary") in a session. Keys: `g` generate, `v` toggle prompt view, `c` copy (summary view), `e` edit and `r` reset prompt (prompt view), `j/k ↑/↓` scroll, `esc` close.
Bind a global key with `cli.json` `keybinds`: `{"summary.open": "<key>"}`.

## Prompt

The default prompt is in `prompt.ts`. Your prompt lives in `prompts/summary.md` next to `tui.tsx`. Through the link this
is the repo copy, so edits show up in `git status`. A fixed line forbidding tool calls is always prepended and is not
editable. `e` opens `$VISUAL`/`$EDITOR` on the file; if neither is set it opens a multi-line editor in the modal
(`ctrl+s` save, `esc` cancel). `r` deletes the override.

## Develop

`bun test` in this directory. `lib.ts` must not import opencode packages. Edits hot-reload in a running TUI through the
link.

## Manual checklist

- [ ] `/summary` in slash completion and palette; on home shows "Open a session first"
- [ ] Empty state, then `g` shows summary + "Generated …"; persists after TUI restart
- [ ] `c` copies the markdown
- [ ] Footer: `summary up to date` after `g`; `summary 1 turn ago`, then `summary 2 turns ago` after messages
- [ ] `!cmd` shell runs and assistant replies do not change the count
- [ ] `g` then `esc`: footer spinner, then toast "Summary ready"; `g` mid-run shows "Already generating"
- [ ] Switching sessions shows each session's own footer
- [ ] Staged revert before the summary: summary stays; `g` works and the new summary's turn count is relative to the last visible message
- [ ] Undo the revert: summary stays
- [ ] Commit the revert (send a message): summary deleted, footer hidden
- [ ] Revert removing only messages after the summary keeps it
- [ ] Agent running: `g` -> "Agent is running - wait for it to finish"
- [ ] Fork a summarized session: fork shows no summary; parent keeps its own
- [ ] `e`/`r`/copy hints and keys only in their views (`e`,`r` in prompt view; `c` in summary view)
- [ ] `v` shows the fixed guard line, the default prompt, "source: default (prompt.ts)"
- [ ] `$EDITOR` set: `e` opens the editor; saving creates `prompts/summary.md` (in `git status`); `v` shows "source: override"
- [ ] `$EDITOR` unset: `e` shows the in-modal editor; Enter adds a newline; `g`/`v`/`c` type letters; `ctrl+s` saves; `esc` cancels without closing the modal
- [ ] `g` uses the edited prompt; older summary shows "Generated with a different prompt"
- [ ] Empty save: warning, previous prompt kept. Text equal to default: override file removed
- [ ] `r` + confirm removes the override; source back to default
