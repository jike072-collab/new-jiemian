# MODULE_OWNERSHIP

## Module 1

- Owner: total-control auditor
- Collaborators: feature-auditor, reuse-auditor, git-manager, reviewer
- Allowed changes: `AGENTS.md`, `.gitignore`, `.github/**`, `docs/**`
- Forbidden changes: `src/**`, UI styling, API shapes, business logic
- Public components: no ownership changes
- Routes: no ownership changes
- Frontend/build config: no ownership changes

## Protected Single-Owner Files For Later Work

- root layout
- routing
- global CSS
- design tokens
- public export files
- `package.json`
- build config
- `AGENTS.md`

## Branch Rules

- `main`: final stable release only
- `develop`: single PR target for this module
- `backup/*`: safety snapshot branches
- `feature/*`: task branches for controlled follow-up work
