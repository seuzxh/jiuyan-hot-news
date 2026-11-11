/**
 * 关键词问股 resource route（无默认导出）：
 * - loader：GET /api/ask?q=<关键词>[&watch=<ask_results.id>] → SSE 流
 *   事件：start{askId} / stage{phase,message} / ping{ts} / pause{phase} / done{resultId,status,snapshot} / error{message}
 *   统一以行轮询驱动（2.5s）：新查询先插行拿到 askId 再后台 runAsk；断线/刷新用 watch=<id> 续传不重跑（§3.3）。
 * - action：POST {askId,type,target} → ask_events 埋点（M3 页面点击上报的落点，基础设施先行）
 */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { findRepoRoot, nowIso } from "@jyc/core";
import {
  getAskResultRow,
  insertAsk,
  normalizeKeyword,
  reclaimStaleAskRows,
  runAsk,
  type AskAggregateOutput,
  type AskIntentOutput,
  type AskResultRow,
} from "@jyc/ask";
import { db } from "../lib/queries";

const root = findRepoRoot();

/** 查询单飞锁：同 keyword_norm 只跑一条链路，后来者转为 watch（模块级 Map，单进程假设见方案 §3.3） */
const inFlight = new Map<string, { askId: number; promise: Promise<unknown> }>();

/** phase → 前端五步文案（理解意图/实时抓取/关联筛选/全文深挖/综合结论，映射见方案 §3.3） */
const PHASE_LABEL: Record<string, string> = {
  intent: "理解查询意图…",
  crawl: "检查语料新鲜度 / 实时爬取…",
  recall: "三路召回（标签 / 文本 / 事件）…",
  aggregate: "关联过滤与汇聚分析（R1）…",
  detail: "深挖高价值帖全文…",
  answer: "综合结论（R2 全文级）…",
};

const POLL_MS = 2500;
const PING_MS = 15_000;

interface RecallSummary {
  unionCount: number;
  candidates: number;
  widenedToHours: number | null;
  routeCounts: { text: number; stockTagOnly: number; eventOnly: number };
}

interface Snapshot {
  askId: number;
  keyword: string;
  status: string;
  kind: string | null;
  window: { start: string; end: string } | null;
  intent: AskIntentOutput | null;
  recall: RecallSummary | null;
  result: AskAggregateOutput | null;
  /** sourceIds → 原帖（id/title/url），供证据链外链 */
  sources: Record<string, { title: string; url: string }>;
  error: string | null;
}

function snapshot(row: AskResultRow): Snapshot {
  const intent = row.intent_json ? (JSON.parse(row.intent_json) as AskIntentOutput) : null;
  const recallRaw = row.recall_json ? (JSON.parse(row.recall_json) as RecallSummary) : null;
  const result = row.result_json ? (JSON.parse(row.result_json) as AskAggregateOutput) : null;

  // 证据链外链：keyPoints/rejected 引用到的 items 一次查齐
  const ids = [
    ...new Set([
      ...(result?.keyPoints.flatMap((k) => k.sourceIds) ?? []),
      ...(result?.rejected.map((r) => r.id) ?? []),
    ]),
  ];
  const sources: Snapshot["sources"] = {};
  if (ids.length > 0) {
    const ph = ids.map(() => "?").join(", ");
    const rows = db()
      .prepare(`SELECT id, title, url FROM items WHERE id IN (${ph})`)
      .all(...ids) as Array<{ id: string; title: string; url: string }>;
    for (const r of rows) sources[r.id] = { title: r.title, url: r.url };
  }

  return {
    askId: row.id,
    keyword: row.keyword,
    status: row.status,
    kind: row.kind,
    window: row.window_end ? { start: row.window_start, end: row.window_end } : null,
    intent,
    recall: recallRaw
      ? {
          unionCount: recallRaw.unionCount,
          candidates: recallRaw.candidates,
          widenedToHours: recallRaw.widenedToHours ?? null,
          routeCounts: recallRaw.routeCounts,
        }
      : null,
    result,
    sources,
    error: row.error,
  };
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const watchId = Number(url.searchParams.get("watch") ?? 0) || 0;

  let askId = watchId;
  if (!askId && q) {
    const norm = normalizeKeyword(q);
    const existing = inFlight.get(norm);
    if (existing) {
      askId = existing.askId; // 单飞：后来者附流同一条链路
    } else {
      reclaimStaleAskRows(db());
      const id = insertAsk(db(), q);
      const promise = runAsk({ db: db(), root, keyword: q, askId: id }).catch((e) => {
        console.error(`[api/ask] ask#${id}「${q}」失败:`, e);
      });
      inFlight.set(norm, { askId: id, promise });
      void promise.finally(() => inFlight.delete(norm));
      askId = id;
    }
  }
  if (!askId) {
    return Response.json({ message: "缺少 q 或 watch 参数" }, { status: 400 });
  }
  return sseResponse(askId, request.signal);
}

function sseResponse(askId: number, signal: AbortSignal): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let lastPhase = "";
      let lastStatus = "";
      const timers: Array<ReturnType<typeof setInterval>> = [];

      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      const close = () => {
        if (closed) return;
        closed = true;
        for (const t of timers) clearInterval(t);
        signal.removeEventListener("abort", close);
        try {
          controller.close();
        } catch {
          // 客户端已断开
        }
      };
      signal.addEventListener("abort", close);

      send("start", { askId });

      const poll = () => {
        const row = getAskResultRow(db(), askId);
        if (!row) {
          send("error", { message: `ask#${askId} 不存在（可能已被清理）` });
          close();
          return;
        }
        if (row.phase !== lastPhase) {
          lastPhase = row.phase;
          send("stage", { phase: row.phase, message: PHASE_LABEL[row.phase] ?? row.phase });
        }
        if (row.status !== lastStatus) {
          lastStatus = row.status;
          if (row.status === "awaiting_handoff") {
            // 不关流：agent `npm run ask -- --consume` 回填后行状态翻动，事件自动续传
            send("pause", {
              phase: row.phase,
              message: "已生成分析任务（agent-handoff 模式）：回填 `npm run ask -- --consume` 后本页自动续跑",
            });
          } else if (row.status === "done" || row.status === "empty") {
            send("done", { resultId: askId, status: row.status, snapshot: snapshot(row) });
            close();
          } else if (row.status === "failed") {
            send("error", { message: row.error ?? "失败（详见 ask_results.error）", resultId: askId });
            close();
          }
        }
      };

      timers.push(setInterval(poll, POLL_MS));
      timers.push(setInterval(() => send("ping", { ts: nowIso() }), PING_MS));
      poll(); // 立即首拍，不等第一个间隔
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

/** 埋点：POST /api/ask {askId, type: view|source_click|chip_click, target} */
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") return Response.json({ message: "POST only" }, { status: 405 });
  let body: { askId?: unknown; type?: unknown; target?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ message: "非法 JSON" }, { status: 400 });
  }
  const askId = Number(body.askId);
  const type = String(body.type ?? "");
  if (!Number.isInteger(askId) || askId <= 0 || !["view", "source_click", "chip_click"].includes(type)) {
    return Response.json({ message: "askId/type 非法" }, { status: 400 });
  }
  db()
    .prepare("INSERT INTO ask_events (ask_id, type, target, ts) VALUES (?, ?, ?, ?)")
    .run(askId, type, typeof body.target === "string" ? body.target : null, nowIso());
  return Response.json({ ok: true });
}
