# 韭研公社资讯聚合系统（JYC Hot News）

投资研究资讯聚合管线 + 展示网站。借鉴 [AIHOT](https://github.com/KKKKhazix/AIHOT)：规则预筛 → LLM 双次打分 → 事件聚簇 → 题材聚合（催化逻辑+Top5 概念股），按题材分类汇总后推送飞书与网站。**文档：[docs/README.md](docs/README.md)（架构/技术方案/分类/检索提炼/新鲜度 五篇）。**

## 架构总览

```
采集(crawl) → 预筛(prefilter) → 打分(score) → 聚簇(cluster)
  → 写作(write) → 题材(theme) → 推送(push) / 网站(apps/web)
```

三级内容层级：**条目（帖子）→ 事件（同事件多帖合一）→ 题材（同分类多事件：催化逻辑综述 + Top5 概念股）**。推送卡片题材优先。

- 每阶段独立 CLI；存储 SQLite（`data/jycgs.db`，Postgres 兼容写法）
- LLM 双模式：`GLM_API_KEY` 直调 API；否则 agent-handoff（任务落盘 `data/llm-tasks/`，agent 产出 `data/llm-results/` 同名文件，`--consume` 回填）
- know-how 外置：`industry/`（信源/门槛/提示词）+ `packages/core/src/taxonomy.ts`（分类）

## 常用命令

```bash
npm run crawl / prefilter / score / cluster / write / theme / push   # 各阶段（条目→事件→题材→推送）
npm run score -- --consume                                    # 回填 handoff（cluster/write/theme 同）
npm run push -- --dry | --slot=morning|noon|evening | --since-hours=N
npm run web        # 网站 dev server
npm test           # 单测（28 项）
npm run typecheck  # 根 + web 双 tsconfig
```

dev 工具：`scripts/dev/inspect-fixture.ts`（站点改版探 DOM）、`reset-events.ts`（清事件重跑聚簇）、`test-webhook.ts`（UTF-8 连接测试，**勿用 shell curl 发中文会 GBK 乱码**）。

## 运维要点（agent 定时任务须知）

- **ZCode 定时任务** `automation-43054d47-936c-48d3-99d5-cb4abc16ce6c` 每日 08:00/12:00/20:00 触发全流程；依赖本机开机
- **handoff 铁律**：结果文件 outputs 的 id/groupId/eventId 与 batch 必须**原样复制**任务文件（历史两次笔误均被校验拦截）；任务/结果同名配对
- **打分中断后**：已生成的 cluster 任务基于不完整 selected 集合 → 删任务重跑 cluster
- **推送失败（code 19001）**：webhook 失效，不记 pushes 不丢数据；换 webhook 后 `push -- --since-hours=N` 补发
- **聚簇复核口径**：同一具体事件或同一催化主线才 true（如同标的同进展线）；拿不准一律 false；**组内含已归属其他事件的成员时禁 true**（commitGroup 双挂缺陷，技术方案 §11#1）

## 环境变量（.env，已 gitignore）

| 变量 | 必需 | 说明 |
|---|---|---|
| `FEISHU_WEBHOOK_URL` | 是 | 飞书群机器人 webhook |
| `FEISHU_SECRET` | 否 | 加签校验 |
| `GLM_API_KEY` | 否 | 不设走 agent-handoff |
| `GLM_BASE_URL` / `GLM_MODEL_*` | 否 | 默认智谱 v4 / glm-4-flash |

## 约定

- 时间戳一律 ISO8601 UTC 存储，展示层转北京时区（`bjTime`/`bjDateKey`/`currentSlot`）
- 帖子去重主键 `/a/{id}`；事件为推送/展示单位，代表帖 = 分数最高 → T1_5 → 更早
- 抓取礼貌策略：UA+Referer、2-5s 随机间隔、指数退避；选择器集中 `packages/sources/src/jiuyangongshe/selectors.ts`（改版先跑 inspect-fixture + 更新 `__fixtures__` 回归）
- 运行统计与踩坑记录见 `docs/技术方案.md` §5.3 / §9
