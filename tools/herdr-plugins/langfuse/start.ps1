param()

$ErrorActionPreference = 'Stop'

$herdr = if ($env:HERDR_BIN_PATH) { $env:HERDR_BIN_PATH } else { 'herdr' }

mise run langfuse
$code = $LASTEXITCODE

if ($code -eq 0) {
    & $herdr notification show 'Langfuse is up' --body 'Web UI: http://localhost:3000' --sound done | Out-Null
} else {
    & $herdr notification show 'Langfuse failed to start' --body "mise run langfuse exited with code $code" --sound request | Out-Null
}

exit $code
