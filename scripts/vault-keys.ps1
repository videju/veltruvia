# ═════════════════════════════════════════════════════════════════════
# VELTRUVIA signing-key vault — DPAPI-encrypted bundle of:
#   veltruvia-release.keystore + .keystore-pass       (Android APK signing)
#   veltruvia-codesign.pfx + .codesign-pfx-pass       (Windows Authenticode)
#
#   powershell -File scripts/vault-keys.ps1 -Lock      # encrypt + delete plaintext
#   powershell -File scripts/vault-keys.ps1 -Unlock    # restore files for building
#   powershell -File scripts/vault-keys.ps1 -PrintPass # print keystore password only
#
# Scope: Windows DPAPI CurrentUser — only THIS Windows user on THIS machine
# can decrypt. No passwords stored anywhere.
# ═════════════════════════════════════════════════════════════════════
param([switch]$Lock, [switch]$Unlock, [switch]$PrintPass)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$vault = Join-Path $root 'keys.vault.bin'
$entropy = [Text.Encoding]::UTF8.GetBytes('veltruvia-keys-v1-4f2a9')
Add-Type -AssemblyName System.Security

$files = @('veltruvia-release.keystore', '.keystore-pass', 'veltruvia-codesign.pfx', '.codesign-pfx-pass')

if ($PrintPass) {
  if (-not (Test-Path $vault)) { Write-Error 'Vault not found — run -Unlock first'; exit 1 }
  $blob = [IO.File]::ReadAllBytes($vault)
  $json = [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($blob, $entropy, 'CurrentUser'))
  ($json | ConvertFrom-Json).'.keystore-pass'
  exit 0
}

if ($Unlock) {
  if (-not (Test-Path $vault)) { Write-Host 'Vault not found.'; exit 1 }
  $blob = [IO.File]::ReadAllBytes($vault)
  $json = [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($blob, $entropy, 'CurrentUser'))
  $map = $json | ConvertFrom-Json
  foreach ($f in $files) { [IO.File]::WriteAllBytes((Join-Path $root $f), [Convert]::FromBase64String($map.$f)) }
  Write-Host '✅ Signing keys restored to repo root (plaintext, this machine only).'
  exit 0
}

if ($Lock) {
  $map = [ordered]@{}
  foreach ($f in $files) {
    $p = Join-Path $root $f
    if (-not (Test-Path $p)) { Write-Host "  (skip, missing: $f)"; continue }
    $map.$f = [Convert]::ToBase64String([IO.File]::ReadAllBytes($p))
  }
  $json = $map | ConvertTo-Json -Depth 2
  $blob = [Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($json), $entropy, 'CurrentUser')
  [IO.File]::WriteAllBytes($vault, $blob)
  foreach ($f in $map.Keys) { Remove-Item (Join-Path $root $f) -Force }
  Write-Host "✅ $($map.Count) key files encrypted into keys.vault.bin (DPAPI, this user only) and plaintext copies deleted from the repo root."
  Write-Host '⚠️  Now delete the Desktop KEYSTORE-BACKUP folders manually if they still exist.'
  exit 0
}

Write-Host 'Usage: -Lock | -Unlock | -PrintPass'
exit 1
