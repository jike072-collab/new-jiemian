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
