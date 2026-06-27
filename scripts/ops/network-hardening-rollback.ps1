param(
  [string]$PolicyBackupPath,
  [switch]$Apply,
  [switch]$IUnderstandNetworkLockoutRisk,
  [switch]$Json,
  [switch]$Help
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Show-Help {
  @"
network-hardening-rollback.ps1

Stage 7.2b read-only rollback runbook helper. Default mode prints rollback
steps and validation guidance. It does not import firewall policy, change rules,
restore files, restart services, or touch runtime data.

Usage:
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ops/network-hardening-rollback.ps1
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ops/network-hardening-rollback.ps1 -PolicyBackupPath C:\path\firewall.wfw

Future apply guard:
  --apply --i-understand-network-lockout-risk

Stage 7.2b intentionally refuses apply mode.
"@
}

function Fail-ClosedApply {
  Write-Error "Stage 7.2b refuses to apply rollback changes. This script is dry-run/read-only only; a later stage needs separate explicit authorization."
  exit 2
}

if ($Help) {
  Show-Help
  exit 0
}

if ($Apply -or $IUnderstandNetworkLockoutRisk) {
  Fail-ClosedApply
}

$Runbook = [ordered]@{
  stage = "Stage 7.2b"
  mode = "dry-run"
  mutatingCommandsExecuted = $false
  applySupported = $false
  policyBackupPath = if ($PolicyBackupPath) { $PolicyBackupPath } else { "not-provided" }
  emergencyFirstActions = @(
    "Keep the current remote session open and do not close the last working shell.",
    "Use the pre-change console, hypervisor, or provider console if the remote channel drops.",
    "Stop ordinary rollout work and preserve logs and listener snapshots.",
    "Do not restart 3106 unless a separate production rollback authorization exists."
  )
  requiredBackups = @(
    "Firewall policy export (.wfw).",
    "Text snapshot of firewall profiles and relevant inbound rules.",
    "NewAPI binding/config backup if a later stage changes it.",
    "PostgreSQL postgresql.conf and pg_hba.conf backup if a later stage changes them.",
    "3106 PID, commit, data checksum, and uploads checksum.",
    "3107 PID, commit, data-staging checksum, and uploads-staging checksum."
  )
  textOnlyRollbackCommands = @(
    "netsh advfirewall import <backup.wfw>",
    "Set-NetFirewallProfile -Profile Domain,Private,Public -Enabled False",
    "Set-NetFirewallRule -DisplayName <rule-name> -Enabled False",
    "Restore NewAPI bind config from backup, then restart NewAPI only after separate authorization.",
    "Restore PostgreSQL config files from backup, then restart PostgreSQL only after separate authorization."
  )
  validation = @(
    "3106 PID is unchanged unless production rollback was explicitly authorized.",
    "3106 commit is unchanged.",
    "3106 data/uploads checksums are unchanged.",
    "3107 PID is unchanged unless staging-only validation was explicitly authorized.",
    "3107 data-staging/uploads-staging checksums are unchanged.",
    "3106 and 3107 health/library routes respond as expected.",
    "NewAPI and PostgreSQL local callers work if they were part of the approved change.",
    "No raw API key, database password, Cookie, Authorization, ADMIN_PASSWORD, or NewAPI key appears in reports."
  )
}

if ($Json) {
  $Runbook | ConvertTo-Json -Depth 6
  exit 0
}

Write-Host "Stage 7.2b firewall/network rollback helper (dry-run/read-only)"
Write-Host "Mutating commands executed: false"
Write-Host "Apply supported now: false"
Write-Host "Policy backup path: $($Runbook.policyBackupPath)"
Write-Host ""
Write-Host "Emergency first actions:"
$Runbook.emergencyFirstActions | ForEach-Object { Write-Host "  - $_" }
Write-Host ""
Write-Host "Required backups:"
$Runbook.requiredBackups | ForEach-Object { Write-Host "  - $_" }
Write-Host ""
Write-Host "Rollback commands, text only, not executed:"
$Runbook.textOnlyRollbackCommands | ForEach-Object { Write-Host "  - $_" }
Write-Host ""
Write-Host "Validation:"
$Runbook.validation | ForEach-Object { Write-Host "  - $_" }
