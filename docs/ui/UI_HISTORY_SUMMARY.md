# UI History Summary

This file keeps the durable lessons from the retired module-by-module UI
implementation notes. The detailed historical module reports were consolidated
after the small-test release candidate because current behavior is validated by
the running app, screenshots under `docs/design-references/`, release QA, and
the active source code.

## Durable Rules

- Keep `StudioApp` and related feature components as the business-state owners.
  `WorkbenchShell` is layout only.
- Do not reintroduce fake login state, fake balances, fake quota, fake models,
  fake progress, or fake success results.
- Prefer CSS breakpoints and design tokens over JavaScript viewport state for
  first-frame layout.
- Keep A-side visual work separate from B-side backend concerns: New API,
  authentication, sessions, quotas, billing, payments, database, Docker, Redis,
  BFF, callbacks, and reconciliation.
- API keys and provider secrets stay out of committed files and out of client
  bundles.
- Build success is not visual proof. Screenshot and browser checks must use the
  real running app after hydration and layout stability.

## Workspace Lessons

- Module 3 replaced the failed shell-only pass with the real application entry.
  The root page renders the real app container, not a static demo shell.
- Image generation and image editing share one form path and one submit path.
  The internal mode changes validation, labels, preview state, and payload
  shape without creating duplicate business state.
- Video text-to-video and image-to-video share the video workspace but keep
  mode-specific upload requirements, empty states, validation, and disabled
  states.
- Library cards render real records only. Empty and filtered-empty states must
  not show sample works as if they were generated output.

## Local Processing Lessons

- Image upscale is a local Upscayl flow. Keep missing-dependency states honest,
  and do not replace them with static success examples.
- Video upscale is a local Video2X flow. Success evidence should include real
  playback, source/output dimensions, duration, download checks, and sanitized
  error handling.
- Temporary processing files should be cleaned after success or failure; stored
  output files should be deleted before metadata is removed.

## Visual And Component Lessons

- Keep the dark workspace hierarchy quiet: one shell, one parameter panel, one
  preview area, restrained borders, and token-driven color.
- Shared controls such as segmented modes, aspect-ratio choices, upload
  surfaces, preview states, and sticky primary actions must remain controlled
  display components. They must not own hidden business state.
- Preview content should describe current state, not repeat the active tool
  name in several places.
- Example media must be labeled as example guidance and must not look like a
  completed user result when the library count is zero.

## Acceptance Evidence

- The detailed screenshots and browser evidence remain under
  `docs/design-references/`.
- Final release validation remains in
  `docs/architecture/auth-newapi/FINAL_QA_REPORT.md`.
- Cleanup candidates and retention decisions are tracked in
  `docs/CLEANUP_AUDIT.md`.
