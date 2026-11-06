# Initial References and Information

- `openspec/changes/create-opencode-summary-plugin/task.md`: task description.

## Prior art (found via web search; search snippets only, repos not yet read)

### opencode
| Reference | Why relevant |
|---|---|
| [opencode plugin docs](https://opencode.ai/docs/plugins/) | Plugin shape, events, `experimental.session.compacting` hook (replaces compaction prompt). |
| [opencode-handoff](https://github.com/joshuadavidthomas/opencode-handoff) | On-demand LLM-generated prompt, opens new session with editable draft. |
| [opencode-smart-title](https://github.com/Tarquinen/opencode-smart-title) | Background LLM call to title sessions. |
| [bro](https://github.com/luchasarie/bro-skill) | Re-explains last reply; close to `/btw` behavior. |
| [opencode-quota](https://github.com/slkiser/opencode-quota) | Slash commands plus toasts. |
| [Goal Plugin](https://github.com/willytop8/OpenCode-goal-plugin) | Session-level `/goal` command, per-session state. |
| [opencode-dir-tree-tui](https://github.com/aihaipeng/opencode-dir-tree-tui), [opencode-skills-tui](https://github.com/aihaipeng/opencode-skills-tui) | TUI plugins: sidebar and preview UI. |
| [Agent Sessions](https://github.com/jazzyalex/agent-sessions) | Local session-history browser. |
| [opencode issue #21760](https://github.com/anomalyco/opencode/issues/21760) | Feature request: summarize a session into a new session. |
| [awesome-opencode](https://github.com/awesome-opencode/awesome-opencode) | Index of plugins; look for other summary/memory plugins. |
| [entireio/cli](https://entire.io/gh/entireio/cli/session/01a08c9c-b514-7fc3-b4be-9e0a0ab2e28b/) | Opencode as summary provider; `--summarize-model` flag. |
| [oc-sessions (VS Code)](https://marketplace.visualstudio.com/items?itemName=zhaoxiuwei.oc-sessions) | Session summarize feature in an editor extension. |

### Claude Code
| Reference | Why relevant |
|---|---|
| `/compact`, "Summarize from here / up to here" | Built-in range summaries with optional focus text; replaces history. |
| [claude-sessions](https://github.com/iannuttall/claude-sessions) | Slash commands for session continuity. |
| [claude-code issue #6907](https://github.com/anthropics/claude-code/issues/6907) | Hook script + `claude -p` to write summary file. |

### Kiro
| Reference | Why relevant |
|---|---|
| [Kiro compaction docs](https://kiro.dev/docs/compaction/) | Auto/manual summarization behavior. |
| [Kiro slash commands](https://kiro.dev/docs/reference/slash-commands/) | `/compact`, `/chat save`. |
| [Kiro issue #11307](https://github.com/kirodotdev/Kiro/issues/11307) | How the summary is rendered in chat. |
| [Kiro Crew](https://github.com/kirodotdev/KiroCrew) | Separate tool on top of Kiro CLI. Memory, lessons, subagents, Apps with custom UI. |
| [requix/kiro-team](https://github.com/requix/kiro-team) | Multi-agent orchestration inside Kiro CLI. |

# Initial Research

- No existing summary or plugin code in this repo. `grep btw` finds only `task.md`.
- Repo has `src/.opencode/agents/` (4 agent md files). `.opencode/` has `commands/` and `skills/` only.
- User-level opencode config exists at `~/.config/opencode/`: `opencode.jsonc`, `tui.json`, `tui.jsonc`, `plugins/`, `package.json`, `herdr-tui-session.js`, `herdr-opencode/`.
- `tools/herdr-plugins/` holds local Herdr plugins (separate from opencode plugins).

# Research Questions

Questions that will steer code exploration and research

## opencode plugin system
1. How does opencode load plugins? Cover locations (`~/.config/opencode/plugins/`, project `.opencode/plugins/`, npm packages in config), file format, entry-point export shape, and load order.
2. What does the plugin context object expose (client SDK, project, directory, worktree, `$` shell)? What hooks and events can a plugin subscribe to?
3. How do plugins register slash commands, custom tools, or TUI commands? Compare the `command` config, plugin hooks, and TUI plugin APIs.
4. What is the difference between server plugins and TUI plugins (`tui.json` / `tui.jsonc`)? Which can render UI?
5. How are existing plugins in `~/.config/opencode/plugins/` and `~/.config/opencode/herdr-tui-session.js` structured? What patterns do they use for hooks, state, and TUI integration?
6. How does a plugin declare dependencies (`package.json` in the config dir), and how are they installed?

## `/btw` modal
7. How does opencode implement the `/btw` command? Where is it defined (source path, docs), and what triggers the modal after a response?
8. What dialog/modal primitives does the opencode TUI provide (e.g. `DialogSelect`, `DialogPrompt`, custom dialogs)? How are they opened, closed, and sized?
9. How does the `/btw` modal handle keybindings and hotkey hints? How are keybinds declared and customized in `tui.json`?
10. Can a plugin open TUI dialogs or only core code? What is the public API surface for this?

## Sessions, messages, and summarization
11. How does the opencode SDK/server expose a session's messages and parts? Which endpoints and types return the full conversation?
12. What does opencode's built-in session summarize/compaction feature do? Cover the endpoint, the prompt used, the model chosen, and where the result is stored.
13. How can a plugin make an LLM call outside the active conversation (e.g. create a child session, `session.prompt` with a `model` override, or `noReply`)? What side effects does each have on session history, cost, and UI?
14. How do hooks such as `chat.message`, `chat.params`, and `event` expose the active session's current model (provider ID and model ID)?

## Models and configuration
15. How are providers and models listed and checked for availability (`config.providers`, `/config/providers`, `opencode models`)? How is a `provider/model` string parsed and validated?
16. How does opencode resolve the "current model" of a session (last user message model, agent model, default `model` in config)?
17. Where and how can plugins read user options? Compare plugin tuple options in `opencode.jsonc` (`["plugin", { ... }]`), custom config keys, and standalone files. What is the config schema/validation behavior?
18. Where are prompts customized today (agents md files, commands md files, `prompt` fields in config)? How are file-path prompt references (`{file:...}`) resolved?

## Persistence and state
19. Where does opencode store session data (storage dir, SQLite, JSON files)? Does it provide a plugin-scoped storage API?
20. Can session metadata or parts be attached to a session and read back later (e.g. custom part types, session `title`/`summary` fields)? How does the existing `summary` field on sessions work?
21. Which session lifecycle events exist (created, updated, deleted, compacted)? What happens to session-related data on session deletion and forking?

## UI indicators
22. What UI surfaces can a plugin affect: sidebar, footer/status line, session header, toasts (`tui.showToast`), prompt area? How do the herdr plugin and existing TUI plugins add indicators?
23. How does the TUI format and refresh relative timestamps, if at all?

## Design system and theming
24. What theming system does the opencode TUI use (theme JSON files, color tokens such as `primary`, `text`, `border`, `background`)? What are the default theme hex values?
25. What layout, spacing, border, and typography conventions do TUI dialogs follow (OpenTUI/Solid components, box borders, padding)?

## Prior art in other plugins and harnesses
29. In `opencode-handoff`, how does it generate its prompt (which SDK calls, which model, child session or not)? How does it open the result in the TUI as an editable draft? What commands and config does it expose?
30. In `opencode-smart-title`, how does it make its background LLM call? How does it choose the model, handle failures, and avoid polluting session history? What config options does it expose?
31. In `bro`, how does it re-explain the last reply? Is it a skill, command, or plugin? Where does the output appear, and how does that compare to `/btw`?
32. In `opencode-quota`, `Goal Plugin`, and similar plugins, how do slash commands, toasts, and per-session state work? Where is state stored?
33. In `opencode-dir-tree-tui` and `opencode-skills-tui`, how do TUI plugins register sidebar panels, previews, keybinds, and dialogs? What does their `tui.json` setup look like?
34. How do other opencode plugins listed in `awesome-opencode` (memory, context, session-browser categories) store and display per-session data such as summaries, notes, or timestamps?
35. In `opencode issue #21760` and `entireio/cli`, what approach to session summarization is described or implemented, including model selection (`--summarize-model`) and fallback?
36. How does Claude Code's `/compact` and "Summarize from here / up to here" work: custom instructions, focus text, range selection, where the summary is stored, and whether originals remain? How do `claude-sessions` and the `#6907` hook approach save summaries?
37. How do Kiro's `/compact` and auto-compaction work, and how is the summary displayed (see Kiro issue #11307)? Can the summarization prompt or model be configured?
38. In Kiro Crew, how do memory, lessons, subagents, and Apps (agents, skills, schedules, custom UI) store and present per-session or per-project summaries? Is there any viewable, timestamped summary?
39. What do `kiro-team` and Kiro Crew's subagents do to return results to a parent conversation, and which parts could serve as an example for separate model calls?
40. Across these tools, what common patterns exist for: summary storage location, "last generated" display, prompt customization, preferred-model selection with fallback, and modal or panel UI with hotkeys?

## Repo conventions
41. How is config in `src/` linked to `~/.config/opencode/` and other consumers (`links.json`, `tools/syncLinks/README.md`)? What links exist today for `src/` content (e.g. `src/.opencode/agents`)? How would a directory like `src/opencode-plugins/` relate to `links.json` and `~/.config/opencode/plugins/`?
42. What do `tools/syncLinks/README.md` and `tools/linkSkills/README.md` say about adding new kinds of artifacts?
43. What testing, typing, or build conventions exist for TypeScript/JavaScript in this repo and in `~/.config/opencode/` (`package.json`, `tsconfig`, test runner)?
