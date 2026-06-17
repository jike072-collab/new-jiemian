# REFERENCE_COMPONENT_AUDIT

## Desktop Reference Summary

- Video page: left rail + middle form + right guidance rail.
- Image page: left rail + middle form + right sample rail.
- Common pattern: dark panels, thin borders, compact typography, pink accent, clear active state.

## Mobile Reference Summary

- Reference observed: workspace moves to one column with a fixed bottom nav.
- Project target: one column with a drawer or collapsible navigation, tabs for parameters and preview, and a fixed bottom generate action with safe-area spacing.
- Login/admin surfaces stay narrow and stacked.
- Ratio controls remain compact and readable.

## Component Mapping

| Reference Element | Current Project Match | Reuse Direction |
| --- | --- | --- |
| Top bar | `src/components/studio-app.tsx` shell header area | visual-only alignment later |
| Sidebar nav | `src/components/studio-app.tsx` nav rail | preserve logic, restyle later |
| Control panel | `src/components/studio-app.tsx` center column | preserve state, events, API calls, upload and generation logic; visual structure to be revalidated later |
| Right rail | `src/components/studio-app.tsx` output/help column | preserve role and logic only; visual structure to be revalidated later |
| Login surface | `src/components/customer-login.tsx` | keep route, restyle later |
| Admin providers | `src/components/admin-providers-client.tsx` | keep route, restyle later |

## Behavior Notes

- The reference site is more sample-driven than the current app.
- The current project remains more task-centric and should not be turned into a clone of the reference feature set.
- `studio-app.tsx` is a business-logic source only; it must not be treated as a layout skeleton without visual comparison.
- Any old layout component should be treated as pending comparison rather than automatically reusable as a new layout shell.
