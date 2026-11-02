#!/usr/bin/env bash
set -euo pipefail

herdr_bin="${HERDR_BIN_PATH:-herdr}"

if [ -z "${LANGFUSE_DIR:-}" ]; then
    echo "Error: LANGFUSE_DIR is not set. Set it globally before running this plugin." >&2
    exit 1
fi

# Run from plugin directory so mise finds mise.toml
plugin_dir="$(cd "$(dirname "$0")" && pwd)"
cd "$plugin_dir"

mise run langfuse
code=$?

if [ "$code" -eq 0 ]; then
    "$herdr_bin" notification show 'Langfuse is up' --body 'Web UI: http://localhost:3000' --sound done >/dev/null 2>&1 || true
else
    "$herdr_bin" notification show 'Langfuse failed to start' --body "mise run langfuse exited with code $code" --sound request >/dev/null 2>&1 || true
fi

exit "$code"
