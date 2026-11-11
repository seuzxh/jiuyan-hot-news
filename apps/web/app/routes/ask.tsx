/**
 * 问股页（M2）：关键词 → SSE 五步进度 → 结论卡。
 * 断线/刷新用 watch=<askId> 续传不重跑；handoff 模式 pause 提示，consume 后自动续跑。
 * 意图假设行/修正 chips/A·B 徽标深化与埋点上报为 M3 范围。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import type { MetaFunction } from "react-router";

export const meta: MetaFunction = () => [{ title: "问股 · 韭研热点" }];

/** SSE snapshot（服务端 api.ask.ts 的载荷契约） */
interface SourceRef {
  title: string;
  url: string;
}
interface Snapshot {
  askId: number;
  keyword: string;
  status: string;
  kind: string | null;
  window: { start: string; end: string } | null;
  intent: {
    intent: string;
    assumption: string;
    expandedKeywords: { identity: string[]; narrative: string[] };
    altInterpretations?: Array<{ label: string; hint: string }>;
  } | null;
  recall: { unionCount: number; candidates: number; widenedToHours: number | null; routeCounts: { text: number; stockTagOnly: number; eventOnly: number } } | null;
  result: {
    keyPoints: Array<{ point: string; sourceIds: string[]; mergedFrom?: string; form: "A" | "B"; subjects?: string[]; infoLayers: string[]; infoIncomplete?: boolean }>;
    relatedStocks: Array<{ name: string; reason: string }>;
    timeline: Array<{ time: string; text: string }>;
    conclusion: string;
    gaps: string[];
    rejected: Array<{ id: string; reason: string }>;
  } | null;
  sources: Record<string, SourceRef>;
  error: string | null;
}

type Phase = "intent" | "crawl" | "recall" | "aggregate" | "detail" | "answer";

/** 五步进度（方案 §3.3 映射：recall+aggregate → 关联筛选） */
const STEPS: Array<{ label: string; phases: Phase[] }> = [
  { label: "理解意图", phases: ["intent"] },
  { label: "实时抓取", phases: ["crawl"] },
  { label: "关联筛选", phases: ["recall", "aggregate"] },
  { label: "全文深挖", phases: ["detail"] },
  { label: "综合结论", phases: ["answer"] },
];
const PHASE_TO_STEP = (p: Phase): number => STEPS.findIndex((s) => s.phases.includes(p));

type RunState =
  | { kind: "idle" }
  | { kind: "running"; askId: number | null; phase: Phase; paused: boolean; message: string; reconnectIn?: number }
  | { kind: "done"; snapshot: Snapshot }
  | { kind: "empty"; snapshot: Snapshot }
  | { kind: "error"; message: string; askId: number | null };

export default function Ask() {
  const [params, setParams] = useSearchParams();
  const [keyword, setKeyword] = useState(params.get("q") ?? "");
  const [state, setState] = useState<RunState>({ kind: "idle" });
  const esRef = useRef<EventSource | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** 统一入口：新查询 / watch 续传共用（拿到 askId 后一律走 watch，断线重连不会重复开查询） */
  const connect = useCallback((opts: { q?: string; watch?: number }) => {
    esRef.current?.close();
    const url = opts.watch ? `/api/ask?watch=${opts.watch}` : `/api/ask?q=${encodeURIComponent(opts.q ?? "")}`;
    const es = new EventSource(url);
    esRef.current = es;

    es.addEventListener("start", (e) => {
      const { askId } = JSON.parse((e as MessageEvent).data) as { askId: number };
      setState((s) => (s.kind === "running" ? { ...s, askId } : s));
    });
    es.addEventListener("stage", (e) => {
      const { phase, message } = JSON.parse((e as MessageEvent).data) as { phase: Phase; message: string };
      setState({ kind: "running", askId: null, phase, paused: false, message });
    });
    es.addEventListener("pause", (e) => {
      const { message } = JSON.parse((e as MessageEvent).data) as { message: string };
      setState((s) => (s.kind === "running" ? { ...s, paused: true, message } : s));
    });
    es.addEventListener("done", (e) => {
      const { resultId, status, snapshot } = JSON.parse((e as MessageEvent).data) as {
        resultId: number;
        status: string;
        snapshot: Snapshot;
      };
      es.close();
      setState(status === "empty" ? { kind: "empty", snapshot } : { kind: "done", snapshot });
    });
    es.addEventListener("error", (e) => {
      // 终态 error 事件（带 message）vs 浏览器连接层错误（MessageEvent 无 data）
      const data = (e as MessageEvent).data;
      if (typeof data === "string") {
        const { message } = JSON.parse(data) as { message: string };
        es.close();
        setState((s) => ({ kind: "error", message, askId: s.kind === "running" ? s.askId : null }));
        return;
      }
      // 连接断开：有 askId 则 30s 退避后 watch 续传（方案 §3.3）
      es.close();
      setState((s) => {
        if (s.kind !== "running") return s;
        const askId = s.askId;
        if (askId) {
          scheduleReconnect(askId, 30);
          return { ...s, message: "连接断开，30 秒后自动重连续传…", reconnectIn: 30 };
        }
        return { kind: "error", message: "连接中断，请重试", askId: null };
      });
    });
  }, []);

  const scheduleReconnect = (askId: number, seconds: number) => {
    if (retryRef.current) clearTimeout(retryRef.current);
    retryRef.current = setTimeout(() => connect({ watch: askId }), seconds * 1000);
  };

  const start = (kw: string) => {
    if (!kw.trim()) return;
    if (retryRef.current) clearTimeout(retryRef.current);
    setParams({ q: kw }, { replace: true });
    setState({ kind: "running", askId: null, phase: "intent", paused: false, message: "建立连接…" });
    connect({ q: kw });
  };

  // 拿到 askId 后写进 URL，刷新后据此 watch 续传
  useEffect(() => {
    if (state.kind === "running" && state.askId) {
      setParams({ q: keyword, id: String(state.askId) }, { replace: true });
    }
  }, [state, keyword, setParams]);

  // 刷新/直链恢复：URL 带 id 且无终态 → watch
  useEffect(() => {
    const id = Number(params.get("id") ?? 0);
    if (id && state.kind === "idle") {
      setState({ kind: "running", askId: id, phase: "intent", paused: false, message: "续传查询进度…" });
      connect({ watch: id });
    }
    return () => {
      esRef.current?.close();
      if (retryRef.current) clearTimeout(retryRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          start(keyword);
        }}
        className="flex gap-2"
      >
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="输入个股 / 概念题材，如「福莱新材」「光模块」「固态电池」…"
          className="flex-1 rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900"
          autoFocus
        />
        <button
          disabled={state.kind === "running" && !state.paused}
          className="rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {state.kind === "running" && !state.paused ? "分析中…" : "问一下"}
        </button>
      </form>

      {state.kind === "idle" && (
        <p className="py-10 text-center text-sm text-zinc-400">
          24 小时滚动窗口实时检索韭研公社（约 300-500 帖/日），全链路约 1-3 分钟出结论
        </p>
      )}

      {state.kind === "running" && <Progress state={state} />}

      {state.kind === "empty" && <EmptyCard snapshot={state.snapshot} />}

      {state.kind === "error" && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
          <p className="font-medium">查询失败</p>
          <p className="mt-1 break-all">{state.message}</p>
          {state.askId && (
            <p className="mt-1 text-xs text-red-500">
              进度已存档（ask#{state.askId}），<Link className="underline" to={`/ask?q=${encodeURIComponent(keyword)}&id=${state.askId}`}>点击重连续传</Link>
            </p>
          )}
        </div>
      )}

      {state.kind === "done" && state.snapshot.result && (
        <ResultCard snapshot={state.snapshot} />
      )}
    </div>
  );
}

function Progress({ state }: { state: Extract<RunState, { kind: "running" }> }) {
  const current = PHASE_TO_STEP(state.phase);
  return (
    <div className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center gap-1.5">
        {STEPS.map((s, i) => {
          const done = current > i;
          const active = current === i;
          return (
            <div key={s.label} className="flex flex-1 items-center gap-1.5">
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
                  done
                    ? "bg-emerald-500 text-white"
                    : active
                      ? "animate-pulse bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                      : "bg-zinc-100 text-zinc-400 dark:bg-zinc-800"
                }`}
              >
                {done ? "✓" : i + 1}
              </span>
              <span className={`hidden text-xs sm:inline ${active ? "font-medium" : "text-zinc-400"}`}>{s.label}</span>
              {i < STEPS.length - 1 && <span className={`h-px flex-1 ${done ? "bg-emerald-400" : "bg-zinc-200 dark:bg-zinc-700"}`} />}
            </div>
          );
        })}
      </div>
      <p className={`text-xs ${state.paused ? "text-amber-600 dark:text-amber-400" : "text-zinc-400"}`}>
        {state.paused ? "⏸ " : ""}
        {state.message}
      </p>
      {state.paused && (
        <p className="rounded-lg bg-amber-50 p-2.5 text-xs leading-5 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
          agent-handoff 模式：分析任务已落盘，等 agent 执行 <code className="rounded bg-amber-100 px-1 dark:bg-amber-900/60">npm run ask -- --consume</code> 回填后，本页自动续跑出结论，无需刷新。
        </p>
      )}
    </div>
  );
}

function EmptyCard({ snapshot }: { snapshot: Snapshot }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6 text-sm dark:border-zinc-800 dark:bg-zinc-900">
      <p className="font-medium">「{snapshot.keyword}」24/48/72 小时窗口内均无命中</p>
      <p className="mt-2 text-zinc-500">
        建议：换全称/简称/概念词再试；新语料随爬取轮次入库，过段时间再来。窗口内语料共约数百帖，冷门词天然可能为零。
      </p>
    </div>
  );
}

function ResultCard({ snapshot }: { snapshot: Snapshot }) {
  const { result, intent, recall, sources } = snapshot;
  if (!result) return null;
  return (
    <div className="space-y-3">
      {intent && (
        <p className="rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-xs leading-5 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          🧭 我理解：{intent.assumption}
          <br />
          <span className="text-zinc-400">
            检索词——身份：{intent.expandedKeywords.identity.join("、") || "无"}
            {intent.expandedKeywords.narrative.length > 0 && `；叙事：${intent.expandedKeywords.narrative.join("、")}`}
          </span>
        </p>
      )}

      <div className="grid gap-3 lg:grid-cols-3">
        {/* 左列：结论 */}
        <div className="space-y-3">
          <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="mb-2 flex items-center gap-2 text-xs font-medium text-zinc-400">
              <span>⚡ 24h 结论</span>
              {snapshot.kind && <span className="rounded bg-zinc-100 px-1.5 py-0.5 dark:bg-zinc-800">{snapshot.kind}</span>}
              {recall && (
                <span className="ml-auto">
                  {recall.unionCount} 帖 → {recall.candidates} 候选{recall.widenedToHours ? `（扩窗 ${recall.widenedToHours}h）` : ""}
                </span>
              )}
            </p>
            <p className="text-sm font-medium leading-6">{result.conclusion}</p>
            {result.gaps.length > 0 && (
              <details className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
                <summary className="cursor-pointer select-none">缺口与待验证（{result.gaps.length}）</summary>
                <ul className="mt-1.5 list-disc space-y-1 pl-4">
                  {result.gaps.map((g, i) => (
                    <li key={i}>{g}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>

          {result.relatedStocks.length > 0 && (
            <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <p className="mb-2 text-xs font-medium text-zinc-400">🎯 关联标的</p>
              <div className="flex flex-wrap gap-1.5">
                {result.relatedStocks.map((s) => (
                  <span key={s.name} title={s.reason} className="rounded-lg bg-zinc-100 px-2 py-1 text-xs dark:bg-zinc-800">
                    {s.name}
                    <span className="ml-1 text-zinc-400">{s.reason.slice(0, 12)}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 中列：逻辑要点（证据链） */}
        <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="mb-2 text-xs font-medium text-zinc-400">🧩 逻辑要点（{result.keyPoints.length}）</p>
          <div className="space-y-3">
            {result.keyPoints.map((k, i) => (
              <div key={i} className="border-b border-zinc-100 pb-2.5 last:border-0 last:pb-0 dark:border-zinc-800/60">
                <p className="text-sm leading-6">{k.point}</p>
                <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-zinc-400">
                  <span className={`rounded px-1.5 py-0.5 ${k.form === "B" ? "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300" : "bg-zinc-100 dark:bg-zinc-800"}`}>
                    {k.form === "B" ? `映射·主推${(k.subjects ?? []).join("/") || "?"}` : "直接"}
                  </span>
                  <span>{k.infoLayers.join("/")}</span>
                  {k.infoIncomplete && <span className="text-amber-600 dark:text-amber-400">⚠截断</span>}
                </p>
                {k.mergedFrom && <p className="mt-0.5 text-xs text-zinc-400">同源合并：{k.mergedFrom}</p>}
                <p className="mt-1 flex flex-wrap gap-1.5">
                  {k.sourceIds.map((sid) => {
                    const src = sources[sid];
                    return src ? (
                      <a
                        key={sid}
                        href={src.url}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded border border-zinc-200 px-1.5 py-0.5 text-xs text-zinc-500 hover:border-zinc-400 hover:text-zinc-900 dark:border-zinc-700 dark:hover:text-zinc-100"
                      >
                        原帖：{src.title.slice(0, 14)}…
                      </a>
                    ) : (
                      <span key={sid} className="text-xs text-zinc-300">{sid}</span>
                    );
                  })}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* 右列：时间线 */}
        <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="mb-2 text-xs font-medium text-zinc-400">🕒 时间线（北京时间）</p>
          {result.timeline.length === 0 ? (
            <p className="text-xs text-zinc-400">窗口内无明确事件进展节点</p>
          ) : (
            <ol className="space-y-2.5">
              {result.timeline.map((t, i) => (
                <li key={i} className="border-l-2 border-zinc-200 pl-3 dark:border-zinc-700">
                  <p className="text-xs font-medium text-zinc-400">{t.time}</p>
                  <p className="mt-0.5 text-sm leading-5">{t.text}</p>
                </li>
              ))}
            </ol>
          )}
          {result.rejected.length > 0 && (
            <p className="mt-3 text-xs text-zinc-400">已过滤 {result.rejected.length} 条蹭热度候选（拒因留档）</p>
          )}
        </div>
      </div>
    </div>
  );
}
