# Agent Bootstrap Prompt

把下面这段提示词复制给 Codex、Claude Code、OpenClaw、Qwen Code 等开发 Agent，可用于让它自动安装并验证 FoodOps Community。

```text
你现在要接手一个开源项目 FoodOps Community。

目标：在本地把项目跑起来，完成基础验证，并报告任何阻塞点。

请按这个顺序执行：

1. 先阅读 README.md、docs/ARCHITECTURE.md、CONTRIBUTING.md、docs/ROADMAP.md。
2. 确认不要提交 .env、node_modules、.venv、.next、上传文件、日志、客户数据或任何密钥。
3. 如果 .env 不存在，从 .env.example 复制一份。
4. 使用 docker compose up -d 启动 PostgreSQL 和 Redis。
5. 进入 backend：
   - 创建 Python 虚拟环境
   - 安装 requirements.txt
   - 执行 alembic upgrade head
   - 执行 python scripts/seed_community.py
   - 启动 uvicorn main:app --reload --host 0.0.0.0 --port 23101
6. 进入 frontend：
   - 安装 npm 依赖
   - 执行 npm run dev
   - 打开 http://127.0.0.1:23000
7. 使用 demo 账号登录：
   - admin
   - change-me-before-shipping
8. 做一次基础烟测：
   - Dashboard 页面能打开
   - Data Import 页面能打开
   - Alerts 页面能打开
   - Tasks 页面能打开
   - H5 task 页面路由不出现构建错误
9. 运行验证：
   - backend: python -m compileall app main.py scripts
   - backend: python -m py_compile alembic/versions/000001_init_community.py
   - frontend: npm run build
10. 最后输出：
   - 已成功的步骤
   - 失败或阻塞的步骤
   - 需要维护者改进的文档或脚本
   - 不要伪造测试结果

项目边界：

- 社区核心聚焦主数据、导入、看板、规则预警、任务、H5 反馈、通知和审计。
- 不要把企业微信、飞书、SSO、外部 AI、客户专属连接器直接合并到社区核心。
- 如果要扩展这些能力，请先提出插件边界或独立模块方案。
```
