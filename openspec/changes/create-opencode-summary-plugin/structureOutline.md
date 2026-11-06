---
date: 2026-11-05T20:22:43+08:00
git_commit: 5ff33d51ef7d8b8133981f143b7606e93d359ca3
branch: main
repository: ai-tools
---

# opencode-summary TUI plugin

A TUI-only opencode V2 plugin at `src/opencode-plugins/opencode-summary`, linked into `~/.config/opencode/plugins/` via `links.json`. `/summary` opens a `/btw`-style modal that generates a summary with `session.generate`, stores it in session metadata, and supports view, edit and reset of the prompt. A footer indicator shows how many turns ago the summary was made. Phase 1 ships a working generate-and-view path end to end. Later phases add the indicator, validity rules and prompt editing on top of it.

## Desired End State

#### User-facing
- `/summary` (slash or palette) in a session opens a modal: stored summary or "No summary yet - press g to generate", plus `Generated 2h ago · 14:05 · 11/5/2026 · 3 turns ago`.
- Modal keys: `g` generate, `v` toggle prompt view, `c` copy (summary view only), `e` edit and `r` reset prompt (prompt view only), scroll keys, `esc`.
- Footer `prompt.footer.status`: `summary up to date` / `summary 1 turn ago` / `summary N turns ago` / `summary 200+ turns ago`; spinner while generating.
- The summary persists across restarts. It is deleted once a committed revert removes any message it covered (this also covers forks and child sessions). A staged revert keeps it.
- `g` is blocked while the agent is running or while a generation is already in flight. With a staged revert `g` works and `lastMessageID` is capped at the revert boundary. A failed or timed-out (3 min) generation keeps the old summary.

#### Repo
- Plugin files `tui.tsx`, `prompt.ts`, `lib.ts`, `lib.test.ts`, `README.md`. `prompts/summary.md` is created by the edit hotkey.
- `links.example.json` gains an `opencode-plugins` group. Repo `README.md` lists `src/opencode-plugins/`.
- `bun test` covers the pure logic in `lib.ts`.

## Implementation Overview

- [ ] Phase 1: Generate and view a summary end to end
- [ ] Phase 2: Footer indicator in turns, background generation
- [ ] Phase 3: Validity check and generate guards
- [ ] Phase 4: View, edit and reset the prompt

---

## Phase 1: Generate and view a summary end to end

Walking skeleton covering every layer: link entry, plugin load, `/summary` command, modal, `session.generate`, metadata write and read-back. Uses `GUARD` + `DEFAULT_PROMPT` only. The record is stored in its final shape (`lastMessageID`, `promptId`) so later phases need no migration.

### File Changes

- **`src/opencode-plugins/opencode-summary/prompt.ts`**: `GUARD` ("Do not call any tools and do not take any actions.") and `DEFAULT_PROMPT` (TL;DR, then Goal, Decisions, Progress / current state, Open questions / next steps, Key files and references; about 300 words or less).
- **`src/opencode-plugins/opencode-summary/lib.ts`**: pure helpers with no opencode imports.

```typescript
export const METADATA_KEY = "opencode-summary"
export type SummaryRecord = { text: string; generatedAt: number; promptId: string; lastMessageID: string }
export function buildRequest(prompt: string): string { ... }                 // GUARD + "\n\n" + prompt
export function promptId(text: string): string { ... }                      // short stable hash
export function readSummary(metadata: unknown): SummaryRecord | undefined { ... }   // shape-checked
export function withSummary(metadata: Record<string, unknown> | undefined, record: SummaryRecord): Record<string, unknown> { ... }
export function withoutSummary(metadata: Record<string, unknown> | undefined): Record<string, unknown> { ... }
export function isBlank(text: string | undefined): boolean { ... }
export function relativeTime(ts: number, now: number): string | undefined { ... }   // stash-style; undefined at 7d+
export function datetime(ts: number): string { ... }                        // "<time> · <date>"
export function generatedLine(record: SummaryRecord, now: number): string { ... }
```

- **`src/opencode-plugins/opencode-summary/lib.test.ts`**: `bun:test` cases for merge/remove (other keys preserved), `readSummary` rejecting bad shapes, `buildRequest` guard first, relative-time boundaries (59 s, 59 m, 23 h, 6 d, 7 d), `isBlank`.
- **`src/opencode-plugins/opencode-summary/tui.tsx`**: `Plugin.define({ id: "opencode-summary", setup })`.
  - Global keymap layer: command `summary.open`, slash `summary`, palette, group "Summary". Off a session route it shows the toast "Open a session first".
  - Modal: `ui.dialog.show` + `set({size: "large", centered: true})`, with its own header, body and footer layout (inset 3, gap 1, muted `esc` and hints). Body is `<scrollbox><markdown>` or the empty state, plus the generated line.
  - Modal layer: `g` generate, `c` copy via `renderer.copyToClipboardOSC52`, scroll keys.
  - `generate(sessionID)`:
    1. Get `lastMessageID`: newest id from `client.message.list({sessionID, order: "desc", limit: 200})` below `session.revert.messageID` (newest overall when no revert), via `lib.lastVisibleID`.
    2. Call `client.session.generate`, raced against a 3 min timeout so a hung call clears the in-flight entry.
    3. On blank text or error: error toast, no write.
    4. Otherwise read-merge-write via `client.session.update({sessionID, metadata})`.
  - Captures the plugin context outside the dialog component (`btw.tsx:46`).

```typescript
async function generate(sessionID: string): Promise<void> { ... }
async function openModal(sessionID: string): Promise<void> { ... }
async function writeSummary(sessionID: string, record: SummaryRecord | undefined): Promise<void> { ... }  // undefined = remove
```

- **`src/opencode-plugins/opencode-summary/README.md`**: what it does, install (links.json), usage, manual checklist (Phase 1 items).
- **`links.example.json`**: new group `opencode-plugins` with the symlink `${home}/.config/opencode/plugins/opencode-summary` -> `${src}/opencode-plugins/opencode-summary`.
- **`README.md`**: add `src/opencode-plugins/` to the directory tree.

### Validation

#### Automated Verification

- [ ] `bun test` (in `src/opencode-plugins/opencode-summary`)
- [ ] `bun build --no-bundle tui.tsx > /dev/null && bun build --no-bundle lib.ts > /dev/null && bun build --no-bundle prompt.ts > /dev/null` (syntax/transpile check; imports not resolved)
- [ ] `python tools/syncLinks/sync.py --config links.example.json --group opencode-plugins --dry-run` (entry parses, shows the planned link)

#### Manual Verification

- [ ] Copy the group into `links.json`, run `python tools/syncLinks/sync.py`, then `--check` (writes to `~`; user runs or approves)
- [ ] Restart the TUI. `/summary` appears in slash completion and the palette.
- [ ] On the home screen, `/summary` shows the toast "Open a session first".
- [ ] In a session: empty state, then `g` shows the summary and the generated line.
- [ ] Restart the TUI. `/summary` still shows the summary (metadata persisted).
- [ ] `c` copies the summary markdown.

---

## Phase 2: Footer indicator in turns, background generation

Adds the footer indicator, turn counting and its refresh triggers, plus in-flight tracking: spinner, "Already generating", and finishing in the background with a "Summary ready" toast. The modal's generated line gains the turns text.

### File Changes

- **`lib.ts`**: turn helpers.

```typescript
export const TURN_LIMIT = 200
export function countTurnsAfter(userMessageIDs: readonly string[], lastMessageID: string): number { ... }   // ascending-ID compare
export function turnLabel(turns: number, capped: boolean): string { ... }   // "summary up to date" | "summary 1 turn ago" | "summary N turns ago" | "summary 200+ turns ago"
export function generatedLine(record: SummaryRecord, now: number, turns?: { count: number; capped: boolean }): string { ... }
```

- **`lib.test.ts`**: 0, 1, N and 200+ wording; `countTurnsAfter` with IDs before, equal to and after `lastMessageID`; generated line with and without turns.
- **`tui.tsx`**:
  - `ui.slot({append: "prompt.footer.status"})` renders the muted label or a `/summary` spinner.
  - `countTurns(sessionID)` calls `client.message.list({sessionID, type: "user", order: "desc", limit: 200})`.
  - A debounced refresh runs on slot `sessionID` change, `data.on("session.inbox.delivered")` and `data.on("session.metadata.updated")`.
  - In-flight set in `storage.memory`. A second `g` shows the toast "Already generating". When the modal is closed at completion, toast "Summary ready".

```typescript
async function countTurns(sessionID: string): Promise<{ count: number; capped: boolean }> { ... }
function refresh(sessionID: string): void { ... }   // debounced; updates footer and open modal
```

- **`README.md`** (plugin): checklist adds footer wording and background generation.

### Validation

#### Automated Verification

- [ ] `bun test`
- [ ] `bun build --no-bundle tui.tsx > /dev/null && bun build --no-bundle lib.ts > /dev/null`

#### Manual Verification

- [ ] After `g`, the footer shows `summary up to date`. One message gives `summary 1 turn ago`, two give `summary 2 turns ago`.
- [ ] Shell (`!cmd`) runs and assistant replies do not change the count.
- [ ] Press `g`, then `esc`: the footer spinner shows, then the toast "Summary ready". Pressing `g` again mid-run shows "Already generating".
- [ ] Switching sessions shows each session's own footer state.

---

## Phase 3: Validity check and generate guards

Applies the deletion rule, read-time and not tied to events: if `lastMessageID` no longer exists, the summary is removed. It also blocks generation while the agent is running (a staged revert does not block).

### File Changes

- **`lib.ts`**: decisions as pure functions.

```typescript
export type BlockReason = "running" | "in-flight"
export function blockReason(input: { status: "idle" | "running"; inFlight: boolean }): BlockReason | undefined { ... }
export function lastVisibleID(idsDesc: readonly string[], revertBoundary?: string): string | undefined { ... }
export function blockMessage(reason: BlockReason): string { ... }
export function validityAction(check: { found: true } | { found: false; notFound: boolean }): "keep" | "delete" { ... }   // other errors keep
```

- **`lib.test.ts`**: each block reason and its precedence; `validityAction` returns keep on found, delete on not-found, keep on other errors.
- **`tui.tsx`**:
  - `loadSummary(sessionID)` reads metadata and calls `client.session.message.get({sessionID, messageID: lastMessageID})`. On not-found it calls `writeSummary(sessionID, undefined)`. It runs on modal open and on every refresh.
  - The refresh also runs on `session.revert.committed`.
  - `g` checks `blockReason` using `data.session.status` and the in-flight set, shows a warning toast, and the footer hint marks `g` unavailable.
  - `session.revert.staged`/`cleared` refresh the blocked state.

```typescript
async function loadSummary(sessionID: string): Promise<SummaryRecord | undefined> { ... }
function isMessageNotFound(error: unknown): boolean { ... }   // shape verified in plan
```

- **`README.md`** (plugin): checklist adds revert and fork cases.

### Validation

#### Automated Verification

- [ ] `bun test`
- [ ] `bun build --no-bundle tui.tsx > /dev/null && bun build --no-bundle lib.ts > /dev/null`

#### Manual Verification

- [ ] Stage a revert to before the summary: the summary stays and `g` works; the new summary counts turns from the last visible message.
- [ ] Undo the revert: the summary stays.
- [ ] Stage a revert, then send a message (commit): the summary is deleted and the footer is hidden.
- [ ] A revert that only removes messages after the summary keeps it.
- [ ] While the agent runs, `g` shows "Agent is running - wait for it to finish".
- [ ] Fork a summarized session: the fork shows no summary and the parent keeps its own.

---

## Phase 4: View, edit and reset the prompt

The prompt becomes file-based. `prompts/summary.md` overrides `DEFAULT_PROMPT`, is read at generate time, and is edited through `$VISUAL`/`$EDITOR` or an in-modal textarea fallback. Reset goes through a confirm dialog.

### File Changes

- **`lib.ts`**: prompt resolution and save rules.

```typescript
export type PromptSource = "default" | "override"
export function resolvePrompt(override: string | undefined): { text: string; source: PromptSource } { ... }
export function saveAction(edited: string): "noop" | "delete" | "write" { ... }   // blank -> noop; equals DEFAULT_PROMPT -> delete
export function promptPaths(metaUrl: string): { dir: string; override: string } { ... }   // <plugin>/prompts/summary.md
```

- **`lib.test.ts`**: resolution with and without an override; `saveAction` for blank, default-equal and changed text; `promptPaths` from a `file://` URL.
- **`tui.tsx`**:
  - `generate` uses `loadPrompt()` (override file, else default). The modal notes "generated with a different prompt" when `promptId` differs from the current prompt.
  - `v` toggles the prompt view: the fixed `GUARD` line, then the effective prompt and its source and path. `esc` leaves the view.
  - `e`: if `$VISUAL`/`$EDITOR` is set, seed the file, then `renderer.suspend()`, spawn the editor on the file and wait, then `renderer.resume()`, then apply `saveAction`. Otherwise show a `<textarea>` view (`ctrl+s` save, `esc` cancel).
  - `r`: `ui.dialog.confirm`, then delete the override.
  - `mkdir -p prompts/` on first write.

```typescript
async function loadPrompt(): Promise<{ text: string; source: PromptSource }> { ... }
async function editPrompt(): Promise<void> { ... }
async function resetPrompt(): Promise<void> { ... }
```

- **`README.md`** (plugin): prompt section (default, override file location, `$EDITOR`, reset); checklist adds prompt items.

### Validation

#### Automated Verification

- [ ] `bun test`
- [ ] `bun build --no-bundle tui.tsx > /dev/null && bun build --no-bundle lib.ts > /dev/null`

#### Manual Verification

- [ ] `v` shows the guard line and the default prompt with source "default".
- [ ] With `$EDITOR` set, `e` opens the editor, and saving creates `src/opencode-plugins/opencode-summary/prompts/summary.md` (visible in `git status`). `v` then shows source "override".
- [ ] Without `$EDITOR`, `e` shows the textarea and `ctrl+s` saves.
- [ ] `g` uses the edited prompt, and the modal shows the "different prompt" note on an older summary.
- [ ] Saving empty text changes nothing (warning). Saving text identical to the default deletes the file.
- [ ] `r` with confirm deletes the override and the source returns to "default".

---

## Open Questions

- How does the TUI client surface `MessageNotFoundError` (tag, name or status)? Verify in the plan for `isMessageNotFound`.
- Are `<textarea>`, `useKeyboard` and a spinner available to plugins from `@opentui/solid` at runtime, or is `/btw`'s `Spinner` internal (if so, use own spinner text)?
- Does `renderer.copyToClipboardOSC52` exist in installed v2.2.5 (the source read was `e5f2dde`)?
- Does TUI hot reload pick up edits under the symlinked plugin dir (dev loop), or is a restart needed?
