# Stage 9D Import Dry-Run

Stage 9D only adds a dry-run plan for future database import. It does not perform a real import.

## Commands

```powershell
npm run db:import:dry-run
npm run db:library-import:plan
```

`db:import:dry-run` wraps the Stage 9C-B planner with an isolated temporary fixture so CI and local checks can prove the path remains read-only.

## Reported Mapping

The dry-run reports:

- `data/library.json -> library_items/assets`
- `data/jobs.json -> generation_jobs`
- uploads file mapping into `assets`
- estimated `library_items`
- estimated `assets`
- estimated `generation_jobs`
- unmappable or conflict counts
- import order

## Hard Boundary

Stage 9D import dry-run must keep all of the following false:

- dry-run only = false
- real import executed = true
- production data changed = true
- production uploads changed = true
- staging data changed = true
- staging uploads changed = true

It must not print raw prompts, raw provider responses, API keys, Authorization headers, cookies, or database URLs.

## Authorization

A future real import still requires:

- copied dataset or maintenance window
- backup manifest
- checksum snapshot
- restore rehearsal
- separate user authorization
- explicit Stage 9E approval
