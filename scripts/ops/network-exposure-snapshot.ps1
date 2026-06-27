param(
  [switch]$Json,
  [switch]$SelfTest,
  [switch]$Help
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Show-Help {
  @"
network-exposure-snapshot.ps1

Read-only Stage 7.2b network exposure snapshot.

This script collects local OS, firewall, listener, process, and connection
metadata. It does not change firewall rules, service state, PostgreSQL, NewAPI,
reverse proxy settings, or runtime data.

Usage:
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ops/network-exposure-snapshot.ps1
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ops/network-exposure-snapshot.ps1 -Json

Options:
  -Json   Emit JSON.
  -SelfTest
          Run local redaction self-tests only. Does not read network state.
  -Help   Show this help.
"@
}

if ($Help) {
  Show-Help
  exit 0
}

$KeyPorts = @(3106, 3107, 3200, 5432, 55432)
$ProxyNames = @(
  "nginx", "caddy", "w3wp", "iisexpress", "traefik", "cloudflared",
  "ngrok", "frpc", "frps", "tailscale", "new-api", "postgres", "postgresql"
)

function Mask-Text([object]$Value) {
  if ($null -eq $Value) { return $null }
  $Text = [string]$Value
  $Text = $Text -replace '(?im)^(\s*(?:Cookie|Set-Cookie|Authorization)\s*:\s*).+$', '$1[REDACTED]'
  $Text = $Text -replace '(?i)(--(?:cookie|header|authorization|token|password|secret|api-key|apikey|key)\s+)("[^"]*"|''[^'']*''|\S+)', '$1[REDACTED]'
  $Text = $Text -replace '(?i)([?&](?:token|access_token|refresh_token|api[_-]?key|key|secret|password|authorization|cookie)=)[^&\s"''<>]+', '$1[REDACTED]'
  $Text = $Text -replace '(?i)(authorization|cookie|set-cookie|token|password|secret|api[_-]?key|app_database_url|new_api[^=\s]*|dsn|url)(\s*[:=]\s*)("[^"]+"|''[^'']+''|\S+)', '$1$2[REDACTED]'
  $Text = $Text -replace '(?i)(postgres(?:ql)?://)[^\s"''<>]+', '$1[REDACTED]'
  $Text = $Text -replace '(?i)(bearer\s+)[A-Za-z0-9._~+/=-]{8,}', '$1[REDACTED]'
  $Text = $Text -replace '(?i)(\s-[Ud]\s+)("[^"]+"|''[^'']+''|\S+)', '$1[REDACTED]'
  $Text = $Text -replace '(?i)(\s-[A-Za-z]*c\s+)("[^"]+"|''[^'']+''|\S.*)', '$1[REDACTED]'
  return $Text
}

function Invoke-MaskTextSelfTest {
  $Cases = @(
    @{
      input = "Cookie: session=secret-cookie; refresh=secret-refresh; other=value"
      forbidden = @("secret-cookie", "secret-refresh", "other=value")
    },
    @{
      input = "Set-Cookie: session=set-cookie-secret; HttpOnly; Path=/"
      forbidden = @("set-cookie-secret", "HttpOnly")
    },
    @{
      input = "curl --cookie session=cli-cookie-secret https://example.test/?token=query-secret-value&safe=ok"
      forbidden = @("cli-cookie-secret", "query-secret-value")
    },
    @{
      input = "Authorization: Bearer live-token-123456"
      forbidden = @("live-token-123456")
    },
    @{
      input = "APP_DATABASE_URL=postgresql://user:pass@127.0.0.1:55432/app"
      forbidden = @("user:pass", "127.0.0.1:55432")
    },
    @{
      input = "tool --api-key sk-real-secret-token-1234567890 --password secret-password"
      forbidden = @("sk-real-secret-token-1234567890", "secret-password")
    },
    @{
      input = "psql.exe -h 127.0.0.1 -p 55432 -U app_user -d app_db -Atc `"select token,password from users;`""
      forbidden = @("app_user", "app_db", "select token", "password from")
    }
  )

  foreach ($Case in $Cases) {
    $Output = Mask-Text $Case.input
    foreach ($Forbidden in $Case.forbidden) {
      if ($Output -like "*$Forbidden*") {
        throw "Mask-Text self-test leaked: $Forbidden"
      }
    }
  }

  [ordered]@{
    ok = $true
    cases = $Cases.Count
    mutatingCommandsExecuted = $false
  }
}

if ($SelfTest) {
  Invoke-MaskTextSelfTest | ConvertTo-Json -Depth 4
  exit 0
}

function Invoke-Safe([scriptblock]$Block, [object]$Fallback) {
  try {
    return & $Block
  } catch {
    return $Fallback
  }
}

function Test-IsAdmin {
  Invoke-Safe {
    $Identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $Principal = [Security.Principal.WindowsPrincipal]::new($Identity)
    return $Principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  } $false
}

function Get-Version([string]$Command) {
  Invoke-Safe {
    $Output = & $Command --version 2>$null
    return ($Output | Select-Object -First 1)
  } "missing"
}

function Get-ProcessDetail([int]$ProcessId) {
  if ($ProcessId -le 0) { return $null }
  Invoke-Safe {
    $Process = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction Stop
    if ($null -eq $Process) { return $null }
    return [ordered]@{
      pid = $Process.ProcessId
      parentPid = $Process.ParentProcessId
      name = $Process.Name
      executablePath = Mask-Text $Process.ExecutablePath
      commandLine = Mask-Text $Process.CommandLine
      startedAt = $Process.CreationDate
    }
  } $null
}

function Convert-TcpListener($Connection) {
  [ordered]@{
    localAddress = $Connection.LocalAddress
    localPort = [int]$Connection.LocalPort
    owningProcess = [int]$Connection.OwningProcess
    state = $Connection.State
    process = Get-ProcessDetail ([int]$Connection.OwningProcess)
    isLoopbackOnly = ($Connection.LocalAddress -in @("127.0.0.1", "::1"))
    isWildcardOrNonLoopback = -not ($Connection.LocalAddress -in @("127.0.0.1", "::1"))
  }
}

function Convert-UdpListener($Endpoint) {
  [ordered]@{
    localAddress = $Endpoint.LocalAddress
    localPort = [int]$Endpoint.LocalPort
    owningProcess = [int]$Endpoint.OwningProcess
    process = Get-ProcessDetail ([int]$Endpoint.OwningProcess)
    isLoopbackOnly = ($Endpoint.LocalAddress -in @("127.0.0.1", "::1"))
    isWildcardOrNonLoopback = -not ($Endpoint.LocalAddress -in @("127.0.0.1", "::1"))
  }
}

function Get-FirewallPortRules {
  Invoke-Safe {
    $Filters = Get-NetFirewallPortFilter -ErrorAction Stop | Where-Object {
      $_.Protocol -in @("TCP", "UDP") -and (
        $_.LocalPort -eq "Any" -or
        ($_.LocalPort -split "," | Where-Object { $_ -in ($KeyPorts | ForEach-Object { [string]$_ }) })
      )
    }
    $Rules = foreach ($Filter in $Filters) {
      $Rule = $Filter | Get-NetFirewallRule -ErrorAction SilentlyContinue
      if ($null -eq $Rule) { continue }
      [ordered]@{
        displayName = $Rule.DisplayName
        enabled = $Rule.Enabled
        direction = $Rule.Direction
        action = $Rule.Action
        profile = $Rule.Profile
        protocol = $Filter.Protocol
        localPort = $Filter.LocalPort
        remoteAddress = $Filter.RemoteAddress
      }
    }
    return @($Rules)
  } @()
}

function Get-RelevantProcesses {
  Invoke-Safe {
    $Items = Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object {
      $Name = [string]$_.Name
      $CommandLine = [string]$_.CommandLine
      foreach ($Pattern in $ProxyNames) {
        if ($Name -match $Pattern -or $CommandLine -match $Pattern) { return $true }
      }
      return $false
    }
    return @($Items | Select-Object ProcessId, ParentProcessId, Name, ExecutablePath, CommandLine, CreationDate | ForEach-Object {
      [ordered]@{
        pid = $_.ProcessId
        parentPid = $_.ParentProcessId
        name = $_.Name
        executablePath = Mask-Text $_.ExecutablePath
        commandLine = Mask-Text $_.CommandLine
        startedAt = $_.CreationDate
      }
    })
  } @()
}

$TcpListeners = Invoke-Safe { @(Get-NetTCPConnection -State Listen -ErrorAction Stop | Sort-Object LocalPort, LocalAddress | ForEach-Object { Convert-TcpListener $_ }) } @()
$UdpListeners = Invoke-Safe { @(Get-NetUDPEndpoint -ErrorAction Stop | Sort-Object LocalPort, LocalAddress | ForEach-Object { Convert-UdpListener $_ }) } @()
$FirewallProfiles = Invoke-Safe {
  @(Get-NetFirewallProfile -ErrorAction Stop | Sort-Object Name | ForEach-Object {
    [ordered]@{
      name = $_.Name
      enabled = [bool]$_.Enabled
      defaultInboundAction = [string]$_.DefaultInboundAction
      defaultOutboundAction = [string]$_.DefaultOutboundAction
    }
  })
} @()
$Established = Invoke-Safe {
  @(Get-NetTCPConnection -State Established -ErrorAction Stop | Select-Object -First 500 | ForEach-Object {
    [ordered]@{
      localAddress = $_.LocalAddress
      localPort = [int]$_.LocalPort
      remoteAddress = $_.RemoteAddress
      remotePort = [int]$_.RemotePort
      owningProcess = [int]$_.OwningProcess
      processName = (Get-Process -Id ([int]$_.OwningProcess) -ErrorAction SilentlyContinue).ProcessName
    }
  })
} @()

$Snapshot = [ordered]@{
  stage = "Stage 7.2b"
  mode = "read-only"
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  mutatingCommandsExecuted = $false
  os = Invoke-Safe {
    $Os = Get-CimInstance Win32_OperatingSystem -ErrorAction Stop
    [ordered]@{
      caption = $Os.Caption
      version = $Os.Version
      buildNumber = $Os.BuildNumber
      architecture = $Os.OSArchitecture
    }
  } $null
  user = [ordered]@{
    name = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    isAdministrator = Test-IsAdmin
  }
  runtime = [ordered]@{
    powershell = $PSVersionTable.PSVersion.ToString()
    node = Get-Version "node"
    npm = Get-Version "npm"
  }
  firewallProfiles = $FirewallProfiles
  tcpListeners = $TcpListeners
  udpListeners = $UdpListeners
  keyPortListeners = @($TcpListeners | Where-Object { $_.localPort -in $KeyPorts })
  nonLoopbackTcpListeners = @($TcpListeners | Where-Object { $_.isWildcardOrNonLoopback })
  nonLoopbackUdpListeners = @($UdpListeners | Where-Object { $_.isWildcardOrNonLoopback })
  firewallPortRules = @(Get-FirewallPortRules)
  relevantProcesses = @(Get-RelevantProcesses)
  establishedConnections = $Established
  riskSummary = [ordered]@{
    port3106LoopbackOnly = @(($TcpListeners | Where-Object { $_.localPort -eq 3106 -and $_.localAddress -in @("127.0.0.1", "::1") })).Count -gt 0
    port3107LoopbackOnly = @(($TcpListeners | Where-Object { $_.localPort -eq 3107 -and $_.localAddress -in @("127.0.0.1", "::1") })).Count -gt 0
    port3200NonLoopback = @(($TcpListeners | Where-Object { $_.localPort -eq 3200 -and $_.isWildcardOrNonLoopback })).Count -gt 0
    port55432NonLoopback = @(($TcpListeners | Where-Object { $_.localPort -eq 55432 -and $_.isWildcardOrNonLoopback })).Count -gt 0
    firewallProfilesDisabled = @(($FirewallProfiles | Where-Object { -not $_.enabled })).Count
  }
}

if ($Json) {
  $Snapshot | ConvertTo-Json -Depth 8
  exit 0
}

Write-Host "Stage 7.2b network exposure snapshot (read-only)"
Write-Host "Generated: $($Snapshot.generatedAt)"
Write-Host "Mutating commands executed: false"
Write-Host ""
Write-Host "OS: $($Snapshot.os.caption) $($Snapshot.os.version) build=$($Snapshot.os.buildNumber)"
Write-Host "User: $($Snapshot.user.name) admin=$($Snapshot.user.isAdministrator)"
Write-Host "Runtime: PowerShell=$($Snapshot.runtime.powershell) node=$($Snapshot.runtime.node) npm=$($Snapshot.runtime.npm)"
Write-Host ""
Write-Host "Firewall profiles:"
foreach ($Profile in $Snapshot.firewallProfiles) {
  Write-Host "  $($Profile.name): enabled=$($Profile.enabled) inbound=$($Profile.defaultInboundAction) outbound=$($Profile.defaultOutboundAction)"
}
Write-Host ""
Write-Host "Key TCP listeners:"
foreach ($Listener in $Snapshot.keyPortListeners) {
  Write-Host "  $($Listener.localAddress):$($Listener.localPort) pid=$($Listener.owningProcess) process=$($Listener.process.name) loopbackOnly=$($Listener.isLoopbackOnly)"
}
Write-Host ""
Write-Host "Non-loopback TCP listener ports:"
($Snapshot.nonLoopbackTcpListeners | ForEach-Object { "  $($_.localAddress):$($_.localPort) pid=$($_.owningProcess)" }) -join [Environment]::NewLine
Write-Host ""
Write-Host "Firewall rules matching key ports: $(@($Snapshot.firewallPortRules).Count)"
Write-Host "Relevant proxy/database/NewAPI processes: $(@($Snapshot.relevantProcesses).Count)"
Write-Host "Established connections sampled: $(@($Snapshot.establishedConnections).Count)"
Write-Host ""
Write-Host "Risk summary:"
Write-Host "  3106 loopback only: $($Snapshot.riskSummary.port3106LoopbackOnly)"
Write-Host "  3107 loopback only: $($Snapshot.riskSummary.port3107LoopbackOnly)"
Write-Host "  3200 non-loopback: $($Snapshot.riskSummary.port3200NonLoopback)"
Write-Host "  55432 non-loopback: $($Snapshot.riskSummary.port55432NonLoopback)"
Write-Host "  disabled firewall profiles: $($Snapshot.riskSummary.firewallProfilesDisabled)"
