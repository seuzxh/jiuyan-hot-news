# 韭研热点 · 韭研公社资讯去噪聚合系统

抓取[韭研公社](https://www.jiuyangongshe.com/)公开帖流，经**四层去噪**（规则预筛 → LLM 双次打分 → 事件聚簇 → 按事件算热度）后，按题材**分类汇总**：飞书每日三推（08:00/12:00/20:00）+ 展示网站。设计借鉴 [AIHOT](https://github.com/KKKKhazix/AIHOT)。

> 📐 **文档目录 [docs/README.md](docs/README.md)**：架构 · 技术方案 · 资讯分类方案 · 内容检索提炼方案 · 新鲜度方案

## 快速开始

```bash
npm install
cp .env.example .env   # 填入 FEISHU_WEBHOOK_URL
npm run pipeline       # 全管线（需 .env 中 LLM 阶段配置，见技术方案 §5）
npm run web            # 展示网站 dev server
```

## 管线阶段

| 命令 | 作用 | LLM |
|---|---|---|
| `npm run crawl` | 抓取板块页（题材/个股/资讯 × 四排序），解析入库 | - |
| `npm run prefilter` | 去重、拦截、旧文规则，产出候选（≤80/轮） | - |
| `npm run score` | 双次打分 + 结构化标签（handoff 模式生成任务后 `-- --consume` 回填） | ✓ |
| `npm run cluster` | 事件聚簇（规则候选 + LLM 复核，宁分勿合） | ✓ |
| `npm run write` | 事件摘要（答案先行）+ 推荐理由 | ✓ |
| `npm run theme` | 题材聚合：催化逻辑综述 + Top5 概念股 | ✓ |
| `npm run push` | 飞书推送题材增量卡片（`--dry` / `--slot=` / `--since-hours=N`） | - |
| `npm run web` | 展示网站（日期+分类+三列卡片 / 热点榜 / 事件页 / 搜索 / 日报） | - |
| `npm test` / `npm run typecheck` | 24 项单测 / 类型检查 | - |

## 调度

- **当前**：ZCode 定时任务每日 08:00/12:00/20:00（LLM 走 agent-handoff，依赖本机在线）
- **规划**：VPS 后切换 pg-boss + PostgreSQL + Docker（schema 已按兼容写法设计，见技术方案 §12）

## 调什么

| 想调 | 改哪里 |
|---|---|
| 信什么算"重要"（评分标准） | `industry/prompts/score.md` |
| 分级门槛 / 预筛规则 / 热度权重 | `industry/selection.ts` |
| 展示分类口径 | `packages/core/src/taxonomy.ts` |
| 抓哪些板块 | `industry/sources.json` |

## 多信源

采集层按适配器接口设计（`packages/sources`），韭研公社为首个实现；新增信源（财联社/雪球…）实现 `SourceAdapter` 即可复用全部下游（打分/聚簇/热度/推送/网站）。

## 历史安全事件

2026-11 前的历史提交曾明文包含 Coze token 与飞书 webhook（均已轮换）。凭据一律走 `.env`（已 gitignore）。

## 许可证

MIT
