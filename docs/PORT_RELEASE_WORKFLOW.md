# 3107 测试与 3106 发布流程

## Unified Operations Commands

Use the hardened operations commands for service work:

- Status: `npm run service:status`
- Health: `npm run service:health`
- Start staging: `npm run service:start:staging`
- Start production: `npm run service:start:production`
- Deploy staging: `npm run deploy:staging`
- Deploy production: `npm run deploy:production -- --target <origin-main-merge-commit>`

Production deploy must run only after local 3107 acceptance has passed and the reviewed change has been merged to `main`.

## Single-Instance Workload Limits

The current production preparation branch uses in-process memory limits for early-user workload protection. This is intentional for the first 30 to 40 users and the current single 3106 instance.

- The counters and concurrency slots reset when the Node.js process restarts.
- The limits are not shared across multiple app instances.
- Do not run multiple 3106 app instances behind one proxy until these limits are moved to a shared store such as PostgreSQL or Redis.
- Normal reads, downloads, library browsing, quota reads, and job status polling must remain available when generation or upload slots are busy.
- 429 responses should include `Retry-After` when the server can compute a retry window.

## Environment Boundary Checks

- Local 3107 uses `PORT=3107`, local staging data directories, and may use test provider configuration.
- Server production uses `PORT=3106`, `NODE_ENV=production`, loopback listening only, persistent Linux data/uploads/runtime paths, and strong production-only secrets.
- Run `npm run env:check:local-staging` before local 3107 acceptance checks.
- Run `npm run env:check:production` and `npm run release:preflight` before any human-operated 3106 production start or deploy.
- These checks print variable names and reasons only. They must not print API keys, passwords, cookies, tokens, DSNs, or full production values.
- See `docs/ENVIRONMENT_VARIABLES.md` for the current variable contract.

本流程用于保证所有服务器准备改动先经过本机 3107 测试，再考虑进入 `main` 和 3106。它只定义流程，不改变业务功能，不新增部署依赖。服务器部署不属于本次 Codex 自动任务。

## 1. 端口职责

- 3106 是服务器正式环境，服务器最终只运行 3106。
- 3107 只在当前开发电脑运行，用于代码优化、自动测试和人工验收。
- 3107 不部署到服务器，也不需要服务器 systemd、Nginx 或数据目录。
- 禁止直接改动、重启、部署或覆盖 3106。
- 3107 测试通过后，才能考虑合并到 `main`，再由人工发布到 3106。
- 不清楚服务器部署方式时，只新增文档，不随意改服务器脚本。

## 2. 阶段顺序

每个阶段按以下顺序推进：

1. Understand：说明本阶段理解到的需求和边界。
2. Inspect：检查相关文件、现有实现、分支状态和未提交改动。
3. Spec：明确本阶段要达成的结果。
4. Plan：列出改动文件、改动方式、验证方式。
5. Implement：只做本阶段范围内的最小改动。
6. Verify：运行 `npm run lint`、`npm run typecheck`、`npm run build`。
7. Review：输出结构化审查报告和风险等级。
8. Push：推送到 GitHub 功能分支。
9. Wait：等待人工确认，不直接合并 `main`。

## 3. 推荐分支流程

1. 从最新 `origin/main` 创建或更新 `chore/server-production-prep`。
2. 在 `chore/server-production-prep` 完成服务器准备模块。
3. 每个模块只做一个主题明确的改动。
4. 本地运行检查：

```bash
npm run lint
npm run typecheck
npm run build
```

5. 每个模块制作一个独立 commit。
6. 立即 push 到 GitHub。
7. 在当前开发电脑运行或检查 3107。
8. 人工测试 3107。
9. 代码审查通过后，再由人工合并到 `main`。
10. `main` 稳定后，再由人工部署或重启服务器 3106。

## 4. 3107 本机测试环境建议

- 3107 只在当前开发电脑运行，不作为服务器 staging 环境。
- 3107 使用本机独立 `.env` 文件，例如 `.env.staging`，不得依赖服务器环境变量。
- 设置 `PORT=3107`。
- 设置 `DATA_DIR=data-staging`。
- 设置 `UPLOADS_DIR=uploads-staging`。
- `ADMIN_PASSWORD` 可以和正式不同。
- NewAPI Key 可以使用测试令牌，或使用正式令牌但要控制调用频率。
- `data` 和 `uploads` 必须和 3106 正式目录隔离。
- `dev:staging` 和 `start:staging` 会在启动前执行运行时目录校验。
- `PORT=3107` 时，缺少 `DATA_DIR` / `UPLOADS_DIR` 或使用默认 `data/`、`uploads/` 会拒绝启动。
- 3107 可以复制一份测试数据，但不能覆盖 3106 的正式数据。
- 复制数据前必须备份，复制 `uploads` 前要注意磁盘容量。

## 5. 3106 正式环境建议

- 设置 `PORT=3106`。
- 服务器最终只运行 3106，不运行 3107。
- `ADMIN_PASSWORD` 必填。
- `.env.local` 不进 Git。
- `DATA_DIR` 和 `UPLOADS_DIR` 未设置时默认使用 `data/` 和 `uploads/`。
- 正式 `data` 和 `uploads` 必须定期备份。
- 正式环境不要随意开启测试功能。
- 正式环境不要直接跑未合并分支。

## 5.1 自动化验证要求

3107 合并前必须由自动化提供证据：

```bash
npm run test:runtime-isolation
npm run check:runtime-paths
npm run test:staging-smoke
```

`test:staging-smoke` 只请求首页、登录页、供应商后台和健康接口，不调用图片生成、视频生成或 NewAPI 消耗额度接口。若本机 3107 已被其他服务占用，测试必须拒绝继续，不能误测旧服务。

## 6. 最小改动原则

写代码前必须先检查：

1. 这个功能是否真的现在需要？
2. 现有代码是否已经有类似能力？
3. 是否可以复用现有 helper、组件、API、数据结构？
4. 是否可以用浏览器原生能力、Node 标准能力或项目已安装依赖解决？
5. 是否可以只改一个小地方，而不是大范围重构？
6. 是否可以不新增依赖？
7. 如果必须新增代码，是否是最小可用改动？

禁止为测试阶段提前引入复杂系统，禁止为小功能做大架构，禁止重复实现已有逻辑。

## 7. 合并条件

合并前必须满足：

- `npm run lint` 通过。
- `npm run typecheck` 通过。
- `npm run build` 通过。
- 3107 页面能打开。
- 3107 供应商后台能打开。
- 3107 图片生成配置能读取。
- 3107 视频生成配置能读取。
- 3107 作品库能正常显示。
- NewAPI 后台调用日志符合预期。
- `data` / `uploads` 已确认隔离。
- 没有提交 API Key。
- 没有提交 `.env.local`、`data`、`uploads`、生成媒体文件或用户上传文件。
- 没有改坏当前 3106 正式功能。

## 8. 审查与风险等级

每次完成后必须输出结构化审查报告。风险等级使用：

- `critical`：泄露 API Key、破坏 3106 正式数据、删除 `uploads` / `data`、导致项目无法启动、绕过后台权限。
- `high`：改变现有 API 路径、改变现有数据结构但没有兼容、影响图片/视频生成主流程、新增未说明依赖、错误处理可能导致数据丢失。
- `medium`：UI 行为变化但未说明、文档和实际实现不一致、缺少手动测试说明、3107 / 3106 环境隔离说明不完整。
- `low`：文案问题、注释不清楚、文件组织可以更好。

## 9. 禁止事项

- 禁止直接 push `main`。
- 禁止直接修改、重启、部署或覆盖 3106。
- 禁止把 3107 部署到服务器。
- 禁止自动合并 `main`。
- 禁止使用 `git reset --hard`、强制推送或改写公共历史。
- 禁止把 3107 的测试数据覆盖到 3106。
- 禁止提交 `.env.local`。
- 禁止提交 API Key。
- 禁止提交 `data`。
- 禁止提交 `uploads`。
- 禁止提交生成图片、视频、用户上传文件。
- 禁止一次性大重构。
- 禁止没有计划就写代码。
- 禁止没有验证就说完成。
- 禁止为了“看起来高级”提前引入数据库、登录、支付、队列。

## 10. 允许事项

- 可以先写文档和流程。
- 可以做小范围安全修复。
- 可以增加错误提示。
- 可以增加日志，但不能记录敏感信息。
- 可以增加 3107 测试清单。
- 可以增加数据隔离说明。
- 可以整理代码，但必须小步进行。
- 可以为未来 SQLite、PostgreSQL、对象存储做规划，但不要提前实现复杂迁移。
