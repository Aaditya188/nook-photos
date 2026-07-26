# Sync the origin server + AI indexer from this repo to the installed service copy,
# then prove the result actually imports BEFORE you restart anything.
#
# Why this script exists: the indexer's modules change as a SET. Copying one file by
# hand leaves the rest stale, the filesystem accepts it happily, and the only symptom
# is the service refusing to start with an ImportError buried in its log. Copy all of
# them, or none.
#
# Usage (no elevation needed to copy; restarting the services does need it):
#   powershell -ExecutionPolicy Bypass -File apps\origin\sync-to-service.ps1
#   powershell -ExecutionPolicy Bypass -File apps\origin\sync-to-service.ps1 -Restart

param(
    [string]$ServiceRoot = "C:\nook-server",
    [switch]$Restart
)

$ErrorActionPreference = "Stop"
$repoOrigin  = Join-Path $PSScriptRoot ""
$repoIndexer = Join-Path $PSScriptRoot "indexer"
$liveIndexer = Join-Path $ServiceRoot "indexer"

if (-not (Test-Path $liveIndexer)) {
    Write-Error "No service install found at $liveIndexer. Pass -ServiceRoot to point elsewhere."
}

# --- copy -------------------------------------------------------------------
Copy-Item (Join-Path $repoOrigin "server.js") (Join-Path $ServiceRoot "server.js") -Force
Write-Host "synced server.js"

$pyFiles = Get-ChildItem $repoIndexer -Filter "*.py" -File
foreach ($f in $pyFiles) {
    Copy-Item $f.FullName (Join-Path $liveIndexer $f.Name) -Force
    Write-Host ("synced indexer/" + $f.Name)
}
foreach ($extra in @("requirements.txt", "requirements-gpu.txt")) {
    $src = Join-Path $repoIndexer $extra
    if (Test-Path $src) {
        Copy-Item $src (Join-Path $liveIndexer $extra) -Force
        Write-Host ("synced indexer/" + $extra)
    }
}

# Stale bytecode can shadow the new source; the service recompiles on boot.
Remove-Item -Recurse -Force (Join-Path $liveIndexer "__pycache__") -ErrorAction SilentlyContinue

# --- verify every copied file matches -------------------------------------
$stale = @()
$pairs = @(@{ a = (Join-Path $repoOrigin "server.js"); b = (Join-Path $ServiceRoot "server.js") })
foreach ($f in $pyFiles) {
    $pairs += @{ a = $f.FullName; b = (Join-Path $liveIndexer $f.Name) }
}
foreach ($p in $pairs) {
    if ((Get-FileHash $p.a).Hash -ne (Get-FileHash $p.b).Hash) { $stale += $p.b }
}
if ($stale.Count -gt 0) {
    Write-Error ("Copy did not take for: " + ($stale -join ", "))
}
Write-Host "all copied files match the repo"

# --- prove it imports, which is what a partial sync breaks -----------------
$venvPy = Join-Path $liveIndexer ".venv\Scripts\python.exe"
if (Test-Path $venvPy) {
    Push-Location $liveIndexer
    # A temp script file, not python -c: PowerShell mangles the quoting inside an
    # inline -c argument when it hands it to a native executable.
    $probeFile = Join-Path $env:TEMP "nook-import-probe.py"
    try {
        @(
            'import sys'
            'sys.path.insert(0, ".")'
            'import store, models, pipeline'
            'print("IMPORT OK")'
        ) | Set-Content -Path $probeFile -Encoding ascii
        $env:NOOK_ENABLE_CLIP = "0"
        $env:NOOK_ENABLE_FACES = "0"
        $out = & $venvPy $probeFile 2>&1
        $env:NOOK_ENABLE_CLIP = $null
        $env:NOOK_ENABLE_FACES = $null
        if (($out -join "`n") -notmatch "IMPORT OK") {
            Write-Host ($out -join "`n")
            Write-Error "The synced indexer does NOT import. Do not restart; fix this first."
        }
        Write-Host "synced indexer imports cleanly"
    }
    finally {
        Pop-Location
        Remove-Item $probeFile -ErrorAction SilentlyContinue
    }
}
else {
    Write-Warning "No venv at $venvPy - skipped the import check."
}

# --- optional restart -------------------------------------------------------
if ($Restart) {
    Write-Host "restarting services (needs an elevated shell)"
    Restart-Service nook-node
    Restart-Service nook-indexer
    Restart-Service nook-gateway
    Get-Service nook-* | Format-Table -AutoSize
}
else {
    Write-Host ""
    Write-Host "Done. In an ELEVATED shell run:"
    Write-Host "  Restart-Service nook-node, nook-indexer, nook-gateway"
}
