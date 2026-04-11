# Claude Tools

A repository for common Claude and Claude Code commands and utilities

## Directory Structure

### `.claude/`
Configuration directory for Claude Code containing:
- `commands/` - Custom slash commands and workflows
- `settings.local.json` - Local project settings

### `CLAUDE.md`
Recommended user-level instructions that Claude Code reads automatically. Defines:
- Interaction style (concise, grammar-sacrificing communication)
- Diagram preferences (MermaidJS)
- Planning requirements (list unresolved questions)

Global user instructions can also be placed at `~/.claude/CLAUDE.md`
