# Builds LinkFlow into .\dist, creates a desktop shortcut and starts it.
# Usage (PowerShell 7):  pwsh -File .\build.ps1
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$dist = Join-Path $root 'dist'
$exe = Join-Path $dist 'LinkFlow.exe'

Write-Host '[1/4] Stopping any running LinkFlow ...'
if (Test-Path $exe) { Start-Process -FilePath $exe -ArgumentList '--stop' -Wait }

Write-Host '[2/4] Building LinkFlow ...'
dotnet publish (Join-Path $root 'LinkFlow.csproj') -c Release -o $dist --nologo
if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }

Write-Host '[3/4] Creating desktop shortcut ...'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'LinkFlow.lnk'))
$shortcut.TargetPath = $exe
$shortcut.WorkingDirectory = $dist
$shortcut.IconLocation = "$exe,0"
$shortcut.Description = 'LinkFlow'
$shortcut.Save()

Write-Host '[4/4] Starting LinkFlow ...'
Start-Process -FilePath $exe
Write-Host 'Done. Use the "LinkFlow" shortcut on your desktop from now on.'
