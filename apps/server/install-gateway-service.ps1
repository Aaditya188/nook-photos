# Installs the Nook gateway (Fastify + sharp; serves the web app, sized
# thumbnails, and range-streamed media) as an always-on Windows service via
# NSSM (https://nssm.cc). Run from an ELEVATED PowerShell in this folder:
#   Set-ExecutionPolicy -Scope Process Bypass -Force
#   .\install-gateway-service.ps1 [-Port 8090] [-Origin http://127.0.0.1:8080]
# Pure ASCII on purpose: Windows PowerShell 5.1 chokes on fancy dashes.

param(
  [int]$Port = 8090,
  [string]$Origin = 'http://127.0.0.1:8080'
)

$ErrorActionPreference = 'Stop'

function Find-Nssm {
  $cmd = Get-Command nssm -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $winget = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\NSSM*" -Recurse -Filter nssm.exe -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($winget) { return $winget.FullName }
  throw "nssm.exe not found. Install it first: winget install NSSM.NSSM"
}

$here = $PSScriptRoot
$repo = Resolve-Path (Join-Path $here '..\..')
$nssm = Find-Nssm
$node = (Get-Command node).Source
$tsx = Join-Path $repo 'node_modules\tsx\dist\cli.mjs'
$entry = Join-Path $here 'src\index.ts'
$logs = Join-Path $here 'logs'
New-Item -ItemType Directory -Force $logs | Out-Null

Write-Host "nssm : $nssm"
Write-Host "entry: $entry"

& $nssm install nook-gateway $node $tsx $entry 2>$null
& $nssm set nook-gateway AppDirectory $here
& $nssm set nook-gateway AppEnvironmentExtra "NOOK_GATEWAY_PORT=$Port" "NOOK_ORIGIN=$Origin"
& $nssm set nook-gateway Start SERVICE_AUTO_START
& $nssm set nook-gateway AppStdout (Join-Path $logs 'gateway.log')
& $nssm set nook-gateway AppStderr (Join-Path $logs 'gateway.err.log')

& $nssm restart nook-gateway 2>$null
if (-not $?) { & $nssm start nook-gateway 2>$null }
Get-Service nook-gateway | Select-Object Name, Status, StartType
Write-Host "Done. Gateway on port $Port -> origin $Origin"
