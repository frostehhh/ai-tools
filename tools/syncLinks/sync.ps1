<#
.SYNOPSIS
  Create / repair / audit the links listed in links.json (repo root).
.DESCRIPTION
  For every entry in links.json: expands ${vars}, then ensures `link` points at `target`.
  - missing link        -> created (parent folders created)
  - wrong-target link   -> removed (link only) and recreated
  - empty real folder   -> removed and replaced by the link
  - non-empty real path -> warning, left alone
  mode "perFile" links each item of `target` matching `include` (and not `exclude`) into the `link` folder.
  Never recurses into links. Stale links are reported by -Check only if they are declared; extras are ignored.
  Symlinks need admin or Developer Mode; junctions do not.
.PARAMETER Group
  Only process these group names (default: all).
.PARAMETER Check
  Audit only: change nothing, exit 1 if any link is missing or wrong.
.PARAMETER Config
  Path to links.json (default: <repo>/links.json).
.EXAMPLE
  pwsh tools/syncLinks/sync.ps1 -Check
  pwsh tools/syncLinks/sync.ps1 -Group core-2
  pwsh tools/syncLinks/sync.ps1 -WhatIf
#>
[CmdletBinding(SupportsShouldProcess)]
param(
  [string[]] $Group,
  [switch] $Check,
  [string] $Config = (Join-Path $PSScriptRoot '..\..\links.json')
)
$ErrorActionPreference = 'Stop'

$cfg = Get-Content -LiteralPath $Config -Raw | ConvertFrom-Json
$vars = @{}
$cfg.vars.PSObject.Properties | ForEach-Object { $vars[$_.Name] = $_.Value }
function Expand([string] $s) {
  for ($i = 0; $i -lt 5; $i++) { foreach ($k in $vars.Keys) { $s = $s.Replace('${' + $k + '}', $vars[$k]) } }
  $s
}
function Norm([string] $p) { ($p -replace '^\\\\\?\\', '').TrimEnd('\').ToLowerInvariant() }

$script:bad = 0
function Report([string] $state, [string] $link, [string] $extra = '') {
  if ($state -in 'ok') { Write-Host "ok       $link" -ForegroundColor DarkGray; return }
  $script:bad++
  Write-Host ("{0,-8} {1} {2}" -f $state, $link, $extra)
}

function Ensure([string] $link, [string] $target, [string] $type) {
  if (-not (Test-Path -LiteralPath $target)) { Write-Warning "target missing, skipped: $link -> $target"; $script:bad++; return }
  $isDir = (Get-Item -LiteralPath $target -Force).PSIsContainer
  $kind = if ($isDir -and $type -eq 'junction') { 'Junction' } else { 'SymbolicLink' }
  $item = Get-Item -LiteralPath $link -Force -ErrorAction SilentlyContinue
  if ($item -and $item.LinkType) {
    if ((Norm ($item.Target -join '')) -eq (Norm $target)) { Report 'ok' $link; return }
    Report 'wrong' $link "-> $($item.Target -join ',') (want $target)"
    if ($Check) { return }
    if ($PSCmdlet.ShouldProcess($link, 'remove wrong link')) {
      if ($item.PSIsContainer) { [System.IO.Directory]::Delete($link) } else { [System.IO.File]::Delete($link) }
    } else { return }
  } elseif ($item) {
    if ($item.PSIsContainer -and -not (Get-ChildItem -LiteralPath $link -Force | Select-Object -First 1)) {
      Report 'empty' $link '(real empty folder, will be replaced)'
      if ($Check) { return }
      if ($PSCmdlet.ShouldProcess($link, 'remove empty folder')) { [System.IO.Directory]::Delete($link) } else { return }
    } else {
      Write-Warning "real path in the way, left alone: $link"; $script:bad++; return
    }
  } else {
    Report 'missing' $link
    if ($Check) { return }
  }
  if ($PSCmdlet.ShouldProcess($link, "create $kind -> $target")) {
    $parent = Split-Path -Parent $link
    if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
    try {
      New-Item -ItemType $kind -Path $link -Target $target | Out-Null
      Write-Host "created  $link" -ForegroundColor Green
      $script:bad--
    } catch { Write-Warning "failed: $link ($($_.Exception.Message))" }
  }
}

foreach ($g in $cfg.groups.PSObject.Properties) {
  if ($Group -and $g.Name -notin $Group) { continue }
  Write-Host "== $($g.Name)" -ForegroundColor Cyan
  foreach ($l in $g.Value.links) {
    $link = Expand $l.link; $target = Expand $l.target
    if ($l.mode -eq 'perFile') {
      if (-not (Test-Path -LiteralPath $target)) { Write-Warning "target dir missing: $target"; $script:bad++; continue }
      $items = Get-ChildItem -LiteralPath $target -Force | Where-Object {
        $n = $_.Name
        (($l.include | Where-Object { $n -like $_ }).Count -gt 0) -and (-not ($l.exclude | Where-Object { $n -like $_ }))
      }
      foreach ($it in $items) { Ensure (Join-Path $link $it.Name) $it.FullName $l.type }
    } else {
      Ensure $link $target $l.type
    }
  }
}

if ($script:bad -gt 0) { Write-Host "$($script:bad) link(s) not in desired state" -ForegroundColor Yellow; if ($Check) { exit 1 } }
else { Write-Host 'all links ok' -ForegroundColor Green }
