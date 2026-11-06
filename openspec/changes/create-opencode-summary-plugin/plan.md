---
date: 2026-11-06T03:33:06+08:00
git_commit: 5ff33d51ef7d8b8133981f143b7606e93d359ca3
branch: main
repository: ai-tools
---

# opencode-summary TUI plugin Implementation Plan

## Overview

Build `opencode-summary`, a TUI-only opencode V2 plugin in `src/opencode-plugins/opencode-summary`, linked into `~/.config/opencode/plugins/` through `links.json`. `/summary` opens a `/btw`-style modal. It generates a conversation summary with `client.session.generate`, stores it in session metadata, shows when it was generated, and lets the user view, edit and reset the prompt. A footer indicator shows how many user turns ago the summary was made.

## Current State Analysis

- The repo has no `src/opencode-plugins/`, no JS/TS toolchain (no `package.json`, `tsconfig` or test runner) and no link into `~/.config/opencode/plugins/`. `links.json` is gitignored and absent; `links.example.json` has one `example` group.
- `~/.config/opencode/plugins/` holds only `herdr-agent-state.js`. `bun` 1.3.11 is on PATH. The installed opencode is v2.2.5.
- Plugin APIs were read from `anomalyco/opencode` at `e5f2dde` (`/tmp/oc-src/opencode`). The installed v2.2.5 binary contains the key strings (`copyToClipboardOSC52`, `runtime-plugin-support`, `session.inbox.delivered`, `MessageNotFoundError`, `prompt.footer.status`, `nativeScene`, the `/generate` route).

### Key Discoveries:
- **Loading:**
  - A local plugin dir with a root `tui.tsx` loads with no `package.json` or build (`services/www/src/docs/content/build/plugins/index.mdx:87-89`).
  - The TUI discovers directories and symlinked directories in `<global-config>/plugins/` (`packages/tui/src/plugin/discovery.ts:24-50`).
- **Runtime imports:**
  - The host provides `effect` and `@opencode/plugin/*` (`packages/plugin/src/runtime-modules.ts:7`).
  - OpenTUI runtime plugin support provides `@opentui/core`, `@opentui/solid` (+ `jsx-runtime`), `solid-js` and `solid-js/store` (`@opentui/solid@0.8.2` `scripts/runtime-plugin-support-configure.js`).
  - `@opencode/theme` is not provided, so the markdown `SyntaxStyle` is built with `SyntaxStyle.fromStyles(styles, context.renderer.nativeScene)` (`cli.mdx:224-233`; `@opentui/core` `syntax-style.d.ts:47`).
- **`/btw` (`packages/tui/src/feature-plugins/prompt/btw.tsx`) uses internals:** `Keymap.createLayer`, `useTheme`, `Spinner`, `useClipboard`, `DialogLayout`/`DialogHeader`/`DialogFooter`, `usePlugin().markdown`. Public equivalents:
  - Keymap: `context.keymap.layer(() => ({mode: "modal", commands}))`. Dialogs push mode `"modal"` (`packages/tui/src/ui/dialog.tsx:322,346`). Layers created in a component are removed when it is disposed (`cli.mdx:306-309`).
  - Theme: `context.theme.surface("dialog")` and `context.theme.text.{base,muted}` (`packages/theme/src/tui/types.ts:25-73`).
  - Clipboard: `context.renderer.copyToClipboardOSC52(text): boolean` (`@opentui/core` `renderer.d.ts:614`).
  - Dialog context: dialogs render beside `PluginProvider` (`btw.tsx:46`), so dialog components close over `setup`'s `context` instead of calling `usePlugin()`.
- **Client (promise) shapes:**
  - `client.session.generate({sessionID, prompt}) -> {text}`.
  - `client.session.get({sessionID}) -> SessionInfo` (has `metadata?`, `revert?`).
  - `client.session.update({sessionID, metadata})`.
  - `client.session.message.get({sessionID, messageID}) -> SessionMessageInfo`.
  - `client.message.list({sessionID, limit, order, type}) -> {data, cursor}`.
  - Sources: `packages/client/src/promise/generated/client.ts:657-667,715,922-933,957-968,1749-1751`; `types.ts:124,2314-2332,2777-2780,3362-3370,3891-3911`.
- **Declared errors** are thrown as `Error` with `name` and `_tag` set to the tag, e.g. `"MessageNotFoundError"` (`client/src/promise/generated/client.ts:2840-2844`, `protocol/src/errors.ts:165-173`).
- **Message IDs** are `msg_` + fixed-width hex of `timestamp * 0x1000 + counter`, so plain string comparison orders them (`packages/schema/src/identifier.ts:8-28`).
- **Events:** `data.on(type, handler)` returns an unsubscribe (`cli.mdx:61-75`). Session events carry `data.sessionID`.
- **Prompt dialog is single-line:** `ui.dialog.prompt` renders a `<textarea height={1} wrapMode="none">` (`packages/tui/src/ui/dialog-prompt.tsx:162-176`) and its `dialog.prompt.submit` command is bound to `return` (`packages/tui/src/config/keybind.ts:268`), so it can't edit a multi-line prompt.
- **Escape inside a dialog can be overridden:** `DialogPrompt` binds `escape` in a keymap layer with `mode: "modal", priority: 1` and a `target` textarea (`dialog-prompt.tsx:62-102`). Plugin layers accept `priority` and `target` (`packages/plugin/src/tui/context.ts:435-448`).
- **Hot reload through the symlink:** the plugin dir is added to the source watcher (`packages/tui/src/plugin/context.tsx:343`); for a symlink the watcher also arms its `realpath` (`packages/tui/src/plugin/watch.ts:82-91`); the source loader watches each local dependency (`watch.ts:11-12`). Edits to the repo copy reload the plugin; `storage.memory` survives reloads.
- **`node:*` imports work in TUI plugins:** OpenTUI's Bun plugin only rewrites its fixed specifier list (plus host additions). `resolvePath` returns `null` for everything else, so Bun resolves built-ins normally (`@opentui/solid@0.8.2` `scripts/runtime-plugin-support-configure.js`, `ensureRuntimePluginSupport`).
- **Syntax check:** `bun build --no-bundle <file>` transpiles TSX without resolving imports and fails on syntax errors (verified in a scratch dir).

## Desired End State

- `/summary` (slash or palette) in a session opens a modal with the summary or "No summary yet - press g to generate", plus `Generated 2h ago · 14:05 · 11/5/2026 · 3 turns ago`.
- Modal keys: `g` generate, `v` toggle prompt view, `e` edit prompt, `r` reset prompt, `c` copy, `j/k`/arrows/page/home/end scroll, `esc` close.
- The footer shows `summary up to date` / `summary 1 turn ago` / `summary N turns ago` / `summary 200+ turns ago`, and a spinner while generating.
- **Persistence and deletion:**
  - The summary persists in `metadata["opencode-summary"]`.
  - It is deleted when its `lastMessageID` no longer exists (committed revert, fork, child session).
  - A staged revert keeps it.
- **Generate rules:**
  - `g` is blocked while the agent is running, while a revert is staged, or while a generation is in flight.
  - A failure keeps the old summary.
  - Closing the modal mid-generation finishes in the background and shows "Summary ready".
- **Prompt:** `prompts/summary.md` overrides `DEFAULT_PROMPT`. A fixed `GUARD` line is always prepended.
- **Verification:** `bun test` passes in the plugin dir. `sync.py --check` passes once the user has added the link.

## What We're NOT Doing

- No server entry, RPC, `package.json`, `tsconfig`, build step or npm publishing.
- No preferred-model option, plugin options or options hotkey.
- No `experimental.*` APIs, compaction hooks, auto/scheduled summaries or range summaries.
- No V1 API support. No web/desktop `/summary`.
- No TUI render tests.

## Implementation Approach

Vertical slices on one file set:
1. Phase 1 wires link, load, command, modal, generate and metadata end to end, with the record in its final shape.
2. Phases 2-4 add the indicator, the validity rules and prompt editing to the same `tui.tsx`.
3. Logic that can be tested lives in `lib.ts`, which has no opencode imports, so `bun test` runs outside opencode.

All plugin paths below are relative to `src/opencode-plugins/opencode-summary/` unless rooted.

**Deviations from the design (plan wins):**
- `esc` closes the modal from the summary and prompt views; `v` toggles back from prompt view. Only the edit view overrides `escape` (to cancel), using a `priority: 1` layer like `DialogPrompt`.
- `r` uses `ui.dialog.confirm`, which replaces the summary modal, so the plugin reopens it afterwards.
- A session with no messages gets the warning "Nothing to summarize yet" (needed for `lastMessageID`).

---

## Phase 1: Generate and view a summary end to end

### Overview
Link entry, plugin load, `/summary` command, modal with empty state, `g` generate with `GUARD` + `DEFAULT_PROMPT`, read-merge-write to metadata, `c` copy, scroll keys, generated line. Generation failures keep the old record and show an error toast.

### Changes Required:

- [x] 1.1 Default prompt and guard

**File**: `src/opencode-plugins/opencode-summary/prompt.ts` (new)
**Changes**: constants only, no imports.

```ts
export const GUARD = "Do not call any tools and do not take any actions."

export const DEFAULT_PROMPT = `Summarize the conversation so far for the user.
Output markdown only, no preamble, about 300 words or less. Use exactly these sections, bullets only below TL;DR; omit a section if empty:

## TL;DR
2-3 sentences.
## Goal
## Decisions
## Progress / current state
## Open questions / next steps
## Key files and references`
```

- [x] 1.2 Pure helpers

**File**: `src/opencode-plugins/opencode-summary/lib.ts` (new)
**Changes**: record shape, metadata merge, request building, hashing, time formatting, error text.

```ts
import { GUARD } from "./prompt"

export const METADATA_KEY = "opencode-summary"
export type Metadata = Record<string, unknown>
export type SummaryRecord = { text: string; generatedAt: number; promptId: string; lastMessageID: string }

export const buildRequest = (prompt: string) => `${GUARD}\n\n${prompt}`

/** FNV-1a 32-bit, hex. Stable id for "generated with a different prompt". */
export function promptId(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0
  return hash.toString(16).padStart(8, "0")
}

export function readSummary(metadata: unknown): SummaryRecord | undefined {
  if (!metadata || typeof metadata !== "object") return undefined
  const value = (metadata as Metadata)[METADATA_KEY]
  if (!value || typeof value !== "object") return undefined
  const { text, generatedAt, promptId, lastMessageID } = value as Record<string, unknown>
  if (typeof text !== "string" || typeof generatedAt !== "number") return undefined
  if (typeof promptId !== "string" || typeof lastMessageID !== "string") return undefined
  return { text, generatedAt, promptId, lastMessageID }
}

export const withSummary = (metadata: Metadata | undefined, record: SummaryRecord): Metadata => ({
  ...metadata,
  [METADATA_KEY]: record,
})

export function withoutSummary(metadata: Metadata | undefined): Metadata {
  const { [METADATA_KEY]: _removed, ...rest } = metadata ?? {}
  return rest
}

export const isBlank = (text: string | undefined) => !text || text.trim() === ""

/** Copy of tui/src/component/dialog-stash.tsx getRelativeTime; undefined at 7+ days. */
export function relativeTime(ts: number, now: number): string | undefined {
  const s = Math.floor((now - ts) / 1000)
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  const d = Math.floor(h / 24)
  if (s < 60) return "just now"
  if (m < 60) return `${m}m ago`
  if (h < 24) return `${h}h ago`
  if (d < 7) return `${d}d ago`
  return undefined
}

/** Copy of tui/src/util/locale.ts datetime: "<time> · <date>". */
export function datetime(ts: number): string {
  const date = new Date(ts)
  return `${date.toLocaleTimeString(undefined, { timeStyle: "short" })} · ${date.toLocaleDateString()}`
}

export function generatedLine(record: SummaryRecord, now: number): string {
  const relative = relativeTime(record.generatedAt, now)
  return ["Generated", ...(relative ? [`${relative} ·`] : []), datetime(record.generatedAt)].join(" ")
}

export function errorMessage(cause: unknown): string {
  if (cause instanceof Error && cause.message) return cause.message
  return typeof cause === "string" && cause ? cause : "Unknown error"
}
```

- [x] 1.3 Tests

**File**: `src/opencode-plugins/opencode-summary/lib.test.ts` (new)

```ts
import { describe, expect, test } from "bun:test"
import * as lib from "./lib"
import { GUARD } from "./prompt"

const record: lib.SummaryRecord = { text: "# hi", generatedAt: 1_000, promptId: "abcd1234", lastMessageID: "msg_01" }

describe("metadata", () => {
  test("withSummary keeps other keys", () => {
    expect(lib.withSummary({ other: 1 }, record)).toEqual({ other: 1, [lib.METADATA_KEY]: record })
  })
  test("withoutSummary removes only our key", () => {
    expect(lib.withoutSummary({ other: 1, [lib.METADATA_KEY]: record })).toEqual({ other: 1 })
    expect(lib.withoutSummary(undefined)).toEqual({})
  })
  test("readSummary validates shape", () => {
    expect(lib.readSummary({ [lib.METADATA_KEY]: record })).toEqual(record)
    expect(lib.readSummary({ [lib.METADATA_KEY]: { ...record, generatedAt: "x" } })).toBeUndefined()
    expect(lib.readSummary(undefined)).toBeUndefined()
    expect(lib.readSummary({})).toBeUndefined()
  })
})

test("buildRequest puts the guard first", () => {
  expect(lib.buildRequest("P")).toBe(`${GUARD}\n\nP`)
})

test("promptId is stable and content-sensitive", () => {
  expect(lib.promptId("a")).toBe(lib.promptId("a"))
  expect(lib.promptId("a")).not.toBe(lib.promptId("b"))
  expect(lib.promptId("a")).toMatch(/^[0-9a-f]{8}$/)
})

test("isBlank", () => {
  expect(lib.isBlank(undefined)).toBe(true)
  expect(lib.isBlank("  \n")).toBe(true)
  expect(lib.isBlank("x")).toBe(false)
})

describe("relativeTime", () => {
  const now = 10 * 86_400_000
  const at = (ms: number) => lib.relativeTime(now - ms, now)
  test("boundaries", () => {
    expect(at(59_000)).toBe("just now")
    expect(at(60_000)).toBe("1m ago")
    expect(at(59 * 60_000)).toBe("59m ago")
    expect(at(3_600_000)).toBe("1h ago")
    expect(at(23 * 3_600_000)).toBe("23h ago")
    expect(at(6 * 86_400_000)).toBe("6d ago")
    expect(at(7 * 86_400_000)).toBeUndefined()
  })
})

test("generatedLine drops relative part at 7+ days", () => {
  expect(lib.generatedLine(record, record.generatedAt + 7_200_000)).toMatch(/^Generated 2h ago · .+ · .+$/)
  expect(lib.generatedLine(record, record.generatedAt + 8 * 86_400_000)).toMatch(/^Generated [^·]+ · [^·]+$/)
})
```

- [x] 1.4 Plugin entry, command, modal, generate

**File**: `src/opencode-plugins/opencode-summary/tui.tsx` (new)
**Changes**: `Plugin.define` with a global command layer (registered from an `app` slot, as `/btw` does), a modal component that closes over `context`, and generate plus read-merge-write.

```tsx
import { Plugin } from "@opencode/plugin/tui"
import { SyntaxStyle, TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { createMemo, createSignal, For, Show } from "solid-js"
import * as lib from "./lib"
import { DEFAULT_PROMPT } from "./prompt"

const INSET = 3 // tui/src/ui/dialog.tsx DIALOG_INSET

export default Plugin.define({
  id: "opencode-summary",
  setup(context) {
    const { client, ui } = context
    const theme = () => context.theme.surface("dialog")
    const syntax = SyntaxStyle.fromStyles(
      {
        default: { fg: context.theme.markdown.text },
        "markup.heading": { fg: context.theme.markdown.heading, bold: true },
        "markup.strong": { fg: context.theme.markdown.strong, bold: true },
        "markup.italic": { fg: context.theme.markdown.emphasis, italic: true },
        "markup.list": { fg: context.theme.markdown.listItem },
        "markup.quote": { fg: context.theme.markdown.blockQuote, italic: true },
        "markup.raw": { fg: context.theme.markdown.code },
        "markup.link": { fg: context.theme.markdown.link, underline: true },
      },
      context.renderer.nativeScene,
    )
    const toastError = (cause: unknown) => ui.toast.show({ variant: "error", message: lib.errorMessage(cause) })

    async function readMetadata(sessionID: string): Promise<lib.Metadata> {
      return ((await client.session.get({ sessionID })).metadata ?? {}) as lib.Metadata
    }

    /** Read-merge-write; `undefined` removes the summary. */
    async function writeSummary(sessionID: string, record: lib.SummaryRecord | undefined): Promise<void> {
      const current = await readMetadata(sessionID)
      const metadata = record ? lib.withSummary(current, record) : lib.withoutSummary(current)
      await client.session.update({ sessionID, metadata: metadata as never })
    }

    async function loadSummary(sessionID: string): Promise<lib.SummaryRecord | undefined> {
      return lib.readSummary(await readMetadata(sessionID))
    }

    /** Returns true when a new record was written. */
    async function generate(sessionID: string): Promise<boolean> {
      const prompt = DEFAULT_PROMPT
      const last = (await client.message.list({ sessionID, order: "desc", limit: 1 })).data[0]
      if (!last) {
        ui.toast.show({ variant: "warning", message: "Nothing to summarize yet" })
        return false
      }
      const result = await client.session
        .generate({ sessionID, prompt: lib.buildRequest(prompt) })
        .catch((cause: unknown) => (toastError(cause), undefined))
      if (!result) return false
      if (lib.isBlank(result.text)) {
        ui.toast.show({ variant: "error", message: "Summary came back empty" })
        return false
      }
      await writeSummary(sessionID, {
        text: result.text.trim(),
        generatedAt: Date.now(),
        promptId: lib.promptId(prompt),
        lastMessageID: last.id,
      })
      return true
    }

    function Hints(props: { items: [title: string, key: string][] }) {
      return (
        <box flexDirection="row" gap={2}>
          <For each={props.items}>{([title, key]) => <text fg={theme().text.muted}>{`${title} ${key}`}</text>}</For>
        </box>
      )
    }

    function SummaryDialog(props: { sessionID: string }) {
      const dimensions = useTerminalDimensions()
      const maxHeight = createMemo(() => Math.max(8, Math.floor(dimensions().height * 0.6)))
      const [record, setRecord] = createSignal<lib.SummaryRecord>()
      const [busy, setBusy] = createSignal(false)
      let scroll: ScrollBoxRenderable | undefined

      const reload = () => loadSummary(props.sessionID).then(setRecord, toastError)
      void reload()

      const run = async () => {
        if (busy()) return
        setBusy(true)
        try {
          if (await generate(props.sessionID)) await reload()
        } catch (cause) {
          toastError(cause)
        } finally {
          setBusy(false)
        }
      }
      const copy = () => {
        const text = record()?.text
        if (!text) return
        if (!context.renderer.copyToClipboardOSC52(text))
          ui.toast.show({ variant: "warning", message: "Copy not supported by this terminal" })
        else ui.toast.show({ variant: "success", message: "Summary copied" })
      }

      context.keymap.layer(() => ({
        mode: "modal",
        commands: [
          { bind: "g", title: "Generate summary", group: "Dialog", run: () => void run() },
          { bind: "c", title: "Copy summary", group: "Dialog", run: copy },
        ],
      }))

      useKeyboard((event) => {
        if (!scroll) return
        if (event.name === "up" || event.name === "k") return scroll.scrollBy(-1)
        if (event.name === "down" || event.name === "j") return scroll.scrollBy(1)
        if (event.name === "pageup") return scroll.scrollBy(-maxHeight())
        if (event.name === "pagedown") return scroll.scrollBy(maxHeight())
        if (event.name === "home") return scroll.scrollTo(0)
        if (event.name === "end") return scroll.scrollTo(scroll.scrollHeight)
      })

      return (
        <box paddingLeft={INSET} paddingRight={INSET} paddingBottom={1} gap={1}>
          <box flexDirection="row" justifyContent="space-between">
            <text attributes={TextAttributes.BOLD} fg={theme().text.base}>/summary</text>
            <text fg={theme().text.muted}>esc</text>
          </box>
          <text fg={theme().text.muted}>
            {busy() ? "Generating…" : record() ? lib.generatedLine(record()!, Date.now()) : "No summary yet - press g to generate"}
          </text>
          <Show when={record()}>
            {(current) => (
              <scrollbox
                ref={(element: ScrollBoxRenderable) => (scroll = element)}
                maxHeight={maxHeight()}
                scrollbarOptions={{ visible: false }}
              >
                <markdown content={current().text} syntaxStyle={syntax} conceal fg={theme().markdown.text} />
              </scrollbox>
            )}
          </Show>
          <Hints items={[["generate", "g"], ["copy", "c"], ["scroll", "j/k ↑/↓"]]} />
        </box>
      )
    }

    function openModal(sessionID: string) {
      ui.dialog.show(() => <SummaryDialog sessionID={sessionID} />)
      ui.dialog.set({ size: "large", centered: true })
    }

    ui.slot({
      append: "app",
      render() {
        context.keymap.layer(() => ({
          mode: "global",
          commands: [
            {
              id: "summary.open",
              title: "Session summary",
              description: "View or generate a summary of this session",
              group: "Session",
              palette: true,
              slash: { name: "summary" },
              run() {
                const route = ui.router.current()
                if (route.type !== "session") {
                  ui.toast.show({ variant: "warning", message: "Open a session first" })
                  return
                }
                openModal(route.sessionID)
              },
            },
          ],
        }))
        return null
      },
    })

    return () => void context.renderer.idle().then(() => syntax.destroy())
  },
})
```

- [x] 1.5 Plugin README

**File**: `src/opencode-plugins/opencode-summary/README.md` (new)
**Changes**: purpose, install, usage, files, manual checklist (Phase 1 items; later phases append).

````markdown
# opencode-summary

TUI plugin for opencode V2. `/summary` opens a modal that generates and shows a summary of the current session using
`session.generate` (session's current model; history is not changed). The summary is stored in session metadata
(`metadata["opencode-summary"]`).

## Install

1. Copy the `opencode-plugins` group from `links.example.json` into `links.json`.
2. `python tools/syncLinks/sync.py` then `python tools/syncLinks/sync.py --check`.
3. Restart opencode. The TUI discovers `~/.config/opencode/plugins/opencode-summary`.

## Use

`/summary` (or the palette, "Session summary") in a session. Keys: `g` generate, `c` copy, `j/k ↑/↓` scroll, `esc` close.
Bind a global key with `cli.json` `keybinds`: `{"summary.open": "<key>"}`.

## Develop

`bun test` in this directory. `lib.ts` must not import opencode packages. Edits hot-reload in a running TUI through the
link.

## Manual checklist

- [ ] `/summary` in slash completion and palette; on home shows "Open a session first"
- [ ] Empty state, then `g` shows summary + "Generated …"; persists after TUI restart
- [ ] `c` copies the markdown
````

- [x] 1.6 Link entry

**File**: `links.example.json`
**Changes**: add group `opencode-plugins` after `example`.

```diff
     "example": {
       "links": [
         {
           "link": "${home}/.config/some-tool/skills",
           "target": "${src}/skills",
           "type": "symlink"
         }
       ]
-    }
+    },
+    "opencode-plugins": {
+      "links": [
+        {
+          "link": "${home}/.config/opencode/plugins/opencode-summary",
+          "target": "${src}/opencode-plugins/opencode-summary",
+          "type": "symlink"
+        }
+      ]
+    }
   }
```

- [x] 1.7 Repo README layout

**File**: `README.md`
**Changes**: add a line to the directory tree after `├── .opencode/`.

```diff
 │   ├── .opencode/         # opencode config: opencode.jsonc + agents/
+│   ├── opencode-plugins/  # local opencode plugins (linked via links.json), e.g. opencode-summary
 │   ├── openspec/          # OpenSpec workspace (config.yaml, schemas/)
```

### Success Criteria:

#### Automated Verification:
- [x] Tests pass: `cd src/opencode-plugins/opencode-summary && bun test`
- [x] Syntax: `cd src/opencode-plugins/opencode-summary && for f in tui.tsx lib.ts prompt.ts; do bun build --no-bundle "$f" > /dev/null || exit 1; done`
- [x] Link entry parses: `python3 tools/syncLinks/sync.py --config links.example.json --group opencode-plugins --dry-run` lists `~/.config/opencode/plugins/opencode-summary` as missing

#### Manual Verification:
- [x] User adds the group to `links.json` and runs `python3 tools/syncLinks/sync.py`, then `--check` (writes to `~`; user runs or approves)
- [ ] Restart opencode: `/summary` is in slash completion and the palette; the TUI log shows no plugin load error
- [ ] On the home screen, `/summary` shows the toast "Open a session first"
- [ ] In a session with messages, the empty state shows; `g` shows "Generating…", then the summary with the TL;DR section and `Generated just now · …`
- [ ] Restart the TUI: the summary is still shown
- [ ] `c` copies; paste confirms the markdown
- [ ] Edit a hint string in the repo's `tui.tsx`: the open TUI reloads the plugin without a restart (expected from `watch.ts:82-91`)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Footer indicator in turns, background generation

### Overview
Turn counting and wording, footer slot with a spinner, a debounced refresh on events, the in-flight set in `storage.memory`, "Already generating", and "Summary ready" when the modal is closed. The modal's generated line gains turns.

### Changes Required:

- [ ] 2.1 Turn helpers

**File**: `lib.ts`
**Changes**: add turn counting and wording; extend `generatedLine`.

```ts
export const TURN_LIMIT = 200
export type Turns = { count: number; capped: boolean }

/** `userMessageIDs` = one page of user messages (newest first, at most `limit`). IDs sort as strings. */
export function turnsSince(userMessageIDs: readonly string[], lastMessageID: string, limit = TURN_LIMIT): Turns {
  const count = userMessageIDs.filter((id) => id > lastMessageID).length
  return { count, capped: userMessageIDs.length >= limit && count >= limit }
}

export function turnsText({ count, capped }: Turns): string {
  if (capped) return `${TURN_LIMIT}+ turns ago`
  if (count === 0) return "up to date"
  return count === 1 ? "1 turn ago" : `${count} turns ago`
}

export const turnLabel = (turns: Turns) => `summary ${turnsText(turns)}`
```

```diff
-export function generatedLine(record: SummaryRecord, now: number): string {
+export function generatedLine(record: SummaryRecord, now: number, turns?: Turns): string {
   const relative = relativeTime(record.generatedAt, now)
-  return ["Generated", ...(relative ? [`${relative} ·`] : []), datetime(record.generatedAt)].join(" ")
+  const parts = ["Generated", ...(relative ? [`${relative} ·`] : []), datetime(record.generatedAt)]
+  return turns ? `${parts.join(" ")} · ${turnsText(turns)}` : parts.join(" ")
 }
```

- [ ] 2.2 Tests

**File**: `lib.test.ts`
**Changes**: add cases.

```ts
describe("turns", () => {
  const ids = ["msg_03", "msg_02", "msg_01"]
  test("turnsSince counts strictly newer ids", () => {
    expect(lib.turnsSince(ids, "msg_03")).toEqual({ count: 0, capped: false })
    expect(lib.turnsSince(ids, "msg_02")).toEqual({ count: 1, capped: false })
    expect(lib.turnsSince(ids, "msg_00")).toEqual({ count: 3, capped: false })
  })
  test("cap at limit", () => {
    expect(lib.turnsSince(["c", "b"], "a", 2)).toEqual({ count: 2, capped: true })
  })
  test("wording", () => {
    expect(lib.turnLabel({ count: 0, capped: false })).toBe("summary up to date")
    expect(lib.turnLabel({ count: 1, capped: false })).toBe("summary 1 turn ago")
    expect(lib.turnLabel({ count: 7, capped: false })).toBe("summary 7 turns ago")
    expect(lib.turnLabel({ count: 200, capped: true })).toBe("summary 200+ turns ago")
  })
  test("generatedLine appends turns", () => {
    expect(lib.generatedLine(record, record.generatedAt, { count: 3, capped: false })).toMatch(/ · 3 turns ago$/)
  })
})
```

- [ ] 2.3 Refresh, in-flight, footer slot

**File**: `tui.tsx`
**Changes**:
- Add a global `tick` signal, bumped (debounced 150 ms) by session events.
- Add the in-flight set in `storage.memory` and a `modalFor` signal.
- `startGenerate` wraps `generate` for both the modal and background completion.
- Add the footer slot with a small local spinner (the TUI `Spinner` is internal).
- The modal reloads on `tick` and shows turns.

```tsx
import { createResource, createSignal, onCleanup } from "solid-js"

// inside setup:
const [tick, setTick] = createSignal(0)
let pending: ReturnType<typeof setTimeout> | undefined
const bump = () => {
  clearTimeout(pending)
  pending = setTimeout(() => setTick((n) => n + 1), 150)
}
const stops = (
  ["session.inbox.delivered", "session.metadata.updated", "session.revert.committed",
   "session.revert.staged", "session.revert.cleared", "session.execution.started", "session.execution.succeeded",
   "session.execution.failed", "session.execution.interrupted"] as const
).map((type) => context.data.on(type, bump))

const [flight, setFlight] = context.storage.memory("inflight", { initial: { sessions: [] as string[] } })
const inFlight = (sessionID: string) => flight.sessions.includes(sessionID)
const [modalFor, setModalFor] = createSignal<string>()

async function countTurns(sessionID: string, lastMessageID: string): Promise<lib.Turns> {
  const page = await client.message.list({ sessionID, type: "user", order: "desc", limit: lib.TURN_LIMIT })
  return lib.turnsSince(page.data.map((message) => message.id), lastMessageID)
}

async function loadView(sessionID: string) {
  const record = await loadSummary(sessionID)
  return record ? { record, turns: await countTurns(sessionID, record.lastMessageID) } : undefined
}

async function startGenerate(sessionID: string): Promise<void> {
  if (inFlight(sessionID)) return void ui.toast.show({ variant: "warning", message: "Already generating" })
  setFlight((draft) => void draft.sessions.push(sessionID))
  try {
    const written = await generate(sessionID)
    if (written && modalFor() !== sessionID) ui.toast.show({ variant: "success", message: "Summary ready", sessionID })
  } catch (cause) {
    toastError(cause)
  } finally {
    setFlight((draft) => void (draft.sessions = draft.sessions.filter((id) => id !== sessionID)))
    bump()
  }
}

function Spinner(props: { label: string }) {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
  const [i, setI] = createSignal(0)
  const timer = setInterval(() => setI((n) => (n + 1) % frames.length), 80)
  onCleanup(() => clearInterval(timer))
  return <text fg={context.theme.hue.interactive[200]}>{`${frames[i()]} ${props.label}`}</text>
}

function FooterStatus(props: { sessionID?: string }) {
  const [view] = createResource(
    () => (props.sessionID ? ([props.sessionID, tick()] as const) : undefined),
    ([sessionID]) => loadView(sessionID).catch(() => undefined),
  )
  return (
    <Show when={props.sessionID}>
      {(sessionID) => (
        <Show when={!inFlight(sessionID())} fallback={<Spinner label="/summary" />}>
          <Show when={view()}>
            {(current) => <text fg={context.theme.text.muted}>{lib.turnLabel(current().turns)}</text>}
          </Show>
        </Show>
      )}
    </Show>
  )
}

ui.slot({ append: "prompt.footer.status", render: (props) => <FooterStatus sessionID={props.sessionID} /> })
```

```diff
 function SummaryDialog(props: { sessionID: string }) {
-  const [record, setRecord] = createSignal<lib.SummaryRecord>()
-  const [busy, setBusy] = createSignal(false)
-  const reload = () => loadSummary(props.sessionID).then(setRecord, toastError)
-  void reload()
-  const run = async () => { ... }
+  const [view] = createResource(() => [props.sessionID, tick()] as const, ([id]) => loadView(id).catch(toastError))
+  const record = () => view()?.record
+  const busy = () => inFlight(props.sessionID)
+  const run = () => void startGenerate(props.sessionID)
   ...
-    {busy() ? "Generating…" : record() ? lib.generatedLine(record()!, Date.now()) : "No summary yet - press g to generate"}
+    {busy() ? "Generating…" : view() ? lib.generatedLine(view()!.record, Date.now(), view()!.turns) : "No summary yet - press g to generate"}
```

```diff
 function openModal(sessionID: string) {
-  ui.dialog.show(() => <SummaryDialog sessionID={sessionID} />)
+  setModalFor(sessionID)
+  ui.dialog.show(() => <SummaryDialog sessionID={sessionID} />, () => setModalFor(undefined))
   ui.dialog.set({ size: "large", centered: true })
 }
```

```diff
-return () => void context.renderer.idle().then(() => syntax.destroy())
+return () => {
+  clearTimeout(pending)
+  stops.forEach((stop) => stop())
+  void context.renderer.idle().then(() => syntax.destroy())
+}
```

- [ ] 2.4 README checklist

**File**: `README.md` (plugin)
**Changes**: append to "Manual checklist".

```markdown
- [ ] Footer: `summary up to date` after `g`; `summary 1 turn ago`, then `summary 2 turns ago` after messages
- [ ] `!cmd` shell runs and assistant replies do not change the count
- [ ] `g` then `esc`: footer spinner, then toast "Summary ready"; `g` mid-run shows "Already generating"
- [ ] Switching sessions shows each session's own footer
```

### Success Criteria:

#### Automated Verification:
- [ ] Tests pass: `cd src/opencode-plugins/opencode-summary && bun test`
- [ ] Syntax: `cd src/opencode-plugins/opencode-summary && for f in tui.tsx lib.ts; do bun build --no-bundle "$f" > /dev/null || exit 1; done`

#### Manual Verification:
- [ ] The README checklist items added in 2.4
- [ ] The modal line reads `Generated … · N turns ago` and updates while open when a message is sent

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Validity check and generate guards

### Overview
Read-time deletion when `lastMessageID` is gone (committed revert, fork, child). Generate is blocked while the agent is running or a revert is staged, with the footer hint reflecting it. A staged revert keeps the summary.

### Changes Required:

- [ ] 3.1 Decision helpers

**File**: `lib.ts`

```ts
export type BlockReason = "running" | "revert-pending" | "in-flight"

export function blockReason(input: { status: "idle" | "running"; revertStaged: boolean; inFlight: boolean }): BlockReason | undefined {
  if (input.inFlight) return "in-flight"
  if (input.status === "running") return "running"
  if (input.revertStaged) return "revert-pending"
  return undefined
}

export function blockMessage(reason: BlockReason): string {
  switch (reason) {
    case "in-flight": return "Already generating"
    case "running": return "Agent is running - wait for it to finish"
    case "revert-pending": return "Revert pending - send a message or undo first"
  }
}

export function isMessageNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const { _tag, name } = error as { _tag?: unknown; name?: unknown }
  return _tag === "MessageNotFoundError" || name === "MessageNotFoundError"
}

export type ValidityCheck = { found: true } | { found: false; notFound: boolean }
export const validityAction = (check: ValidityCheck): "keep" | "delete" => (!check.found && check.notFound ? "delete" : "keep")
```

- [ ] 3.2 Tests

**File**: `lib.test.ts`

```ts
describe("guards", () => {
  test("blockReason precedence", () => {
    expect(lib.blockReason({ status: "idle", revertStaged: false, inFlight: false })).toBeUndefined()
    expect(lib.blockReason({ status: "running", revertStaged: true, inFlight: false })).toBe("running")
    expect(lib.blockReason({ status: "idle", revertStaged: true, inFlight: false })).toBe("revert-pending")
    expect(lib.blockReason({ status: "running", revertStaged: true, inFlight: true })).toBe("in-flight")
  })
  test("blockMessage", () => {
    expect(lib.blockMessage("revert-pending")).toBe("Revert pending - send a message or undo first")
  })
})

describe("validity", () => {
  test("isMessageNotFound matches client-declared errors", () => {
    const declared = Object.assign(new Error("gone"), { _tag: "MessageNotFoundError" })
    declared.name = "MessageNotFoundError"
    expect(lib.isMessageNotFound(declared)).toBe(true)
    expect(lib.isMessageNotFound(new Error("Transport"))).toBe(false)
    expect(lib.isMessageNotFound(undefined)).toBe(false)
  })
  test("validityAction", () => {
    expect(lib.validityAction({ found: true })).toBe("keep")
    expect(lib.validityAction({ found: false, notFound: true })).toBe("delete")
    expect(lib.validityAction({ found: false, notFound: false })).toBe("keep")
  })
})
```

- [ ] 3.3 Validity in load, guards in generate

**File**: `tui.tsx`
**Changes**:
- `loadSummary` checks `lastMessageID` and deletes the record on not-found.
- `startGenerate` checks `blockReason` using `data.session.status` plus a fresh `session.get().revert`.
- The modal hint marks `g` unavailable.

```diff
 async function loadSummary(sessionID: string): Promise<lib.SummaryRecord | undefined> {
-  return lib.readSummary(await readMetadata(sessionID))
+  const record = lib.readSummary(await readMetadata(sessionID))
+  if (!record) return undefined
+  const check: lib.ValidityCheck = await client.session.message
+    .get({ sessionID, messageID: record.lastMessageID })
+    .then(
+      () => ({ found: true }) as const,
+      (error: unknown) => ({ found: false, notFound: lib.isMessageNotFound(error) }) as const,
+    )
+  if (lib.validityAction(check) === "keep") return record
+  await writeSummary(sessionID, undefined)
+  return undefined
 }
```

```ts
async function blocked(sessionID: string): Promise<lib.BlockReason | undefined> {
  const info = await client.session.get({ sessionID })
  return lib.blockReason({
    status: context.data.session.status(sessionID),
    revertStaged: Boolean(info.revert),
    inFlight: inFlight(sessionID),
  })
}
```

```diff
 async function startGenerate(sessionID: string): Promise<void> {
-  if (inFlight(sessionID)) return void ui.toast.show({ variant: "warning", message: "Already generating" })
+  const reason = await blocked(sessionID)
+  if (reason) return void ui.toast.show({ variant: "warning", message: lib.blockMessage(reason) })
   setFlight((draft) => void draft.sessions.push(sessionID))
```

```diff
 function SummaryDialog(props: { sessionID: string }) {
+  const [reason] = createResource(() => [props.sessionID, tick()] as const, ([id]) => blocked(id).catch(() => undefined))
   ...
-  <Hints items={[["generate", "g"], ["copy", "c"], ["scroll", "j/k ↑/↓"]]} />
+  <Hints items={[[reason() ? `generate (${reason()})` : "generate", "g"], ["copy", "c"], ["scroll", "j/k ↑/↓"]]} />
```

`loadView` already calls `loadSummary`, so the footer and the modal both apply the rule. The deletion write emits `session.metadata.updated`, then a refresh, which finds no record and stops there (no loop).

- [ ] 3.4 README checklist

**File**: `README.md` (plugin)

```markdown
- [ ] Staged revert before the summary: summary stays; `g` -> "Revert pending - send a message or undo first"
- [ ] Undo the revert: summary stays; `g` works
- [ ] Commit the revert (send a message): summary deleted, footer hidden
- [ ] Revert removing only messages after the summary keeps it
- [ ] Agent running: `g` -> "Agent is running - wait for it to finish"
- [ ] Fork a summarized session: fork shows no summary; parent keeps its own
```

### Success Criteria:

#### Automated Verification:
- [ ] Tests pass: `cd src/opencode-plugins/opencode-summary && bun test`
- [ ] Syntax: `cd src/opencode-plugins/opencode-summary && for f in tui.tsx lib.ts; do bun build --no-bundle "$f" > /dev/null || exit 1; done`

#### Manual Verification:
- [ ] The README checklist items added in 3.4

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: View, edit and reset the prompt

### Overview
`prompts/summary.md` overrides `DEFAULT_PROMPT` and is read at generate time.
- `v` toggles the prompt view: guard line, effective prompt, source and path.
- `e` edits the prompt: `$VISUAL`/`$EDITOR` on the real file (renderer suspended), else a multi-line `<textarea>` edit view inside the modal (`ctrl+s` save, `esc` cancel).
- `r` resets after `ui.dialog.confirm`.
- The modal notes "generated with a different prompt" when `promptId` differs from the current prompt.

### Changes Required:

- [ ] 4.1 Prompt helpers

**File**: `lib.ts`

```ts
import { DEFAULT_PROMPT } from "./prompt"
import path from "node:path"
import { fileURLToPath } from "node:url"

export type PromptSource = "default" | "override"
export type ResolvedPrompt = { text: string; source: PromptSource }

export const resolvePrompt = (override: string | undefined): ResolvedPrompt =>
  isBlank(override) ? { text: DEFAULT_PROMPT, source: "default" } : { text: override!.trim(), source: "override" }

/** What to do with edited prompt text. */
export function saveAction(edited: string): "noop" | "delete" | "write" {
  if (isBlank(edited)) return "noop"
  return edited.trim() === DEFAULT_PROMPT.trim() ? "delete" : "write"
}

export function promptPaths(metaUrl: string): { dir: string; override: string } {
  const dir = path.dirname(fileURLToPath(metaUrl))
  return { dir, override: path.join(dir, "prompts", "summary.md") }
}
```

- [ ] 4.2 Tests

**File**: `lib.test.ts`

```ts
import { DEFAULT_PROMPT } from "./prompt"

describe("prompt", () => {
  test("resolvePrompt", () => {
    expect(lib.resolvePrompt(undefined)).toEqual({ text: DEFAULT_PROMPT, source: "default" })
    expect(lib.resolvePrompt("  \n")).toEqual({ text: DEFAULT_PROMPT, source: "default" })
    expect(lib.resolvePrompt(" Mine \n")).toEqual({ text: "Mine", source: "override" })
  })
  test("saveAction", () => {
    expect(lib.saveAction("")).toBe("noop")
    expect(lib.saveAction(`${DEFAULT_PROMPT}\n`)).toBe("delete")
    expect(lib.saveAction("Mine")).toBe("write")
  })
  test("promptPaths", () => {
    expect(lib.promptPaths("file:///x/opencode-summary/tui.tsx")).toEqual({
      dir: "/x/opencode-summary",
      override: "/x/opencode-summary/prompts/summary.md",
    })
  })
})
```

- [ ] 4.3 File-backed prompt, view toggle, edit, reset

**File**: `tui.tsx`
**Changes**:
- `loadPrompt` replaces `DEFAULT_PROMPT` in `generate`.
- Add `editWithEditor`, `resetPrompt` and `applyEdited`.
- The modal gets a `mode` signal (`summary | prompt | edit`), the `v`/`e`/`r` commands, an edit view and a "different prompt" note.
- `openModal` accepts an initial mode so it can reopen after the confirm dialog and the external editor.

```tsx
import { TextareaRenderable } from "@opentui/core"
import { onMount } from "solid-js"
import { spawn } from "node:child_process"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { GUARD } from "./prompt"

const paths = lib.promptPaths(import.meta.url)

async function readOverride(): Promise<string | undefined> {
  return readFile(paths.override, "utf8").catch((error: NodeJS.ErrnoException) =>
    error.code === "ENOENT" ? undefined : Promise.reject(error),
  )
}
const loadPrompt = async () => lib.resolvePrompt(await readOverride())

async function applyEdited(edited: string, previous: string | undefined): Promise<void> {
  switch (lib.saveAction(edited)) {
    case "noop":
      // restore what was there before (the editor may have emptied the real file)
      if (previous === undefined) await rm(paths.override, { force: true })
      else await writeFile(paths.override, previous)
      return void ui.toast.show({ variant: "warning", message: "Empty prompt - not saved" })
    case "delete":
      await rm(paths.override, { force: true })
      return void ui.toast.show({ message: "Prompt matches default - override removed" })
    case "write":
      await mkdir(path.dirname(paths.override), { recursive: true })
      await writeFile(paths.override, edited.trim() + "\n")
      return void ui.toast.show({ variant: "success", message: "Prompt saved" })
  }
}

function spawnEditor(command: string, file: string): Promise<void> {
  const [bin, ...args] = command.split(" ")
  return new Promise((resolve, reject) => {
    const child = spawn(bin!, [...args, file], { stdio: "inherit" })
    child.on("error", reject)
    child.on("exit", (code, signal) =>
      code === 0 ? resolve() : reject(new Error(`Editor exited with ${signal ? `signal ${signal}` : `code ${code}`}`)),
    )
  })
}

const externalEditor = () => process.env.VISUAL || process.env.EDITOR

/** `$VISUAL`/`$EDITOR` on the real override file. Caller checks `externalEditor()` first. */
async function editWithEditor(sessionID: string, editor: string): Promise<void> {
  const previous = await readOverride()
  await mkdir(path.dirname(paths.override), { recursive: true })
  if (previous === undefined) await writeFile(paths.override, (await loadPrompt()).text + "\n") // seed
  await context.renderer.suspend()
  try {
    await spawnEditor(editor, paths.override)
  } catch (cause) {
    toastError(cause) // file left as the editor left it
    return
  } finally {
    await context.renderer.resume()
  }
  await applyEdited((await readOverride()) ?? "", previous)
  openModal(sessionID, "prompt")
}

async function resetPrompt(sessionID: string): Promise<void> {
  const confirmed = await ui.dialog.confirm({
    title: "Reset summary prompt?",
    message: `Delete ${ui.format.path(paths.override)} and use the default prompt.`,
    label: { confirm: "Reset", cancel: "Cancel" },
  })
  if (confirmed) {
    await rm(paths.override, { force: true })
    ui.toast.show({ message: "Prompt reset to default" })
  }
  openModal(sessionID, "prompt")
}
```

```diff
 async function generate(sessionID: string): Promise<boolean> {
-  const prompt = DEFAULT_PROMPT
+  const prompt = (await loadPrompt()).text
```

```diff
-function SummaryDialog(props: { sessionID: string }) {
+type Mode = "summary" | "prompt" | "edit"
+function SummaryDialog(props: { sessionID: string; mode: Mode }) {
+  const [mode, setMode] = createSignal<Mode>(props.mode)
+  const [prompt, { refetch: refetchPrompt }] = createResource(() => [mode(), tick()] as const, () => loadPrompt())
+  const stale = () => view() && prompt() && view()!.record.promptId !== lib.promptId(prompt()!.text)
+  const edit = () => {
+    const editor = externalEditor()
+    if (editor) void editWithEditor(props.sessionID, editor).catch(toastError)
+    else setMode("edit")
+  }
   context.keymap.layer(() => ({
     mode: "modal",
+    enabled: mode() !== "edit", // letters go to the textarea while editing
     commands: [
       { bind: "g", title: "Generate summary", group: "Dialog", run },
       { bind: "c", title: "Copy summary", group: "Dialog", run: copy },
+      { bind: "v", title: "Toggle prompt view", group: "Dialog", run: () => setMode((m) => (m === "summary" ? "prompt" : "summary")) },
+      { bind: "e", title: "Edit prompt", group: "Dialog", run: edit },
+      { bind: "r", title: "Reset prompt", group: "Dialog", run: () => void resetPrompt(props.sessionID).catch(toastError) },
     ],
   }))
```

`useKeyboard` scrolling returns early while `mode() === "edit"`, so `j/k` and arrows move the textarea cursor.

Edit view: a component rendered only in edit mode. Its keymap layer follows `DialogPrompt` (`dialog-prompt.tsx:62-102`): `mode: "modal"`, `priority: 1`, scoped to the textarea, so `ctrl+s` and `escape` win over the dialog's own `escape` (which would close it). `return` is not bound, so Enter inserts a newline.

```tsx
function PromptEditor(props: { initial: string; onDone: (saved: boolean) => void }) {
  const [target, setTarget] = createSignal<TextareaRenderable>()
  let textarea: TextareaRenderable | undefined
  const save = async () => {
    const previous = await readOverride()
    await applyEdited(textarea?.plainText ?? "", previous).then(() => props.onDone(true), toastError)
  }
  context.keymap.layer(() => ({
    mode: "modal",
    priority: 1,
    target,
    enabled: target() !== undefined,
    commands: [
      { bind: "ctrl+s", title: "Save prompt", group: "Dialog", run: () => void save() },
      { bind: "escape", title: "Cancel edit", group: "Dialog", run: () => props.onDone(false) },
    ],
  }))
  onMount(() => setTimeout(() => textarea && !textarea.isDestroyed && textarea.focus(), 1)) // as DialogPrompt
  return (
    <box gap={1}>
      <text fg={theme().text.muted}>{`fixed: ${GUARD}`}</text>
      <textarea
        ref={(element: TextareaRenderable) => ((textarea = element), setTarget(element))}
        initialValue={props.initial}
        height={Math.max(6, maxHeight() - 4)}
        wrapMode="word"
        textColor={theme().text.formfield.base}
        focusedTextColor={theme().text.formfield.base}
        cursorColor={theme().text.base}
      />
      <Hints items={[["save", "ctrl+s"], ["cancel", "esc"]]} />
    </box>
  )
}
```

`maxHeight` is hoisted to the dialog-level scope (or passed as a prop) so both components can use it.

In `SummaryDialog`:

```tsx
<Show when={mode() === "edit"}>
  <PromptEditor
    initial={prompt()?.text ?? DEFAULT_PROMPT}
    onDone={(saved) => {
      setMode("prompt")
      if (saved) void refetchPrompt()
    }}
  />
</Show>
```

The prompt view replaces the summary body when `mode() === "prompt"`:

```tsx
<Show when={mode() === "prompt"} fallback={/* summary body from Phases 1-3, plus stale note */ summaryBody()}>
  <scrollbox ref={(element: ScrollBoxRenderable) => (scroll = element)} maxHeight={maxHeight()} scrollbarOptions={{ visible: false }}>
    <box gap={1}>
      <text fg={theme().text.muted}>{`fixed: ${GUARD}`}</text>
      <text fg={theme().text.base}>{prompt()?.text ?? ""}</text>
      <text fg={theme().text.muted}>
        {prompt()?.source === "override" ? `source: override (${ui.format.path(paths.override)})` : "source: default (prompt.ts)"}
      </text>
    </box>
  </scrollbox>
</Show>
<Show when={mode() === "summary" && stale()}>
  <text fg={theme().text.muted}>Generated with a different prompt</text>
</Show>
<Hints items={[[reason() ? `generate (${reason()})` : "generate", "g"], [mode() === "summary" ? "prompt" : "summary", "v"],
  ["edit", "e"], ["reset", "r"], ["copy", "c"], ["scroll", "j/k"]]} />
```

```diff
-function openModal(sessionID: string) {
+function openModal(sessionID: string, mode: Mode = "summary") {
   setModalFor(sessionID)
-  ui.dialog.show(() => <SummaryDialog sessionID={sessionID} />, () => setModalFor(undefined))
+  ui.dialog.show(() => <SummaryDialog sessionID={sessionID} mode={mode} />, () => setModalFor(undefined))
   ui.dialog.set({ size: "large", centered: true })
 }
```

- [ ] 4.4 README prompt section and checklist

**File**: `README.md` (plugin)
**Changes**: add a "Prompt" section and checklist items. Update "Use" keys to `g v e r c`.

````markdown
## Prompt

The default prompt is in `prompt.ts`. Your prompt lives in `prompts/summary.md` next to `tui.tsx`. Through the link this
is the repo copy, so edits show up in `git status`. A fixed line forbidding tool calls is always prepended and is not
editable. `e` opens `$VISUAL`/`$EDITOR` on the file; if neither is set it opens a multi-line editor in the modal
(`ctrl+s` save, `esc` cancel). `r` deletes the override.
````

```markdown
- [ ] `v` shows the fixed guard line, the default prompt, "source: default (prompt.ts)"
- [ ] `$EDITOR` set: `e` opens the editor; saving creates `prompts/summary.md` (in `git status`); `v` shows "source: override"
- [ ] `$EDITOR` unset: `e` shows the in-modal editor; Enter adds a newline; `g`/`v`/`c` type letters; `ctrl+s` saves; `esc` cancels without closing the modal
- [ ] `g` uses the edited prompt; older summary shows "Generated with a different prompt"
- [ ] Empty save: warning, previous prompt kept. Text equal to default: override file removed
- [ ] `r` + confirm removes the override; source back to default
```

### Success Criteria:

#### Automated Verification:
- [ ] Tests pass: `cd src/opencode-plugins/opencode-summary && bun test`
- [ ] Syntax: `cd src/opencode-plugins/opencode-summary && for f in tui.tsx lib.ts prompt.ts; do bun build --no-bundle "$f" > /dev/null || exit 1; done`
- [ ] Link audit: `python3 tools/syncLinks/sync.py --check` exits 0 (with the user's `links.json`)

#### Manual Verification:
- [ ] The README checklist items added in 4.4
- [ ] Run with `VISUAL= EDITOR= opencode` to exercise the in-modal editor on a multi-line prompt

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Unresolved Questions

- Does the TUI's global managed-textarea input layer bind `ctrl+s` or `return` in a way that beats a `priority: 1` plugin layer targeted at the textarea? `DialogPrompt` uses the same setup, so expected no; checked manually in Phase 4.
