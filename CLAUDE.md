# 韭研公社资讯聚合系统（JYC Hot News）

投资研究资讯聚合管线 + 展示网站。借鉴 [AIHOT](https://github.com/KKKKhazix/AIHOT)：规则预筛 → LLM 双次打分 → 事件聚簇 → 概念逻辑卡（按产业逻辑链归类：结论 + 因果链 + 标的角色 + 风险），**以概念为单位**推送飞书与网站。**文档：[docs/README.md](docs/README.md)（架构/技术方案/分类/检索提炼/新鲜度 五篇）。**

## 架构总览

```
采集(crawl) → 预筛(prefilter) → 打分(score) → 聚簇(cluster)
  → 写作(write) → 概念(concept) → 推送(push) → 站点日更(scripts/dev/site.mjs) / 网站(apps/web)

按需支线：ask（关键词问股，M1 已上线）—— items → 意图分析 → 实时爬取+三路召回
  → R1 汇聚 → Top帖全文 → R2 汇聚 → ask_results（详见 docs/关键词问答技术方案.md）
```

三级内容层级：**条目（帖子）→ 事件（同事件多帖合一）→ 概念（同一条产业逻辑链的多帖：逻辑卡 = 结论 + 因果链 + 标的及其角色 + 风险）**。

内容单位是概念而不是帖子：读者要的是"这条逻辑走到哪一步、谁在链条的哪一环"。帖子（含盘前纪要等汇总帖）只是素材——汇总帖里的话题由 concept 阶段拆开，分别归到对应概念；推送与网站首页都以概念卡为主体，帖子退为可展开的来源，不逐条转发。

- 每阶段独立 CLI；存储 SQLite（`data/jycgs.db`，Postgres 兼容写法）
- LLM 双模式：`GLM_API_KEY` 直调 API；否则 agent-handoff（任务落盘 `data/llm-tasks/`，agent 产出 `data/llm-results/` 同名文件，`--consume` 回填）
- know-how 外置：`industry/`（信源/门槛/提示词）+ `packages/core/src/taxonomy.ts`（分类）

## 常用命令

```bash
npm run crawl / prefilter / score / detail / cluster / write / concept / push   # 各阶段（条目→事件→概念→推送）
npm run score -- --consume                                    # 回填 handoff（cluster/write/concept 同）
npm run concept [-- --consume] [-- --date=YYYY-MM-DD]          # 概念逻辑卡；默认最近 24h，--date 回填某北京日
npm run push -- --dry [-- --all] | --slot=morning|noon|evening | --since-hours=N   # --dry --all 预览卡片（全部帖子按待推送，不动推送记录）
node scripts/dev/site.mjs build && node scripts/dev/site.mjs stage  # 公网站点构建+打包，再用 zcode-site deploy .zcode-site/stage
npm run ask -- --keyword=福莱新材        # 关键词问股（--no-crawl / --consume / --show=<id> / --json）
npm run web        # 网站 dev server
npm test           # 单测（49 项）
npm run typecheck  # 根 + web 双 tsconfig
```

dev 工具：`scripts/dev/site.mjs`（公网站点 build/stage）、`scripts/dev/inspect-fixture.ts`（站点改版探 DOM）、`reset-events.ts`（清事件重跑聚簇）、`test-webhook.ts`（UTF-8 连接测试，**勿用 shell curl 发中文会 GBK 乱码**）、`ask-m1-regression.ts`（问股召回基准回归）。

## 运维要点（agent 定时任务须知）

- **ZCode 定时任务** `automation-43054d47-936c-48d3-99d5-cb4abc16ce6c` 每日 08:00/12:00/20:00 触发全流程；依赖本机开机
- **handoff 铁律**：结果文件 outputs 的 id/groupId/eventId 与 batch 必须**原样复制**任务文件（历史两次笔误均被校验拦截）；任务/结果同名配对
- **ask-aggregate handoff 任务**（问股链路产生，`data/llm-tasks/ask-aggregate-*.json`）：outputs 是**单元素数组**（一个结果对象，非逐条），id 用输入候选的 `id` 字段；batch 后缀 `_r1`/`_r2` 标轮次——R1 回填后由 `npm run ask -- --consume` 自动抓全文并可能派生 `_r2` 任务；任务内 prompt/agentInstructions 自描述，照做即可
- **打分中断后**：已生成的 cluster 任务基于不完整 selected 集合 → 删任务重跑 cluster
- **推送失败（code 19001）**：webhook 失效，不记 pushes 不丢数据；换 webhook 后 `push -- --since-hours=N` 补发
- **聚簇复核口径**：同一具体事件或同一催化主线才 true（如同标的同进展线）；拿不准一律 false；**组内含已归属其他事件的成员时禁 true**（commitGroup 双挂缺陷，技术方案 §11#1）
- **概念逻辑卡（concept，输出的主体）**：按 `industry/prompts/concept.md` 写——归类看逻辑不看体裁，粒度是一条能独立讲清的逻辑链；判断以任务里的正文节选 `text` 为准（摘要只是索引，标的角色和数字都在正文里）；只依据输入事实、事实与推断分开表述、不照搬帖子标题和摘要。结果里的事件 id 建议用短键映射展开，避免手抄出错。未被任何概念覆盖的帖子会由代码兜底成"其他动态"，所以宁可多归不要漏
- **站点日更**：每轮推送后 build → stage → deploy；部署后确认线上首页 200 且 `/assets/*.css` 200（Windows 构建的 bundle 路径分隔符问题已由 site.mjs 修复，页面若变裸 HTML 先查这个）。**浏览器端代码不能引用服务端模块**：`apps/web/app/components/*` 和路由文件的组件部分，既不要 import `@jyc/core`，也不要 import `lib/queries.ts` 的运行时导出——两者都带 node:sqlite，会让 client build 报 `mkdirSync is not exported by "__vite-browser-external"`。路由 loader 里用它们没问题（构建时会剔除）；组件要用的纯函数放 `lib/grouping.ts`（类型可以用 `import type` 引）

## 环境变量（.env，已 gitignore）

| 变量 | 必需 | 说明 |
|---|---|---|
| `FEISHU_WEBHOOK_URL` | 是 | 飞书群机器人 webhook |
| `FEISHU_SECRET` | 否 | 加签校验 |
| `JYC_SITE_URL` | 否 | 公网展示站地址，写入推送卡片脚注（来源帖入口） |
| `GLM_API_KEY` | 否 | 不设走 agent-handoff |
| `GLM_BASE_URL` / `GLM_MODEL_*` | 否 | 默认智谱 v4 / glm-4-flash；问股可配 `GLM_MODEL_ASK_INTENT` / `GLM_MODEL_ASK_AGG` |
| `ASK_CRAWL_DEBOUNCE_MS` / `ASK_STALE_MS` | 否 | 问股爬取防抖（默认 15min）/ running 行超时回收（默认 30min） |

## 约定

- 时间戳一律 ISO8601 UTC 存储，展示层转北京时区（`bjTime`/`bjDateKey`/`currentSlot`）
- 帖子去重主键 `/a/{id}`；事件为推送/展示单位，代表帖 = 分数最高 → T1_5 → 更早
- 抓取礼貌策略：UA+Referer、2-5s 随机间隔、指数退避；选择器集中 `packages/sources/src/jiuyangongshe/selectors.ts`（改版先跑 inspect-fixture + 更新 `__fixtures__` 回归）
- 运行统计与踩坑记录见 `docs/技术方案.md` §5.3 / §9
