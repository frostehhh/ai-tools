# Startup Plugin

This Herdr plugin starts all background services when Herdr launches. It uses mise tasks with the `startup` task as the entrypoint to define a dependency chain so services start in the correct order.

## Architecture

### Files

| File | Purpose |
|------|---------|
| `herdr-plugin.toml` | Herdr plugin manifest. Defines startup commands and actions. |
| `start.ps1` | Windows startup script. Runs `mise run startup` from the plugin directory. |
| `start.sh` | macOS startup script. Runs `mise run startup` from the plugin directory. |
| `../mise.toml` | Mise task definitions (one directory up). Defines `docker-desktop`, `langfuse`, and `startup` tasks. |

## How to add a new background service

### 1. Add the service as a mise task

Edit `../mise.toml` (the mise config one directory above this one):

```toml
[tasks.my-service]
description = "Launch my background service"
depends = ["docker-desktop"]  # if it needs docker
# depends = ["langfuse"]      # if it needs langfuse first
# depends = ["docker-desktop", "langfuse"]  # multiple dependencies
dir = "/path/to/service"
run = "docker compose up -d"
```

### 2. Add it to the startup chain

Update the `startup` task in `../mise.toml`:

```toml
[tasks.startup]
description = "Start all background services"
depends = ["langfuse", "my-service"]
run = "echo 'Background services started'"
```

### 3. Use environment variables for paths (recommended)

Instead of hardcoding paths, use an env var:

```toml
[tasks.my-service]
description = "Launch my background service"
depends = ["docker-desktop"]
dir = "{{ env.MY_SERVICE_DIR }}"
run = "docker compose up -d"
```

Then set it globally in your shell profile:

```bash
# ~/.zshrc or ~/.bash_profile
export MY_SERVICE_DIR="/path/to/service"
```

### 4. Test it

```bash
# From the plugin directory
cd tools/herdr-plugins
mise run my-service

# Or test the full chain
mise run startup
```

## Important conventions

- **Always run from the plugin directory.** Both `start.ps1` and `start.sh` change to the plugin directory before calling `mise run startup`. This ensures mise finds `../mise.toml`.
- **Use `depends` for ordering.** If service B needs service A, declare it in the task definition, not in scripts.
- **Validate env vars.** If a task needs an env var, validate it exists (the scripts already do this for `LANGFUSE_DIR`).
- **Notifications.** The scripts send Herdr notifications on success/failure. Update the message if you change what services run.

## Platform-specific notes

- **macOS:** `start.sh` is used. Bash is available at `/bin/bash`.
- **Windows:** `start.ps1` is used. PowerShell (`pwsh`) must be installed.
- Both scripts call the same `mise run startup` command. Platform differences are handled by mise task definitions, not by the scripts.

## Environment variables used

| Variable | Required | Description |
|----------|----------|-------------|
| `LANGFUSE_DIR` | Yes | Path to your local Langfuse checkout |
| `HERDR_BIN_PATH` | No | Path to `herdr` binary. Defaults to `herdr` in PATH. |
