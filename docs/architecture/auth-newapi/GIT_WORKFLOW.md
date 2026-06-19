# Parallel Line B Git Workflow

## Long-Lived Branch

The long-lived integration branch is:

```text
integration/auth-newapi
```

Every module branch starts from the latest `integration/auth-newapi`.

## Module Branches

Each module uses exactly one feature branch:

- `feature/auth-newapi-01-workspace`
- `feature/auth-newapi-02-auth-audit`
- `feature/auth-newapi-03-newapi-audit`
- `feature/auth-newapi-04-source-of-truth`
- `feature/auth-newapi-05-deployment`
- `feature/auth-newapi-06-operations`
- `feature/auth-newapi-07-bff-client`
- `feature/auth-newapi-08-user-mapping`
- `feature/auth-newapi-09-auth-session`
- `feature/auth-newapi-10-quota-usage`
- `feature/auth-newapi-11-billing-sandbox`
- `feature/auth-newapi-12-final-handoff`

## Module Flow

1. Fetch and prune `origin`.
2. Update `integration/auth-newapi`.
3. Create the module branch from the latest integration branch.
4. Audit before changing files.
5. Modify only files allowed by the module.
6. Run the narrowest meaningful checks.
7. Run a sensitive information scan.
8. Inspect `git status`, `git diff --stat`, and `git diff`.
9. Commit one module only.
10. Push the module branch.
11. Open a Draft PR to `integration/auth-newapi`.
12. Re-read the remote PR diff.
13. Self-review the remote diff.
14. Fix blocking issues with follow-up commits.
15. Re-run checks and push fixes.
16. Merge into `integration/auth-newapi` only after gates pass.
17. Update `EXECUTION_LOG.md`.
18. Start the next module only after the previous module has merged.

## Final Handoff

After B12, create only a Draft PR:

```text
integration/auth-newapi -> develop
```

Do not merge that PR automatically.

## Prohibited Git Actions

- Do not force-push.
- Do not rewrite shared history.
- Do not change remotes.
- Do not delete branches.
- Do not merge directly into `main`, `develop`, or `feature/03-multi-device-shell`.
