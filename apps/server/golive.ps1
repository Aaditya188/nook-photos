# Go-live: point the tunnel at the gateway (:8090), install the gateway as an
# always-on service, verify it, then restart the tunnel. Run in an elevated shell.
# Pure ASCII only (PowerShell 5.1 parser is picky about non-ASCII).
$ErrorActionPreference = "Continue"
$log = "D:\nook-photos-rn\apps\server\golive.log"
Set-Content -Path $log -Value ("golive start " + (Get-Date)) -Encoding ASCII
function L($m) { Add-Content -Path $log -Value $m }

$nssm  = "C:\Users\praka\AppData\Local\Microsoft\WinGet\Packages\NSSM.NSSM_Microsoft.Winget.Source_8wekyb3d8bbwe\nssm-2.24-101-g897c7ad\win64\nssm.exe"
$node  = "C:\Program Files\nodejs\node.exe"
$tsx   = "D:\nook-photos-rn\node_modules\tsx\dist\cli.mjs"
$entry = "D:\nook-photos-rn\apps\server\src\index.ts"
$cfg   = "C:\Users\praka\.cloudflared\config.yml"
New-Item -ItemType Directory -Force "D:\nook-photos-rn\apps\server\logs" | Out-Null

# 0. Flip the tunnel ingress from :8080 to :8090 (idempotent).
$raw = Get-Content $cfg -Raw
$raw = $raw.Replace("localhost:8080", "localhost:8090")
Set-Content -Path $cfg -Value $raw -Encoding ASCII
L "config flipped to 8090"

# 1. Free :8090 (stop any manual gateway process).
Get-NetTCPConnection -LocalPort 8090 -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2

# 2. (Re)install the gateway service.
if (Get-Service nook-gateway -ErrorAction SilentlyContinue) {
  & $nssm stop nook-gateway
  Start-Sleep -Seconds 1
  & $nssm remove nook-gateway confirm
}
$params = '"' + $tsx + '" "' + $entry + '"'
& $nssm install nook-gateway $node $params
& $nssm set nook-gateway AppDirectory "D:\nook-photos-rn\apps\server"
& $nssm set nook-gateway AppEnvironmentExtra NOOK_DATA_DIR=D:\photos NOOK_ORIGIN=http://127.0.0.1:8080 NOOK_GATEWAY_PORT=8090
& $nssm set nook-gateway Start SERVICE_AUTO_START
& $nssm set nook-gateway AppStdout "D:\nook-photos-rn\apps\server\logs\gateway.log"
& $nssm set nook-gateway AppStderr "D:\nook-photos-rn\apps\server\logs\gateway.log"
& $nssm start nook-gateway
L "gateway service installed and started"

# 3. Wait for the gateway to answer on :8090.
$ok = $false
for ($i = 0; $i -lt 30; $i++) {
  try {
    $r = Invoke-RestMethod "http://localhost:8090/api/ping" -TimeoutSec 3
    if ($r.ok) { $ok = $true; break }
  } catch {}
  Start-Sleep -Seconds 1
}
L ("gateway healthy on 8090: " + $ok)

# 4. Restart the tunnel to pick up the new ingress (only if the gateway is up).
if ($ok) {
  Restart-Service nook-tunnel -Force
  L "nook-tunnel restarted"
} else {
  L "gateway NOT healthy; tunnel not restarted; check logs\gateway.log"
}

L "done"
Get-Service nook-gateway, nook-tunnel | Format-Table Name, Status, StartType | Out-String | Add-Content -Path $log
Write-Host ""
Write-Host "======== golive.log ========"
Get-Content $log
