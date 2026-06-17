# New API License Boundary

## License Type

The official repository license is **GNU Affero General Public License v3.0 (AGPLv3)**.

Sources:

- [LICENSE](https://github.com/QuantumNous/new-api/blob/main/LICENSE)
- [README](https://github.com/QuantumNous/new-api/blob/main/README.md)

## Official Attribution Terms

The official project adds attribution requirements in `NOTICE` and the README:

- preserve the notice `Frontend design and development by New API contributors.`
- keep a visible link back to the official repository in the UI

This is an official project requirement, not a local preference.

## Practical Boundary

| Scenario | Risk posture |
| --- | --- |
| Deploy unmodified upstream code | Lower operational risk, but still subject to AGPLv3 terms |
| Modify and serve a networked derivative | Higher compliance burden because AGPLv3 source-offer obligations apply |
| Reuse only official APIs and keep this project's own UI | Safer for this repo's separation goals |
| Copy New API UI, branding, or backend pages | Conflicts with the project's stated boundary and increases derivative-code risk |

## Integration Position For This Project

Line B may integrate with New API as a separately deployed backend service and document API contracts for the BFF. It must not import or copy New API frontend code, pages, icons, layout, or brand treatment into this repository. If future work modifies New API itself, that must be treated as a separate compliance review, not as normal BFF integration.

## What This Project Should Not Do

- Do not copy New API UI assets or page composition.
- Do not treat New API as a design source for this project's frontend.
- Do not present modified upstream branding as if it were original project work.

## Risk Note

This file does not give legal advice. It only records the official license boundary and the project-side decision to avoid copying New API UI or branding.
