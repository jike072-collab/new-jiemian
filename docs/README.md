# Documentation Index

This index separates current operating documents from historical snapshots.
Server production means one Ubuntu 3106 instance. Local 3107 is only for the
development computer and is not deployed to the server.

## CURRENT

- [Project README](../README.md): concise project overview.
- [AGENTS.md](../AGENTS.md): Codex working rules and module boundaries.
- [CODEX_WORKFLOW.md](CODEX_WORKFLOW.md): branch, commit, push, and verification workflow.
- [PORT_RELEASE_WORKFLOW.md](PORT_RELEASE_WORKFLOW.md): 3107-to-3106 release boundary.
- [ENVIRONMENT_VARIABLES.md](ENVIRONMENT_VARIABLES.md): active environment variable contract.
- [SERVER_PREPARATION_BASELINE.md](SERVER_PREPARATION_BASELINE.md): server-preparation branch baseline.
- [SERVER_PREPARATION_FINAL_AUDIT.md](SERVER_PREPARATION_FINAL_AUDIT.md): final repository audit before local 3107 validation.
- [STUDIO_REGRESSION_GUARDS.md](STUDIO_REGRESSION_GUARDS.md): provider-safe UI/API regression guardrails.
- [PROVIDER_HEALTH_CHECKS.md](PROVIDER_HEALTH_CHECKS.md): provider health behavior and redaction boundary.
- [ERROR_DIAGNOSTICS.md](ERROR_DIAGNOSTICS.md): safe error diagnostics.

## WINDOWS_LOCAL

- [3107_MANUAL_TEST_CHECKLIST.md](3107_MANUAL_TEST_CHECKLIST.md): local 3107 acceptance checklist.
- [archive/windows-local-environment/](archive/windows-local-environment/): historical Windows-local service, rollback, deployment, and network runbooks. These files do not describe the current Ubuntu server deployment.

## LINUX_SERVER

- [deploy/linux/README.md](../deploy/linux/README.md): Ubuntu deployment template index.
- [DEPLOYMENT_AND_DATA_PLAN.md](DEPLOYMENT_AND_DATA_PLAN.md): current deployment and data summary.
- [DEPLOYMENT_READINESS_CHECKLIST_3106.md](DEPLOYMENT_READINESS_CHECKLIST_3106.md): human server-readiness checklist.
- [PRODUCTION_OPERATIONS.md](PRODUCTION_OPERATIONS.md): current 3106 operations entry.
- [PRODUCTION_RELEASE_RUNBOOK.md](PRODUCTION_RELEASE_RUNBOOK.md): high-level 3106 release runbook.
- [ROLLBACK_RUNBOOK.md](ROLLBACK_RUNBOOK.md): current rollback principles and restore boundary.
- [SERVER_BACKUP_AND_RESTORE.md](SERVER_BACKUP_AND_RESTORE.md): 60GB single-server backup and restore policy.
- [PROTECTED_DEPLOY_3106_RUNBOOK.md](PROTECTED_DEPLOY_3106_RUNBOOK.md): no-touch protected deployment planning.
- [SERVER_PREPARATION_BASELINE.md](SERVER_PREPARATION_BASELINE.md): current production-preparation baseline.
- [SERVER_PREPARATION_FINAL_AUDIT.md](SERVER_PREPARATION_FINAL_AUDIT.md): final audit status before local 3107 and server gates.

## MIGRATION

- [DATABASE_CURRENT_STATE_AUDIT.md](DATABASE_CURRENT_STATE_AUDIT.md): current JSON/PostgreSQL persistence audit.
- [DATABASE_DOMAIN_MODEL.md](DATABASE_DOMAIN_MODEL.md): target database model.
- [DATABASE_MIGRATION_PLAN.md](DATABASE_MIGRATION_PLAN.md): migration planning.
- [DATABASE_MIGRATION_RUNBOOK.md](DATABASE_MIGRATION_RUNBOOK.md): database migration command boundary.
- [DATABASE_BACKUP_RESTORE_RUNBOOK.md](DATABASE_BACKUP_RESTORE_RUNBOOK.md): database backup/restore notes.
- [DATABASE_STAGE9CB_INTEGRATION.md](DATABASE_STAGE9CB_INTEGRATION.md): current library/jobs database integration flags.
- [LIBRARY_DATABASE_BACKEND.md](LIBRARY_DATABASE_BACKEND.md): library database adapter state.
- [GENERATION_JOBS_DATABASE_BACKEND.md](GENERATION_JOBS_DATABASE_BACKEND.md): generation jobs database adapter state.
- Stage 9 planning and closeout documents remain migration history unless a current runbook links to them explicitly.

## HISTORICAL

- Retired local executable upscale implementation notes are kept under
  `docs/archive/` and are not part of the current runtime contract.
- [archive/audits/](archive/audits/): reserved for moved historical audit snapshots.
- [architecture/auth-newapi/](architecture/auth-newapi/): auth/New API design, audit, and handoff archive.
- [ui/](ui/): UI module reports, design guardrails, and visual audit notes.
- [design-references/](design-references/): screenshot evidence and reference images.
- [research/](research/): product/UI research snapshots.

## DUPLICATE And STALE Handling

Do not delete duplicate or stale documents until `rg` confirms no script or
document still references them. Prefer replacing an old root document with a
short current pointer and moving the full old text into `docs/archive/`.

Current docs must not describe retired local upscale, object storage,
multi-instance deployment, or streaming upload as implemented features.
