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
