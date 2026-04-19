# Morpheus WebHub — native messaging host installer (Windows)
# Run from the extension/native/ directory:
#   powershell -ExecutionPolicy Bypass -File install.ps1

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "Morpheus WebHub - native host installer" -ForegroundColor Cyan
Write-Host ""

# --- Find Python ---
$python = $null
foreach ($cmd in @('python', 'python3', 'py')) {
    try {
        $p = (Get-Command $cmd -ErrorAction SilentlyContinue).Source
        if ($p) { $python = $p; break }
    } catch {}
}
if (-not $python) {
    # Try common install locations
    $candidates = @(
        "$env:LOCALAPPDATA\Programs\Python\Python3*\python.exe",
        "$env:LOCALAPPDATA\Programs\Python\Python*\python.exe",
        "C:\Python3*\python.exe",
        "C:\Python*\python.exe"
    )
    foreach ($glob in $candidates) {
        $found = Get-Item $glob -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($found) { $python = $found.FullName; break }
    }
}
if (-not $python) {
    Write-Host "ERROR: Python not found. Install Python 3 and ensure it is in PATH." -ForegroundColor Red
    exit 1
}
Write-Host "Python : $python"

# --- Write launcher .bat with resolved Python path ---
$batPath  = Join-Path $scriptDir "morpheus_host.bat"
$hostPath = Join-Path $scriptDir "morpheus_host.py"
$batContent = "@echo off`r`n`"$python`" `"$hostPath`" %*`r`n"
[System.IO.File]::WriteAllText($batPath, $batContent, [System.Text.Encoding]::ASCII)
Write-Host "Launcher: $batPath"

# --- Write native messaging manifest ---
$manifestDir  = Join-Path $env:APPDATA "Mozilla\NativeMessagingHosts"
$manifestPath = Join-Path $manifestDir "morpheus_webhub.json"
if (-not (Test-Path $manifestDir)) { New-Item -ItemType Directory -Path $manifestDir | Out-Null }

$manifest = [ordered]@{
    name                = "morpheus_webhub"
    description         = "Morpheus WebHub native messaging host"
    path                = $batPath
    type                = "stdio"
    allowed_extensions  = @("morpheus-webhub@local")
}
$manifest | ConvertTo-Json | Set-Content -Path $manifestPath -Encoding UTF8
Write-Host "Manifest: $manifestPath"

# --- Register in Windows registry (Firefox reads HKCU first) ---
$regKey = "HKCU:\Software\Mozilla\NativeMessagingHosts\morpheus_webhub"
if (-not (Test-Path $regKey)) { New-Item -Path $regKey -Force | Out-Null }
Set-ItemProperty -Path $regKey -Name "(Default)" -Value $manifestPath
Write-Host "Registry: $regKey"

Write-Host ""
Write-Host "Installation complete." -ForegroundColor Green
Write-Host "Restart Firefox / Zen Browser to activate the native host."
