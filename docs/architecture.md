# 架构

> 状态：生产运行中（每日 08:00/12:00/20:00 自动执行）· 设计蓝本 [AIHOT](https://github.com/KKKKhazix/AIHOT)

## 1. 设计原则

1. **分层去噪**：规则预筛拦明确噪声 → LLM 双次打分过分级门槛 → 事件聚簇去重 → 题材聚合综述。每层只做一件事，层间以数据库解耦
2. **管线分阶段**：每阶段独立 CLI，可单独运行/测试/替换调度器
3. **LLM 双模式**：`GLM_API_KEY` 直调智谱 API；无 key 走 agent-handoff（任务落盘 → ZCode 定时任务中的 agent 按同一套提示词产出 → 校验回填）
4. **know-how 外置**：信源/门槛/提示词在 `industry/`，分类在 `packages/core/src/taxonomy.ts`——改标准不改代码
5. **Postgres 兼容**：SQLite 起步（零部署依赖），DDL 与查询保持 PG 语义，VPS 到位后平移

## 2. 数据流

```
┌────────┐  ┌───────────┐  ┌──────────┐  ┌─────────┐  ┌────────┐  ┌────────┐  ┌────────┐
│ crawl  │→ │ prefilter │→ │  score   │→ │ cluster │→ │ write  │→ │ theme  │→ │  push  │
│ SSR抓取 │  │ 规则去噪   │  │ LLM双打分 │  │ 事件聚簇 │  │ 摘要写作│  │ 题材综述│  │ 飞书卡片│
└───┬────┘  └─────┬─────┘  └────┬─────┘  └────┬────┘  └───┬────┘  └───┬────┘  └───┬────┘
    │             │             │             │           │           │          │
    └─────────────┴──────┬──────┴──────┬──────┴───────────┴───────────┴──────────┘
                        ▼             ▼
                 items（条目）    events（事件）──► themes（题材）
                        └──── SQLite data/jycgs.db ────┘
                                   │
                     ┌─────────────┴─────────────┐
                     ▼                           ▼
              push（飞书增量卡片）          apps/web（展示网站）
```

**按需支线 ask（关键词问股，M1 已上线）**——与上面定时批处理互补的用户主动查询：

```
items ──► 意图分析(GLM) ──► 实时爬取(防抖) + 三路召回 ──► R1 汇聚 ──► Top帖全文深挖 ──► R2 汇聚 ──► ask_results
CLI: npm run ask -- --keyword=<个股/概念>   （Web /ask 页 + /api/ask SSE 已上线：五步进度/watch 续传/handoff 自动续跑）
```

三个内容层级：**条目（帖子）→ 事件（同事件多帖合一）→ 题材（同分类多事件的综述单元）**。推送与网站首页均以题材/事件为单位，不再转发单帖。

## 3. Monorepo 结构

```
apps/web            # 展示网站：React Router v7 SSR + Tailwind v4
packages/core       # 领域类型、SQLite 存储层、预筛/热度/题材聚合逻辑、taxonomy 分类
packages/sources    # 信源适配器接口（SourceAdapter）+ jiuyangongshe 实现（crawlAll 共享爬取 / fetchDetail 全文）
packages/ask        # 关键词问股：三路召回（recall）+ 四段编排（run），CLI 与 Web 共用
packages/llm        # GLM 客户端、handoff 协议（任务/结果文件）、schema 校验
industry/           # know-how：sources.json / selection.ts / prompts/*.md（score·cluster·write·theme·ask-intent·ask-aggregate）
database/migrations # SQL 迁移（0001_init、0002_themes、0003_ask）
scripts/            # 各阶段 CLI（含 ask.ts）+ dev 工具（inspect-fixture / reset-events / test-webhook / ask-m1-regression）
data/               # 运行时产物（gitignore）：jycgs.db、llm-tasks/、llm-results/
docs/               # 本文档目录
```

## 4. 技术栈

| 层 | 选型 | 备注 |
|---|---|---|
| 运行时 | Node ≥22.13 + TypeScript + tsx | node:sqlite 内置，无原生编译依赖 |
| 包管理 | npm workspaces | 无额外工具链 |
| 解析 | cheerio | 选择器集中在 `selectors.ts`，fixture 回归 |
| LLM | 智谱 OpenAI 兼容接口 / agent-handoff | 每阶段可独立配模型 |
| 存储 | SQLite（WAL）→ 规划 Postgres | 迁移文件即 schema 文档 |
| 网站 | React Router v7 SSR + Tailwind v4 | 直读同一 SQLite |
| 测试 | vitest（45 项） | 解析/预筛/分类/题材/问股召回/详情页全覆盖 |
| 调度 | ZCode 定时任务 → 规划 pg-boss | CLI 与调度器解耦 |

## 5. 调度与部署形态

- **当前**：ZCode 定时任务（cron `0 8,12,20 * * *`）逐阶段调 CLI；LLM 阶段由运行中的 agent 充当（handoff）；依赖本机在线
- **规划（Phase 5）**：VPS + Docker Compose（web/worker/postgres）→ SQLite 迁 PG → pg-boss 接管调度 → `GLM_API_KEY` 直调、移除 handoff
- 多信源：新信源实现 `SourceAdapter` 即接入全部下游（打分/聚簇/题材/推送/网站）

## 6. 相关文档

[技术方案](技术方案.md)（实现细节）· [资讯分类方案](资讯分类方案.md) · [内容检索提炼方案](内容检索提炼方案.md) · [新鲜度方案](新鲜度方案.md)
