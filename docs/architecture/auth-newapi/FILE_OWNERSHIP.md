# Parallel Line B File Ownership

## B01 Allowed Files

B01 may only add documentation needed to establish the isolated workstream:

- `docs/architecture/auth-newapi/**`
- `docs/ui/PARALLEL_WORK_MATRIX.md`

## Main Line A Exclusive Files

Parallel line B must not modify these files or surfaces:

- `src/app/page.tsx`
- `src/components/workbench-shell*`
- `src/components/studio-app*`
- Frontend header code.
- Frontend sidebar code.
- Workbench root layout.
- Official frontend navigation.
- `styles/tokens.css`
- `src/app/globals.css`
- Shared public UI components.
- Module 3 screenshot and visual acceptance files.

## Restricted Shared Files

These files are not modified by default:

- `package.json`
- Public database schema files.
- Public route registry files.
- `AGENTS.md`

If a later backend module truly needs one of these files, the module must document the reason first, make the smallest possible change, and call it out separately in the pull request.

## Conflict Rules

- Do not resolve conflicts by overwriting a whole file from either side.
- Preserve main line A ownership when a conflict touches frontend shell or visual files.
- Preserve line B ownership when a conflict touches backend authentication or New API documents.
- Prefer narrow manual conflict resolution with a clear note in `EXECUTION_LOG.md`.
- Stop if the safe owner of a conflicting change is unclear.
