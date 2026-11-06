# Task

Create an opencode plugin that summarizes a conversation on demand.

## Requirements

1. **Summarize on prompt.** Generate a summary of a conversation when the user asks for it.
2. **View summary.** User can view a conversation's summary.
3. **UI indicator.** Show an indicator describing when the summary was generated.
4. **Configurable prompt.** User can configure the prompt used for summarization.
5. **Default prompt.** Plugin provides a default summarization prompt.
6. **Configurable model.** User can configure a preferred model.
   - Use the preferred model when it is available.
   - Otherwise fall back to the current model of the conversation.
7. **`/summary` command.** Add a `/summary` command that opens a modal.
   - Modal is similar to the one opencode's `/btw` command shows after a response is generated.
   - Modal must show when the summary was last generated.
   - Modal supports hotkeys to:
     - Generate the summary.
     - View the summarization prompt.
     - Edit the summarization prompt.
     - See the summary plugin options.
8. **Location.** Plugin source lives at `src/opencode-plugins/opencode-summary`.
