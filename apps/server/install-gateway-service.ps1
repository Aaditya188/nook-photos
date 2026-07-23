# Installs the nook-gateway performance server as an always-on Windows service.
# Run elevated. Serves :8090, proxies to the origin :8080. Same data dir.
$ErrorActionPreference = "Continue"
$log = "D:\nook-photos-rn\apps\server\install-gateway.log"
"=== install-gateway $(Get-Date -Format o) ===" | Out-File $log -Encoding utf8
$nssm = "C:\Users\praka\AppData\Local\Microsoft\WinGet\Packages\NSSM.NSSM_Microsoft.Winget.Source_8wekyb3d8bbwe\nssm-2.24-101-g897c7ad\win64\nssm.exe"
$node = "C:\Program Files\nodejs\node.exe"
$tsx = "D:\nook-photos-rn\node_modules\tsx\dist\cli.mjs"
$entry = "D:\nook-photos-rn\apps\server\src\index.ts"
New-Item -ItemType Directory -Force "D:\nook-photos-rn\apps\server\logs" | Out-Null

function Run($d, $sb) { "--- $d ---" | Out-File $log -Append -Encoding utf8; try { & $sb 2>&1 | Out-File $log -Append -Encoding utf8 } catch { "ERR $_" | Out-File $log -Append -Encoding utf8 } }

if (Get-Service nook-gateway -ErrorAction SilentlyContinue) {
  Run "stop+remove existing" { & $nssm stop nook-gateway; Start-Sleep 1; & $nssm remove nook-gateway confirm }
}

Run "install"       { & $nssm install nook-gateway $node "`"$tsx`" `"$entry`"" }
Run "appdir"        { & $nssm set nook-gateway AppDirectory "D:\nook-photos-rn\apps\server" }
Run "env"           { & $nssm set nook-gateway AppEnvironmentExtra "NOOK_DATA_DIR=D:\photos" "NOOK_ORIGIN=http://127.0.0.1:8080" "NOOK_GATEWAY_PORT=8090" "NODE_ENV=production" }
Run "autostart"     { & $nssm set nook-gateway Start SERVICE_AUTO_START }
Run "stdout"        { & $nssm set nook-gateway AppStdout "D:\nook-photos-rn\apps\server\logs\gateway.log" }
Run "stderr"        { & $nssm set nook-gateway AppStderr "D:\nook-photos-rn\apps\server\logs\gateway.log" }
Run "rotate"        { & $nssm set nook-gateway AppRotateFiles 1; & $nssm set nook-gateway AppRotateBytes 10485760 }
Run "start"         { & $nssm start nook-gateway }

Start-Sleep 3
"=== state ===" | Out-File $log -Append -Encoding utf8
Get-Service nook-gateway | Format-Table -AutoSize Name, Status, StartType | Out-String | Out-File $log -Append -Encoding utf8
"=== DONE $(Get-Date -Format o) ===" | Out-File $log -Append -Encoding utf8
