import { Link } from "react-router";
import type { ConceptView } from "../lib/queries";
import { bjTime } from "./EventCard";

/** 兜底概念名（与 @jyc/core 的 CONCEPT_OTHER_TITLE 一致；这里不导入 core——它是服务端模块，含 node:sqlite） */
const OTHER_TITLE = "其他动态";
/** 卡片上最多露出的标的数，其余进详情页（卡片保持三列网格的密度） */
const CARD_STOCKS = 6;

/** 详情页地址（id 含冒号，放进 URL 路径前编码） */
export function conceptPath(id: string): string {
  return `/concept/${encodeURIComponent(id)}`;
}

/**
 * 概念逻辑卡：结论 + 因果链 + 核心标的 + 风险，来源帖折叠在底部。
 * 卡片单位是"一条逻辑线"而不是一个帖子——帖子只是它的素材。
 * 卡片只放摘要层，逐条催化与全部标的在详情页。
 */
export function ConceptCard({ concept }: { concept: ConceptView }) {
  // 兜底概念没有因果链（环节位置上放的是帖子标题），只列来源
  const isOther = concept.title === OTHER_TITLE;
  const stocks = concept.stocks.filter((s) => s.name.trim() !== "");
  const shown = stocks.slice(0, CARD_STOCKS);
  const rest = stocks.length - shown.length;

  return (
    <article className="group flex flex-col rounded-xl border border-zinc-200/80 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-zinc-300 hover:shadow-lg dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-[15px] font-bold leading-snug">
          <Link to={conceptPath(concept.id)} className="transition-colors hover:text-sky-700 dark:hover:text-sky-300">
            {concept.title}
          </Link>
        </h2>
        <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
          {concept.sources.length} 帖
        </span>
      </div>

      <p className="mt-1.5 text-[13px] font-medium leading-relaxed text-zinc-800 dark:text-zinc-100">{concept.takeaway}</p>

      {!isOther && (
        <ol className="mt-2.5 space-y-1 border-l-2 border-zinc-200 pl-2.5 dark:border-zinc-700">
          {concept.chain.map((step, i) => (
            <li key={i} className="flex gap-1.5 text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
              <span className="w-3 shrink-0 font-mono text-[10px] leading-[1.1rem] text-zinc-400 dark:text-zinc-500">{i + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      )}

      {shown.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1">
          {shown.map((s) => (
            <span
              key={s.name}
              className="rounded-md border border-sky-100 bg-sky-50 px-1.5 py-0.5 text-[11px] leading-4 dark:border-sky-900 dark:bg-sky-950"
            >
              <span className="font-semibold text-sky-700 dark:text-sky-300">{s.name}</span>
              {s.role && <span className="ml-1 text-zinc-500 dark:text-zinc-400">{s.role}</span>}
            </span>
          ))}
          {rest > 0 && (
            <span className="rounded-md border border-dashed border-zinc-200 px-1.5 py-0.5 text-[11px] leading-4 text-zinc-400 dark:border-zinc-700">
              +{rest}
            </span>
          )}
        </div>
      )}

      {concept.risk && (
        <p className="mt-2 rounded-md bg-amber-50 px-2 py-1 text-[11px] leading-relaxed text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          ⚠ {concept.risk}
        </p>
      )}

      <div className="mt-auto flex items-start justify-between gap-3 pt-2.5">
        <details className="min-w-0">
          <summary className="cursor-pointer select-none text-[11px] text-zinc-400 transition-colors hover:text-zinc-700 dark:text-zinc-500 dark:hover:text-zinc-200">
            来源 {concept.sources.length} 帖
          </summary>
          <ul className="mt-1.5 space-y-1 border-t border-dashed border-zinc-200 pt-1.5 dark:border-zinc-800">
            {concept.sources.map((s) => (
              <li key={s.id} className="flex items-baseline gap-1.5 text-[11px] leading-relaxed">
                <Link
                  to={`/story/${s.id}`}
                  className="truncate text-zinc-600 hover:text-sky-700 hover:underline dark:text-zinc-300 dark:hover:text-sky-300"
                >
                  {s.title}
                </Link>
                <span className="shrink-0 font-mono text-[10px] text-zinc-400 dark:text-zinc-600">{s.lastItemAt ? bjTime(s.lastItemAt) : ""}</span>
              </li>
            ))}
          </ul>
        </details>
        <Link
          to={conceptPath(concept.id)}
          className="shrink-0 text-[11px] font-medium text-zinc-400 transition-colors hover:text-sky-700 dark:text-zinc-500 dark:hover:text-sky-300"
        >
          {!isOther && concept.catalysts.length > 0 ? `催化 ${concept.catalysts.length} 条 · ` : ""}
          {stocks.length > 0 ? `标的 ${stocks.length} 个 · ` : ""}详情 →
        </Link>
      </div>
    </article>
  );
}
