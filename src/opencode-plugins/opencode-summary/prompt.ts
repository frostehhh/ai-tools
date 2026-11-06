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
