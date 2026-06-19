# Parallel Work Matrix

## Ownership Matrix

| Area | Main line A | Parallel line B |
| --- | --- | --- |
| Workbench shell | Owns | Does not modify |
| Public visual design | Owns | Does not modify |
| Responsive layout | Owns | Does not modify |
| Login and registration visuals | Owns | Provides backend contracts only |
| Admin visuals | Owns | Provides backend contracts only |
| Authentication backend | Reviews integration needs | Owns |
| Secure sessions | Reviews UI contract needs | Owns |
| New API deployment research | Not responsible | Owns |
| New API BFF | Not responsible | Owns |
| User mapping | Not responsible | Owns |
| Quota and usage | Not responsible | Owns |
| Billing sandbox | Not responsible | Owns |

## Protected Main Line A Files

Parallel line B must not modify:

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
- Module 3 screenshots and visual acceptance files.

## Coordination Rules

- Line B may document future UI contract needs, but must not implement official UI.
- Line B may add backend API contracts in later authorized modules, but must not change public route registries unless a module explicitly allows it.
- If frontend and backend work collide, preserve both diffs manually. Do not overwrite a whole file to resolve conflicts.
- Stop and record the blocker if conflict ownership is unclear.
