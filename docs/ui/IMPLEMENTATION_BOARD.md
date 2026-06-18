# IMPLEMENTATION_BOARD

## Module 1 Board

| Item | Status | Notes |
| --- | --- | --- |
| Baseline comparison | Done | Local `HEAD` and `origin/main` were compared. |
| Safety snapshot branch | Done | Current branch is `backup/pre-ui-rebuild-2026-06-17`. |
| Feature audit | Done | Routes and current surface were identified from source. |
| Reuse audit | Done | Main reuse candidates are `StudioApp`, `BrandLogo`, `AdminProvidersClient`, and server helpers. |
| Failure log | Done | Historical `/login` and `/admin/providers` blockers are archived in `KNOWN_BASELINE_FAILURES.md`; current verification snapshot passes. |
| Screenshot archive | Done | Curated current-state screenshots were copied into `docs/design-references/current-before-rebuild/`. |
| Secrets scan | Done | Repo scan ran; no committed secret strings were found in the module 1 docs. |
| Verification snapshot | Done | `npm ci`, `npm run lint`, `npm run typecheck`, `npm run build`, and HTTP checks on `/`, `/login`, `/admin/providers` all passed in the current worktree. |

## Follow-up Rules

- Do not move to module 2 before user confirmation.
- Keep every completed checkpoint pushable on its own.

## Module 3 Board

| Item | Status | Notes |
| --- | --- | --- |
| Module 3 segment 1 | Done | Root cause and recovery plan documented. |
| Module 3 segment 2 | Done | Business-preserving responsive shell repair was pushed to PR #3. |
| Module 3 segment 3 | Done | Final state, mobile actions, drawer focus, screenshots, and acceptance checks completed. |
| Module 3 final acceptance patch | Done | Mobile Drawer full-name display, Issue verification, refreshed screenshots, and PR text cleanup completed. |
| Module 4 | Done, awaiting human review | Segment 3 browser acceptance, screenshots, checks, and PR update completed on `feature/04-image-workspace`. |

## Module 4 Board

| Item | Status | Notes |
| --- | --- | --- |
| Module 4 segment 1 | Done | Branch, A/B boundary, and image workspace audit completed. |
| Module 4 segment 2 | Done | Real image generator/editor workspace implementation completed and pushed. |
| Module 4 segment 3 | Done | Real browser acceptance, screenshots, docs, quality checks, and PR update completed. |
| Module 4 final accessibility patch | Done | Selection semantics, prompt counter announcements, labels, keyboard checks, and Unicode safety scan completed. |
| Module 4 | Done | PR #11 was approved and merged to `develop`. |
| Module 5 segment 1 | Done | Visual baseline screenshots, audit matrix, component ownership, and implementation plan completed for review. |
| Module 5 segment 2 | Done | Shell hierarchy cleanup and shared visual controls implemented. |
| Module 5 segment 3 | Done | After screenshots, visual comparison, browser acceptance, docs, and Draft PR completed. |
| Module 5 final patch 2 | Done | Image workspace mode regression, segmented controls, ratio visuals, color hierarchy, sticky action, Unicode scan, and refreshed screenshots completed. |
| Module 5 final visual closeout | Done | Ratio selected state finalized with transparent outer surface and clean production screenshots captured. |
| Module 5 | Done | PR #18 was approved and merged to `develop`. |
| Module 6 segment 1 | Done | Video workspace audit, mode-difference matrix, and implementation plan completed and pushed. |
| Module 6 segment 2 | Done | Text-to-video and image-to-video now differ in parameters, validation, payload behavior, preview state, and mobile/desktop submit state. |
| Module 6 segment 3 | Done | Production browser acceptance, screenshot evidence, docs, checks, push, and Draft PR completed. |
| 模块 6 最终补修 | 已完成 | 图生视频单首帧契约、API 校验、真实上传/替换/删除验收、移动端 loading 文案代码修正、Unicode 扫描和证据修正完成。 |
| 模块 6 | 已完成 | PR #22 was approved and merged to `develop`. |
| 模块 7 第 1 段 | 已完成 | Image upscale audit, local Upscayl chain review, security review, and implementation plan are documented. |
| 模块 7 第 2 段 | 已完成 | First usable image upscale workspace is implemented on the real local Upscayl flow. |
| 模块 7 第 3 段 | 已完成 | Upscayl acceptance evidence, unavailable-state screenshots, docs, and quality checks completed. |
| 模块 7 最终补修 | 已完成 | Local Upscayl is installed and real 2x/4x integration passed with source/output dimensions, download verification, Unicode scan, and refreshed evidence. |
| 模块 7 | 已完成 | PR #24 was approved and merged to `develop`. |
| 模块 8 | 已完成 | PR #26 was approved and merged to `develop`. |
| 模块 9 | 第一版已完成，等待人工检查 | Real local works library, preview, download, delete, missing-file state, docs, checks, and Draft PR were completed on `feature/09-library`. |
| 模块 9 最终补修 | 已完成 | Safe delete flow now removes real files before metadata, returns `404` for absent works, and clears related jobs through the jobs write queue. |
| 模块 10 | 阻塞 | Do not start until module 9 is manually approved. |
