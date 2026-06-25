# 奥皇 AI

奥皇 AI 是一个本地优先的图片与视频生成工作台。第一版包含图片生成、视频生成、基于本地 CLI 的图片/视频高清和作品库，并提供内置供应商配置后台。

## 功能

- 图片生成：文生图、图生图/图片编辑
- 视频生成：文生视频、图生视频
- 作品库：本地保存、预览、下载、删除生成结果
- 供应商后台：配置 API 地址、模型、密钥和启用状态
- 图片高清：调用本机 Upscayl CLI 放大图片
- 视频高清：调用本机 Video2X CLI 放大视频

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

- 3106 是正式端口。
- 3107 是测试端口。
- 新功能先在 3107 验证。
- 通过后再考虑合并并发布到 3106。
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

未设置 `DATA_DIR` / `UPLOADS_DIR` 时，默认仍使用 `data/` 和 `uploads/`。

### 从旧项目保留下来的接口地址

旧仓库 `jike072-collab/codex_sp` 里的可用后端地址已经对照过：

- 已接入当前工作台：图片生成 `https://www.right.codes/draw/v1/images/generations`
- 已接入当前工作台：视频生成 `https://clmm-mall.top/v1/videos/generations`
- 已预留但当前未调用：识图 `https://right.codes/gemini`
- 已预留但当前未调用：文案/脚本 `https://api.deepseek.com/chat/completions`
- 已预留但当前未调用：本机代理 `http://127.0.0.1:8080/v1`

这些预留项已经写进 `.env.example`，以后做客户账号、自动提示词、识图分析或脚本文案时可以继续接。旧项目如果曾经填过真实 Key，不要提交到 Git；建议在新项目里重新手动填写或轮换。

## Windows 本地高清配置

图片高清和视频高清均在本机执行，不需要 API Key。可在供应商后台填写可执行文件路径；留空时程序会检查环境变量、常见安装目录和 `PATH`。

### Upscayl

1. 从 [Upscayl 官方 Releases](https://github.com/upscayl/upscayl/releases) 安装 Windows 版，或从 [upscayl-ncnn Releases](https://github.com/upscayl/upscayl-ncnn/releases) 下载独立 CLI。
2. 桌面版通常会把 CLI 安装到 `%LOCALAPPDATA%\Programs\Upscayl\resources\bin\upscayl-bin.exe` 或 `C:\Program Files\Upscayl\resources\bin\upscayl-bin.exe`，程序会自动检测这些位置。
3. 独立 CLI 需要保留模型目录；如模型不在可执行文件相邻的 `..\models`，设置 `UPSCAYL_MODELS_DIR`。
4. 在 `.env.local` 中按需设置：

```dotenv
UPSCAYL_BIN=C:/path/to/upscayl-bin.exe
UPSCAYL_MODELS_DIR=C:/path/to/models
UPSCAYL_MODEL=upscayl-standard-4x
UPSCAYL_GPU_ID=0
```

`UPSCAYL_BIN` 和 `UPSCAYL_MODELS_DIR` 可留空使用自动检测；`UPSCAYL_MODEL` 必须与模型目录中的模型名称匹配。Upscayl 的 NCNN 后端要求 Vulkan 兼容 GPU，纯 CPU 或许多集成显卡无法运行，参见 [Upscayl 官方故障排查](https://github.com/upscayl/upscayl/wiki/Troubleshooting)。

### Video2X

1. 从 [Video2X 官方 Releases](https://github.com/k4yt3x/video2x/releases) 下载 Windows 安装程序并安装。
2. 如 `video2x.exe` 未被自动检测，在供应商后台填写完整路径，或设置 `VIDEO2X_BIN`。
3. 在 `.env.local` 中按需设置：

```dotenv
VIDEO2X_BIN=C:/path/to/video2x.exe
VIDEO2X_MODEL=realesr-animevideov3
VIDEO2X_GPU_ID=0
VIDEO2X_CODEC=libx264
VIDEO2X_CRF=18
```

Windows 预编译版 Video2X 要求 CPU 支持 AVX2，GPU 支持 Vulkan；安装前请核对 [官方硬件要求](https://github.com/k4yt3x/video2x#%EF%B8%8F-hardware-requirements)。可运行 `video2x.exe --list-devices` 查看 Vulkan 设备，命令行参数见 [Video2X 官方 CLI 文档](https://docs.video2x.org/running/command-line.html)。

### 许可注意

Upscayl、upscayl-ncnn 与 Video2X 均采用 GNU AGPL v3。安装、修改、分发、捆绑或通过网络提供修改后的版本前，请阅读 [Upscayl 许可证](https://github.com/upscayl/upscayl/blob/main/LICENSE)、[upscayl-ncnn 许可证](https://github.com/upscayl/upscayl-ncnn/blob/master/LICENSE) 和 [Video2X 许可证](https://github.com/k4yt3x/video2x/blob/master/LICENSE)，并自行确认源码提供、版权声明及依赖许可证等义务。本说明不构成法律意见。

## 检查

```bash
npm run lint
npm run typecheck
npm run build
```
