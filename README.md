# 奥皇 AI

奥皇 AI 是一个本地优先的图片与视频生成工作台。第一版包含图片生成、视频生成、火山 ImageX/VOD 高清增强和作品库，并提供内置供应商配置后台。

## 功能

- 图片生成：文生图、图生图/图片编辑
- 视频生成：文生视频、图生视频
- 作品库：本地保存、预览、下载、删除生成结果
- 供应商后台：配置 API 地址、模型、密钥和启用状态
- 图片高清增强：调用火山 ImageX 进行高清增强
- 视频高清增强：调用火山 VOD 进行高清增强

## 本地启动

```bash
npm install
npm run dev
```

访问：

- 前台：`http://localhost:3000`
- 供应商后台：`http://localhost:3000/admin/providers`
- 客户登录入口：`http://localhost:3000/login`

## 3106 正式端口与 3107 测试端口

- 3106 是服务器正式环境，服务器最终只运行 3106。
- 3107 只在当前开发电脑运行，用于代码优化、自动测试和人工验收。
- 3107 不部署到服务器，也不需要服务器 systemd、Nginx 或数据目录。
- 新功能和服务器准备改动先在 3107 验证。
- `main` 代表允许进入正式发布流程的代码，但 Codex 不得自动合并 `main`。
- 服务器准备改动统一在 `chore/server-production-prep` 完成，每个模块独立 commit 并立即 push。
- 最终流程是：模块分支开发 -> 本地 3107 测试 -> push GitHub -> 代码审查 -> 合并 `main` -> 服务器部署 3106。
- 服务器部署不属于 Codex 自动任务。
- 详细流程见 `docs/PORT_RELEASE_WORKFLOW.md`。
- 手动测试见 `docs/3107_MANUAL_TEST_CHECKLIST.md`。
- 部署和数据规划见 `docs/DEPLOYMENT_AND_DATA_PLAN.md`。

## 环境变量

复制 `.env.example` 为 `.env.local`，按需填写。真实 API Key 不要提交到 Git。

```bash
cp .env.example .env.local
```

生成结果默认保存到本地 `data/` 和 `uploads/`，这两个目录已被 `.gitignore` 忽略。

运行 3107 测试环境时，建议显式隔离数据目录，避免写入 3106 正式数据：

```dotenv
PORT=3107
DATA_DIR=data-staging
UPLOADS_DIR=uploads-staging
```

3107 启动会强制校验隔离目录；缺少 `DATA_DIR` / `UPLOADS_DIR`，或指向默认 `data/`、`uploads/` 时会拒绝启动。

```bash
npm run dev:staging
npm run start:staging
```

未设置 `DATA_DIR` / `UPLOADS_DIR` 时，默认仍使用 `data/` 和 `uploads/`。

### 从旧项目保留下来的接口地址

旧仓库 `jike072-collab/codex_sp` 里的可用后端地址已经对照过：

- 已接入当前工作台：图片生成 `https://www.right.codes/draw/v1/images/generations`
- 已接入当前工作台：视频生成 `https://clmm-mall.top/v1/videos/generations`
- 已预留但当前未调用：识图 `https://right.codes/gemini`
- 已预留但当前未调用：文案/脚本 `https://api.deepseek.com/chat/completions`
- 已预留但当前未调用：本机代理 `http://127.0.0.1:8080/v1`

这些预留项已经写进 `.env.example`，以后做客户账号、自动提示词、识图分析或脚本文案时可以继续接。旧项目如果曾经填过真实 Key，不要提交到 Git；建议在新项目里重新手动填写或轮换。

## 高清增强配置

当前图片高清增强使用火山 ImageX，视频高清增强使用火山 VOD。供应商后台中的高清增强配置只接受当前火山 endpoint 类型：

- 图片高清增强：`volcengine-imagex-upscale`
- 视频高清增强：`volcengine-vod-upscale`

在 `.env.local` 或供应商后台中按需配置火山 AK/SK、ImageX ServiceId、VOD SpaceName 和输出域名。真实密钥只保存在本地环境或服务端配置中，不提交到 Git，不输出到日志。

旧的本地高清配置只在读取旧 `data/providers.json` 时做一次兼容映射；当前后台保存结果、API 返回和前端选项不会继续写入旧本地类型。

## 检查

```bash
npm run lint
npm run typecheck
npm run build
```
