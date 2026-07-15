# Channel Posts

## WeChat Moments

我们把 FoodOps Community 开源了。

这是一个面向连锁餐饮门店的自托管运营系统，先聚焦最小运营链路：

主数据、手动导入、dashboard、本地规则预警、任务派发、H5 反馈、通知和审计日志。

技术栈是 FastAPI + Next.js + PostgreSQL。

现在想找第一批开发者和懂门店运营的朋友一起试跑、提问题、做 good first issue。

GitHub:

https://github.com/wangsalin/foodops

有兴趣的朋友可以先 star 或者直接看 issue。

## Developer Group

我们刚开源了一个行业工具项目：FoodOps Community。

方向是连锁餐饮门店运营，不做大平台，不做外卖交易，先做一条可自托管的运营链路：

`导入数据 -> 规则预警 -> 任务派发 -> H5 反馈 -> 审计复盘`

技术栈：

- FastAPI
- SQLAlchemy / Alembic
- PostgreSQL
- Redis
- Next.js
- Ant Design

目前仓库已经有 README、CI、issue 模板、good first issues 和分支保护。

GitHub:

https://github.com/wangsalin/foodops

欢迎熟悉后端、前端、测试、行业 SaaS、餐饮运营的朋友试跑一下。最需要的是具体反馈：哪里跑不起来、导入字段哪里不合理、任务流哪里可以更贴近门店现场。

## Juejin / V2EX Short Post

标题建议：

开源一个面向连锁餐饮门店的自托管运营系统：FoodOps Community

正文：

最近把一个餐饮门店运营方向的项目整理成了开源社区版：FoodOps Community。

项目不做外卖平台，也不做完整 ERP，先聚焦一条基础运营链路：

- 主数据
- 手动导入
- dashboard
- 本地规则预警
- 任务派发
- H5 反馈
- 通知
- 审计日志

技术栈：

- FastAPI
- SQLAlchemy / Alembic
- PostgreSQL
- Redis
- Next.js
- Ant Design

现在比较需要社区帮忙完善：

- 导入模板
- demo seed
- 后端测试
- 前端 smoke tests
- alert-to-task 流程

GitHub:

https://github.com/wangsalin/foodops

欢迎 star、试跑、提 issue，也欢迎直接认领 good first issue。

## Zhihu Opening

如果一个中小型连锁餐饮团队还没有完整的数据中台和企业系统，它每天仍然要处理很多具体问题：销售数据怎么汇总、库存异常怎么发现、门店任务怎么派发、处理结果怎么反馈、后续怎么复盘。

FoodOps Community 想先解决这条最小链路。

它不是外卖平台，也不是大而全 ERP，而是一个可自托管的开源运营系统，聚焦：

`主数据 -> 导入 -> 预警 -> 任务 -> H5 反馈 -> 审计`

项目地址：

https://github.com/wangsalin/foodops

我们现在更需要开发者和行业使用者一起验证：这套链路是否足够清晰，导入模板是否合理，本地启动是否顺畅，任务流是否贴近门店真实场景。

## GitHub Discussion / Issue Pin

Welcome to FoodOps Community.

This project is intentionally scoped to a local-first operations loop for food service teams:

`master data -> imports -> dashboard -> alerts -> tasks -> H5 feedback -> notifications -> audit logs`

The first community milestone is not feature expansion. It is making the local loop easy to run, easy to inspect, and easy to contribute to.

Good starting points:

- Try the local setup.
- Review the import normalizers.
- Improve demo seed data.
- Add tests for import and alert-to-task flows.
- Open issues for unclear docs or setup friction.

Repository:

https://github.com/wangsalin/foodops
