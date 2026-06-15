# 奥皇 AI Project Notes

## Stack

- Next.js 16 App Router
- React 19
- TypeScript strict
- Tailwind CSS v4

## Product Boundaries

- Keep the app as a local-first AI tool studio.
- Do not reintroduce the old Shoe Ad Studio five-step ad workflow.
- API keys must never be committed. Keep runtime secrets in `.env.local` or local `data/` files only.
- Image upscale uses the local Upscayl CLI, and video upscale uses the local Video2X CLI. Keep both integrations local-first and API-key-free.

## Commands

- `npm run dev`
- `npm run lint`
- `npm run typecheck`
- `npm run build`

## Style

- Use named exports for shared helpers and components.
- Keep UI text in Chinese for the first version.
- Preserve the supplied logo shape; color can be controlled through CSS/currentColor.
