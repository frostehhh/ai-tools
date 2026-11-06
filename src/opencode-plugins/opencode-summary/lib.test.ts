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
