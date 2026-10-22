<#
.SYNOPSIS
  Publishes the Windows app into dist\LinkFlow-<version>-local WITHOUT static\ or data\ beside it.

.DESCRIPTION
  LinkFlow treats the first ancestor of its executable that contains static\index.html as its root, and keeps
  data\ (messages.db, files, config.json with the pairing token) under that root. The daily run folder must
  therefore contain only the executable and its runtime files, so the program walks up to this project root
  and keeps using the real data and the real static\. Copying static\ into the run folder makes it a second root
  with an empty data\ and a new pairing token (happened with LinkFlow-0.4.0-local on 2026-10-20).

  This script never deletes or merges anything. If the target already contains static\ or data\ it stops and
  reports; the user decides. It does not touch shortcuts. It does not run build.ps1 (which stops the app,
  rewrites the desktop shortcut and restarts it).

.PARAMETER Target
  Run folder. Defaults to dist\LinkFlow-<Version from LinkFlow.csproj>-local.

.PARAMETER StopRunning
  If LinkFlow is running from the target folder, stop it with its own graceful "--stop" first. Without this
  switch the script refuses to replace files of a running program.

.PARAMETER Start
  Start the program afterwards and verify it is using this project's data.

.PARAMETER CheckOnly
  Run the pre-checks and print the plan; publish nothing.
#>
[CmdletBinding()]
param(
    [string]$Target,
    [switch]$StopRunning,
    [switch]$Start,
    [switch]$CheckOnly
)
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$projectFile = Join-Path $root 'LinkFlow.csproj'
$dataDir = Join-Path $root 'data'
$version = ([regex]::Match((Get-Content -LiteralPath $projectFile -Raw), '<Version>([^<]+)</Version>')).Groups[1].Value
if (-not $version) { throw "Version not found in $projectFile" }
if (-not $Target) { $Target = Join-Path $root "dist\LinkFlow-$version-local" }
$Target = [IO.Path]::GetFullPath($Target)
$exe = Join-Path $Target 'LinkFlow.exe'

function Get-MessageCount {
    $db = Join-Path $dataDir 'messages.db'
    if (-not (Test-Path -LiteralPath $db)) { return $null }
    $python = (Get-Command python -ErrorAction SilentlyContinue).Source
    if (-not $python) { return $null }
    $code = "import sqlite3,sys;c=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True);print(c.execute('select count(*) from messages').fetchone()[0])"
    $out = & $python -c $code $db 2>$null
    if ($LASTEXITCODE -ne 0) { return $null }
    return [int]$out
}

function Get-RunningFromTarget {
    Get-Process -Name LinkFlow -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -and $_.Path.StartsWith($Target + '\', [StringComparison]::OrdinalIgnoreCase) }
}

Write-Host "Project root : $root"
Write-Host "Version      : $version"
Write-Host "Run folder   : $Target"

# The run folder must never become a second root.
foreach ($name in 'static', 'data') {
    $stray = Join-Path $Target $name
    if (Test-Path -LiteralPath $stray) {
        throw "$stray exists. A run folder with $name\ becomes its own root and starts an empty data\ with a new pairing token. Nothing was changed; report this to the user and let them decide what to do with it (for example rename it, such as static.off, or remove it themselves)."
    }
}
if ($Target.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase) -eq $false) {
    throw "Target must be inside the project root so the program finds the project's static\ and data\."
}

$before = Get-MessageCount
Write-Host ("Messages     : {0} (project data)" -f $(if ($null -eq $before) { 'unknown' } else { $before }))

$running = @(Get-RunningFromTarget)
if ($running.Count -gt 0) {
    Write-Host "Running      : LinkFlow is running from the target folder (PID $($running.Id -join ','))."
    if (-not $StopRunning -and -not $CheckOnly) {
        throw 'LinkFlow is running from the target folder. Exit it from the tray, or rerun with -StopRunning to stop it with its own --stop.'
    }
}
if ($CheckOnly) { Write-Host 'CheckOnly: pre-checks passed, nothing published.'; return }

if ($running.Count -gt 0) {
    Start-Process -FilePath $exe -ArgumentList '--stop' -Wait
    $deadline = (Get-Date).AddSeconds(20)
    while ((Get-RunningFromTarget) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 500 }
    if (Get-RunningFromTarget) { throw 'LinkFlow did not exit within 20 seconds; nothing was replaced.' }
}

New-Item -ItemType Directory -Force -Path $Target | Out-Null
dotnet publish $projectFile -c Release -r win-x64 --self-contained true -o $Target --nologo
if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed with exit code $LASTEXITCODE" }

foreach ($name in 'static', 'data') {
    if (Test-Path -LiteralPath (Join-Path $Target $name)) {
        throw "Publish produced $name\ in the run folder; this must not happen. Report it; do not use this folder."
    }
}
if (-not (Test-Path -LiteralPath $exe)) { throw "LinkFlow.exe missing in $Target" }
$actual = (Get-Item -LiteralPath $exe).VersionInfo.ProductVersion
Write-Host "Published    : LinkFlow.exe $actual (no static\ or data\ in the run folder)"

if ($Start) {
    Start-Process -FilePath $exe -WorkingDirectory $Target
    $runtimeFile = Join-Path $dataDir 'runtime.json'
    $proc = $null
    for ($i = 0; $i -lt 30 -and -not $proc; $i++) {
        Start-Sleep -Seconds 1
        $proc = Get-RunningFromTarget | Select-Object -First 1
        if ($proc -and (Test-Path -LiteralPath $runtimeFile)) {
            $rt = Get-Content -LiteralPath $runtimeFile -Raw | ConvertFrom-Json
            if ($rt.pid -ne $proc.Id) { $proc = $null }
        } else { $proc = $null }
    }
    if (-not $proc) { throw "Started, but $runtimeFile does not show the new process. It may be using another root; check before using the app." }
    $after = Get-MessageCount
    Write-Host "Started      : PID $($proc.Id); project data\runtime.json matches"
    Write-Host ("Messages     : {0} before, {1} after" -f $before, $after)
    if ($null -ne $before -and $null -ne $after -and $after -lt $before) { throw "Message count dropped from $before to $after." }
}
Write-Host 'Done. Desktop shortcut and Run entries were not touched; check they point to the run folder above.'
