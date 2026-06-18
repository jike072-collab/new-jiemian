# 奥皇 AI Project Notes

## Stack

- Next.js 16 App Router
- React 19
- TypeScript strict
- Tailwind CSS v4

## Module 1 Baseline Rules

- This workspace is frozen as a recoverable baseline before any UI rebuild work.
- The first baseline check must compare `git fetch origin`, `git status --short --branch`, `git rev-parse HEAD`, `git rev-parse origin/main`, and `git log --left-right --graph --oneline HEAD...origin/main`.
- Do not assume any local commit, including `main @ 8aea575`, is the baseline before comparing local and remote state.
- Do not force-push or overwrite remote history.
- If the local worktree has unpushed commits or stray state, create `backup/pre-ui-rebuild-<YYYY-MM-DD>` first and push that snapshot before any later branches.
- After the confirmed baseline is known, create `develop`, then create `feature/01-project-baseline` from `develop`.
- One module keeps one PR. Multiple atomic commits are allowed, but the safety snapshot and the audit docs must be pushed as separate checkpoints.
- The PR target for this module is `develop`; `main` is reserved for final stable release only.

## Ownership and Review Gates

- Module 1 may only change `AGENTS.md`, `.gitignore`, `.github/**`, and `docs/**`.
- Do not modify `src/**`, page styles, interfaces, data structures, or business logic in this module.
- Do not skip subagent audit output. The controller must wait for the feature auditor, reuse auditor, git manager, and reviewer before concluding.
- Root layout, routing, global CSS, design tokens, public exports, `package.json`, build config, and `AGENTS.md` must each have a single owner in later modules.

## Product Boundaries

- Keep the app as a local-first AI tool studio.
- Do not reintroduce the old Shoe Ad Studio five-step ad workflow.
- API keys must never be committed. Keep runtime secrets in `.env.local` or local `data/` files only.
- Image upscale uses the local Upscayl CLI, and video upscale uses the local Video2X CLI. Keep both integrations local-first and API-key-free.

## Module 3 Recovery Rules

- Do not replace a real application entry with a static shell page.
- Review `docs/ui/FEATURE_FREEZE.md` before any shell, layout, or responsive work.
- Do not create fake login state, fake balances, or a second tool-state source.
- Prefer CSS media queries and layout tokens over first-render JavaScript viewport decisions.
- New or rebuilt surfaces must use Design Tokens; do not hardcode new hex colors in the shell.
- Keep at most one panel border and one control border per region.
- Wait for hydration, font load, and layout stability before taking screenshots.
- Screenshot filenames must match the actual `window.innerWidth` and `window.innerHeight`.
- Passing build checks does not mean the layout is visually correct.
- Do not request merge until screenshot comparison and feature-preservation checks are complete.
- Treat `AI 图片编辑器` as a real current capability decision, not as a reference-site invention.

## Module 5 Visual Foundation Rules

- Feature modules must not redesign the public shell as a side effect of business work.
- Tool pages must not copy shared shell titles, ratio controls, upload controls, preview states, or primary-action layouts.
- Shared component changes must include before/after visual comparison screenshots.
- Do not restore the old Shoe Ad Studio five-step workflow, white workspace, fluorescent green brand color, narrow AI Inspector, or shoe-ad page structure.
- A-side work must not modify B-side New API, authentication, quota, payment, Docker, database, Redis, BFF, callback, reconciliation, or port configuration.
- Shared UI components must stay controlled by the existing business owner and must not create duplicate model, upload, prompt, submit, job, or result state.

## Commands

- `npm run dev`
- `npm run lint`
- `npm run typecheck`
- `npm run build`

## Style

- Use named exports for shared helpers and components.
- Keep UI text in Chinese for the first version.
- Preserve the supplied logo shape; color can be controlled through CSS/currentColor.
