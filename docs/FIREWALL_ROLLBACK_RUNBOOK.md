# Firewall Rollback Runbook

Stage 7.2b does not change firewall configuration. This runbook defines the
rollback material and emergency path required before a later authorized firewall
maintenance window.

## Required Backups

Before any firewall change, save:

- full firewall policy export as `.wfw`;
- text snapshot of Domain, Private, and Public profile states;
- text snapshot of relevant inbound rules for management, 3106, 3107, 3200, and
  55432;
- current TCP/UDP listener snapshot;
- 3106 PID, commit, data checksum, uploads checksum;
- 3107 PID, commit, data-staging checksum, uploads-staging checksum;
- NewAPI and PostgreSQL binding/config backups if they will be changed in the
  same maintenance stage.

## Export Current Policy

The future maintenance operator should export the current policy before any
change. Example command text:

```powershell
netsh advfirewall export C:\rollback\firewall-before-stage7-2c.wfw
Get-NetFirewallProfile | Format-List * > C:\rollback\firewall-profiles.txt
Get-NetFirewallRule -Direction Inbound | Format-Table -AutoSize > C:\rollback\firewall-inbound-rules.txt
```

These commands are examples for a later stage. They are not executed by Stage
7.2b.

## Preserve Remote Management

Do not enable firewall profiles until the active remote-management channel is
known and allowed. The operator must confirm:

- access method, such as console, RDP, SSH, provider console, or remote-control
  product;
- local listening port or tunnel dependency;
- trusted remote source where practical;
- a second recovery path if the primary session drops;
- a rollback shell remains open.

## Immediate Recovery

If the remote session drops or app health fails after a later firewall change:

1. Use the still-open shell, provider console, or physical console.
2. Import the saved firewall policy.
3. Re-check profile and inbound rule state.
4. Verify 3106 and 3107 health.
5. Stop the maintenance stage and preserve logs.

Example command text:

```powershell
netsh advfirewall import C:\rollback\firewall-before-stage7-2c.wfw
```

If the export is unavailable, the emergency operator may need to disable a
specific newly added rule or profile, but that decision requires explicit
authorization because it changes host security posture.

## Restore Policy

The preferred rollback is policy import from the saved `.wfw` file. After import:

- confirm remote-management access is stable;
- confirm NewAPI and PostgreSQL listeners are back to the expected state;
- confirm 3106 PID and commit did not change;
- confirm 3106 data/uploads checksums did not change;
- confirm 3107 data-staging/uploads-staging checksums did not change;
- record any difference for incident review.

## Avoid Remote Lockout

Apply firewall changes in the smallest possible sequence. Allow management first,
verify the live session after each step, keep a second recovery channel open, and
avoid combining firewall profile enablement with NewAPI/PostgreSQL binding
changes in a single unreviewed action.

## Authorization Points

Separate authorization is required before:

- enabling or disabling a firewall profile;
- adding, changing, or removing a firewall rule;
- importing a firewall policy;
- changing NewAPI binding;
- changing PostgreSQL `listen_addresses` or `pg_hba.conf`;
- restarting NewAPI or PostgreSQL;
- restarting, stopping, publishing, or rolling back 3106.
