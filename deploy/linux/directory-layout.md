# Linux Directory Layout

Recommended server layout:

```text
/opt/aohuang-ai/
  releases/
    <release-id>/
  current -> /opt/aohuang-ai/releases/<release-id>

/var/lib/aohuang-ai/
  data/
  uploads/
  runtime/
  backups/

/etc/aohuang-ai/
  production.env
```

## Ownership

Use a dedicated low-privilege service account:

```text
user:  aohuang-ai
group: aohuang-ai
```

Recommended ownership:

| Path | Owner | Mode | Notes |
| --- | --- | --- | --- |
| `/opt/aohuang-ai/releases/<release-id>` | root or deploy owner | `0755` | Immutable code release after install. |
| `/opt/aohuang-ai/current` | root or deploy owner | symlink | Points to the active release. |
| `/var/lib/aohuang-ai/data` | `aohuang-ai:aohuang-ai` | `0750` | Persistent app data and JSON stores. |
| `/var/lib/aohuang-ai/uploads` | `aohuang-ai:aohuang-ai` | `0750` | Generated and uploaded media. |
| `/var/lib/aohuang-ai/runtime` | `aohuang-ai:aohuang-ai` | `0750` | Runtime cache, npm cache, and operational scratch. |
| `/var/lib/aohuang-ai/backups` | root or backup operator | `0750` | Backup artifacts outside Git and releases. |
| `/etc/aohuang-ai/production.env` | `root:root` or `root:aohuang-ai` | `0600` or `0640` | Private environment file; never commit it. |

The service unit uses `ProtectSystem=strict` and grants write access only to the
data, uploads, and runtime directories.

## Release IDs

Use an explicit release ID such as:

```text
20260701-<git-sha>
```

The active symlink should move only after the release has passed local install
checks, `npm run env:check:production`, `npm run release:preflight`, and the
operator's deployment gate. Do not deploy a branch directly to the server; merge
through `main` first.

## 3106 And 3107 Boundary

3106 is the only server runtime. 3107 is reserved for the development computer
and must not have systemd units, Nginx server blocks, or server data directories.

## Storage Boundaries

`DATA_DIR`, `UPLOADS_DIR`, and `RUNTIME_DIR` must be separate persistent Linux
absolute paths. They must not point into:

- `.next`
- `node_modules`
- a temporary release directory
- `/tmp`
- a public web root

Nginx must not serve `data`, `uploads`, `runtime`, or `backups` directly.
Application downloads should continue to go through authenticated app routes.
