---
date: 2026-11-05T00:42:19+08:00
git_commit: dfea13e9f22e90ad784bfdbcafc445eb317bda8e
branch: main
repository: ai-tools
---

## Research Question

Source: `openspec/changes/create-opencode-summary-plugin/questions.md`.

1. How does opencode load plugins (locations, file format, export shape, load order)?
2. What does the plugin context expose, and which hooks and events exist?
3. How do plugins register slash commands, custom tools and TUI commands?
4. Server plugins vs TUI plugins: which can render UI?
5. How are the existing local plugins structured?
6. How do plugins declare and install dependencies?
7. How is `/btw` implemented, and what triggers its modal?
8. What dialog primitives does the TUI provide?
9. How does the `/btw` modal handle keybindings and hotkey hints?
10. Can a plugin open TUI dialogs?
11. How are a session's messages and parts exposed?
12. What does built-in summarize/compaction do?
13. How can a plugin make an LLM call outside the active conversation?
14. How do hooks expose the session's current model?
15. How are providers/models listed, checked and parsed?
16. How is a session's "current model" resolved?
17. How do plugins read user options?
18. Where are prompts customized, and how do `{file:}`/`{env:}` resolve?
19. Where is session data stored?
20. Can metadata or parts be attached to a session?
21. Which session lifecycle events exist, and what happens on delete and fork?
22. Which UI surfaces can a plugin affect?
23. How does the TUI format relative timestamps?
24. What theming system does the TUI use, and what are the default values?
25. What layout and spacing conventions do dialogs follow?
29. How does `opencode-handoff` work?
30. How does `opencode-smart-title` work?
31. How does `bro` work?
32. How do `opencode-quota` and the Goal plugin work?
33. How do `opencode-dir-tree-tui` and `opencode-skills-tui` work?
34. How do memory/context plugins in `awesome-opencode` store per-session data?
35. What do issue #21760 and `entireio/cli` describe?
36. How do Claude Code's `/compact` and "Summarize from here / up to here" work?
37. How do Kiro's `/compact` and auto-compaction work?
38. How do Kiro Crew's memory, lessons and Apps store summaries?
39. How do `kiro-team` and Kiro subagents return results to a parent?
40. What common patterns exist across these tools?
41. How is `src/` config linked to consumers?
42. What do the tool READMEs say about new artifact kinds?
43. What testing, typing and build conventions exist?

(Questions 26-28 do not exist in `questions.md`.)

## Research Methodology (verbatim)

This document will remain objective and factual. It does not contain any recommendations or implementation suggestions.
Open questions will not ask Why things haven't been built or what should be built in the future.

There is no "implementation" section - that is intentional.

## Summary

The installed opencode is **V2** (`opencode v2.2.5`), but `~/.config/opencode` mixes V1 and V2 artifacts. `opencode.jsonc` and `cli.json` use V2 keys (`plugins`), while `tui.json(c)` and `package.json` (`@opencode-ai/plugin@1.18.34`) are V1. The public docs at `opencode.ai/docs` describe V1; `opencode.ai/v2/docs` and the `anomalyco/opencode` `dev` branch describe V2. V1 hooks (`chat.message`, `chat.params`, `event`, `experimental.session.compacting`) are replaced in V2 by `ctx.session.hook(...)` and `ctx.event.subscribe(...)`.

A V2 plugin is a package or directory with up to four entry points (`server`, `tui`, `rpc`, `gui-experimental`) built with `Plugin.define({ id, setup(ctx) })`. The server side exposes sessions, commands, tools, storage and one-shot generation. The TUI side exposes a keymap layer (commands, slash names, palette entries, keybinds), dialogs, toasts, slots, routes and plugin storage. `/btw` is a built-in TUI plugin that calls `session.generate` and shows the answer in a `large` centered dialog with a `c` copy hotkey; its pieces are the same primitives public plugins use, except the dialog layout components, which are internal.

For work outside the active conversation, V2 offers three mechanisms with different side effects: `ctx.experimental.generate.text` (no session), `ctx.session.generate` (session context, history unchanged) and child sessions (separate history, separate cost). Plugin options arrive as `ctx.options`; unknown top-level config keys are dropped. Plugin persistence is `ctx.storage` (global key-value, not per-session) and session `metadata` (free-form JSON on the session row). Prior-art plugins (handoff, smart-title, quota, goal, memory plugins) show each of these mechanisms in use. Other harnesses (Claude Code, Kiro, Kiro Crew) differ on where the summary lives, whether originals remain and whether prompt or model is configurable.

In this repo, nothing links `src/` content into `~/.config/opencode/plugins`; `links.json` is gitignored and absent. There is no TypeScript, `tsconfig`, test runner or build step in the repo or in `~/.config/opencode`; existing opencode plugins there are plain ESM JavaScript.

## Detailed Findings

### 1. Two plugin API generations coexist on this machine

opencode's `dev` branch is V2; `packages/opencode` no longer exists and code lives in `packages/{core,schema,protocol,plugin,client,sdk,server,tui,theme}`. The V1 docs (`opencode.ai/docs/plugins/`) and the V2 docs (`opencode.ai/v2/docs/plugins/`) differ:

| | V1 | V2 |
|---|---|---|
| Config key | `plugin` | `plugins` |
| TUI plugin config | `tui.json(c)` `plugin` | `cli.json` `plugins`, or the `./tui` part of a package |
| SDK package | `@opencode-ai/plugin` | `@opencode/plugin` |
| Export shape | named `async (ctx) => Hooks` | `Plugin.define({id, setup(ctx)})` default export |
| Context | `{client, project, directory, worktree, serverUrl, $}` | `ctx` with `location`, `options`, `storage`, `session`, `command`, `tool`, ... (no `$`, no `client`) |

Local files in `~/.config/opencode`:

| File | Generation | Content |
|---|---|---|
| `opencode.jsonc` | V2 | `{"plugins": ["opencode-kiro"]}` |
| `tui.json` | V1 | `{"plugin": ["opencode-kiro"]}` |
| `tui.jsonc` | V1 | `{"plugin": ["./herdr-tui-session.js"]}` |
| `cli.json` | V2 | `plugins: ["./herdr-opencode"]`, `theme.name: "system"`, no `keybinds` |
| `package.json` | V1 | `@opencode-ai/plugin` `1.18.34` |

#### Loading and discovery

V1 loads global then project config, then `~/.config/opencode/plugins/`, then `.opencode/plugins/`; npm plugins are installed by Bun into `~/.cache/opencode/node_modules/`. V2 applies plugin arrays from `~/.config/opencode/opencode.jsonc`, `./opencode.jsonc` and `./.opencode/opencode.jsonc` lowest to highest precedence without replacing each other. It also discovers direct `.ts`/`.js` files and package directories in every `.opencode/plugins/` and in `~/.config/opencode/plugins/` (`packages/core/src/plugin/source-directory.ts:6`, which also scans the legacy `plugin/`). Config-listed local paths must be directories. A `plugins/` directory beside a project-root `opencode.json` is not auto-discovered.

Entry points resolve per package (`packages/core/src/plugin/module.ts:143-150`): `.`/`./server` (server), `./tui`, `./gui-experimental`, `./rpc`. A directory without `exports` uses root file names `server` (else `index`), `tui`, `rpc`. A TUI-only package is not listed by the server. Entries support directives: `-id` disables, `*` is every plugin, `.*` matches an ID prefix. `opencode plugin add|list|check|update|remove` manages them. `module.ts:84-95` rejects exports that lack an `id` and an `effect` or `setup`.

The TUI loads the TUI parts of plugins its connected server loaded, plus TUI-only plugins from `cli.json` and from `<global-config>/plugins/<name>/tui.ts` or `<project>/.opencode/plugins/<name>/tui.ts` (`packages/tui/src/plugin/discovery.ts:8-67`). There is no project-local `cli.json`.

#### Testing patterns

None in the plugin loader as observed by the research; not inspected for test files in `anomalyco/opencode`.

### 2. V2 server plugins get a context of domains, each with `transform` and `hook`

The V2 context (`ctx`) contains `location` (`{directory, workspaceID?, project{id, directory, canonical}}`), `options`, `app.version`, `storage.{get,set,remove,scan}`, `session.*`, `permission.*`, `plugin.list()`, `credential.activate`, and `experimental.generate.{text,image,decisions}`. Domains `agent`, `command`, `integration`, `mcp`, `model`, `provider`, `reference`, `skill`, `tool`, `vcs`, `websearch`, `worktree` each have `transform(editor)` and `reload()`. `ctx.event.subscribe({types?, signal?})` is an `AsyncIterable`; `server.connected` is never delivered to plugins.

Hooks register as `await ctx.<domain>.hook(name, cb, {providerID?})`; the callback receives one mutable event:

| Domain | Hooks |
|---|---|
| `ctx.session.hook` | `prompt`, `context`, `compaction`, `generate`, `title`, `model.request`, `http.request`, `http.response`, `experimental.ws.*`, `retry`, `experimental.idle` |
| `ctx.tool.hook` | `execute.before`, `execute.after` |
| `ctx.shell.hook` | `create.before` |
| `ctx.permission.hook` | `evaluate` |
| `ctx.aisdk.hook` | `sdk`, `language` |

V1 hooks map as follows (`/v2/docs/build/plugins/migrate-v1/`): `chat.message`→`session.hook("prompt")`; `chat.params`→`session.hook("context")`; `chat.headers`→`model.request`/`http.request`; `experimental.session.compacting`→`session.hook("compaction")`; `event`→`ctx.event.subscribe()`; `tool.execute.*`→`ctx.tool.hook`; `shell.env`→`shell.hook("create.before")`. `command.execute.before`, `experimental.compaction.autocontinue`, `experimental.provider.small_model` and `experimental.text.complete` have no direct V2 mapping. V1 `Hooks` also include `config`, `tool`, `auth`, `provider`, `permission.ask`, `tool.definition` and `experimental.chat.*.transform`. V1's `experimental.session.compacting` output is `{context: string[], prompt?: string}`; setting `prompt` replaces the default and ignores `context`.

V1 event names (docs): `command.executed`, `file.edited`, `file.watcher.updated`, `installation.updated`, `lsp.*`, `message.*`, `permission.asked|replied`, `server.connected`, `session.created|compacted|deleted|diff|error|idle|status|updated`, `todo.updated`, `tool.execute.*`, `tui.prompt.append|command.execute|toast.show`.

#### Testing patterns

Not applicable to this section.

### 3. Commands, tools and TUI commands register through different mechanisms

| Mechanism | Registration | Behavior |
|---|---|---|
| Prompt-template command | V1 `command` key or V2 `commands` key in config; or `.opencode/commands/*.md`, `~/.config/opencode/commands/*.md` | Expands `$ARGUMENTS`, `$1..`, ``!`shell` ``, then submits a prompt. V2 adds `subagent`. `schema/src/config/command.ts:7-14`: `{template, description?, agent?, model?, subagent?, subtask?}`. |
| Plugin server command (V2) | `ctx.command.transform(editor => editor.add({name, description, execute({sessionID, prompt, delivery})}))` | Executor typically calls `ctx.session.prompt`. V1 has no server-side registration (only `command.execute.before` to alter parts). |
| Custom tool (V1 file) | `.opencode/tools/<name>.ts`, `~/.config/opencode/tools/` using `tool({description, args, execute})` | Filename is the tool name; multiple exports become `<file>_<export>`. Same-named built-ins are replaced. |
| Custom tool (V1 plugin) | `Hooks.tool: {name: tool({...})}` | |
| Custom tool (V2) | `ctx.tool.transform(editor => editor.add({name, description, input, execute(input, context)}))` | `context.signal` available; `editor.namespace/update/remove`. |
| TUI command (V2) | `context.keymap.layer(() => ({mode, priority, commands:[{id, title, group, bind, palette, slash:{name, aliases, arguments}, enabled, suggested, run}], bindings}))` | Palette, slash completion and keybind in one entry. `slash.arguments: true` keeps typed text and passes raw text to `run(input)`. |
| TUI command (V1) | `api.keymap.registerLayer(...)` or deprecated `api.command.register` | `{title, value, keybind, slash, onSelect}` |

Prior-art TUI plugins note that slash completion and the palette are not available in the base keymap mode; `mode: "global"` is used (`opencode-dir-tree-tui`, `opencode-skills-tui`, `opencode-quota`).

#### Testing patterns

Not applicable to this section.

### 4. Server plugins run in the server; only TUI plugins render UI

| | Server plugin | TUI plugin |
|---|---|---|
| Runs in | opencode server process | terminal client (OpenTUI + Solid) |
| Renders UI | No | Yes |
| Remote server | runs on server | TUI-only plugins stay local |
| V2 SDK | `@opencode/plugin` | `@opencode/plugin/tui` |

The V2 TUI context (`packages/plugin/src/tui/context.ts`):

```text
Context
  options, location, app{version, channel}, renderer, client, data, attention, theme, themeMode
  markdown.registerCodeBlockRenderer(lang, fn)
  keymap: layer, dispatch, shortcuts, commands, pending, active, mode.{current,push}
  storage: store(key,{initial}) -> durable, synced across TUIs
           memory(key,{initial}) -> survives plugin reload, not TUI exit
  ui: dialog, toast, router, panel, tabs, model, format, slot
```

The V1 TUI API (`tui.d.ts`) has `api.route`, `api.ui.{Dialog,DialogAlert,DialogConfirm,DialogPrompt,DialogSelect,Slot,Prompt,toast,dialog}`, `api.kv.{get,set}`, `api.state`, `api.theme.current`, `api.client`, `api.event.on`, `api.slots.register`, `api.lifecycle`.

#### Testing patterns

Not applicable to this section.

### 5. The local plugins are plain-JS objects that carry both generations' entry points

```text
~/.config/opencode
├── opencode.jsonc            # plugins: ["opencode-kiro"]
├── tui.json / tui.jsonc      # V1 TUI plugin lists
├── cli.json                  # V2: plugins ["./herdr-opencode"], theme system
├── package.json              # @opencode-ai/plugin 1.18.34
├── plugins/herdr-agent-state.js    # herdr-managed server plugin (overwritten on reinstall)
├── herdr-tui-session.js            # TUI plugin
└── herdr-opencode/tui.js           # re-exports ../herdr-tui-session.js
```

- `plugins/herdr-agent-state.js`: default export `{id: "herdr.opencode", server: HerdrAgentStatePlugin, setup() {}}` (`:220-224`). `server` serves V1; the empty `setup` makes it inert under V2. A gate (`:93-105`) activates only for `opencode run`/`--mini`. Hooks `chat.message` and `event` map `session.status|idle`, `permission.asked`, `question.asked`, `session.error`, `tool.execute.*`, `session.compacted` to `working|idle|blocked`. State is module-level (`childSessions` Map, `reportedRootSessionID`, a promise chain, `reportSeq`). Output is JSON lines over a Unix socket (`HERDR_SOCKET_PATH`, `HERDR_PANE_ID`), 500 ms timeout.
- `herdr-tui-session.js:65-71`: default export `{id: "herdr.opencode.session-selection", setup, tui}`; a comment says the plain object stays dependency-free. V1 calls `tui(api)` using `api.route.current`, `api.event.on`, `api.client.*`, `api.lifecycle.onDispose` and a 100 ms route poll. V2 calls `setup(api)` using `api.ui.router.current()`, `api.data.session.*`, `api.data.listen` and a 100 ms poll, returning a cleanup. It uses in-memory state only and no plugin storage.
- Neither herdr file renders UI. Herdr's indicators live in herdr's own pane UI via the socket reports. The opencode docs mention `tabs.mode: "auto"` hides session tabs inside Herdr.
- `plugins/herdr-agent-state.js` is not listed in any config file; discovery finds it by directory.

#### Testing patterns

No tests for these files; the files are not tracked in this repo.

### 6. Dependencies live in the config directory's `package.json`

V1 docs: a `package.json` in `~/.config/opencode/` or `.opencode/` lists `dependencies`; opencode runs `bun install` at startup. Local `~/.config/opencode/package.json` is `{"dependencies": {"@opencode-ai/plugin": "1.18.34"}}`, with a lockfile and 30-entry `node_modules` (`@opencode-ai`, `zod`, `effect`, `yaml`, `toml`, `@ai-sdk`); its `.gitignore` ignores `node_modules`, `package.json`, lockfiles. `~/.opencode/package.json` pins `@opencode-ai/plugin@1.4.3`.

V2 installs package plugins via `Npm.add` (`packages/core/src/plugin/module.ts:101-105`) or `Npm.resolve` when `install: false`; cached packages load immediately, missing ones install in the background, unpinned npm/Git plugins are checked for updates. `opencode plugin add` accepts npm names with versions/tags/ranges and Git specs. The host resolves `effect`, `effect/*` and `@opencode/plugin` imports to its own instances; plugins declare `effect` as a peer dependency.

Prior-art packages (`opencode-handoff`, `opencode-dir-tree-tui`, `opencode-skills-tui`) export `.`/`./server` → `dist/index.js` and `./tui` → `dist/tui.js`, with peer deps `@opentui/core`, `@opentui/solid`, `solid-js`. The dir-tree and skills TUIs pre-compile JSX with `Bun.build` and `@opentui/solid/bun-plugin`; a comment says opencode 2.0.16 skips Solid's TSX transform inside `node_modules`. Both ship a no-op server stub `{id, setup() {}}`.

#### Testing patterns

Not applicable to this section.

### 7. `/btw` is a built-in TUI plugin: `session.generate` plus a `large` centered dialog

`packages/tui/src/feature-plugins/prompt/btw.tsx` (plugin id `opencode.btw`, registered in `packages/tui/src/plugin/builtins.ts`). Its command is `session.aside` (`btw.tsx:51-57`): `group: "Session"`, `palette: true`, `slash: {name: "btw", arguments: true}`, title "Ask a side question", no default key.

```text
session.aside run(input)
  if route is not a session: warning toast "Open a session first"
  question = input.trim() or await ui.dialog.prompt({title:"/btw", placeholder:"Ask anything"})
  pending++ (spinner slot "prompt.footer.status")
  client.session.generate({sessionID, prompt: [instructions, question].join("\n\n")})
  ui.dialog.show(() => <Answer/>); ui.dialog.set({size:"large", centered:true})
  on error: toast.error(cause)
```

`/btw` is not triggered automatically after a response; it is invoked by the user. The V2 docs list `session.aside` default keybind as `none`; a user binds it in `cli.json` `keybinds`. `/btw` is in V2 source only; it is not in the V1 docs or `tui.d.ts`.

#### Testing patterns

Not inspected.

### 8. Dialogs share primitives, and plugins can open them

`ui.dialog` (V2) offers `show(render, onClose?)`, `set({size?, centered?})`, `clear()`, `alert`, `confirm`, `prompt`, and `select({title, options[{title, value, description, footer, category, disabled}], current, search?, actions?[{bind, title, side?, selection?, onTrigger}]})`. Promise-returning dialogs resolve `undefined` on Escape. V1 equivalents: `api.ui.dialog.{replace,clear,setSize}` and `api.ui.Dialog*` components.

Sizes (`packages/tui/src/ui/dialog.tsx:30-36`): medium 60, large 88, xlarge 116 cells; `maxWidth = terminal width - 2`. The backdrop is `RGBA(0,0,0,150)` at `zIndex 3000`; non-centered dialogs get `paddingTop = height/4`. Escape and ctrl+c close (layer binds `escape`, `ctrl+c`); a backdrop click calls `onClose`.

Plugin dialogs are wrapped by the plugin provider (`packages/tui/src/plugin/api.tsx:329-420`, `createDialogApi`). `btw.tsx:46` notes dialogs render beside `PluginProvider`, so `usePlugin()` must be captured outside the dialog component. `select` actions get internal command ids `plugin.dialog.select.<id>.<n>`. `DialogLayout`, `DialogHeader`, `DialogFooter`, `DialogBleed` are imported from the TUI source by `/btw` and are not in the public `@opencode/plugin/tui` types.

Prior art builds dialogs from plugin-public pieces: `opencode-handoff` uses `ui.dialog.show` + `dialog.set({size:"xlarge", centered:true})` with `<textarea>` and `<scrollbox>`; `ui.dialog.select({search})` for pickers.

#### Testing patterns

Not inspected.

### 9. Hotkeys come from keymap layers, and hints come from footer actions

`/btw`'s answer dialog (`btw.tsx:88-189`) registers `Keymap.createLayer({mode: "modal", commands:[{bind:"c", title:"Copy answer", group:"Dialog"}]})` and uses `useKeyboard` for up/k, down/j, pageup/pagedown, home/end. Hints appear in `DialogFooter` `actions.primary` as `{title:"copy response", key:"c"}`, changing to "✓ copied"; the legacy footer shows `copy c` and `scroll j/k ↑/↓`; the header's right-hand label defaults to `esc`.

Keybinds are declared in V2 `cli.json` `keybinds` (`{"session.aside": "<key>"}`); values may be a string, comma-separated alternatives, an array, an object `{key, event, preventDefault, fallthrough}`, or `"none"`/`false`; `leader` defaults to `ctrl+x`. V1 uses `tui.json` `keybinds` with underscore names. `keymap.shortcuts(id)` reads configured shortcuts (`opencode-handoff` reads `input.newline`, `input.submit`).

Layers in `opencode-handoff` use `{mode:"global", priority:100, commands:[{bind, run}]}` for tab, ctrl+f/a/l/s/d, escape, up/down, return, space. The `select` dialog notes ctrl+n and ctrl+p are reserved internally.

#### Testing patterns

Not inspected.

### 10. Theming is token-based JSON, with resolved tokens and dialog overrides

V2 theme files live in `~/.config/opencode/themes/<name>.json` or `.opencode/themes/` (nearer project replaces global by name; `packages/tui/src/theme/discovery.ts`). This machine has no custom themes; `cli.json` sets `theme.name: "system"`. Format: `{ $schema, base: {...}, light: {...}, dark: {...} }`; values are hex (3/4/6/8 digits), `transparent`, or `$` references (`$hue.cyan.400`, `$text.base`); state keys `$hovered|focused|pressed|selected|disabled`; `@dialog` overrides tokens inside dialogs (`packages/theme/src/tui/schema.ts`, types in `types.ts`).

Token groups: `text` (`base`, `muted`, `faint`, `action.*`, `formfield`, `feedback.{error,warning,success,info}.{base,muted}`), `background` (`base`, `raised.{base,high,max}`, `action`, `formfield`, `feedback`), `border.base`, `scrollbar.base`, `diff`, `syntax`, `markdown`, `hue` (`gray red orange yellow green cyan blue purple`; aliases `accent`, `interactive`, `neutral`; steps 100-900), `categorical`. V1 uses flat tokens (`primary`, `text`, `textMuted`, `background`, `backgroundPanel`, `backgroundElement`, `border`, `borderActive`, ...).

Default `opencode` dark values (`packages/tui/src/theme/assets/v2/opencode.json`):

| Token | Value |
|---|---|
| `text.base` | `#eeeeee` |
| `text.muted` | `#808080` |
| `background.base` | `#0a0a0a` |
| `background.raised.base/high/max` | `#141414` / `#1e1e1e` / `#4c4c4c` |
| `border.base` | `#484848` |
| `@dialog` background | `#141414` |
| `interactive` (orange 200) | `#fab283` |
| `accent` (purple 200) | `#9d7cd8` |
| error / warning / success / info | `#e06c75` / `#f5a742` / `#7fd88f` / `#56b6c2` |

The light palette inverts the gray ramp (gray 100 `#000000`, 800 `#ffffff`). `opencode2.json` and a V1 `assets/opencode.json` also exist and were not compared.

Dialog layout (`ui/dialog.tsx`): `DIALOG_INSET = 3` horizontal padding; `DIALOG_LIST_INSET = 4`; `Dialog` has `paddingTop={1}` and `theme.surface("dialog")`; `DialogLayout` has `paddingLeft/Right = DIALOG_INSET`, `paddingBottom={1}`, `gap={1}`; `DialogHeader` is a space-between row with bold `text.base` title and muted `esc`; `DialogFooter` shows muted `title key` actions (secondary left, primary right, gap 2 or 1), becomes a raised band (`background.raised.high`) under "new designs", and stacks below 60 columns; `DialogBleed` uses negative margins. Toasts (`ui/toast.tsx`) sit absolute at `top={1}`, `right={2}`, `maxWidth = min(60, width-6)`, with feedback-colored split borders and 2×1 padding on `raised.high`. Components are OpenTUI `<box>`, `<text>`, `<scrollbox>`, `<markdown>` in Solid.

#### Testing patterns

Not inspected. A `Storybook` built-in plugin loads only when `OPENCODE_STORY` is set.

### 11. UI surfaces are slots, toasts, dialogs, routes and notifications

V2 slots (`SlotMap`, `context.ts:191-202`): `app`, `home.footer`, `home.footer.status`, `prompt.footer`, `prompt.footer.status`, `prompt.footer.file`, `session.composer.top`, `session.panel`, `sidebar.content`, `sidebar.footer`. Placements: `prepend`, `append`, `before`, `after`, `replace` (last-enabled `replace` wins; ancestor beats descendant; `packages/tui/src/plugin/structure.ts`). There is no header slot in V2; V1 has `sidebar_title`, `home_logo`, `home_prompt`, `session_prompt`, `app_bottom`. Other surfaces: `ui.toast.show({title?, message, variant, duration?, sessionID?})`, `ui.router.register/navigate/current`, `ui.panel.open(name)`, `ui.tabs`, `attention.notify`, markdown code-block renderers. V1 SDK also exposes `POST /tui/show-toast`, `/tui/append-prompt`, `/tui/execute-command`.

Built-in plugins (`builtins.ts`): `HomeFooter`, `PromptFooter`, `PromptBtw`, `SidebarContext`, `SidebarLimit`, `SidebarMcp`, `SidebarTodo`, `SidebarFooter`, `Notifications`, `Plugins`, `Stats`, `Merman`, `Latex`, `DiffViewer`.

Prior art on surfaces:

| Plugin | Surfaces |
|---|---|
| `opencode-quota` | `sidebar.content`, `prompt.footer`, `home.footer.status`, `session.composer.top`, `app`; toasts; palette + slash commands |
| `opencode-dir-tree-tui` | `sidebar.content` panel; `/dirtree-sidebar` dialog |
| `opencode-skills-tui` | `sidebar.content` panel; `/skills-sidebar` dialog; preview dialog |
| `opencode-handoff` | review dialog, toast, router navigate |
| goal plugin | session title (`▶ objective · 3/10 · 2m · 45k/200k`), toasts via `client.tui.showToast` |

### 12. The TUI has no shared relative-time formatter

`component/dialog-open.tsx:498-509` `timeAgo` yields `now`, `Nm`, `Nh`, `Nd`, `Nmo`, `Ny` and is used in the session-list footer (`:227`, `session.time.updated`) with no ticking timer; it recomputes when the options memo reruns. `component/dialog-stash.tsx:9-22` `getRelativeTime` yields `just now`, `Nm ago`, `Nh ago`, `Nd ago` (under 7 days), else `Locale.datetime`. `util/locale.ts:7-18`: `Locale.time` uses `toLocaleTimeString(undefined, {timeStyle:"short"})`; `Locale.datetime` is `"<time> · <date>"`. Used in `routes/session/dialog-timeline.tsx:24` and `dialog-fork.tsx:70`. The only ticking text is `AssistantRetry` (`routes/session/index.tsx:2540-2560`, 1 s interval). No `Intl.RelativeTimeFormat` use was found.

### 13. Messages and parts come from `session.message.list`, with parts inline

| Endpoint | Returns |
|---|---|
| `GET /api/session/:id/message` (`protocol/src/groups/message.ts:75-90`) | `{data: Message[], cursor:{previous?, next?}}`; query `limit` 1-200, `order`, opaque `cursor`, `type` filter |
| `GET /api/session/:id/message/:messageID` (`session.ts:705-716`) | one message |
| `GET /api/session/:id/context` (`session.ts:502-514`) | messages after the last compaction |
| `GET /api/experimental/session/:id/log` (SSE) | durable event log |
| `GET /api/experimental/session/:id/export` | `{info, messages}` |

Message types (`schema/src/session-message.ts`): `agent-switched | model-switched | location-switched | user | synthetic | system | skill | shell | assistant | compaction | idle`. An assistant message (`:220-246`) has `agent`, `model: Model.Ref`, `content: (AssistantText | AssistantReasoning | AssistantTool)[]`, `cost`, `tokens`, `finish`, `error`, `retry`, `time`, `metadata?`. Tool parts carry `state.status` of `streaming|running|completed|error`. Parts also live in table `session_part` keyed `(message_id, ordinal)` (`core/src/session/sql.ts:107-128`); there is no parts endpoint.

Plugins reach sessions through `ctx.session` (`plugin/src/promise/session.ts:196-221`): `list, create, get, remove, switchAgent, switchModel, prompt, generate, command, compact, synthetic, interrupt, update, move, context`. A `messages` method was not found there. `opencode-handoff`'s `read_session` tool calls `ctx.session.context({sessionID})` and renders the last N messages (default 100, max 500). `opencode-smart-title` (V1) uses `client.session.messages`, keeping non-synthetic text parts of user and assistant messages.

### 14. Built-in compaction is a queued model call with a fixed prompt and an agent-based model

`POST /api/session/:id/compact` with `{id?, delivery?}` (`session.ts:439-455`) queues the request and runs at the next step boundary. Reasons are `auto | overflow | manual` (`core/src/session/compaction.ts:59-63`). Prompt pieces: `SUMMARY_TEMPLATE` (`## Objective … ## Important Context`, `:166-197`), `SUMMARY_RULES` (`:199-205`), `buildPrompt(update, legacy)` (`:207-238`; first compaction "You MUST summarize the conversation above…", later "Update the existing checkpoint…"), `NUDGE` retry (`:240`). The prompt is appended as a final user message after the conversation to reuse the prompt cache (`:433-452,477-504`).

Model selection (`:270-289`): the agent with id `compaction` and its `model` if set and resolvable; otherwise the session's current model; native-compaction models skip the agent lookup. Settings: `compaction.auto`, `compaction.keep.tokens` (default 15000), `compaction.buffer` (`schema/src/config/compaction.ts`; defaults `auto:true, keep:15_000, precompute:false` at `:260-262`). The result is published as `session.compaction.ended` (`:910-921`, `{reason, model, native, text, cost, tokens}`), projected into a `compaction` message `{status:"completed", reason, model?, native?, summary, cost?, tokens?}` with `metadata.keepID`; history loads from the latest completed compaction. Failure emits `session.compaction.failed`. Cost is billed to the session via `session.usage.recorded` with `source:"compaction"` (`:869-888`). The `compaction` hook (`ctx.session.hook("compaction", e => ...)`) lets a plugin set `e.result = {summary, native?, metadata?, tokens?}` to skip the model call.

`Session.Info` (`schema/src/session.ts:34-65`) has no `summary` field. `session_v2` retains legacy columns `summary_additions|deletions|files|diffs` and `share_url` (`sql.ts:46-49`); diffs have `GET /api/session/:id/diff`. A hidden `summary` agent with the PR-description prompt `PROMPT_SUMMARY` is registered (`core/src/plugin/agent.ts:40-50,110-115`); no core caller was found.

Title generation: `SessionTitle.Service.generate(sessionID)` (`core/src/session/title.ts:25-28,104-153`) sends the first user message (or original request plus recent turns), bounded by `MAX_CONTEXT_LENGTH 8000`, `MAX_FIRST_MESSAGE_LENGTH 2000`, `MAX_LENGTH 100`. Model: the `title` agent's model; else `model.small(providerID)` (first present of `gpt-luna`, `gemini-flash-lite`, `gemini-flash`, `claude-haiku` families, `core/src/model.ts:306-319`); else the primary model at a lower variant; falls back to the primary model on failure. The result is published as `session.renamed`. A `title` hook can supply a result. V1 `small_model` is migrated into `agents.title.model` (`core/src/config/normalize.ts:136-152`).

### 15. Three mechanisms make LLM calls with different side effects

| Mechanism | History | Cost | UI |
|---|---|---|---|
| `ctx.experimental.generate.text({prompt, model?})` (`POST /api/experimental/generate/text`, `protocol/src/groups/generate.ts:25-46`) | none; no session or tools; fresh `x-opencode-session` header (`core/src/generate.ts:60-68`) | no session usage observed | none |
| `ctx.session.generate({sessionID, prompt})` (`POST /api/session/:id/generate` → `{data:{text}}`, `session.ts:634-650`) | session context + prompt as last user message, "without mutating session history" (`core/src/session/generate.ts:25-68`); runs `generate` hooks | whether usage is recorded was not confirmed | none |
| child session: `ctx.session.create({parentID, title?, agent?, model?, metadata?, permissions?})` then `prompt` | separate messages; parent unmodified | usage applied only to the child row (`projector.ts:~60-77`); no roll-up seen | hidden from root list (`packages/tui/src/app.tsx:698` filters `parentID: null`); `session.created` event has `parentID` |

`generate.text` uses the base config's default model when `model` is omitted. Child sessions inherit the parent's `metadata` and `permissions` unless provided (`core/src/session.ts:288-318`). `session.prompt` takes `{id?, text, files?, agents?, skills?, metadata?, delivery?, resume?}` with no per-call `model`; a model is set at create or via `POST /api/session/:id/model`. `resume: false` admits input without scheduling an agent-loop run (V1's `noReply` analogue). Waiting uses `POST /api/experimental/session/:id/wait` or `ctx.session.wait`. Deleting a session deletes its children.

How prior art uses them:

| Project | LLM call approach |
|---|---|
| `opencode-handoff` | no separate call; sends an instruction template into the current session via `ctx.session.prompt`, the session's own model writes the summary; a `handoff_session` tool returns it |
| `opencode-smart-title` | direct `generateText` from the Vercel `ai` package with a model from `@tarquinen/opencode-auth-provider`; no opencode session |
| `opencode-claude-memory` | plugin-owned child session: `create({parentID, title, agent, model, permissions}) → prompt → wait → context → remove`, with timeouts |
| `opencode-short-term-memory` | `summarizerMode "clean"` uses a separate owned summary session; `"active"` uses the current session; optional `memoryModel` |
| `entireio/cli` | shells out to `opencode run --format json --agent <tmp> [--model p/m]` with `OPENCODE_CONFIG_CONTENT` injecting a no-tools agent; `--standalone` for OpenCode 2+ |
| `bro-skill` | no call; skill/command text makes the current model re-explain its last message |

### 16. The current model surfaces in `context` hooks and events, and resolves by session, agent, then default

`session.hook("prompt")` carries `{sessionID, messageID, prompt, metadata?, delivery}` and no model (`promise/session.ts:13-18`). `session.hook("context")` carries `model: Model.Ref` (`{id, providerID, variant?}`), `system`, `messages`, `options`, `agent`, `tools` (`:26-40`). `compaction`, `generate`, `title`, `model.request`, `http.*`, `retry` also carry `model`. `SessionRequestKind = "primary" | "compaction" | "title" | "generate"` (`:64-69`). A third argument `{providerID}` filters a hook to a provider (`core/src/plugin/host.ts:171-191`). `session.model.selected` carries `{sessionID, model, previous?}` (`session-event.ts:71-80`); `session.created` carries `model?`; `opencode-quota` reads `ctx.session.get` for the session model and listens for `session.model.selected`. V1 `chat.message`/`chat.params` inputs carry `model` and `provider`.

Resolution (`core/src/session/runner/model.ts:77-99`):

```text
resolve(session, available)
  if session.model set
    must be in available() else ModelUnavailableError{providerID, modelID}
    use session.model (+ variant)
  else
    agent = agents.select(session.agent); if agent.model in available() use it
    else ModelResolver.resolve() -> Model.default()
    else ModelNotSelectedError
Model.default(): configured top-level `model` (or editor.default.set) if enabled,
                 else first available model with text support  (core/src/model.ts:300-305)
last fallback: first available model with a loadable package (core/src/model-resolver.ts:506-519)
```

In V2 messages carry no model except assistant messages; `model-switched` messages and the session row's `model` column track switches. The "last user message model" rule is not used.

### 17. Models list through HTTP, CLI and `ctx.model`, with availability meaning enabled

`GET /api/model?types=…`, `GET /api/model/default` (`protocol/src/groups/model.ts:17-47`), `GET /api/provider[/:id]` (`provider.ts:10-40`), `GET /api/config`, and `opencode models` (`cli/src/commands/commands.ts:329-332`). `ctx.model` is `ModelApi & {transform, reload}` (`promise/model.ts:25-28`). `Provider.Info` has `activation: auto|enabled|disabled` (`schema/src/provider.ts:111-121`). `Model.available(types?)` returns enabled models; `all()` returns every model (`core/src/model.ts:289-298`). Signed out, only free OpenCode models are enabled (`:325-326`). A request for a model not in `available()` fails with `ModelUnavailableError`.

Parsing: `Model.Ref.parse("provider/model#variant")` (`schema/src/model.ts:25-45`) takes the provider as everything before the first `/` and the id up to `#`; it throws `Invalid model reference: <input>` if no `/` at index > 0, id empty, provider contains `#`, or variant empty or containing `#`. Config validation (`schema/src/config/model.ts:8-37`) accepts regex `^[^/#]+\/[^#]+(?:#[^#]+)?$` or `{providerID, model, variant?}`, always producing the explicit struct. The looser `Model.parse` (`core/src/model.ts:356-362`) never throws; with no `/`, `modelID` is `""`. No existence check happens at parse time.

Prior-art model choice: `opencode-smart-title` `selectModel` tries `config.model` (`"provider/model"`, bad format warns and falls through), then iterates `[openai, anthropic, google, deepseek, xai, alibaba, zai, opencode]` skipping unauthenticated providers with a per-provider fallback model list; shows a toast "Smart Title: Model fallback" on fallback. `entireio/cli` stores `summary_generation.{provider, model}` in `.entire/settings.json`; a model requires a provider; a configured provider that is missing errors with no fallback; with none configured it auto-selects a single installed candidate or prompts, defaulting `claude-code` to `sonnet`.

### 18. Plugin options arrive as `ctx.options`; unknown config keys are dropped

V2 form: `plugins: ["pkg", {"package": "pkg", "options": {...}}]` (`schema/src/config/plugin.ts:6-14`). V1 tuple `["pkg", {…}]` is normalized into it (`core/src/config/normalize.ts:184-189`). Options are `Readonly<Record<string, any>>` (`plugin/src/options.ts`), injected at `core/src/plugin/module.ts:164`; absent options give `{}` (`core/src/config/plugin/source.ts:118-120`). Options must be JSON-serializable when a plugin has a GUI bundle (`module.ts:143-147`).

The config is decoded with `{errors:"all", onExcessProperty:"ignore"}` (`core/src/config.ts:140-141`, `config/normalize.ts:44`), so unknown top-level keys are silently dropped and no `ctx.config` getter exists. No plugin-options file convention exists in opencode. Validation: malformed JSONC rejects the document with a warning; per-field invalid values are dropped with a `warn` diagnostic (`normalize.ts:770-800`); a failed final `decodeInfo` rejects the document; diagnostics are logged, not thrown (`core/src/config.ts:150-185`).

Prior plugins' option sources:

| Plugin | Option source |
|---|---|
| `opencode-handoff` | plugin tuple options (`attachFiles`, `review`) |
| `opencode-smart-title` | `~/.config/opencode/smart-title.jsonc` (auto-created) overridden by `.opencode/smart-title.jsonc`: `enabled, debug, model, updateThreshold` |
| `opencode-quota` | `~/.config/opencode/opencode-quota/settings.jsonc` (honors `$XDG_CONFIG_HOME`, `$OPENCODE_CONFIG_DIR`); TUI settings dialog persists via RPC `saveSettings` |
| goal plugin | plugin options (`stateFilePath`, `commandName`, `persistState`, `completionAudit`), env `OPENCODE_GOAL_STATE_PATH` |
| `opencode-agent-memory` | `~/.config/opencode/agent-memory.json` |
| `opencode-short-term-memory` | `stm.jsonc`/`stm.json`; keys `summarizerMode`, `memoryModel`, `memoryDir` |
| `opencode-magic-context` | `~/.config/cortexkit/magic-context.jsonc`; `historian.opencode.model` |

### 19. Prompts customize through agent and command markdown, config text and hooks

Agents: markdown in `~/.config/opencode/agents/<name>.md` and `.opencode/agents/<name>.md` (nested paths become ids); the body becomes `system` (`core/src/config/plugin/agent.ts:158-180`); V1-style files use `prompt`. Config form `agents.<id>: {model, request, system, description, mode, hidden, color, steps, disabled, permissions}` (`schema/src/config/agent.ts:11-26`). Plugins edit agents via `ctx.agent.transform` (built-in `title`, `summary`, `compaction`, `explore` are defined this way, `core/src/plugin/agent.ts:96-115`). Commands: markdown in `.opencode/commands/*.md` or `~/.config/opencode/commands/` (legacy `command/` still discovered); body becomes `template`; templates expand `$ARGUMENTS`, `$1…`, ``!`cmd` `` (`config/plugin/command.ts:142-216`). Compaction and title prompts are fixed in core (`compaction.ts:166-241`, `plugin/agent.ts:19-30`), overridable via `agents.title.system` or the `title`/`compaction` hooks.

`{env:NAME}` and `{file:path}` (`core/src/config/variable.ts:25-81`) are regex-substituted on the **raw config text** before JSONC parsing, for every config file (`core/src/config.ts:177,199,262,295`). `{env:}` uses `input.env?.[name] ?? process.env[name]`, default `""`. `{file:}` is skipped after `//` on its line, expands `~/`, resolves relative paths against the config file's directory, trims and JSON-escapes content; a missing file yields `""` plus a warning. They are not applied to agent or command markdown bodies. Repo example: `src/.opencode/agents/research.md:1-4` has frontmatter `description`, `mode: subagent`, then the prompt.

Other prompt customization in prior art: `opencode-handoff` embeds its instruction template in source (`HANDOFF_COMMAND`); `opencode-smart-title` keeps `TITLE_PROMPT` in `prompt.ts`; `bro-skill` keeps its prompt in `SKILL.md`, copied into a command wrapper; `entireio/cli` builds the prompt with `buildSummarizationPrompt`.

### 20. Session data is in SQLite, and plugin data is in key-value storage or session metadata

Storage is SQLite via drizzle under `~/.local/share/opencode`: `opencode.db`, or `opencode-<channel>.db` for non-release channels unless `OPENCODE_DISABLE_CHANNEL_DB=1` or `OPENCODE_DB` is set (`cli/src/database-path.ts:4-12`). Here the directory holds `opencode.db`, `opencode-local.db` (+ `-shm`, `-wal`), `auth.json`, `log/`, `repos/`, `shell/`. Tables (`core/src/session/sql.ts`): `session_v2` (line 28; `model`, `agent`, `metadata` JSON; `title`, `parent_id`, `fork_session_id`, `fork_boundary`, token/cost columns), `session_message` (86; `data` JSON, keyed `(session_id, seq)`), `session_part` (107), `session_inbox` (130), plus event-log tables (`core/src/event/sql.ts`). JSON files under `~/.local/share/opencode/storage/` are a V1 artifact; V1 migration code is at `core/src/database/v1-migration*.ts`.

Plugin-scoped storage: `ctx.storage` (`get`, `set`, `remove`, `scan({prefix, after?, limit?})`, `plugin/src/storage.ts`), backed by table `kv` (`core/src/kv/sql.ts`); keys are namespaced `plugin:<hex of plugin-id chars>:` (`core/src/plugin/host.ts:~658-680`); it is global to the plugin and not removed with a session. TUI plugins have `storage.store` (durable, synced; comment says files named `plugin.<id>.<key>.json`) and `storage.memory`.

Attaching data to sessions: `Session.Metadata = Record<string, Json>` (`schema/src/session-metadata.ts`), durable and opaque to core, set via `POST /api/session` or `PATCH /api/session/:id` (`session.ts:165-170,301-312`, emits `session.metadata.updated`, replaces the whole object), read from `Session.Info.metadata`; children and forks inherit it unless the creator supplies their own. Messages carry `metadata?` (`session-message.ts:31-35`), settable on `prompt`/`synthetic`. `session.title` is patchable. `POST /api/session/:id/synthetic {text, description?, metadata?, delivery?, resume?}` adds a model-visible `synthetic` message. Assistant content is a closed union of `text | reasoning | tool`; no custom part types exist. Tool `state.metadata` is set by tools.

Per-session state in prior art:

| Plugin | Location | Keyed by |
|---|---|---|
| `opencode-quota` | `<stateDir>/opencode-quota/snapshot-v6.json` (atomic, locked, `0600`) | session (snapshot/refresh) |
| goal plugin | `<cwd>/.opencode/goals/state.json.sessions/<sha256(sessionID)>/state.json` + `state.json.ledger.jsonl` | session shard |
| `opencode-agent-memory` journal | `~/.config/opencode/journal/<YYYYMMDD-HHMMSS-mmm>.md` with frontmatter `title, project, model, provider, agent, session_id, created, tags` | entry; `session_id` in frontmatter |
| `opencode-claude-memory` | `<CLAUDE_CONFIG_DIR>/opencode-memory/<root>/extraction-state.json` (`lastExtractedMessageID`, `lastMessageAt`, `attemptedAt`, `updatedAt`, `failures`) | session |
| `opencode-short-term-memory` | `.opencode/memory` (memory markdown, checkpoint, reset boundary, log) | conversation |
| `opencode-simple-memory` | `<date>.logfmt` lines with `ts`, type, scope, tags | date |
| `opencode-smart-title` | none; writes `session.title` | n/a |

### 21. Session lifecycle events are specific rather than generic

`schema/src/session-event.ts`, mostly `Event.durable` with `aggregate: "sessionID"`: `session.created` (L39, `{projectID, location, subpath?, parentID?, slug, title?, agent?, model?, metadata?, permissions?, version}`), `agent.selected` (L60), `model.selected` (L71), `moved` (L82), `renamed` (L92), `metadata.updated` (L102), `permissions` (L112), `viewed|archived|unarchived` (L122-140), `deleted` (L182), `forked` (L192), `execution.started|succeeded|failed|interrupted` (L245-259), `compaction.started|delta|ended|failed` (L588-638), plus `step.*`, `text.*`, `reasoning.*`, `tool.*`, `inbox.*`, `usage.*`, `retry.scheduled`, `revert.*`. Deltas and `usage.updated` are ephemeral; `session.usage.recorded` does not reach clients. There is no `session.updated` or `session.compacted` event in V2; `session.idle` appears only in a migration example (`migrate-v1.mdx:310`).

Delete (`core/src/session.ts:391-402`): interrupt, await idle, cancel jobs, close transport; recursively remove children; clear environment; publish `session.deleted`; projector runs `SessionBlob.releaseSession` and `DELETE FROM session_v2` (`projector.ts:630-635`); child tables cascade (`sql.ts:86-128`); plugin `kv` untouched.

Fork (`POST /api/session/:id/fork {before?}`, `session.ts:258-271`; `projector.ts:109-200`): new session with `fork_session_id` = parent and `fork_boundary`, `parent_id` null; copies `project_id`, `workspace_id`, `directory`, `agent`, `model`, `metadata`, `permission`; title `"<title> (fork #N)"`; cost/tokens reset to 0; messages copied up to the boundary in batches of 500 with media blobs re-stored.

`opencode-skills-tui` listens for `skill.updated`, `project.updated`, `session.skill.activated`, `session.deleted`, `session.compaction.ended` and resets per-session state on compaction.

### 22. Prior-art plugins demonstrate the surface in working code

**`opencode-handoff` (v0.7.0, V2).** `/handoff <goal>` is a plugin command whose `execute` sends a template into the current session (`ctx.session.prompt({..., text: HANDOFF_COMMAND.replaceAll("$ARGUMENTS", () => prompt.text)})`). The model calls tool `handoff_session({prompt, files?: [{path, description, mode}]})`. Server and TUI communicate through a typed RPC contract `Rpc.define({id, methods:{claim,start,preview,cancel}, events:{draft,started}})`.

```text
handoff_session tool
  store draft in Map keyed by randomUUID; emit "draft" event
  block on Promise; CLAIM_TIMEOUT_MS = 3000 -> startWithoutReview if nobody claims
TUI "draft" listener
  claim only if ui.router.current() is the source session
  ui.dialog.show(<Review/>); dialog.set({size:"xlarge", centered:true})
  edits call handoff.preview (debounced 200 ms) for token estimates (~4 chars/token)
  ctrl+s / enter -> handoff.start -> session.create({agent, model: source.model}) + prompt(files)
                    -> router.navigate(session) + toast "Handoff started"
```

Options `attachFiles` (default true) and `review` (false skips the dialog). No model option; it needs OpenCode v2.1.2+. V1 (v0.5.0) used `client.tui.executeCommand({command:"session_new"})`, a 150 ms delay, `client.tui.appendPrompt` and `showToast`, with a `chat.message` hook injecting file parts via `client.session.prompt({noReply:true, ...})`. The changelog says the v2 draft opens in a dialog "instead of the TUI prompt box, which v2 plugins can't fill".

**`opencode-smart-title` (V1).** Trigger: `event` hook on `session.status` idle; skips subagent sessions (`parentID`); per-session in-memory counter with `count % updateThreshold`; fire-and-forget. Context is built per turn from the user text plus first and last assistant text. `cleanTitle` strips `<think>`, takes the first non-empty line, truncates to 100. It writes `client.session.update({path:{id}, body:{title}})`. On error it logs and leaves the title; no retry, timeout or backoff was found. Debug logs go to `~/.config/opencode/logs/smart-title/YYYY-MM-DD.log`.

**`bro-skill`.** One `SKILL.md` (`name: bro`) plus `install.sh`; for opencode it is copied to `~/.config/opencode/skills/bro/SKILL.md` with a command wrapper appended with `$ARGUMENTS`. Output is a normal assistant reply. No config options.

**`opencode-quota` (v6.2.0, V2).** Server commands `/quota`, `/quota_status`, `/quota_usage [...]` via `ctx.command.transform`; TUI command `/quota_settings` and palette commands in a `mode:"global"` keymap layer. A second layer binds `return` at higher priority and, if the editor text starts with a quota command, runs `editor.clear()` and opens a window instead of submitting. On Web/Desktop the server posts the report as a user message with `resume:false`, `delivery:"steer"` and report metadata, and registers `context`, `compaction`, `generate` and `title` hooks to strip report messages from model history. It uses `ctx.event.subscribe({types:["credential.updated","credential.switched","session.model.selected"]})`. TUI toasts use `api.ui.toast.show` with colored spans; a preview toast is re-shown each second because the API only shows a toast for a duration. Surfaces: see section 11.

**Goal plugin (v0.11.4).** `/goal <objective>`, `status`, `pause`, `resume`, `edit`, `clear`, `list`; v1 registers via `command.goal` config, v2 via `ctx.command.transform` with a bridge (`src/v2-bridge.js`) adapting v2 hooks to the v1 contract. Completion uses text markers (`[goal:evidence]`, `[goal:complete]`, `[goal:blocked]`); an optional verifier runs in a child session. Toasts and logs: `client.app.log` and `client.tui.showToast`, variant chosen by regex on the message. It writes a one-line status into the session title. State: per-session shards, a ledger, `0600` files, a per-session lease so a second process goes passive. The README says it is in maintenance mode because OpenCode 2.2.1 ships its own `/goal`.

**`opencode-dir-tree-tui` and `opencode-skills-tui` (V2 TUI).** Installed with `opencode plugin add <name>`; neither repo contains or documents a `tui.json`. Sidebar panel: `context.ui.slot({append:"sidebar.content", render: props => ...})` (`props.sessionID`). Commands: `keymap.layer` with `slash: {name:"dirtree-sidebar"}` or `{name:"skills-sidebar"}` and `palette: true`. Click actions use `onMouseUp`. dir-tree configures open/copy/toggle mouse buttons and per-project ignore rules in `storage.store("dir-tree.config")`; collapse state in `storage.memory` (a comment says `store` synced collapse across terminals); data from `client.file.list`, `git status --porcelain -z`, `data.on(...)` events and a 10 s poll; clipboard via OSC 52. skills-tui reads `data.location.skill.list`, tracks loaded skills per session from message history, previews `SKILL.md` in an `xlarge` dialog, and inserts @mentions by driving the built-in `/skills` picker with `keymap.dispatch("dialog.select.*")` (the source comment calls this a hack).

**Memory plugins.** `opencode-short-term-memory` has a `/stm` menu (Show, Logs, Settings, Status, Update, Reset) and injects saved memory as a session message without requesting a reply; the per-entry timestamp format was not found. `opencode-claude-memory` extracts on `session.idle` (debounced) via a child session with an explicit permission ruleset and injects recall results through `experimental.chat.system.transform`. `opencode-magic-context` stores tiered "compartments" in Rust-core storage (format not found). `deja-vu` is a Go indexer with no LLM.

**Issue #21760** (closed by bot, no maintainer response or PR) is a request for `/summarize-to-new` and a context-threshold button/toast, creating a new session that references the old session id, with optional `.sessions/{id}.md` persistence and a customizable prompt. It has no model-selection design.

#### Testing patterns

Prior-art test layouts were not inspected beyond the source files cited.

### 23. Claude Code keeps originals and exposes focus text and hooks

`/compact [instructions]` summarizes the conversation with optional focus text; "Compact Instructions" in CLAUDE.md can also steer it; `/autocompact [auto|<tokens>]` sets the window; repeated failures stop with a "thrashing" error. "Summarize from here" and "Summarize up to here" live in the rewind menu (`/rewind` or `Esc Esc`): you pick one prompt and the action applies after or before it (no arbitrary range); highlighting an option and typing in "add context (optional)" then `Enter` supplies instructions, while a number key summarizes immediately. A "Summarized conversation" marker replaces the compressed messages. "Summarizing doesn't change files on disk, and the original messages stay in the session transcript."

Storage: transcript JSONL at `~/.claude/projects/.../<session_id>.jsonl` (`transcript_path` in hook payloads); `PostCompact` receives `trigger` and `compact_summary`; `PreCompact` receives `trigger` and `custom_instructions` and can block (exit 2 or `"decision":"block"`). The exact transcript record for the summary is undocumented. Which model `/compact` uses is not documented.

Issue #6907 (closed "not planned") proposed timestamped `SESSION-SUMMARY-YYYY-MM-DD-HHMM.md` files. The community workaround is a command file `.claude/commands/create-summary.md` (with `model:` frontmatter), a `.claude/hooks/auto_summarize.sh` that pipes the transcript into `claude -p "/create-summary"`, and a `hooks.PreCompact` registration; results were not verified in the thread. `claude-sessions` (archived) writes `sessions/<YYYY-MM-DD-HHMM[-name]>.md` plus `sessions/.current-session` through slash-command markdown files (`session-start|update|end|current|list`), with no hooks or model selection in the README.

### 24. Kiro and Kiro Crew differ on storage, prompt control and display

Kiro auto-compacts near the context limit (example 80%); `/compact` (CLI) "replaces the message history with this summary" and takes no arguments. The summary is structured (goals, decisions, progress, next steps); recent message pairs stay verbatim (`compaction.excludeMessages` default 2, `compaction.excludeContextWindowPercent` default 2). Compaction is "one-way" and not recoverable in-session. IDE 1.0 persists the summary as a session checkpoint in internal storage; CLI v3 writes a `tombstone` plus a record with `operationType:"Summary"` to `~/.kiro/sessions/<bucket>/sess_*/messages.jsonl`. No prompt or model setting is documented. Issue #11307 (open) reports the CLI v3 TUI renders the full summary as an ordinary `role:"model"` message with `isCompactionSummary: true` that nothing reads, and that replies after it freeze (filed separately as #11358).

Kiro Crew's `session-summary` module (`docs/system-specs/modules/session-summary.md`) is an off-by-default (`session_summary.enabled`) intent-level summary generated after a turn and shown in a chat side-panel "Summary" tab. It is stored as sidecar JSON `~/.kiro/crew/sessions/.intents/<key>.json` (and `.summaries/<key>.json`), never in the transcript, deleted with the session:

```json
{"sig": 1760000000.5, "gen": 3, "generated_at": 1760000123.1, "user_turns": 7,
 "last_activity": "2026-08-10T10:00:00+00:00", "intents": [...], "constraints": [...]}
```

`GET /api/chat/slots/{slot}/summary` returns `generated_at`, `last_activity`, `user_turns`, `stale`, `generate_state` and never triggers generation; `POST` generates on demand and returns `409` with `summary_disabled|summary_in_flight|summary_turn_running|summary_unavailable`. Staleness is `sig` (transcript mtime) or `gen` mismatch; the stale summary is still served. Model is `AgentConfig.resolve_model("background")`, which never inherits the interactive agent model; no fallback chain was found. The prompt is fixed in `dashboard/chat_summary.py` with a `{language}` slot. Generation skips unchanged transcripts, incognito sessions, running turns and in-flight passes; failures are swallowed and logged. A WebSocket `session_summary` event refreshes the panel; a `/session-dashboards` gallery lists up to 12 sessions per window. No hotkeys were found; the exact "last generated" UI string was not found. Memory keeps full daily history for 14 days, per-day summaries to day 60, then counts to day 180 (`history/{date}.md` in V1, `memory_history` table in V2). The session ledger (goal, phase, next step, rejected approaches) is re-injected after compaction and has no dashboard page. Apps were not examined.

Verified against the spec itself (`docs/system-specs/modules/session-summary.md`, read in full):

- **Config** (`session_summary` in `config.json`, clamped with a warning rather than raising): `enabled` (false), `min_user_turns` (2), `regenerate_after_turns` (1), `max_intents` (50), `max_constraints` (50), `assistant_excerpt_chars` (400). Enabled from Settings → Chat.
- **Input reduction:** only `role` and `content` are read; tool and error rows dropped; user messages capped at 4,000 chars, assistant messages head/tail excerpted; the transcript part of the prompt is capped at 40,000 chars (first 3 user turns plus newest turns, one `[... user turns A-B omitted ...]` line). Automation posted under `role: "user"` is flagged `injected` and excluded from turn counts.
- **Gating** returns a skip-reason string (`disabled`, `in_flight`, `running`, `memory_mode`, `stop_reason:<r>`, `too_few_turns`, `cadence`); only a clean `end_turn` qualifies. A forced (POST) pass lifts only `stop_reason` and `cadence`.
- **Freshness** requires both `sig` (transcript mtime) and `gen` (`rotation_generation`) to match; both are snapshotted by the caller before the model call, and the write is refused if either moved or if the session is no longer quiescent.
- **Display:** the Summary tab reads `GET .../summary` (never generates); `stale: true` still returns the stored payload. A `generate_state` field (`ready|too_few_turns|unavailable`) is computed server-side. Reconnect catch-up invalidates `['session-summary']`.
- **Redaction:** `normalize_payload()` runs `redact_credentials` and `redact_exfiltration_urls` recursively before the sidecar is written.
- **Readers:** the panel GET, the POST read-back and an MCP tool `session_summary` (`GET /api/session-control/summary`) share `chat_summary.read_cached_intent_summary`.
- **Scope:** only turns that run through `_run_chat` on a slot reach the automatic pass (dispatch site `_finish_queue_cycle`, `dashboard/chat_turn/queue_cycle.py`); Slack, other messaging channels, the task runner, cron, webhooks, workflows, subagents and `kirocrew chat` own separate turn loops and are excluded.
- **Tests:** `test_session_summary_{config,extract,storage,generate,api}.py` and `test_mcp_dashboard_session_summary.py`; storage tests pin that writing a summary leaves the transcript's bytes and mtime untouched; `test_session_summary_generate.py` asserts the prompt still names its known judgment traps and the `{language}` slot.

Subagent result return: Kiro subagents run with isolated history and "return findings to the main agent", which aggregates; they share steering, MCP servers, workspace access and permissions; pipelines are fixed DAGs. `kiro-team` agents are JSON configs with a per-agent `"model"` field (the example sets `claude-sonnet-4`); the documenter and validator are fixed-role single-purpose calls; up to 4 run in parallel with no resume.

### 25. Cross-tool comparison

| Aspect | Claude Code | Kiro | Kiro Crew | opencode |
|---|---|---|---|---|
| Summary storage | transcript JSONL; `compact_summary` in `PostCompact` | IDE internal checkpoint; CLI `messages.jsonl` Summary record | sidecar JSON; transcript untouched | `compaction` message in SQLite (`session_message`) |
| Originals after | remain in transcript | not recoverable in-session | untouched | history loads from the latest compaction; earlier rows remain in the DB |
| "Last generated" display | "Summarized conversation" marker (no timestamp documented) | context meter; summary as chat message | `generated_at`, `last_activity` stored and returned | compaction message has no timestamp field named in the schema; `time` fields exist on messages |
| Prompt customization | `/compact` text, rewind "add context", CLAUDE.md | none documented | fixed + `{language}` | fixed in core; `compaction` hook can supply the summary; `agents.title.system` for titles |
| Model | not documented for `/compact` | not documented | background role, never interactive | `compaction` agent model, else session model |
| UI | rewind menu with arrows, numbers, `Enter` | meter | side-panel tab, no hotkeys found | none for compaction in sources read |

Common storage patterns: transcript-embedded summary (Claude Code, Kiro, opencode), separate files (Claude Code workaround, `claude-sessions`, Kiro Crew sidecar, memory plugins), and session title or metadata (smart-title, goal plugin). Hotkeys for this feature are documented only for Claude Code's rewind menu; opencode `/btw` documents `c` and scroll keys.

### 26. The repo has no link to `~/.config/opencode/plugins` and no JS/TS toolchain

`links.json` is gitignored (`.gitignore:6`) and does not exist; the tracked `links.example.json:8-18` has one group `example` with `${home}/.config/some-tool/skills` → `${src}/skills` (type `symlink`). So `syncLinks` currently links nothing from `src/`. No symlinks exist inside `~/.config/opencode` or `~/.claude`; `~/.config/opencode/{agents,commands,skills}` do not exist; `~/.agents/skills` is a real directory.

`tools/syncLinks/sync.py` is generic: flags `--config`, `--group`, `--check`, `--dry-run` (`:240-259`); vars `self` and `home` (`:280-281`); `type` defaults to `symlink` (`:288-300`); `mode == "perFile"` → `ensure_perfile` (`:303-315`); missing target is skipped with a warning (`:132-134`); a non-empty real folder or file in the way is left alone (`:153-164`); an empty real folder is replaced (`:159-161,177-178`); Windows `junction` uses `mklink /J` (`:184-185`); exit 1 only when `--check` finds a link not in the desired state (`:322-325`). `tools/syncLinks/README.md` documents `vars` (`:28-31`), link fields `link/target/type/mode` (`:57-62`), `perFile` with `include`/`exclude` globs (`:64-77`), an `${home}/.config/opencode/skills` → `${src}/skills` example (`:89-93`), "undeclared links are ignored" (`:121`), "Add, move or remove a link by editing `links.json`" (`:123`), and that `src/skills/<category>` junctions belong to `linkSkills` (`:130-132`). Neither README discusses new artifact kinds, agents, commands or plugins. `tools/linkSkills/README.md` is skills-only (`:3,29-32`), reads `src/.agents/skills`, writes `src/skills/<category>/<name>`, and says opencode is configured by listing `src/skills/<category>` in `skills` (`:7,60`). The repo `AGENTS.md` says any added link must be declared in `links.json` and audited with `sync.py --check`.

`src/` layout:

```text
src/
├── .agents/skills/<14 skill folders>   # source of truth
├── .claude/ (CLAUDE.md, settings*.json, agents/, commands/, skills/ pointer files)
├── .opencode/agents/ (codebase-analyzer, codebase-locator, codebase-pattern-finder, research .md)
├── openspec/ (config.yaml, schemas/)
├── skills/{general,frontend}/          # generated symlinks, gitignored (.gitignore:3)
├── AGENTS.md
└── skills-lock.json
```

`src/.opencode/` contains only `agents/`; `README.md:15` and `tools/linkSkills/README.md:60` mention `src/.opencode/opencode.jsonc`, which does not exist. No `src/opencode-plugins/` exists and it is not mentioned in `README.md:9-27`, `AGENTS.md` or `src/AGENTS.md`. `~/.config/opencode/plugins/` is a real directory holding only `herdr-agent-state.js` (header `:1-5` says herdr manages it and to "add custom hooks/plugins beside this file").

Toolchain: no `tsconfig*`, no `*.ts`, no root `package.json`, test runner or lint config outside `node_modules`. The only JS is `tools/pipedream/notion-to-google-calendar/` (`package.json:1-13`, `"type": "module"`, script `dev: node server.js`, deps `@pipedream/sdk`, `dotenv`, `express`; `server.js` plain ESM; its `AGENTS.md:48-56` says "No test suite" and verifies via curl). Python tools use `argparse` and type hints with no tests. `tools/herdr-plugins/` is TOML/bash/mise (`mise.toml:1-14`, `startup/herdr-plugin.toml:1-26`, `startup/start.sh:1-24`, manual `mise run <task>` verification) and is not opencode-related. `~/.config/opencode/package.json:1-5` has one dependency; `.bin` has only `node-gyp-build*`, `node-which`, `uuid`, `yaml`; no `tsc`, no test script; its `.gitignore:1-5` ignores `node_modules`, `package.json`, lockfiles. `node`, `npm` (mise shims) and `bun` (`~/.bun/bin/bun`) are on PATH; `tsc` is not. Existing opencode plugin files are plain ESM JS: `plugins/herdr-agent-state.js` (imports `node:net`, named export `HerdrAgentStatePlugin` at `:135`, default export at `:220-224`); `herdr-tui-session.js:65-71`; `herdr-opencode/tui.js:5` re-export.

Other tracked content: root `.opencode/commands/` has 11 `opsx-*.md`; root `.opencode/skills/` has 11 `openspec-*`; `plugins/riptide-rpi-terminal/0.30.4/` is a vendored Claude Code plugin registered by `.claude-plugin/marketplace.json`, disabled in `src/.claude/settings.json:2-12`; `openspec/` and `src/openspec/` are manual copies.

#### Testing patterns

No test suite exists for JS in this repo or in `~/.config/opencode`; Python tools have no tests; Pipedream demo and herdr plugins are verified manually.

## Code References

### opencode V2 source (cloned at `e5f2dde`, repo `anomalyco/opencode`; key files, others exist)
- `packages/plugin/src/promise/session.ts:13-69,196-221` — session hook event shapes, `ctx.session` method list
- `packages/plugin/src/promise/plugin.ts:36-37`, `promise/model.ts:25-28`, `promise/event.ts`, `plugin/src/storage.ts`, `plugin/src/options.ts` — generate, model, event, storage, options APIs
- `packages/plugin/src/tui/context.ts:191-202`, `tui/plugin.ts` — TUI context, `SlotMap`, `Plugin.define`
- `packages/core/src/plugin/module.ts:84-164`, `source-directory.ts:6`, `host.ts:171-191,658-680` — plugin loading, entrypoints, hook filtering, storage namespace
- `packages/core/src/session/compaction.ts:59-289,433-504,869-921` — compaction prompt, model, events
- `packages/core/src/session/title.ts:20-153`, `generate.ts:25-68`, `context.ts:94-124`, `runner/model.ts:21-99` — title, generate, model resolution
- `packages/core/src/model.ts:289-362`, `model-resolver.ts:506-519`, `config.ts:140-299`, `config/variable.ts:25-81`, `config/normalize.ts` — model list/default/parse, config decode, variable substitution
- `packages/core/src/session/sql.ts`, `kv/sql.ts`, `event/sql.ts`, `session/projector.ts` — SQLite schema and projections
- `packages/protocol/src/groups/{message,session,model,provider,generate,config}.ts` — HTTP endpoint definitions
- `packages/schema/src/{session,session-message,session-event,session-metadata,model,provider}.ts`, `schema/src/config/{compaction,model,plugin,agent,command}.ts` — types
- `packages/tui/src/feature-plugins/prompt/btw.tsx`, `tui/src/plugin/{builtins,discovery,api,structure}.ts(x)`, `tui/src/ui/{dialog,toast}.tsx`, `tui/src/component/{dialog-open,dialog-stash}.tsx`, `tui/src/util/locale.ts`, `tui/src/routes/session/index.tsx:2540-2560` — `/btw`, plugin host, dialogs, timestamps
- `packages/theme/src/tui/{schema,types}.ts`, `packages/tui/src/theme/{discovery.ts,assets/v2/opencode.json}` — theming
- `services/www/src/docs/content/{compaction,config,agents,commands}.mdx`, `build/plugins/migrate-v1.mdx` — in-repo docs

### Docs
- https://opencode.ai/docs/plugins/ (V1), https://opencode.ai/v2/docs/plugins/, `/v2/docs/build/plugins/server/`, `/v2/docs/build/plugins/migrate-v1/`, `/v2/docs/cli/plugins/`, `/v2/docs/cli/keybinds/`, `/v2/docs/cli/config/`, `/v2/docs/themes/`, `/v2/docs/commands/`

### Local machine (`~/.config/opencode`; exhaustive for the config dir listing researched)
- `opencode.jsonc`, `tui.json`, `tui.jsonc`, `cli.json`, `package.json`, `.gitignore`
- `plugins/herdr-agent-state.js:93-105,135,220-224`, `herdr-tui-session.js:65-71`, `herdr-opencode/tui.js:5`
- `service.json` exists and contains a credential (not reproduced)

### Prior-art repos (source read on GitHub)
- https://github.com/joshuadavidthomas/opencode-handoff — `src/{plugin,tools,rpc,tui}.ts(x)`, `CHANGELOG.md`
- https://github.com/Tarquinen/opencode-smart-title — `index.ts`, `lib/{model-selector,config,logger}.ts`, `prompt.ts`
- https://github.com/luchasarie/bro-skill — `SKILL.md`, `install.sh`
- https://github.com/slkiser/opencode-quota — `src/plugin.ts`, `src/tui/{index.tsx,toasts.ts}`, `src/core/persist.ts`, `docs/readme/configuration.md`
- https://github.com/willytop8/OpenCode-goal-plugin — `src/{goal-plugin,v2-bridge,persistence-lease}.js`
- https://github.com/aihaipeng/opencode-dir-tree-tui, https://github.com/aihaipeng/opencode-skills-tui — `src/tui.tsx`, components, `scripts/build.ts`
- https://github.com/awesome-opencode/awesome-opencode (`data/plugins/`), `opencode-agent-memory`, `opencode-claude-memory`, `opencode-short-term-memory`, `opencode-plugin-simple-memory`, `opencode-magic-context`, `deja-vu`
- https://github.com/anomalyco/opencode/issues/21760; https://github.com/entireio/cli — `cmd/entire/cli/{setup.go,settings/settings.go,explain_summary_provider.go,summarize/*,agent/opencode/generate.go}`

### Other harnesses
- https://code.claude.com/docs/en/{commands,context-window,checkpointing,hooks}.md; https://github.com/anthropics/claude-code/issues/6907; https://github.com/iannuttall/claude-sessions
- https://kiro.dev/docs/compaction.md, `/docs/ide/whats-new-v1/compaction.md`, `/docs/reference/slash-commands.md`, `/docs/custom-agents/subagents.md`; https://github.com/kirodotdev/Kiro/issues/11307
- https://github.com/kirodotdev/KiroCrew — `docs/system-specs/modules/{session-summary,memory-skills-hooks}.md`, `src/kiro_crew/docs/session-ledger.md`; https://github.com/requix/kiro-team

### This repo (exhaustive for linking/tooling files named)
- `links.example.json:8-18`, `.gitignore:3,6`, `tools/syncLinks/{README.md,sync.py}`, `tools/linkSkills/README.md`, `AGENTS.md`, `README.md:9-27,46-52`
- `src/.opencode/agents/{research,codebase-locator,...}.md`, `src/skills/`, `src/.agents/skills/`
- `tools/pipedream/notion-to-google-calendar/{package.json,server.js,AGENTS.md}`, `tools/herdr-plugins/{mise.toml,startup/*}`

## Architecture Documentation

opencode V2 is organized as a durable event-sourced session store (SQLite, projected from `session.*` events) behind an HTTP API, with plugins that extend the server (`ctx.*` domains with `transform` and `hook`) and the terminal client (`context.*` with keymap, ui, data, storage). Server and TUI parts of one package are separate entry points that can share a typed RPC contract. Server plugins mutate behavior through single mutable hook events; TUI plugins add commands through keymap layers that register slash names, palette entries and keybinds together, and render through slots and dialogs. Built-in features such as `/btw` are TUI plugins built from the same primitives, with a few internal layout components.

Conversation data is stored as typed messages with inline parts; compaction replaces the active context by writing a `compaction` message with a pointer to the kept tail, leaving earlier rows in place. Work outside the conversation uses one of three call paths (no-session generate, session-context generate, child session) that differ in what they write. Per-plugin persistence is either global key-value (`ctx.storage`), free-form session `metadata`, or plugin-owned files; prior-art plugins use all three, plus session titles.

Configuration follows layered precedence with silent dropping of unknown keys and text-level `{env:}`/`{file:}` substitution; plugin-specific options travel in the plugin tuple (`ctx.options`) or in plugin-owned config files.

The machine's config directory is hybrid V1/V2. The repo around it is a collection of configuration, markdown skills and Python link tools; it has no TypeScript tooling and no path that links repo content to `~/.config/opencode/plugins`, so linking is purely declarative through the gitignored `links.json`.

## Open Questions

1. Does `ctx.session` in V2 expose a method that lists messages, or is `@opencode/client` the only route from a plugin?
2. Does `ctx.session.generate` record usage against the session (cost), as compaction does with `session.usage.recorded`?
3. Does `ctx.experimental.generate.text` bill or record usage anywhere, and which provider auth does it use?
4. How does V2 order config-listed plugins against directory-discovered plugins at load?
5. Does V2 install `~/.config/opencode/package.json` dependencies at startup for local plugins?
6. Which durable events reach plugin `ctx.event.subscribe` and TUI `data.on` subscribers (the public set)?
7. What do `opencode-kiro` and the TUI-side `Plugins` built-in do with plugin options and entrypoint listing?
8. Where is `SessionTitle.generate` called from, and under what conditions?
9. Can a V2 plugin read the session's `time` fields for the latest compaction message through any public API, and what are the `time` fields on a `compaction` message?
10. Which model does Claude Code use for `/compact`, and which transcript record holds the summary?
11. What is the exact "last generated" text in Kiro Crew's Summary tab, and what do its Apps store?
12. How is the V2 `cli.json` `keybinds` schema validated for plugin-defined command ids (for example, is an unknown id rejected)?
