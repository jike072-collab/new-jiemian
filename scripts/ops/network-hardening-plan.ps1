param(
  [switch]$Apply,
  [switch]$IUnderstandNetworkLockoutRisk,
  [switch]$Json,
  [switch]$Help
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Show-Help {
  @"
network-hardening-plan.ps1

Stage 7.2b read-only hardening plan. Default mode prints the proposed firewall,
NewAPI, PostgreSQL, and verification sequence. It does not modify the system.

Usage:
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ops/network-hardening-plan.ps1
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ops/network-hardening-plan.ps1 -Json

Future apply guard:
  --apply --i-understand-network-lockout-risk

Stage 7.2b intentionally refuses apply mode. A later stage needs separate user
authorization before any network, firewall, PostgreSQL, NewAPI, reverse proxy,
HTTPS, or security-group change.
"@
}

function Fail-ClosedApply {
  Write-Error "Stage 7.2b refuses to apply network changes. This script is dry-run/read-only only; a later stage needs separate explicit authorization."
  exit 2
}

if ($Help) {
  Show-Help
  exit 0
}

if ($Apply -or $IUnderstandNetworkLockoutRisk) {
  Fail-ClosedApply
}

$Plan = [ordered]@{
  stage = "Stage 7.2b"
  mode = "dry-run"
  mutatingCommandsExecuted = $false
  applySupported = $false
  applyGuard = "--apply --i-understand-network-lockout-risk"
  authorizationRequired = $true
  objective = "Keep 3106/3107 loopback-only, restrict NewAPI and PostgreSQL exposure, and enable firewall only after preserving remote access."
  currentFindings = @(
    "3106 and 3107 should remain bound to 127.0.0.1.",
    "NewAPI :3200 was observed on wildcard IPv6 (::), which can expose it beyond local callers.",
    "PostgreSQL :55432 was observed on 0.0.0.0 and ::, which can expose the database beyond local callers.",
    "Windows Firewall Domain/Private/Public profiles were observed disabled.",
    "No nginx, caddy, IIS, traefik, cloudflared, ngrok, frp, or tailscale process was observed during the read-only snapshot."
  )
  targetArchitecture = @(
    "3106 production: 127.0.0.1:3106 only.",
    "3107 staging: 127.0.0.1:3107 only.",
    "NewAPI: 127.0.0.1:3200 unless a separately approved reverse proxy protects it.",
    "PostgreSQL application instance: 127.0.0.1:55432 unless a documented remote client exists.",
    "Public entry should terminate at a reviewed HTTPS reverse proxy, not at raw app, NewAPI, or PostgreSQL listeners."
  )
  requiredPrechecks = @(
    "Confirm the active remote-management channel and its local port before enabling any firewall profile.",
    "Export the current firewall policy and record recovery access before any change.",
    "Confirm 3106 PID, commit, data checksum, and uploads checksum.",
    "Confirm 3107 PID, commit, data-staging checksum, and uploads-staging checksum.",
    "Confirm NewAPI callers are local-only or list each approved remote source as masked CIDR.",
    "Confirm PostgreSQL clients are local-only or list each approved remote source as masked CIDR.",
    "Confirm rollback script and firewall export are readable from a second shell."
  )
  proposedSequence = @(
    "1. Snapshot current listeners, firewall profiles, firewall rules, processes, and checksums.",
    "2. Add explicit allow rules for the confirmed remote-management channel first.",
    "3. Add local-only allow or block rules for 3200 and 55432.",
    "4. Rebind NewAPI to 127.0.0.1 if no approved remote client exists.",
    "5. Rebind PostgreSQL listen_addresses to 127.0.0.1 and reduce pg_hba.conf if no approved remote client exists.",
    "6. Enable the least risky firewall profile first, watching the active remote session.",
    "7. Validate 3106, 3107, NewAPI, PostgreSQL, and logs.",
    "8. Keep rollback shell open until all checks pass."
  )
  exampleCommandsTextOnly = @(
    "Export policy: netsh advfirewall export <backup.wfw>",
    "Profile enable example: Set-NetFirewallProfile -Profile Domain,Private,Public -Enabled True",
    "Allow management example: New-NetFirewallRule -DisplayName <management> -Direction Inbound -Action Allow -Protocol TCP -LocalPort <port> -RemoteAddress <trusted-source>",
    "Block NewAPI example: New-NetFirewallRule -DisplayName <block-newapi-3200> -Direction Inbound -Action Block -Protocol TCP -LocalPort 3200",
    "Block PostgreSQL example: New-NetFirewallRule -DisplayName <block-postgres-55432> -Direction Inbound -Action Block -Protocol TCP -LocalPort 55432",
    "Rollback import: netsh advfirewall import <backup.wfw>"
  )
  verification = @(
    "3106 /, /login, /api/health/backend, /api/library return expected statuses.",
    "3107 /, /login, /api/health/backend, /api/library return expected statuses.",
    "watchdog action=none, identity=owned, ok=true for staging.",
    "NewAPI and PostgreSQL no longer listen on wildcard addresses unless explicitly approved.",
    "No 500s, database errors, raw secrets, generation calls, or NewAPI generation calls in the current log window.",
    "data/uploads and data-staging/uploads-staging checksums remain unchanged."
  )
  rollbackTriggers = @(
    "Remote management disconnects or becomes unstable.",
    "3106 health or library route fails.",
    "3107 health or library route fails.",
    "NewAPI local callers fail unexpectedly.",
    "PostgreSQL local callers fail unexpectedly.",
    "Firewall profile or rule state differs from the approved plan.",
    "Unexpected data/uploads checksum change appears."
  )
  rollbackPlan = @(
    "Keep the pre-change shell open.",
    "Import the saved firewall policy.",
    "Restore NewAPI binding config from backup if it was changed in a later stage.",
    "Restore PostgreSQL config from backup if it was changed in a later stage.",
    "Restart only the specifically changed service after separate authorization.",
    "Verify listeners, health routes, and checksums again."
  )
}

if ($Json) {
  $Plan | ConvertTo-Json -Depth 6
  exit 0
}

Write-Host "Stage 7.2b network hardening plan (dry-run/read-only)"
Write-Host "Mutating commands executed: false"
Write-Host "Apply supported now: false"
Write-Host "Future guard: $($Plan.applyGuard)"
Write-Host ""
Write-Host "Objective:"
Write-Host "  $($Plan.objective)"
Write-Host ""
Write-Host "Current findings:"
$Plan.currentFindings | ForEach-Object { Write-Host "  - $_" }
Write-Host ""
Write-Host "Target architecture:"
$Plan.targetArchitecture | ForEach-Object { Write-Host "  - $_" }
Write-Host ""
Write-Host "Required prechecks:"
$Plan.requiredPrechecks | ForEach-Object { Write-Host "  - $_" }
Write-Host ""
Write-Host "Proposed sequence:"
$Plan.proposedSequence | ForEach-Object { Write-Host "  $_" }
Write-Host ""
Write-Host "Example commands, text only, not executed:"
$Plan.exampleCommandsTextOnly | ForEach-Object { Write-Host "  - $_" }
Write-Host ""
Write-Host "Verification:"
$Plan.verification | ForEach-Object { Write-Host "  - $_" }
Write-Host ""
Write-Host "Rollback triggers:"
$Plan.rollbackTriggers | ForEach-Object { Write-Host "  - $_" }
Write-Host ""
Write-Host "Rollback plan:"
$Plan.rollbackPlan | ForEach-Object { Write-Host "  - $_" }
