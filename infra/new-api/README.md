# New API 独立测试环境

这个目录只放 New API 的隔离测试部署，不接前端，不放真实支付。

## 结构

- `docker-compose.yml` - New API、PostgreSQL、Redis 的独立测试编排
- `.env.example` - 需要复制成 `.env` 的示例环境变量
- `scripts/` - 启停、状态、日志脚本
- `docs/DEPLOYMENT.md` - 部署、初始化、验证说明

## 约束

- New API 版本固定，不使用 `latest`
- 数据库、Redis 不暴露公网端口
- New API 仅绑定本机或受控测试内网
- 真实 `.env`、备份和运行数据都应留在本地，不提交到 Git

## 快速开始

```bash
cd infra/new-api
cp .env.example .env
sh scripts/start
```

初始化管理员以后，再按 `docs/DEPLOYMENT.md` 的验证步骤检查健康状态。
