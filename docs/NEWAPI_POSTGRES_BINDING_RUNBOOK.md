# NewAPI And PostgreSQL Binding Runbook

Stage 7.2b only prepares a binding runbook. It does not change NewAPI,
PostgreSQL, firewall, reverse proxy, HTTPS, 3106, 3107, data, or uploads.

## NewAPI Local Binding

Observed risk: NewAPI was seen on `:::3200`, a wildcard IPv6 listener. If no
approved remote caller exists, the recommended target is `127.0.0.1:3200`.
The observed runtime was a standalone exe, not the repository Docker Compose
stack whose default example uses local binding. Treat the actual service manager
and startup command as the source of truth for a future maintenance window.

Before a later change:

- identify the NewAPI service manager or startup command;
- locate its environment/config source without printing secrets;
- confirm whether 3106 and 3107 call it only through local host;
- confirm whether any upstream proxy or external service depends on direct
  access;
- back up the config and startup metadata.

Future change concept:

```text
Set NewAPI bind host to 127.0.0.1.
Restart only NewAPI after separate authorization.
Verify http://127.0.0.1:3200 local health or equivalent admin health.
Verify external direct access is blocked or unreachable.
```

Do not expose raw NewAPI publicly unless a separately approved HTTPS reverse
proxy, authentication, and rate-limit plan exists.

## PostgreSQL Local Binding

Observed risk: PostgreSQL was seen on `0.0.0.0:55432` and `:::55432`. If NewAPI
and application services are same-host clients, the recommended target is
`127.0.0.1:55432`.
The read-only audit observed `listen_addresses = '*'`, `port = 55432`, and
local-only `pg_hba.conf` entries using `127.0.0.1/32`, `::1/128`, and
`scram-sha-256`. The listener is still wider than needed when no approved remote
client exists.

Before a later change:

- locate `postgresql.conf`;
- locate `pg_hba.conf`;
- record `listen_addresses`;
- review `pg_hba.conf` for `0.0.0.0/0`, `::/0`, broad LAN ranges, and `trust`;
- list approved remote clients as masked source ranges only;
- record any pgpass, cookie, admin-token, or env secret file as
  `present_not_read`, never by content;
- back up config files and the current service state.

Future change concept:

```text
Set listen_addresses to 127.0.0.1 when remote clients are not approved.
Reduce pg_hba.conf to local entries and exact approved sources only.
Restart PostgreSQL only after separate authorization.
Verify local NewAPI and app database access.
Verify external direct access is blocked or unreachable.
```

## Validation

After a later authorized binding change:

- 3106 `/api/health/backend` returns 200.
- 3106 `/api/library` returns 200.
- 3107 `/api/health/backend` returns 200.
- 3107 `/api/library` returns 200.
- NewAPI remains reachable from local expected callers.
- PostgreSQL remains reachable from local expected callers.
- NewAPI is not listening on wildcard addresses unless explicitly approved.
- PostgreSQL is not listening on wildcard addresses unless explicitly approved.
- No generation endpoint or NewAPI generation endpoint is called.
- data/uploads and data-staging/uploads-staging checksums remain unchanged.

## Rollback

Rollback for a later authorized change:

1. Restore backed-up NewAPI binding config if NewAPI was changed.
2. Restore backed-up `postgresql.conf` and `pg_hba.conf` if PostgreSQL was
   changed.
3. Restore firewall policy if firewall rules were changed.
4. Restart only the service that was changed, and only with explicit
   authorization.
5. Re-run local health, listener, and checksum verification.

## Restart And Authorization

Changing NewAPI binding may require a NewAPI restart. Changing PostgreSQL
`listen_addresses` or `pg_hba.conf` may require a PostgreSQL reload or restart.
Those actions are not allowed in Stage 7.2b and require a later, separate user
authorization. 3106 restart or production release remains separately forbidden
unless the user explicitly authorizes it.
