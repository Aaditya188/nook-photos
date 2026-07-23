# Installs the Nook origin server (and optionally the AI indexer) as always-on
# Windows services using NSSM (https://nssm.cc). Run from an ELEVATED PowerShell:
#   Set-ExecutionPolicy -Scope Process Bypass -Force
#   .\install-services.ps1 [-DataDir D:\photos]
#
# The service auto-starts on boot and restarts on crash. Pure ASCII on purpose:
# Windows PowerShell 5.1 chokes on fancy dashes.

param(
  [string]$DataDir = "$PSScriptRoot\data",
  [int]$Port = 8080
)

$ErrorActionPreference = 'Stop'

function Find-Nssm {
  $cmd = Get-Command nssm -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $winget = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\NSSM*" -Recurse -Filter nssm.exe -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($winget) { return $winget.FullName }
  throw "nssm.exe not found. Install it first: winget install NSSM.NSSM"
}

$nssm = Find-Nssm
$node = (Get-Command node).Source
$server = Join-Path $PSScriptRoot 'server.js'

Write-Host "nssm : $nssm"
Write-Host "node : $node"
Write-Host "app  : $server"
Write-Host "data : $DataDir"

& $nssm install nook-origin $node $server 2>$null
& $nssm set nook-origin AppDirectory $PSScriptRoot
& $nssm set nook-origin AppEnvironmentExtra "NOOK_PORT=$Port" "NOOK_DATA_DIR=$DataDir"
& $nssm set nook-origin Start SERVICE_AUTO_START
& $nssm set nook-origin AppStdout (Join-Path $PSScriptRoot 'logs\origin.log')
& $nssm set nook-origin AppStderr (Join-Path $PSScriptRoot 'logs\origin.err.log')
New-Item -ItemType Directory -Force (Join-Path $PSScriptRoot 'logs') | Out-Null

& $nssm start nook-origin 2>$null
Get-Service nook-origin | Select-Object Name, Status, StartType
Write-Host "Done. The server listens on port $Port and keeps your library in $DataDir"
