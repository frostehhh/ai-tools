# AGENTS.md

## Conventions

- Keep guidance concise — this file is loaded into context on every turn.
- Prefer pointing to skills for detailed, on-demand reference material.
- In all interactions and commit messages, be extremely concise and sacrifice grammar for the sake of concision.
- If you have questions for the user, use the **ask-user tool** (`question` in opencode).
- Minimize writing any inline comments in code. If the code is simple, readable and concise, that is good enough and there is no need to write inline comments for this.

## Delegation & Subagent Policy

- **Always prefer subagents**: For any side tasks, large codebase explorations, multi-file searches (e.g., `grep`/finding references across multiple files), or deep research, you must spawn an isolated subagent via the subagent tool (`Agent` in Kiro, `task` in opencode) rather than cluttering the main conversation context.
- **Scope of delegation**: 
  - Use **read-only / explore subagents** for code research, dependency tracing, and codebase reconnaissance.
  - Use **general-purpose subagents** when executing isolated, multi-step implementation tracks.
- **Keep main context clean**: Only bring summaries, final answers, or actionable resolution steps back into the primary session window.

## Writing Diagrams

If you need to show a diagram, ALWAYS use MermaidJS.