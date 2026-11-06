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
