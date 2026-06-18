# REVIEW_GATES

## Gates

1. Collect subagent reports first.
2. Total control summarizes, it does not self-approve.
3. Confirm freeze scope before any next-module work.
4. Confirm sensitive-data scan before any push.
5. Confirm screenshot archive is filtered and redacted.
6. Confirm `/login` failure is documented, not silently repaired in module 1.
7. Confirm develop is the PR target.
8. Confirm template carousel is audit-dependent, not pre-banned.
9. Confirm Template Strip remains audit-dependent and is not auto-added from the reference site.
10. Confirm login, registration, and account entry are preserved capabilities and are not replaced by marketing-only entry points.
11. Confirm the shell work does not replace a real app entry with a static demo page.
12. Confirm the shell does not create fake login state, fake balances, or a second tool-state source.
13. Confirm responsive behavior is driven by CSS and tokens first, not first-render viewport JavaScript.
14. Confirm screenshots are taken only after hydration, fonts, and layout are stable.
15. Confirm screenshot filenames match the actual viewport size.
16. Confirm no merge request is filed until screenshot comparison and feature-preservation checks are complete.
17. Confirm `AI 图片编辑器` remains a real tool registration decision tied to current code and freeze evidence, not a reference-site assumption.

## Sensitive Data

- No secrets were intentionally committed in module 1.
- Browser caches, temporary logs, and chrome profile data must stay out of the repo.
- Repo scan completed on current tracked docs; no committed secret strings were found in module 1 additions.
- Screenshot and log archives must stay redacted before they are referenced or copied into the repo.
- Shell-rebuild screenshots and logs must remain filtered, non-sensitive, and workspace-local only.

## Approval Rule

- No module 2 work starts until the user explicitly confirms module 1 is acceptable.

## Module 3 Gate

- PR #3 must not merge until code repair and real screenshot verification are complete.
- PR #3 must not merge until the browser checks prove desktop, tablet, mobile, login, drawer, and library behavior.
- Module 4 must not start until all three module 3 segments are complete and manually approved.
- Build passing does not prove the page is correct.
- Final screenshots must come from the real running page, not a static mock.
- Final screenshots for PR #3 must come from the latest HEAD and must not show a Next.js Issue badge.

## Module 4 Gate

- Module 4 must not merge until it has human review and approval.
- Module 4 must not proceed to module 5 until the user explicitly approves it.
- If no real model is configured, do not replace the missing real generation/edit result with a fake model, mock result, or static success state.
- Build passing does not prove image workspace interaction is correct.
- Final module 4 screenshots must come from the real running app at the latest branch head.
- A-side module 4 must not modify B-side New API, authentication, quota, payment, Docker, database, Redis, BFF, callback, reconciliation, or port configuration.
- Button-based selected controls must expose selection semantics with `aria-pressed` or another correct role-specific state.
- Mobile parameter/preview tabs must expose `role="tablist"`, `role="tab"`, `aria-selected`, and `aria-controls`.
- Module 4 final review must include a bidi Unicode control-character scan over `src/` and `docs/`.

## Module 5 Gate

- Module 5 must not proceed to module 6 until it is manually approved.
- Feature modules must not casually rebuild global visual structure while implementing business features.
- Shared component changes must include before/after screenshots.
- Build passing does not prove visual correctness.
- Module 5 must not restore the old five-step shoe-ad workflow, white workspace, fluorescent green brand color, narrow AI Inspector, or Shoe Ad Studio page.
- Module 5 must not modify B-side New API, authentication, quota, payment, Docker, database, Redis, BFF, callback, reconciliation, or port configuration.
- When no real model is configured, the UI must keep the real unavailable state and must not introduce fake models, fake balances, or fake results.
- Public shell screenshots must verify Header, Sidebar, parameter panel, preview panel, mobile Drawer, mobile tabs, and horizontal overflow.
- WorkbenchShell must remain a layout shell only: no fake account state, no fake model state, no fixed business preview copy, and no second submit path.
- Shared controls in module 5 must stay controlled by existing tool state and must not own model, upload, prompt, job, or result business data.
- Module 5 must not merge until the before/after screenshot set and visual comparison table have human review.
- Module 5 Draft PR must explicitly state that module 6 has not started and B-side New API/auth/quota/payment code was not modified.
- Module 5 final visual evidence must come from a clean production preview, not a stale dev server or static mock.
- Production evidence must verify CSS and JS chunks load successfully; a passing build alone is not sufficient visual acceptance.

## Module 6 Gate

- Module 6 must not proceed to module 7 until it is manually approved.
- Module 6 must not merge until segment 3 browser evidence, quality checks, and Draft PR text have human review.
- `text-to-video` and `image-to-video` must be genuinely different in validation, copy, empty state, and request behavior before acceptance.
- When no real video model is configured, do not replace the unavailable state with a mock video result, fake progress, or static success state.
- Module 6 must reuse the module 5 visual foundation and must not redesign Header, Sidebar, ratio controls, upload controls, primary action, preview shell, or scrollbar behavior.
- A-side module 6 must not modify B-side New API, authentication, quota, payment, Docker, database, Redis, BFF, callback, reconciliation, or port configuration.
- If the current provider API exposes no capability fields, A-side code must record the limitation and must not hard-code guessed vendor capability maps.
- Image-to-video accepts exactly one first-frame image. Zero files and more than one file must be rejected by both the UI contract and API validation; screenshots must not label an unuploaded state as uploaded.
- Module 6 upload evidence must verify real upload, replace, delete, and object URL cleanup, or explicitly record the automation limitation instead of using a fake uploaded state.

## Module 7 Gate

- Module 7 must not proceed to module 8 until it is manually approved.
- A-side module 7 must not modify B-side New API, authentication, quota, payment, Docker, database, Redis, BFF, callback, reconciliation, or port configuration.
- Module 7 must not modify video upscale business while repairing image upscale.
- Image upscale remains a local processing capability and must not be converted into a New API model call.
- The local Upscayl dependency must be truly detected before the UI marks image upscale as available.
- When the local dependency is missing, the UI must show a real dependency-missing state and must not fake processing or success.
- No static sample image may be used as an accepted image-upscale result.
- Download actions must point only to real stored output files created by the local process.
- Normal workspace errors must not expose local absolute executable paths, model paths, command lines, secrets, or full stack traces.
- Module 7 must keep the module 5 visual foundation and must not redesign Header, Sidebar, upload controls, primary action, preview shell, or scrollbar behavior.
