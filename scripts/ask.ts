/**
 * 关键词问答（问股）CLI：npm run ask -- --keyword=福莱新材 [--no-crawl] [--json]
 * handoff 模式（无 GLM_API_KEY）：段③ 落盘 data/llm-tasks/ask-aggregate-*.json，
 * agent 产出结果后 `npm run ask -- --consume` 回填续跑。
 * npm run ask -- --show=<id>：重放某次查询的落库结果。
 */
import { defaultDbPath, defaultMigrationsDir, openDb } from "@jyc/core";
import {
  consumeAsk,
  getAskResultRow,
  reclaimStaleAskRows,
  runAsk,
  taxonomyHints,
  type AskRunResult,
} from "@jyc/ask";
import type { AskAggregateOutput } from "@jyc/llm";

const root = process.cwd();
const args = process.argv.slice(2);
const keyword = args.find((a) => a.startsWith("--keyword="))?.slice("--keyword=".length);
const consume = args.includes("--consume");
const noCrawl = args.includes("--no-crawl");
const asJson = args.includes("--json");
const showId = args.find((a) => a.startsWith("--show="))?.slice("--show=".length);

function renderResult(r: AskRunResult | { result?: AskAggregateOutput }): void {
  const res = (r as AskRunResult).result;
  if (!res) return;
  console.log("\n────────── 结论 ──────────");
  console.log(res.conclusion);
  if (res.keyPoints.length > 0) {
    console.log("\n── 关键信息点 ──");
    for (const k of res.keyPoints) {
      const form = k.form === "B" ? `[B·主推${(k.subjects ?? []).join("/")}]` : "[A]";
      const layers = k.infoLayers.join("/");
      const inc = k.infoIncomplete ? "⚠信息不全" : "";
      console.log(`· ${k.point} ${form}（${layers}）${inc} ← ${k.sourceIds.join(", ")}`);
      if (k.mergedFrom) console.log(`  合并：${k.mergedFrom}`);
    }
  }
  if (res.relatedStocks.length > 0) {
    console.log("\n── 关联标的 ──");
    console.log(res.relatedStocks.map((s) => `${s.name}（${s.reason}）`).join("；"));
  }
  if (res.timeline.length > 0) {
    console.log("\n── 时间线（北京时间）──");
    for (const t of res.timeline) console.log(`  ${t.time}  ${t.text}`);
  }
  if (res.gaps.length > 0) {
    console.log("\n── 缺口与待验证 ──");
    for (const g of res.gaps) console.log(`· ${g}`);
  }
  if (res.rejected.length > 0) {
    console.log(`\n（已过滤 ${res.rejected.length} 条无关候选，拒因留档 ask_results.recall/result_json）`);
  }
}

const db = openDb(defaultDbPath(root), defaultMigrationsDir(root));

if (consume) {
  const summaries = await consumeAsk(db, root);
  for (const s of summaries) {
    console.log(`[ask] 任务 ${s.taskBatch} → ask#${s.askId}「${s.keyword}」 ${s.status}`);
    if (s.status === "done") {
      const row = getAskResultRow(db, s.askId);
      if (row?.result_json) renderResult({ result: JSON.parse(row.result_json) });
    }
  }
  if (summaries.length === 0) console.log("[ask] 没有就绪的 ask-aggregate 任务（先跑 npm run ask -- --keyword=… 生成任务）");
  db.close();
} else if (showId) {
  const row = getAskResultRow(db, Number(showId));
  if (!row) {
    console.error(`[ask] ask_results#${showId} 不存在`);
    db.close();
    process.exit(1);
  }
  if (asJson) {
    console.log(JSON.stringify(row, null, 2));
  } else {
    console.log(`[ask] #${row.id}「${row.keyword}」 ${row.status} · 窗口 ${row.window_start} ~ ${row.window_end}`);
    if (row.result_json) renderResult({ result: JSON.parse(row.result_json) });
    if (row.error) console.log(`error: ${row.error}`);
  }
  db.close();
} else if (keyword) {
  reclaimStaleAskRows(db);
  const result = await runAsk({
    db,
    root,
    keyword,
    skipCrawl: noCrawl,
    onProgress: (p) => console.log(`[ask:${p.phase}] ${p.message}`),
  });
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.status === "done") {
    if (result.intent) {
      console.log(`\n我理解：${result.intent.assumption}`);
      console.log(
        `检索词：身份[${result.intent.expandedKeywords.identity.join("、")}] 叙事[${result.intent.expandedKeywords.narrative.join("、")}]`,
      );
    }
    if (result.recallStats) {
      const s = result.recallStats;
      console.log(
        `召回：并集 ${s.unionCount}（文本 ${s.routeCounts.text} / 仅标签 ${s.routeCounts.stockTagOnly} / 仅事件 ${s.routeCounts.eventOnly}）→ 候选 ${s.candidates}${result.widenedToHours ? `（已扩窗 ${result.widenedToHours}h）` : ""}`,
      );
    }
    renderResult(result);
    console.log(`\n[ask] 完成（ask_results#${result.askId}，重放: npm run ask -- --show=${result.askId}）`);
  } else if (result.status === "empty") {
    console.log(`\n[ask]「${keyword}」24/48/72h 窗口内均无命中（ask_results#${result.askId}）。`);
    const hints = taxonomyHints(keyword);
    if (hints.length > 0) {
      console.log(`相近题材方向（taxonomy 提示）：${hints.join("、")}`);
    }
    console.log("建议：换个说法（全称/简称/概念词），或过段时间再来——新语料随爬取轮次入库。");
  } else if (result.status === "awaiting_handoff") {
    console.log("\n[ask] 已生成 handoff 任务，等待 agent 处理：");
    for (const f of result.handoffTasks ?? []) console.log(`  ${f}`);
    console.log("处理完成后运行: npm run ask -- --consume（回填后续跑并出结果）");
  } else {
    console.error(`[ask] 失败（ask_results#${result.askId}）: ${result.error}`);
    db.close();
    process.exit(1);
  }
  db.close();
} else {
  console.log("用法：npm run ask -- --keyword=<关键词> [--no-crawl] [--json] | --consume | --show=<id>");
  db.close();
}
