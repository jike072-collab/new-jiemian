# Codex Final Handoff

## 1. 基本信息

| 项目 | 结果 |
| --- | --- |
| 仓库名称 | `jike072-collab/new-jiemian` |
| 当前分支 | `chore/server-production-prep` |
| 基准分支 | `origin/main` |
| 当前HEAD commit | `dabde60965384c03866cc890b26db2e6901c01e5` before the external review remediation commit |
| Node.js版本 | `v24.16.0` |
| npm版本 | `11.13.0` |
| 执行日期 | 2026-07-01 |
| 最终总体状态 | `COMPLETE_WITH_KNOWN_ISSUES` |

Evidence was collected before creating this handoff document. The handoff
document itself is committed afterward as a documentation-only commit.

Collected command results:

```text
git status --short
<no output>

git branch --show-current
chore/server-production-prep

git rev-parse HEAD
2b31cd7c455ed9df47e12e0d33a8b8f4e67e41ee

node -v
v24.16.0

npm -v
11.13.0
```

`git diff --stat origin/main...HEAD` summary at collection time:

```text
129 files changed, 9166 insertions(+), 1522 deletions(-)
```

`git diff --name-status origin/main...HEAD` was collected and is represented by
the categorized file inventory in section 5. Two archived retired-tool paths are
described by category instead of repeating their exact stale path spelling in
this current document, because `npm run check:docs` intentionally rejects those
stale terms outside archives and compatibility tests.

## 2. 部署规则确认

- 3107只在开发电脑上用于优化、自动测试和人工验收。
- 3107不上服务器，不需要服务器 systemd、Nginx 或服务器数据目录。
- 服务器只运行3106正式环境。
- 当前任务没有合并`main`。
- 当前任务没有部署3106。
- 当前任务没有运行生产数据库迁移。
- 当前任务没有调用真实收费供应商。
- 当前任务没有删除真实用户数据。
- 当前分支只准备审查材料和服务器上线前资产；真正部署是后续人工流程。

## 3. 模块完成情况

| 模块 | 状态 | commit hash | commit message | push状态 | 主要修改 |
| --- | --- | --- | --- | --- | --- |
| 1. 建立服务器准备分支和发布流程 | PASS | `5f09a94` | `chore: establish server preparation workflow` | Pushed | 明确3107本地、3106服务器、模块独立提交、revert优先和基线文档。 |
| 2. 清理旧本地高清兼容痕迹 | PASS | `847fc24` | `refactor: retire legacy local upscale configuration` | Pushed | 当前高清改为火山 ImageX/VOD，旧配置只在迁移边界兼容。 |
| 3. 降低上传和内存风险 | PASS | `2fe5f85` | `fix: bound media uploads for production memory safety` | Pushed | 集中上传上限，视频默认200 MiB，服务端在Buffer前校验。 |
| 4. 24小时媒体保留策略 | PASS | `cf579d9` | `feat: expire generated media after retention window` | Pushed | 新增媒体过期配置、清理脚本、幂等安全删除和UI提示。 |
| 5. 60GB服务器磁盘保护 | PASS | `3417c60` | `feat: protect runtime storage from disk exhaustion` | Pushed | 新增存储容量检查、保护等级、503/507类拒绝和运维检查。 |
| 6. 限流和并发保护 | PASS | `3f68bfa` | `security: enforce single-instance workload limits` | Pushed | 扩展单实例内存限流、并发槽和认证失败限制。 |
| 7. 环境变量边界和生产校验 | PASS | `0f271ed` | `feat: validate production runtime configuration` | Pushed | 新增生产/本地环境校验、生产模板和变量文档。 |
| 8. Ubuntu 3106部署模板 | PASS | `d4d26fc` | `ops: add single-instance linux deployment assets` | Pushed | 新增 systemd、Nginx、预检、健康检查和目录规划模板。 |
| 9. 备份与恢复策略 | PASS | `1340f0c` | `ops: align backup policy with expiring media storage` | Pushed | 新增短期数据库/元数据备份、manifest、恢复验证和文档。 |
| 10. 文档重组 | PASS | `8582b44` | `docs: align project documentation with production architecture` | Pushed | 建立当前文档索引，归档历史Windows/审计资料，更新3106/3107边界。 |
| 10A. 独立诊断脱敏修复 | PASS | `4d965d4` | `fix: redact credential-shaped diagnostic fields` | Pushed | 修复检查中发现的诊断字段脱敏缺口；独立提交便于回退。 |
| 11. 最终仓库检查和3107验收准备 | PASS | `6ea0911` | `chore: finalize local production-readiness validation` | Pushed | 完成干净依赖验证、本地隔离启动检查、最终审计和人工验收清单。 |

## 4. Commit列表

Collected `git log --oneline --decorate origin/main..HEAD`:

```text
6ea0911 chore: finalize local production-readiness validation
4d965d4 fix: redact credential-shaped diagnostic fields
8582b44 docs: align project documentation with production architecture
1340f0c ops: align backup policy with expiring media storage
d4d26fc ops: add single-instance linux deployment assets
0f271ed feat: validate production runtime configuration
3f68bfa security: enforce single-instance workload limits
3417c60 feat: protect runtime storage from disk exhaustion
cf579d9 feat: expire generated media after retention window
2fe5f85 fix: bound media uploads for production memory safety
847fc24 refactor: retire legacy local upscale configuration
5f09a94 chore: establish server preparation workflow
```

Commit mapping:

- `5f09a94`: module 1.
- `847fc24`: module 2.
- `2fe5f85`: module 3.
- `cf579d9`: module 4.
- `3417c60`: module 5.
- `3f68bfa`: module 6.
- `0f271ed`: module 7.
- `d4d26fc`: module 8.
- `1340f0c`: module 9.
- `8582b44`: module 10.
- `4d965d4`: extra focused fix found during final verification. It redacts
  credential-shaped diagnostic fields. It was not included in the original
  module commit because the failure surfaced during later aggregate checks. It
  affects error/log safety only and does not change business flow.
- `6ea0911`: module 11.

## 5. 修改文件清单

This inventory covers the 129 files changed before the handoff document commit.
The handoff document adds one more documentation file.

### 工作流和Git规则

| 文件 | 目的 | 是否影响运行逻辑 | 主要入口 |
| --- | --- | --- | --- |
| `AGENTS.md` | 明确3107/3106和模块提交规则。 | No | Agent workflow text |
| `README.md` | 保持根README为当前架构入口。 | No | Project overview |
| `docs/CODEX_WORKFLOW.md` | 记录Codex模块化工作规则。 | No | Workflow doc |
| `docs/PORT_RELEASE_WORKFLOW.md` | 明确本地3107、GitHub审查、服务器3106流程。 | No | Release workflow doc |
| `docs/SERVER_PREPARATION_BASELINE.md` | 记录上线前基线和待处理问题。 | No | Baseline doc |
| `docs/SERVER_PREPARATION_FINAL_AUDIT.md` | 记录模块11最终审计。 | No | Final audit doc |
| `package.json` | 增加检查、运维和测试脚本。 | Yes | `scripts` |

### 高清增强清理

| 文件 | 目的 | 是否影响运行逻辑 | 主要入口 |
| --- | --- | --- | --- |
| `src/lib/server/providers.ts` | 当前公开端点类型只保留火山高清；旧配置只在迁移函数处理。 | Yes | `normalizeLegacyUpscaleProvider`, `readProviders`, `updateProviders` |
| `src/lib/server/types.ts` | 更新Provider类型。 | Yes | `EndpointType`, `ProviderConfig` |
| `src/lib/server/volcengine-upscale.ts` | 当前图片/视频高清调用火山 ImageX/VOD。 | Yes | `upscaleImage`, `submitVideoUpscale`, `uploadedUpscaleFile` |
| `src/app/api/upscale/image/route.ts` | 图片高清API进入当前火山流程和并发保护。 | Yes | `POST` |
| `src/app/api/upscale/video/route.ts` | 视频高清API进入当前火山流程和并发保护。 | Yes | `POST` |
| `src/components/admin-providers-client.tsx` | 管理端展示当前高清供应商标签。 | Yes | Provider UI |
| `src/components/studio/constants.ts` | 统一高清增强标签。 | Yes | `upscaleTargetLabel`, `videoUpscaleScaleLabel` |
| Archived retired local image/video HD module docs | 仅作历史资料保存，不代表当前实现。 | No | Archive docs |
| `scripts/test-provider-display-names.mjs` | 测试旧类型映射后不再泄漏到当前展示。 | No | Provider display tests |
| `src/lib/server/__tests__/provider-health-stage8a.test.ts` | 确认健康报告不传播旧高清类型。 | No | Provider health test |
| `src/lib/server/__tests__/provider-health.test.ts` | 当前供应商健康测试更新。 | No | Provider health test |

### 上传和内存保护

| 文件 | 目的 | 是否影响运行逻辑 | 主要入口 |
| --- | --- | --- | --- |
| `src/lib/upload-limits.ts` | 集中管理图片10 MiB、视频200 MiB、硬上限256 MiB。 | Yes | `mediaUploadPolicies`, `resolveLoweredUploadLimitBytes`, `uploadSizeLimitMessage` |
| `src/lib/server/media-upload-guard.ts` | 服务端在Buffer前校验大小、MIME、扩展名和文件签名。 | Yes | `assertFileSizeAllowed`, `assertFileFormatAllowed`, `assertBufferLengthAllowed` |
| `src/app/api/generate/video/route.ts` | 视频生成上传入口接入上传守卫和并发槽。 | Yes | `POST` |
| `src/app/api/generate/image/route.ts` | 图片生成入口接入工作量保护。 | Yes | `POST` |
| `src/components/studio-app.tsx` | 客户端展示上限并提前拒绝超限文件。 | Yes | Studio client file handling |
| `src/components/studio/types.ts` | 前端类型增加上传限制字段。 | Yes | Studio types |
| `src/components/studio/result-preview.tsx` | 结果预览适配过期/下载状态。 | Yes | Result preview |
| `scripts/test-upload-limits.mjs` | 覆盖上限、硬上限、MIME和Buffer前拒绝。 | No | Upload limit tests |
| `src/lib/server/__tests__/media-upload-guard.test.ts` | 单元覆盖服务端上传守卫。 | No | Upload guard test |
| `tsconfig.upload-limits-tests.json` | 独立上传限制测试编译配置。 | No | Test tsconfig |

### 媒体24小时过期

| 文件 | 目的 | 是否影响运行逻辑 | 主要入口 |
| --- | --- | --- | --- |
| `src/lib/media-retention.ts` | 统一24小时保留配置和过期时间计算。 | Yes | `resolveMediaRetentionHours`, `mediaExpiresAt`, `attachMediaRetentionMetadata` |
| `src/lib/server/media-retention-cleanup.ts` | 幂等清理过期本地媒体并标记记录过期。 | Yes | `cleanupExpiredMedia` |
| `scripts/ops/cleanup-expired-media.mjs` | dry-run/apply清理命令。 | Yes | CLI |
| `src/lib/server/library.ts` | 作品记录带过期状态并支持清空本地输出引用。 | Yes | `expireLibraryItemMedia`, library read/write |
| `src/lib/server/database/library-jobs-adapter.ts` | 数据库后端同步过期状态。 | Yes | Library/jobs adapter |
| `src/lib/server/database/__tests__/library-jobs-adapter.test.ts` | 覆盖数据库记录一致性。 | No | Adapter test |
| `scripts/test-media-retention-cleanup.mjs` | 覆盖未过期、过期、处理中、外部URL、路径逃逸和幂等。 | No | Retention cleanup test |
| `src/components/studio/media-card.tsx` | 作品卡显示24小时提示和过期时间。 | Yes | `MediaCard` |
| `src/components/studio/library-view.tsx` | 作品库展示过期提示。 | Yes | Library view |

### 磁盘保护

| 文件 | 目的 | 是否影响运行逻辑 | 主要入口 |
| --- | --- | --- | --- |
| `src/lib/storage-capacity-policy.ts` | 定义70/80/85/90/95阈值和保护等级。 | Yes | `resolveStorageThresholds`, `storageLevelForUsedPercent` |
| `src/lib/server/storage-capacity.ts` | 检查DATA_DIR/UPLOADS_DIR真实文件系统并阻止新写入。 | Yes | `getStorageCapacityStatus`, `assertStorageAllows` |
| `scripts/ops/storage-check.mjs` | 运维容量检查命令。 | Yes | CLI |
| `src/lib/server/security/health.ts` | 公网健康状态只输出安全摘要。 | Yes | Health helpers |
| `scripts/test-storage-capacity.mjs` | 覆盖阈值、失败、不同文件系统和允许读取清理。 | No | Storage tests |
| `src/lib/server/__tests__/storage-capacity.test.ts` | 单元覆盖容量策略。 | No | Storage unit tests |
| `tsconfig.storage-capacity-tests.json` | 独立容量测试编译配置。 | No | Test tsconfig |

### 限流和并发

| 文件 | 目的 | 是否影响运行逻辑 | 主要入口 |
| --- | --- | --- | --- |
| `src/lib/server/workload-limits.ts` | 集中管理单实例默认阈值。 | Yes | `defaultWorkloadLimits`, `getWorkloadLimits` |
| `src/lib/server/workload-guard.ts` | 内存并发槽、429响应和释放机制。 | Yes | `withUserImageWorkload`, `withUserVideoWorkload`, `withVideoProviderUpload` |
| `src/lib/server/auth/service.ts` | 登录/注册失败限流接入。 | Yes | Auth service methods |
| `src/lib/server/auth/http.ts` | 认证错误响应适配。 | Yes | Auth HTTP helpers |
| `src/lib/server/auth/__tests__/auth-service.test.ts` | 覆盖认证限流。 | No | Auth tests |
| `scripts/test-abuse-guard-contracts.mjs` | 覆盖滥用保护和并发合同。 | No | Abuse guard tests |
| `scripts/test-workload-limits.mjs` | 覆盖工作量阈值配置。 | No | Workload tests |
| `src/lib/server/__tests__/workload-guard.test.ts` | 单元覆盖并发槽释放。 | No | Workload guard tests |
| `tsconfig.workload-limits-tests.json` | 独立工作量测试编译配置。 | No | Test tsconfig |

### 环境变量

| 文件 | 目的 | 是否影响运行逻辑 | 主要入口 |
| --- | --- | --- | --- |
| `.env.example` | 当前本地3107示例，不含真实值。 | No | Template |
| `.env.production.example` | 服务器3106生产示例，不含真实值。 | No | Template |
| `docs/ENVIRONMENT_VARIABLES.md` | 列出变量用途、敏感性、默认值、范围和使用位置。 | No | Env docs |
| `scripts/check-production-env.mjs` | 生产环境校验命令。 | Yes | CLI |
| `scripts/check-local-staging-env.mjs` | 本地3107环境校验命令。 | Yes | CLI |
| `src/lib/server/security/production-env.ts` | 生产/本地环境 fail-closed 校验。 | Yes | `validateProductionRuntimeEnv`, `validateLocalStagingRuntimeEnv` |
| `src/lib/server/security/release-check.ts` | release preflight接入生产校验。 | Yes | Release check |
| `src/lib/server/security/__tests__/release-check.test.ts` | 覆盖弱密码、端口、监听、路径、限制和日志脱敏。 | No | Release check tests |
| `scripts/security-release-check.mjs` | 安全发布检查更新。 | Yes | CLI |

### Linux部署

| 文件 | 目的 | 是否影响运行逻辑 | 主要入口 |
| --- | --- | --- | --- |
| `deploy/linux/README.md` | Ubuntu 22.04单实例3106部署说明。 | No | Deploy README |
| `deploy/linux/aohuang-ai.service.example` | 3106 systemd unit模板。 | No | systemd template |
| `deploy/linux/aohuang-media-cleanup.service.example` | 媒体清理一次性service。 | No | systemd template |
| `deploy/linux/aohuang-media-cleanup.timer.example` | 每小时触发清理timer。 | No | systemd timer |
| `deploy/linux/nginx-limits.conf.example` | Nginx `http` 上下文限流 zone 模板。 | No | Nginx template |
| `deploy/linux/nginx-site.conf.example` | 80到443、443反代127.0.0.1:3106模板。 | No | Nginx template |
| `deploy/linux/production.env.example` | 生产环境文件模板，无真实密钥。 | No | Env template |
| `deploy/linux/deploy-preflight.sh` | 只读部署前检查脚本。 | No | Shell preflight |
| `deploy/linux/health-check.sh` | 本机健康检查脚本。 | No | Shell health check |
| `deploy/linux/journald.md` | 日志轮转和journald说明。 | No | Ops doc |
| `deploy/linux/directory-layout.md` | release、data、uploads、runtime、backups目录规划。 | No | Ops doc |

### 备份恢复

| 文件 | 目的 | 是否影响运行逻辑 | 主要入口 |
| --- | --- | --- | --- |
| `docs/SERVER_BACKUP_AND_RESTORE.md` | 60GB单服务器备份与恢复策略。 | No | Backup docs |
| `scripts/ops/server-backup.mjs` | dry-run/apply备份、manifest、校验和、短期保留。 | Yes | `createServerBackup`, `pruneServerBackups` |
| `scripts/ops/server-restore.mjs` | 恢复验证，默认不直接操作生产。 | Yes | Restore CLI |
| `scripts/ops/operation-lock.mjs` | 运维锁增强，避免并发备份。 | Yes | Operation lock |
| `scripts/check-database-docs.mjs` | 检查备份/恢复脚本文档引用。 | No | Docs check |
| `scripts/test-ops-service.mjs` | 运维脚本测试扩展。 | No | Ops tests |
| `scripts/test-local-production-readiness.mjs` | 本地隔离生产构建启动验收脚本。 | No | Local readiness test |

### 文档

| 文件 | 目的 | 是否影响运行逻辑 | 主要入口 |
| --- | --- | --- | --- |
| `docs/README.md` | 当前文档总索引。 | No | Docs index |
| `docs/3107_MANUAL_TEST_CHECKLIST.md` | 本地3107人工验收清单。 | No | Manual checklist |
| `docs/DEPLOYMENT_AND_DATA_PLAN.md` | 更新服务器3106、24小时保留和部署边界。 | No | Deploy doc |
| `docs/DEPLOYMENT_READINESS_CHECKLIST_3106.md` | 3106部署前清单更新。 | No | Checklist |
| `docs/PRODUCTION_OPERATIONS.md` | 生产运维命令改为当前3106设计。 | No | Ops doc |
| `docs/PRODUCTION_RELEASE_RUNBOOK.md` | 当前发布流程入口。 | No | Runbook |
| `docs/ROLLBACK_RUNBOOK.md` | 回滚说明更新，强调数据恢复分离。 | No | Runbook |
| `docs/DATABASE_BACKUP_RESTORE_RUNBOOK.md` | 数据库备份恢复说明对齐。 | No | DB runbook |
| `docs/DATABASE_SECURITY_AND_BACKUP_PLAN.md` | 数据库安全和备份策略更新。 | No | DB doc |
| `docs/FIREWALL_ROLLBACK_RUNBOOK.md` | 归档前当前说明调整。 | No | Network doc |
| `docs/NETWORK_EXPOSURE_AUDIT.md` | 网络暴露说明调整。 | No | Network audit |
| `docs/NETWORK_HARDENING_PLAN.md` | 网络加固说明调整。 | No | Network plan |
| `docs/ERROR_DIAGNOSTICS.md` | 诊断脱敏说明更新。 | No | Diagnostics doc |
| `docs/PROTECTED_DEPLOY_3106_RUNBOOK.md` | 3106保护部署说明更新。 | No | Deploy doc |
| `docs/CLEANUP_AUDIT.md` | 历史审计标记。 | No | Historical audit |
| `docs/RELEASE_READINESS_AUDIT_2026-06-29.md` | 历史快照标记。 | No | Historical audit |
| `docs/STAGE9E_BATCH_B_EXECUTION_PLAN.md` | 历史/状态标记调整。 | No | Historical plan |
| `docs/STAGE9E_BATCH_C_DUAL_WRITE_CANARY_ROLLBACK_PLAN.md` | 历史/状态标记调整。 | No | Historical plan |
| `docs/STAGE9E_BATCH_C_IMPLEMENTATION_PREFLIGHT.md` | 历史/状态标记调整。 | No | Historical preflight |
| `docs/STAGE9F_P0_SECURITY_BASELINE_AUDIT.md` | 历史/状态标记调整。 | No | Historical audit |
| `docs/archive/audits/README.md` | 审计归档说明。 | No | Archive index |
| `docs/archive/windows-local-environment/DEPLOYMENT_AND_DATA_PLAN.md` | Windows本地历史文档归档。 | No | Archive doc |
| `docs/archive/windows-local-environment/FIREWALL_ROLLBACK_RUNBOOK.md` | Windows本地历史文档归档。 | No | Archive doc |
| `docs/archive/windows-local-environment/NETWORK_EXPOSURE_AUDIT.md` | Windows本地历史文档归档。 | No | Archive doc |
| `docs/archive/windows-local-environment/NETWORK_HARDENING_PLAN.md` | Windows本地历史文档归档。 | No | Archive doc |
| `docs/archive/windows-local-environment/PRODUCTION_OPERATIONS.md` | Windows本地历史文档归档。 | No | Archive doc |
| `docs/archive/windows-local-environment/PRODUCTION_RELEASE_RUNBOOK.md` | Windows本地历史文档归档。 | No | Archive doc |
| `docs/archive/windows-local-environment/ROLLBACK_RUNBOOK.md` | Windows本地历史文档归档。 | No | Archive doc |
| `docs/architecture/auth-newapi/AB_I01_FINAL_INTEGRATION_REVIEW.md` | 历史架构文档状态更新。 | No | Architecture doc |
| `docs/architecture/auth-newapi/AUTH_API_CONTRACT.md` | 历史架构文档状态更新。 | No | Architecture doc |
| `docs/architecture/auth-newapi/EXECUTION_LOG.md` | 历史架构文档状态更新。 | No | Architecture log |
| `docs/architecture/auth-newapi/FINAL_QA_REPORT.md` | 历史架构文档状态更新。 | No | QA report |
| `docs/architecture/auth-newapi/NEW_API_SECURITY_REVIEW.md` | 历史架构文档状态更新。 | No | Security review |
| `docs/ui/BUSINESS_LOGIC_MAP.md` | 当前UI业务逻辑说明调整。 | No | UI doc |
| `docs/ui/MODULE_09_LIBRARY.md` | 作品库说明加入过期状态。 | No | UI doc |
| `docs/ui/REVIEW_GATES.md` | 审查门禁说明更新。 | No | UI doc |

### 测试和检查

| 文件 | 目的 | 是否影响运行逻辑 | 主要入口 |
| --- | --- | --- | --- |
| `scripts/check-docs.mjs` | 检查Markdown相对链接、脚本引用、当前文档旧术语和敏感形态。 | No | `check:docs` |
| `scripts/check-studio-api-contracts.mjs` | API合同检查加入上传/磁盘/限流约束。 | No | Studio API contract check |
| `scripts/check-release-test-artifact-isolation.mjs` | 运行产物隔离检查更新。 | No | Artifact check |
| `scripts/check-database-implementation-gate.mjs` | 数据库门禁引用更新。 | No | DB gate check |
| `scripts/database/check-stage9c-schema.mjs` | 数据库schema检查引用更新。 | No | Schema check |
| `scripts/ops/load-runtime-env.mjs` | 运行环境加载更新。 | Yes | Runtime env loader |
| `scripts/ops/watchdog-service.mjs` | 运维watchdog引用更新。 | Yes | Watchdog |
| `scripts/studio-ui-test-utils.mjs` | UI测试工具适配。 | No | UI test utils |
| `src/components/before-after-image-compare.tsx` | 前端类型/展示小修。 | Yes | Image compare component |
| `src/lib/server/error-diagnostics.ts` | 诊断脱敏增强。 | Yes | `GenerationDiagnosticError`, redaction helpers |
| `src/lib/server/__tests__/error-diagnostics.test.ts` | 脱敏测试扩展。 | No | Diagnostics tests |
| `src/lib/server/provider-call.ts` | 供应商调用错误脱敏。 | Yes | Provider call wrapper |
| `src/lib/server/provider-health.ts` | 供应商健康输出脱敏/当前类型调整。 | Yes | Provider health |

## 6. 关键实现说明

### 6.1 当前高清增强

- 图片高清调用链：`src/app/api/upscale/image/route.ts`校验会话和CSRF后，
  进入`src/lib/server/volcengine-upscale.ts`的`uploadedUpscaleFile`和
  `upscaleImage`，通过火山 ImageX 上传、提交工作流并保存作品记录。
- 视频高清调用链：`src/app/api/upscale/video/route.ts`校验会话和CSRF后，
  通过`withUserVideoWorkload`和`withVideoProviderUpload`进入
  `submitVideoUpscale`，调用火山 VOD 上传、提交处理任务并记录任务状态。
- 旧本地可执行高清配置只在`normalizeLegacyUpscaleProvider`中兼容读取。
  图片旧类型映射到当前 ImageX 类型，视频旧类型映射到当前 VOD 类型。
- 旧类型允许出现的位置仅限归档文档、该迁移函数和对应迁移/脱敏测试。
  当前类型、API返回、后台保存结果和UI不再传播旧类型。

### 6.2 视频上传保护

- 默认视频上限：200 MiB。
- 硬上限：256 MiB；普通环境变量只能降低，不能提高到硬上限以上。
- 客户端检查位置：`src/components/studio-app.tsx`读取公共上传限制并在选择
  文件时提前拒绝超限文件。
- 服务端检查位置：`src/lib/server/media-upload-guard.ts`和
  `src/lib/server/volcengine-upscale.ts`的`uploadedUpscaleFile`。
- Buffer创建前检查证据：`uploadedUpscaleFile`先调用`assertFileSizeAllowed`，
  再读取文件头校验格式，最后才允许进入完整文件读取和供应商上传。
- MIME和文件类型校验：集中在`allowedVideoMimeTypes`、
  `allowedVideoExtensions`和`assertFileFormatAllowed`，同时检查基础文件签名。
- 当前仍为整文件内存处理。没有声称实现流式上传；本轮通过200 MiB默认上限、
  256 MiB硬上限、磁盘保护和并发槽控制2核4G服务器风险。

### 6.3 24小时媒体清理

- `MEDIA_RETENTION_HOURS`默认值：24。
- 安全范围：1到168小时。
- 清理频率：Linux模板提供每小时运行一次的systemd timer。
- 过期时间计算：优先用作品完成时间；旧记录没有完成时间时使用创建时间。
- 不删除状态：queued、generating、uploading和仍在处理中的任务不删除。
- 文件删除安全边界：只处理受控上传根目录内的本地媒体，使用realpath和根
  目录校验，HTTP URL、data URL和外部供应商URL不当成本地文件删除。
- JSON和PostgreSQL一致性：`expireLibraryItemMedia`和数据库适配器分别处理
  JSON/数据库后端，失败时返回错误，不把全部记录误标为成功。
- 审计保留：清空本地输出引用并标记`expired`/`expiredAt`，不删除用户、积分、
  订单、计费流水和必要任务记录。
- dry-run命令：`npm run ops:cleanup-media:dry-run`。
- apply命令：`npm run ops:cleanup-media:apply`。
- UI提示位置：作品卡片和作品库显示24小时保留提示与预计过期时间。

### 6.4 磁盘保护

- 70%：warning，仅记录警告。
- 80%：critical warning，运维状态显示需要清理。
- 85%：拒绝新的视频上传、视频生成落盘和视频高清任务。
- 90%：拒绝所有会产生新媒体文件的任务。
- 95%：emergency，只允许登录、读取、下载、管理员检查和清理操作。
- 检查文件系统：真正承载`DATA_DIR`和`UPLOADS_DIR`的文件系统；两者不同
  时分别检查并采用最严格结果。
- 拒绝请求：新视频写入、新图片/视频媒体写入、高清任务和其他新媒体任务。
- 仍允许读取：登录、作品读取、下载、积分查询、管理员状态检查和独立清理。
- 统计失败策略：保守处理为不可确认安全，不静默当作空间充足。
- 检查缓存：短时间缓存普通状态；大文件上传前使用fresh检查。

### 6.5 限流和并发

- 单用户图片类生成任务：默认最多2个。
- 单用户视频类任务：默认最多1个。
- 单用户大文件上传或视频高清上传：默认最多1个。
- 单进程大视频Buffer读取和供应商上传：默认最多1个。
- 全站视频上传阶段：默认最多2个。
- 登录失败同IP：默认5次/分钟。
- 注册同IP：默认3次/小时。
- 管理员密码失败：默认3次/分钟，严于普通登录。
- 并发槽释放：`withWorkloadSlots`在成功、失败和异常路径的`finally`释放。
- 当前限制：单实例内存限流；重启后计数清空，不支持多实例共享。

### 6.6 生产环境校验

- 3106检查：生产`PORT`必须是3106。
- 监听地址检查：生产必须是loopback，不能公开监听。
- 管理员密码检查：必须存在且不能是常见弱值。
- 数据目录检查：生产`DATA_DIR`、`UPLOADS_DIR`、runtime目录必须是Linux绝对
  路径，不能位于release临时目录、`.next`、`node_modules`或`/tmp`。
- 上传限制检查：图片/视频限制必须合法，视频配置不能超过生产默认边界。
- 保留时间检查：`MEDIA_RETENTION_HOURS`必须在1到168小时。
- 磁盘阈值检查：阈值必须保持递增关系。
- 数据库模式检查：生产持久化模式与数据库连接配置必须一致。
- 供应商配置检查：只要求启用或显式配置的供应商具备对应字段；ImageX和VOD
  分别检查。
- 日志脱敏检查：错误只输出变量名和原因，不输出值。

### 6.7 Linux部署资产

- systemd文件：`deploy/linux/aohuang-ai.service.example`只启动一个3106实例。
- Nginx文件：`deploy/linux/nginx-site.conf.example`只代理到`127.0.0.1:3106`。
- 媒体清理timer：`deploy/linux/aohuang-media-cleanup.timer.example`每小时触发，
  清理脚本仍按24小时保留规则判断。
- 推荐目录：release在`/opt/aohuang-ai`，持久数据在`/var/lib/aohuang-ai`，
  环境文件在`/etc/aohuang-ai/production.env`。
- 应用运行用户：独立低权限用户；unit开启`NoNewPrivileges=true`和`PrivateTmp=true`。
- 数据和代码隔离：release目录只放代码；data、uploads、runtime、backups独立。
- 公网端口：只应开放22、80、443；3106不对公网开放。

### 6.8 备份恢复

- 备份内容：PostgreSQL业务数据、用户/积分/订单/计费记录、必要data元数据、
  供应商配置、迁移文件、commit和恢复manifest。
- 不长期备份：24小时过期生成媒体、临时上传、缓存、可重新获取的临时供应商
  文件和普通运行日志。
- 本地保留：默认5份，安全范围3到7份。
- manifest内容：时间、commit、分支、Node版本、schema摘要、文件数量、大小、
  校验和和不含密钥的数据库摘要。
- 恢复步骤：停止写入、验证manifest、恢复数据库、恢复元数据、修复权限、启动
  服务、做功能验收。
- 代码回滚和数据恢复分开：Git回退不能覆盖用户数据。

## 7. 环境变量变更

Only variable names and behavior are listed. No real values are included.

| 变量 | 新增/删除/废弃 | 默认值 | 生产是否必需 | 是否敏感 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `MEDIA_RETENTION_HOURS` | 新增 | `24` | Optional | No | 生成媒体保留小时数，范围1到168。 |
| `MEDIA_IMAGE_UPLOAD_LIMIT_MIB` | 新增 | `10` | Optional | No | 只能降低图片上传上限。 |
| `MEDIA_VIDEO_UPLOAD_LIMIT_MIB` | 新增 | `200` | Optional | No | 只能降低视频上传上限；硬上限256 MiB。 |
| `STORAGE_WARNING_PERCENT` | 新增 | `70` | Optional | No | 磁盘warning阈值。 |
| `STORAGE_CRITICAL_PERCENT` | 新增 | `80` | Optional | No | 磁盘critical阈值。 |
| `STORAGE_VIDEO_BLOCK_PERCENT` | 新增 | `85` | Optional | No | 阻止新视频写入阈值。 |
| `STORAGE_MEDIA_BLOCK_PERCENT` | 新增 | `90` | Optional | No | 阻止所有新媒体写入阈值。 |
| `STORAGE_EMERGENCY_PERCENT` | 新增 | `95` | Optional | No | emergency只读/清理阈值。 |
| `WORKLOAD_USER_IMAGE_TASKS` | 新增 | `2` | Optional | No | 单用户图片任务并发上限。 |
| `WORKLOAD_USER_VIDEO_TASKS` | 新增 | `1` | Optional | No | 单用户视频任务并发上限。 |
| `WORKLOAD_USER_LARGE_UPLOADS` | 新增 | `1` | Optional | No | 单用户大上传并发上限。 |
| `WORKLOAD_PROCESS_LARGE_VIDEO_IO` | 新增 | `1` | Optional | No | 单进程大视频IO上限。 |
| `WORKLOAD_SITE_VIDEO_UPLOAD_PHASE` | 新增 | `2` | Optional | No | 全站视频上传阶段上限。 |
| `AUTH_LOGIN_FAILED_PER_IP_PER_MINUTE` | 新增 | `5` | Optional | No | 登录失败限流。 |
| `AUTH_REGISTER_PER_IP_PER_HOUR` | 新增 | `3` | Optional | No | 注册限流。 |
| `AUTH_ADMIN_PASSWORD_FAILED_PER_IP_PER_MINUTE` | 新增 | `3` | Optional | No | 管理员密码失败限流。 |
| `APP_BIND_HOST` | 新增/明确 | `127.0.0.1` | Required | No | 生产必须loopback。 |
| `RUNTIME_DIR` | 新增/明确 | service runtime | Required | No | 生产runtime目录。 |
| `SERVER_BACKUP_ROOT` | 新增 | sibling backups | Recommended | No | 短期备份根目录，不能在release目录。 |
| `SERVER_BACKUP_RETENTION_COUNT` | 新增 | `5` | Optional | No | 本地备份保留3到7份。 |
| `DATA_DIR` | 保留/强化 | local `data` fallback | Required | No | 生产必须Linux绝对路径。 |
| `UPLOADS_DIR` | 保留/强化 | local `uploads` fallback | Required | No | 生产必须Linux绝对路径且不与data重叠。 |
| `PORT` | 保留/强化 | Next default | Required | No | 本地3107，生产3106。 |
| `ADMIN_PASSWORD` | 保留/强化 | none for production | Required | Yes | 生产必须强值。 |
| `APP_DATABASE_URL` | 保留/强化 | none | Required for production postgres | Yes | 不在日志或文档输出真实值。 |
| `APP_AUTH_PERSISTENCE_MODE` | 保留/强化 | local json | Required | No | 生产必须匹配数据库策略。 |
| `APP_BILLING_PERSISTENCE_MODE` | 保留/强化 | local json | Required | No | 生产必须匹配数据库策略。 |
| `APP_TASK_BILLING_PERSISTENCE_MODE` | 保留/强化 | local json | Required | No | 生产必须匹配数据库策略。 |
| `VOLCENGINE_ACCESS_KEY_ID` | 保留/强化 | none | Required when enabled | Yes | 火山凭证变量名。 |
| `VOLCENGINE_SECRET_ACCESS_KEY` | 保留/强化 | none | Required when enabled | Yes | 火山凭证变量名。 |
| `VOLCENGINE_IMAGEX_SERVICE_ID` | 保留/强化 | none | Required when ImageX enabled | No | ImageX配置。 |
| `VOLCENGINE_VOD_SPACE_NAME` | 保留/强化 | none | Required when VOD enabled | No | VOD配置。 |
| Retired local executable HD variables | 删除/废弃 | none | No | Some were path-like | 不再被当前运行配置读取或生产模板说明。 |

## 8. npm scripts变更

| script | 用途 | 是否安全 | 是否会修改数据 | 建议运行环境 |
| --- | --- | --- | --- | --- |
| `ops:cleanup-media:dry-run` | 预览过期媒体清理。 | Yes | No | 本地或服务器 |
| `ops:cleanup-media:apply` | 实际删除过期本地媒体并标记过期。 | Guarded | Yes | 服务器，经人工确认 |
| `ops:storage:check` | 输出内部存储容量状态。 | Yes | No | 本地或服务器 |
| `ops:backup:dry-run` | 预览服务器备份计划。 | Yes | No | 服务器 |
| `ops:backup:apply` | 创建短期数据库/元数据备份。 | Guarded | Yes, writes backup files | 服务器 |
| `ops:backup:prune:dry-run` | 预览旧备份清理。 | Yes | No | 服务器 |
| `ops:backup:prune:apply` | 删除受控备份目录内的旧备份。 | Guarded | Yes | 服务器 |
| `ops:restore:verify` | 验证备份manifest和校验和。 | Yes | No by default | 服务器或隔离恢复环境 |
| `env:check:production` | 检查3106生产环境变量。 | Yes | No | 服务器或带虚假测试变量的本地 |
| `env:check:local-staging` | 检查本地3107 staging边界。 | Yes | No | 本地开发电脑 |
| `check:docs` | 检查文档链接、脚本引用和敏感/过时内容。 | Yes | No | 本地或CI |
| `test:ops` | 运维、存储容量和release原子性测试。 | Yes | Uses temp data | 本地或CI |
| `test:upload-temp-cleanup` | 上传临时清理、上传限制和媒体保留测试。 | Yes | Uses temp data | 本地或CI |
| `test:local-production-readiness` | 隔离本地生产构建启动验收。 | Yes | Uses temp dirs and test port | 本地 |
| `test:abuse-guard-contracts` | 滥用保护、限流和认证合同测试。 | Yes | Uses temp data | 本地或CI |
| `test:security-release` | 安全发布检查测试。 | Yes | No production writes | 本地或CI |
| `check` | 聚合lint、typecheck、docs、专项测试和build。 | Yes | Uses temp data only | 本地或CI |

## 9. 测试结果

Current handoff verification is updated after creating this document. Prior
module evidence is included where a command was run before this final handoff
document existed.

| 命令 | 结果 | 用时 | 备注 |
| --- | --- | --- | --- |
| `npm ci` | PASS | not recorded in this handoff | Module 11 clean dependency install passed with 0 vulnerabilities. |
| `npm run lint` | PASS | included in current `npm run check` | ESLint aggregate check. |
| `npm run typecheck` | PASS | included in current `npm run check` | TypeScript no-emit aggregate check. |
| `npm run check:docs` | PASS | 1.6s | Checked 156 docs/templates and 87 package scripts; external links not checked. |
| `npm run test:runtime-isolation` | PASS | included in current `npm run check` | Runtime data isolation. |
| `npm run test:security-release` | PASS | included in current `npm run check` | Security release checks. |
| `npm run check:studio-api-contracts` | PASS | included in current `npm run check` | Studio API contracts. |
| `npm run test:provider-health` | PASS | included in current `npm run check` | Provider health checks. |
| `npm run test:log-redaction` | PASS | included in current `npm run check` | Log redaction. |
| `npm run test:upscale-auth-csrf` | PASS | included in current `npm run check` | Upscale auth/CSRF checks. |
| `npm run test:abuse-guard-contracts` | PASS | included in current `npm run check` | Abuse and workload limits. |
| `npm run test:upload-temp-cleanup` | PASS | included in current `npm run check` | Upload limits, temp cleanup, media retention. |
| `npm run test:ops` | PASS | included in current `npm run check` | Ops, storage capacity, release atomicity. |
| `npm run test:rollback-drill` | PASS | included in current `npm run check` | Rollback drill. |
| `npm run build` | PASS | included in current `npm run check` | Next.js production build. |
| `npm run check` | PASS | 124.2s | Aggregate suite passed, including lint, typecheck, docs, security, upload, retention, storage, ops, rollback, and build. |
| `git diff --check` | PASS | 1.3s | No whitespace errors. |

No failing test is being hidden in this document. Current handoff checks passed
before commit.

## 10. 旧内容搜索结果

The requested retired-keyword search was executed at handoff time. The exact raw
search expression contains retired tool names and a local Windows path pattern;
those spellings are intentionally not repeated in this current document because
the repository's current documentation check rejects them outside historical
archives and compatibility tests.

Remaining result categories:

| 结果类别 | 位置 | 是否允许 | 解释 |
| --- | --- | --- | --- |
| Historical archive docs | `docs/archive/**` | Allowed | Historical materials are marked as archives and do not represent current implementation. |
| Provider migration boundary | `src/lib/server/providers.ts` | Allowed | `normalizeLegacyUpscaleProvider` maps legacy endpoint identifiers to current ImageX/VOD providers. |
| Compatibility tests | `scripts/test-provider-display-names.mjs` and server tests | Allowed | Tests prove old stored config is normalized and not returned through current API/UI. |
| Current README/UI/production config | No active hit found | PASS | Current docs and templates describe ImageX/VOD only. |

If a reviewer reruns the exact search, every non-archive hit should be either
the migration function or a test that asserts legacy data is contained.

## 11. Git安全检查

Executed:

```text
git ls-files | rg "(^|/)\\.env($|\\.)|(^|/)data/|(^|/)uploads/|runtime/|backups/"
```

Result:

```text
.env.example
.env.production.example
infra/new-api/.env.example
```

Interpretation:

- `.env.example`: allowed template, no real secret values.
- `.env.production.example`: allowed production template, no real secret values.
- `infra/new-api/.env.example`: allowed template for the embedded New API
  fixture/config area.
- No real `.env` file is tracked.
- No user upload file is tracked.
- No real data directory is tracked.
- No runtime JSON state is tracked.
- No real backup is tracked.
- No real key file is tracked.

Safety confirmations:

- No force push was used.
- No `reset --hard` was used.
- No unknown files were deleted.
- No real secret was intentionally read, printed, committed, or logged.
- All module commits listed in section 3 were pushed before this final handoff.

## 12. 已知问题

### BLOCKER

None currently recorded at the repository-validation layer after the external
review remediation pass. This is not a server acceptance result.

### HIGH

None currently recorded after the local remediation validation pass. Database
library reads remain deliberately disabled in production and are listed as
DEFERRED below.

### SERVER-GATE

| 项目 | 原因 | 建议处理时间 |
| --- | --- | --- |
| Ubuntu目录权限 | 只有真实服务器能证明用户、目录和ACL正确。 | 部署前 |
| Nginx配置加载 | 需要真实Nginx和证书路径验证。 | 部署前 |
| systemd启动 | 需要真实unit安装和服务启动验证。 | 部署前 |
| HTTPS | 需要真实域名和证书验证。 | 部署前 |
| 防火墙 | 需要真实服务器安全组/防火墙检查。 | 部署前 |
| 真实磁盘统计 | 需要服务器真实文件系统容量和inode状态。 | 部署前 |
| PostgreSQL连接 | 需要生产数据库私有配置验证，且不得在Codex自动任务中迁移。 | 部署前 |
| 真实ImageX和VOD | 需要仓库所有者授权的真实供应商验收。 | 本地3107验收或服务器上线前 |
| 备份到外部介质 | 本地60GB盘只适合短期副本。 | 首次正式上线前 |

### DEFERRED

| 项目 | 原因 | 建议处理时间 |
| --- | --- | --- |
| 独立主页 | 不阻塞单实例工作台首次部署。 | 首次部署后 |
| `studio-app.tsx`继续拆分Hook | 当前任务禁止业务重构，现有检查通过。 | 后续前端维护 |
| 对象存储 | 当前设计为本地文件系统加24小时过期。 | 有更多用户或存储压力后 |
| 多实例 | 当前限流为单实例内存模型。 | 需要水平扩容时 |
| 分布式限流 | 当前早期用户规模不需要。 | 多实例前 |
| 消息队列 | 当前任务仍可由单实例流程承载。 | 后续可靠性增强 |
| 流式大视频上传 | 当前仍为完整Buffer，但已有安全硬限制和并发限制。 | 需要更大视频或更高并发时 |
| 数据库作品读取 | `DATABASE_LIBRARY_READ_ENABLED=true` 在生产校验中会失败；用户所有权映射尚未完成，不适合多用户生产读取。 | 完成schema和迁移设计后 |

## 13. 本地3107人工测试清单

The repository owner should fill `PASS`, `FAIL`, or `NOT_TESTED` plus notes.

| 项目 | 状态 | 备注 |
| --- | --- | --- |
| 注册 | NOT_TESTED |  |
| 登录 | NOT_TESTED |  |
| 退出 | NOT_TESTED |  |
| 刷新后会话 | NOT_TESTED |  |
| 图片生成 | NOT_TESTED |  |
| 视频生成 | NOT_TESTED |  |
| 图片编辑 | NOT_TESTED |  |
| 图片高清 | NOT_TESTED |  |
| 视频高清 | NOT_TESTED |  |
| 200 MiB上传限制提示 | NOT_TESTED |  |
| 作品下载 | NOT_TESTED |  |
| 作品删除 | NOT_TESTED |  |
| 作品24小时提示 | NOT_TESTED |  |
| 用户作品隔离 | NOT_TESTED |  |
| 积分扣除 | NOT_TESTED |  |
| 失败退款或状态恢复 | NOT_TESTED |  |
| 管理员后台 | NOT_TESTED |  |
| 移动端布局 | NOT_TESTED |  |
| 桌面端布局 | NOT_TESTED |  |
| 页面错误提示 | NOT_TESTED |  |
| 3107退出后没有遗留进程 | NOT_TESTED |  |

## 14. 服务器3106待验证清单

These are future server gates only. They have not passed in this automated task.

- Node.js 24 installed on Ubuntu 22.04 LTS.
- Production environment validation passes with private values kept private.
- App listens only on `127.0.0.1:3106`.
- Nginx proxies HTTPS traffic to local 3106.
- HTTPS certificate is valid.
- Security group or firewall exposes only 22, 80, and 443 publicly.
- systemd restarts the single production instance correctly.
- Media cleanup timer runs hourly and script still applies 24-hour rules.
- Disk thresholds reflect the real DATA_DIR/UPLOADS_DIR filesystems.
- Log rotation or journald retention is configured.
- PostgreSQL backup can be created.
- Restore drill is separately authorized and verified.
- Data remains after service restart.
- Real provider calls work only when explicitly authorized by the owner.
- Real user isolation is verified.
- Disk space monitoring exists outside the app-level guard.

## 15. 给代码审查人员的重点问题

1. 是否误删了当前有效的火山 ImageX/VOD 高清增强逻辑。
2. 旧本地高清配置兼容是否只存在于迁移边界。
3. 大视频是否在大小校验前进入内存。
4. 24小时清理是否可能误删系统文件或活动任务。
5. JSON和PostgreSQL记录是否可能不一致。
6. 磁盘保护是否会误伤登录、下载或管理员清理。
7. 并发槽是否存在不释放问题。
8. 是否可能扣费后因限流失败但未退款。
9. 生产环境变量错误时是否真正fail closed。
10. systemd和Nginx模板是否引用真实存在的npm scripts。
11. 备份恢复是否可能覆盖生产数据。
12. 是否存在密钥、用户数据或运行文件被提交Git。

## 16. 审查所需命令

Reviewer commands:

```bash
git fetch origin
git checkout chore/server-production-prep
git pull --ff-only
git diff --stat origin/main...HEAD
git diff origin/main...HEAD
npm ci
npm run check
```

Focused commands:

```bash
npm run check:docs
npm run lint
npm run typecheck
npm run test:security-release
npm run test:upscale-auth-csrf
npm run test:abuse-guard-contracts
npm run test:upload-temp-cleanup
npm run test:ops
npm run test:rollback-drill
npm run test:local-production-readiness
npm run build
git diff --check
```

Operational dry-runs that do not deploy 3106:

```bash
npm run env:check:local-staging
npm run ops:cleanup-media:dry-run
npm run ops:storage:check
npm run ops:backup:dry-run
npm run ops:backup:prune:dry-run
```

Production commands must only be run with private real server config by the
repository owner or deployment operator:

```bash
npm run env:check:production
npm run release:preflight
```

## 16A. External Review Remediation

This section records the production-readiness issues found by external review
after the original module 11 handoff.

### PR #99 CI Follow-up

PR `#99 Prepare single-instance production deployment` first reported:

- `windows-quality`: PASS
- `quality`: FAIL
- failing step: `Nginx template syntax check`

Root cause:

- `.github/workflows/ci.yml` generated a temporary `nginx.conf` with
  `include mime.types;`
- the same step ran `nginx -t -p "$(pwd)/.tmp/nginx-test" ...`
- under that prefix Nginx resolved the relative include to
  `.tmp/nginx-test/mime.types`, which does not exist on the Ubuntu runner

Current repository remediation:

- the temporary workflow config now uses `include /etc/nginx/mime.types;`
- the `nginx -t` syntax check remains enabled and still validates:
  - `deploy/linux/nginx-limits.conf.example`
  - `deploy/linux/nginx-site.conf.example`
  - temporary TLS certificate wiring
  - referenced `limit_req` zones
- the quality job must still fail if Nginx emits a real syntax or include error

Provider JSON response bounds were also adjusted in this remediation pass:

- success soft limit: `16 MiB`
- error soft limit: `1 MiB`
- hard cap: `64 MiB`

Reason:

- the project still allows generated images up to the current media byte cap
- a valid image payload encoded as Base64 can exceed `13 MiB`
- the old `2 MiB` success limit could reject valid image results before the
  actual media byte guard ran

Current provider output rule:

- image URL and image Base64 responses remain supported
- video URL responses remain supported
- video Base64 or video data URL provider responses are rejected explicitly, so
  large video payloads do not expand inside provider JSON memory

CI rerun state for this follow-up must remain pending until a new GitHub Actions
run completes. Until then this handoff stays at
`COMPLETE_WITH_KNOWN_ISSUES`.

| Review item | Remediation | Current behavior |
| --- | --- | --- |
| Invalid Nginx hourly rates | `deploy/linux/nginx-site.conf.example` no longer uses `r/h`; registration uses coarse `1r/m`. | Nginx is documented as a second IP-protection layer. Exact 3-per-hour registration limits remain in the app. |
| Conflicting production directories | `.env.production.example`, deploy templates, docs checks, and security release checks use `/var/lib/aohuang-ai/{data,uploads,runtime,backups}`. | Windows local 3107 paths are unchanged. Current docs check rejects the retired production layout outside archives. |
| Media cleanup unlink-before-metadata risk | Expired local files are moved into `UPLOADS_DIR/.retention-quarantine`, the library item is marked `expirationPending`, then metadata is expired and the quarantined file is deleted. | If JSON or database persistence fails, the cleanup attempts to restore the file and clear pending state; cleanup stops the current apply run after the failure and can be retried. |
| JSON/PostgreSQL inconsistency risk | Library update helpers roll JSON state back when database dual-write fails or returns no updated record. | Pending media is represented as a non-active database asset; active records should not point to files deleted by cleanup. |
| Remote media download memory/SSRF risk | `storeRemoteUrl` and authenticated provider downloads now use streamed bounded storage through `storeRemoteUrlStreamed`. | Initial URLs and redirects are restricted to HTTP(S), resolved through DNS, checked against local/private/reserved networks, capped by redirect count, and written to temp files before atomic rename. |
| Database library reads unsafe for production ownership | Production environment validation rejects `DATABASE_LIBRARY_READ_ENABLED=true`. | `LIBRARY_STORAGE_BACKEND=json` with `DATABASE_LIBRARY_READ_ENABLED=false` remains allowed. Database-backed library reads are DEFERRED until owner mapping is complete. |

Remote media download status: streamed with byte counting and cleanup on failure,
not full `response.arrayBuffer()` buffering.

Additional remediation checks already run in this pass:

```text
npm run check:studio-api-contracts        PASS
npm run test:ops                          PASS
npm run test:database-library-integration PASS
npm run test:generation-jobs-db-integration PASS
npm run test:security-release             PASS
npm run test:upload-temp-cleanup          PASS
node scripts/test-upload-limits.mjs       PASS
npm run check:docs                        PASS
npm run lint                              PASS
npm run typecheck                         PASS
npm run build                             PASS
npm run check                             PASS
git diff --check                          PASS
rg -n "rate=[0-9]+r/h" deploy docs        PASS, no results
retired production path search in .env.production.example, deploy, and docs PASS, no results
rg -n "response\.arrayBuffer\(\)" src/lib/server PASS, no results
nginx -t                                  NOT_RUN, nginx was not found on this Windows workstation
```

## 17. 最终结论

最终状态：`COMPLETE_WITH_KNOWN_ISSUES`

当前分支：`chore/server-production-prep`

当前HEAD：`dabde60965384c03866cc890b26db2e6901c01e5` before the external review remediation commit

## External Review Remediation

Status for this section remains `COMPLETE_WITH_KNOWN_ISSUES` after local
verification passed. It still requires branch push, local 3107 manual
validation, and future server-gate checks before any real production rollout.

### Final Security Boundary Remediation

This remediation pass completed the final repository-side fixes requested by the
external review:

- remote provider JSON reads are bounded and no longer buffer arbitrary
  `response.text()` payloads in `src/lib/server/provider-call.ts`
- completed jobs no longer persist or return raw upstream `sourceUrl` values
- remote media allowlists are fail-closed in production through
  `REMOTE_MEDIA_ALLOWED_HOSTS`
- same-origin authenticated redirects remain allowed, but cross-origin redirects
  carrying sensitive auth headers are rejected
- remote media downloads, local byte storage, and data URL storage all keep the
  current size caps and safe MIME guards without leaking provider secrets

### Windows Database Test Isolation Fix

The `EPERM` failure on Windows was an artifact-isolation bug, not a database
assertion failure. Database test wrappers used a shared compiled output
directory `dist/database-tests` and deleted it immediately before each run,
which could race with lingering file handles on this workstation.

The current fix introduces `scripts/database/compiled-test-runner.mjs`:

- each database test run compiles into its own
  `dist/database-test-runs/run-<pid>-<timestamp>-<random>` directory
- the test runner overrides both `--outDir` and `--tsBuildInfoFile`
- cleanup removes only that unique run directory
- cleanup retries Windows transient lock failures with bounded retry/delay
- a cleanup failure now reports a safe relative path and non-zero exit status

Validated on this workstation with:

```text
npm run test:database-mvp                         PASS
npm run test:database-library-integration         PASS
npm run test:generation-jobs-db-integration      PASS
npm run test:generation-jobs-db-integration      PASS (repeat run)
```

### Media Expiration State Machine

Current local-media expiration now converges through persistent stages:

```text
active -> pending -> quarantined -> fileDeleted -> expired
```

- `pending`: metadata is written first and stores the original `storedName` plus
  the exact quarantine filename before any file rename happens.
- `quarantined`: the file has been atomically moved into
  `UPLOADS_DIR/.retention-quarantine` and can still be retried or restored.
- `fileDeleted`: the quarantined file has already been unlinked, so cleanup must
  never restore the record to active media; retries only finish the metadata
  convergence to `expired`.
- `expired`: local output references are cleared and temporary expiration fields
  are removed.

Recovery behavior on the next cleanup run:

- `pending` with original file still present: rename to quarantine and continue.
- `pending` with file already in quarantine: mark `quarantined` and continue.
- `quarantined` with file still present: unlink and move to `fileDeleted`.
- `fileDeleted`: finish metadata convergence to `expired`.
- `expired` with a record-backed quarantine file: delete the quarantine file and
  keep the item expired.

No fuzzy quarantine filename matching remains. Only exact
`expirationQuarantineName` values recorded on a library item are eligible for
deletion or recovery. This avoids deleting unknown files from the quarantine
directory.

### Remote Download Reliability

Remote media download now uses one controller across:

1. initial request
2. redirects
3. full response body streaming
4. final size check
5. atomic rename into uploads

The total timeout is cleared only after the final rename completes. A separate
idle timeout resets on every body chunk and aborts stalled transfers. On abort
or failure the reader is cancelled, the file stream is destroyed, and temporary
or partial files are deleted.

### Data URL and Byte Storage Bounds

- `storeDataUrl` accepts only the current image/video MIME allowlist.
- Base64 size is estimated before `Buffer.from(..., "base64")`.
- Oversized data URLs are rejected before decoding.
- Decoded buffers are checked again through the same server-side byte cap guard.
- `storeBytes` now checks MIME and size defensively, writes to a `0600` temp
  file, then atomically renames into the final uploads location.
- Provider `output.base64` results now route through `storeDataUrl`, so provider
  responses no longer bypass the MIME and pre-decode size guards.

### SSRF Boundary

- Production remote media download is fail-closed unless
  `REMOTE_MEDIA_ALLOWED_HOSTS` is configured.
- Exact hosts and explicit subdomain rules like `*.example.test` are supported.
- Suffix tricks like `example.test.evil.test` are rejected.
- Initial URLs and every redirect target must satisfy the allowlist.
- DNS answers are still checked against loopback, RFC1918, link-local, metadata,
  reserved ranges, and IPv4-mapped IPv6 private addresses.
- The default production path now connects to the resolved address directly and
  keeps the original host in `Host` and `servername`, which closes the
  validation-versus-connect DNS rebinding gap when arbitrary `fetch` is not in
  use.

### Nginx Assets

- Added `deploy/linux/nginx-limits.conf.example` for the real
  `limit_req_zone` definitions in the `http` context.
- `deploy/linux/nginx-site.conf.example` now only references the four zones:
  `aohuang_login`, `aohuang_register`, `aohuang_admin`, `aohuang_generate`.
- `scripts/check-docs.mjs` now validates that every `limit_req zone=` used by
  the site template is defined in the limits template and still rejects `r/h`.
- `.github/workflows/ci.yml` now installs Nginx on Ubuntu and runs `nginx -t`
  against a synthetic config that includes both templates and a temporary
  self-signed certificate.

### Added or Expanded Tests

- `scripts/test-media-retention-cleanup.mjs`
  - pending crash before rename
  - rename crash before `quarantined`
  - final JSON failure after `fileDeleted`
  - final database failure after `fileDeleted`
  - unlink `EACCES`
  - unlink `EBUSY`
  - restart recovery
  - record-backed quarantine orphan convergence
  - idempotent repeat run
- `src/lib/server/__tests__/remote-media-download.test.ts`
  - total timeout
  - idle timeout
  - connection close on abort
  - production allowlist fail-closed
  - exact host and explicit subdomain allowlist
  - suffix bypass reject
  - redirect to unlisted host reject
  - IPv4-mapped IPv6 private range reject
  - data URL pre-decode size rejection
  - temp-file cleanup for streamed and local writes
Current status for this remediation section:

- branch push: pending until the remediation commit is created
- merge to `main`: not done
- deploy to server 3106: not done
- local 3107 manual validation: `NOT_RUN`
- repository blocker state: no repository-local blocker is recorded here, but server acceptance remains a `SERVER-GATE`
- local verification completed:
  - `npm run check:docs` PASS
  - `npm run lint` PASS
  - `npx eslint . --max-warnings=0` PASS
  - `npm run typecheck` PASS
  - `npm run test:security-release` PASS
  - `npm run check:studio-api-contracts` PASS
  - `npm run test:database-library-integration` PASS
  - `npm run test:generation-jobs-db-integration` PASS
  - `npm run test:upload-temp-cleanup` PASS
  - `npm run test:ops` PASS
  - `npm run build` PASS
  - `git diff --check` PASS
  - `npm run check` PASS
- git checkout state at validation time:
  - branch `chore/server-production-prep`
  - HEAD `dabde60965384c03866cc890b26db2e6901c01e5`
- GitHub CI: NOT_RUN in this local remediation pass
- nginx -t on this workstation: NOT_RUN (nginx not installed)
- review recommendation: review the branch diff, complete local 3107 manual
  validation, then decide whether to approve merge to `main`
