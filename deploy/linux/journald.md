# Journald Logging

The Linux templates use systemd journal logging by default. The service units do
not write API keys, database passwords, admin passwords, cookies, tokens, or
environment values into command lines.

## Suggested Journal Policy

Configure retention in `/etc/systemd/journald.conf` according to the final
server disk budget. A conservative starting point for a 60GB server is:

```ini
SystemMaxUse=1G
SystemKeepFree=5G
MaxRetentionSec=14day
Compress=yes
```

Restarting journald is an operator action and is not part of these templates.

## Safe Review

Use service-scoped journal queries when reviewing production behavior:

```bash
journalctl -u aohuang-ai.service --since "1 hour ago"
journalctl -u aohuang-media-cleanup.service --since "24 hours ago"
```

Do not paste raw logs into tickets or chat if they may contain prompts, user
content, provider diagnostics, request headers, cookies, tokens, stack traces, or
database connection material.

## Cleanup Logs

The media cleanup service should report counts, sizes, item IDs, and safe
relative paths only. It must not print prompts, provider secrets, private user
content, or environment variable values.
