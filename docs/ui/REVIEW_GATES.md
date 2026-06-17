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
9. Confirm login, registration, and account entry are preserved capabilities and are not replaced by marketing-only entry points.

## Sensitive Data

- No secrets were intentionally committed in module 1.
- Browser caches, temporary logs, and chrome profile data must stay out of the repo.
- Repo scan completed on current tracked docs; no committed secret strings were found in module 1 additions.
- Screenshot and log archives must stay redacted before they are referenced or copied into the repo.

## Approval Rule

- No module 2 work starts until the user explicitly confirms module 1 is acceptable.
