import { Plugin } from "@opencode/plugin/tui"
import { SyntaxStyle, TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { createMemo, createResource, createSignal, For, onCleanup, Show } from "solid-js"
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

    /** Returns true when a new record was written. */
    async function generate(sessionID: string): Promise<boolean> {
      const prompt = DEFAULT_PROMPT
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

    function SummaryDialog(props: { sessionID: string }) {
      const dimensions = useTerminalDimensions()
      const maxHeight = createMemo(() => Math.max(8, Math.floor(dimensions().height * 0.6)))
      const [view] = createResource(() => [props.sessionID, tick()] as const, ([id]) => loadView(id).catch(toastError))
      const [reason] = createResource(() => [props.sessionID, tick()] as const, ([id]) => blocked(id).catch(() => undefined))
      const record = () => view()?.record
      const busy = () => inFlight(props.sessionID)
      let scroll: ScrollBoxRenderable | undefined

      const run = () => void startGenerate(props.sessionID)
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
          { bind: "g", title: "Generate summary", group: "Dialog", run },
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
            {busy() ? "Generating…" : view() ? lib.generatedLine(view()!.record, Date.now(), view()!.turns) : "No summary yet - press g to generate"}
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
          <Hints items={[[reason() ? `generate (${reason()})` : "generate", "g"], ["copy", "c"], ["scroll", "j/k ↑/↓"]]} />
        </box>
      )
    }

    function openModal(sessionID: string) {
      setModalFor(sessionID)
      ui.dialog.show(() => <SummaryDialog sessionID={sessionID} />, () => setModalFor(undefined))
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

    return () => {
      clearTimeout(pending)
      stops.forEach((stop) => stop())
      void context.renderer.idle().then(() => syntax.destroy())
    }
  },
})
