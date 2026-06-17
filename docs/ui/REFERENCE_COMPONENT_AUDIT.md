# REFERENCE_COMPONENT_AUDIT

## Desktop Reference Summary

- Video page: left rail + middle form + right guidance rail.
- Image page: left rail + middle form + right sample rail.
- Common pattern: dark panels, thin borders, compact typography, pink accent, clear active state.

## Mobile Reference Summary

- Workspace moves to one column with a fixed bottom nav.
- Login/admin surfaces stay narrow and stacked.
- Ratio controls remain compact and readable.

## Component Mapping

| Reference Element | Current Project Match | Reuse Direction |
| --- | --- | --- |
| Top bar | `src/components/studio-app.tsx` shell header area | visual-only alignment later |
| Sidebar nav | `src/components/studio-app.tsx` nav rail | preserve logic, restyle later |
| Control panel | `src/components/studio-app.tsx` center column | reuse structure |
| Right rail | `src/components/studio-app.tsx` output/help column | keep role, refine presentation |
| Login surface | `src/components/customer-login.tsx` | keep route, restyle later |
| Admin providers | `src/components/admin-providers-client.tsx` | keep route, restyle later |

## Behavior Notes

- The reference site is more sample-driven than the current app.
- The current project remains more task-centric and should not be turned into a clone of the reference feature set.
