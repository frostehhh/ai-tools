import { Plugin } from "@opencode/plugin/tui"
import { SyntaxStyle, TextAttributes, type ScrollBoxRenderable, type TextareaRenderable } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { spawn } from "node:child_process"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import * as lib from "./lib"
import { DEFAULT_PROMPT, GUARD } from "./prompt"

const INSET = 3
const paths = lib.promptPaths(import.meta.url)
type Mode = "summary" | "prompt" | "edit"

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
      const record = lib.readSummary(await readMetadata(sessionID))
      if (!record) return undefined
      const check: lib.ValidityCheck = await client.session.message
        .get({ sessionID, messageID: record.lastMessageID })
        .then(
          () => ({ found: true }) as const,
          (error: unknown) => ({ found: false, notFound: lib.isMessageNotFound(error) }) as const,
        )
      if (lib.validityAction(check) === "keep") return record
      await writeSummary(sessionID, undefined)
      return undefined
    }

    async function blocked(sessionID: string): Promise<lib.BlockReason | undefined> {
      return lib.blockReason({
        status: context.data.session.status(sessionID),
        inFlight: inFlight(sessionID),
      })
    }

    const [tick, setTick] = createSignal(0)
    let pending: ReturnType<typeof setTimeout> | undefined
    const bump = () => {
      clearTimeout(pending)
      pending = setTimeout(() => setTick((n) => n + 1), 150)
    }
    const stops = (
      [
        "session.inbox.delivered",
        "session.metadata.updated",
        "session.revert.committed",
        "session.revert.staged",
        "session.revert.cleared",
        "session.execution.started",
        "session.execution.succeeded",
        "session.execution.failed",
        "session.execution.interrupted",
      ] as const
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

    async function readOverride(): Promise<string | undefined> {
      return readFile(paths.override, "utf8").catch((error: NodeJS.ErrnoException) =>
        error.code === "ENOENT" ? undefined : Promise.reject(error),
      )
    }
    const loadPrompt = async () => lib.resolvePrompt(await readOverride())

    async function applyEdited(edited: string, previous: string | undefined): Promise<void> {
      switch (lib.saveAction(edited)) {
        case "noop":
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

    async function editWithEditor(sessionID: string, editor: string): Promise<void> {
      const previous = await readOverride()
      await mkdir(path.dirname(paths.override), { recursive: true })
      if (previous === undefined) await writeFile(paths.override, (await loadPrompt()).text + "\n")
      await context.renderer.suspend()
      try {
        await spawnEditor(editor, paths.override)
      } catch (cause) {
        toastError(cause)
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

    /** Returns true when a new record was written. */
    async function generate(sessionID: string): Promise<boolean> {
      const prompt = (await loadPrompt()).text
      const [info, page] = await Promise.all([
        client.session.get({ sessionID }),
        client.message.list({ sessionID, order: "desc", limit: lib.TURN_LIMIT }),
      ])
      // A staged revert hides messages from revert.messageID on; cap lastMessageID at the boundary.
      const lastMessageID = lib.lastVisibleID(page.data.map((message) => message.id), info.revert?.messageID)
      if (!lastMessageID) {
        ui.toast.show({ variant: "warning", message: "Nothing to summarize yet" })
        return false
      }
      // No abort signal on session.generate: race a timeout so a hung call cannot keep the session "in flight" forever.
      let timer: ReturnType<typeof setTimeout> | undefined
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Summary timed out")), lib.GENERATE_TIMEOUT_MS)
      })
      const result = await Promise.race([client.session.generate({ sessionID, prompt: lib.buildRequest(prompt) }), timeout])
        .catch((cause: unknown) => (toastError(cause), undefined))
        .finally(() => clearTimeout(timer))
      if (!result) return false
      if (lib.isBlank(result.text)) {
        ui.toast.show({ variant: "error", message: "Summary came back empty" })
        return false
      }
      await writeSummary(sessionID, {
        text: result.text.trim(),
        generatedAt: Date.now(),
        promptId: lib.promptId(prompt),
        lastMessageID,
      })
      return true
    }

    async function startGenerate(sessionID: string): Promise<void> {
      const reason = await blocked(sessionID)
      if (reason) return void ui.toast.show({ variant: "warning", message: lib.blockMessage(reason) })
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

    function Hints(props: { items: [title: string, key: string][] }) {
      return (
        <box flexDirection="row" gap={2}>
          <For each={props.items}>{([title, key]) => <text fg={theme().text.muted}>{`${title} ${key}`}</text>}</For>
        </box>
      )
    }

    function PromptEditor(props: { initial: string; height: number; onDone: (saved: boolean) => void }) {
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
      onMount(() => setTimeout(() => textarea && !textarea.isDestroyed && textarea.focus(), 1))
      return (
        <box gap={1}>
          <text fg={theme().text.muted}>{`fixed: ${GUARD}`}</text>
          <textarea
            ref={(element: TextareaRenderable) => ((textarea = element), setTarget(element))}
            initialValue={props.initial}
            height={props.height}
            wrapMode="word"
            textColor={theme().text.formfield.base}
            focusedTextColor={theme().text.formfield.base}
            cursorColor={theme().text.base}
          />
          <Hints items={[["save", "ctrl+s"], ["cancel", "esc"]]} />
        </box>
      )
    }

    function SummaryDialog(props: { sessionID: string; mode: Mode }) {
      const dimensions = useTerminalDimensions()
      const maxHeight = createMemo(() => Math.max(8, Math.floor(dimensions().height * 0.6)))
      const [mode, setMode] = createSignal<Mode>(props.mode)
      const [view] = createResource(() => [props.sessionID, tick()] as const, ([id]) => loadView(id).catch(toastError))
      const [reason] = createResource(() => [props.sessionID, tick()] as const, ([id]) => blocked(id).catch(() => undefined))
      const [prompt, { refetch: refetchPrompt }] = createResource(() => [mode(), tick()] as const, () => loadPrompt())
      const record = () => view()?.record
      const busy = () => inFlight(props.sessionID)
      const stale = () => view() && prompt() && view()!.record.promptId !== lib.promptId(prompt()!.text)
      let scroll: ScrollBoxRenderable | undefined

      const run = () => void startGenerate(props.sessionID)
      const copy = () => {
        const text = record()?.text
        if (!text) return
        if (!context.renderer.copyToClipboardOSC52(text))
          ui.toast.show({ variant: "warning", message: "Copy not supported by this terminal" })
        else ui.toast.show({ variant: "success", message: "Summary copied" })
      }
      const edit = () => {
        const editor = externalEditor()
        if (editor) void editWithEditor(props.sessionID, editor).catch(toastError)
        else setMode("edit")
      }

      context.keymap.layer(() => ({
        mode: "modal",
        enabled: mode() !== "edit",
        commands: [
          { bind: "g", title: "Generate summary", group: "Dialog", run },
          { bind: "v", title: "Toggle prompt view", group: "Dialog", run: () => setMode((m) => (m === "summary" ? "prompt" : "summary")) },
        ],
      }))
      context.keymap.layer(() => ({
        mode: "modal",
        enabled: mode() === "summary",
        commands: [{ bind: "c", title: "Copy summary", group: "Dialog", run: copy }],
      }))
      context.keymap.layer(() => ({
        mode: "modal",
        enabled: mode() === "prompt",
        commands: [
          { bind: "e", title: "Edit prompt", group: "Dialog", run: edit },
          { bind: "r", title: "Reset prompt", group: "Dialog", run: () => void resetPrompt(props.sessionID).catch(toastError) },
        ],
      }))

      useKeyboard((event) => {
        if (!scroll || mode() === "edit") return
        if (event.name === "up" || event.name === "k") return scroll.scrollBy(-1)
        if (event.name === "down" || event.name === "j") return scroll.scrollBy(1)
        if (event.name === "pageup") return scroll.scrollBy(-maxHeight())
        if (event.name === "pagedown") return scroll.scrollBy(maxHeight())
        if (event.name === "home") return scroll.scrollTo(0)
        if (event.name === "end") return scroll.scrollTo(scroll.scrollHeight)
      })

      const summaryBody = () => (
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
      )

      return (
        <box paddingLeft={INSET} paddingRight={INSET} paddingBottom={1} gap={1}>
          <box flexDirection="row" justifyContent="space-between">
            <text attributes={TextAttributes.BOLD} fg={theme().text.base}>/summary</text>
            <text fg={theme().text.muted}>esc</text>
          </box>
          <text fg={theme().text.muted}>
            {busy() ? "Generating…" : view() ? lib.generatedLine(view()!.record, Date.now(), view()!.turns) : "No summary yet - press g to generate"}
          </text>
          <Show when={mode() === "edit"}>
            <PromptEditor
              initial={prompt()?.text ?? DEFAULT_PROMPT}
              height={Math.max(6, maxHeight() - 4)}
              onDone={(saved) => {
                setMode("prompt")
                if (saved) void refetchPrompt()
              }}
            />
          </Show>
          <Show when={mode() === "prompt"}>
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
          <Show when={mode() === "summary"}>{summaryBody()}</Show>
          <Show when={mode() === "summary" && stale()}>
            <text fg={theme().text.muted}>Generated with a different prompt</text>
          </Show>
          <Show when={mode() !== "edit"}>
            <Hints
              items={[
                [reason() ? `generate (${reason()})` : "generate", "g"],
                [mode() === "summary" ? "prompt" : "summary", "v"],
                ...(mode() === "prompt" ? ([["edit", "e"], ["reset", "r"]] as [string, string][]) : []),
                ...(mode() === "summary" ? ([["copy", "c"]] as [string, string][]) : []),
                ["scroll", "j/k"],
              ]}
            />
          </Show>
        </box>
      )
    }

    function openModal(sessionID: string, mode: Mode = "summary") {
      setModalFor(sessionID)
      ui.dialog.show(() => <SummaryDialog sessionID={sessionID} mode={mode} />, () => setModalFor(undefined))
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
              group: "Summary",
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

    return () => {
      clearTimeout(pending)
      stops.forEach((stop) => stop())
      void context.renderer.idle().then(() => syntax.destroy())
    }
  },
})
