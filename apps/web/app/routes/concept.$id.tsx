import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Link, useLoaderData } from "react-router";
import { getConcept } from "../lib/queries";
import { bjTime, dateLabel } from "../components/EventCard";

/** 兜底概念名（与 @jyc/core 的 CONCEPT_OTHER_TITLE 一致；不导入 core——服务端模块含 node:sqlite） */
const OTHER_TITLE = "其他动态";

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: `${data?.concept.title ?? "逻辑线"} · 韭研热点` },
  { name: "description", content: data?.concept.takeaway ?? "" },
];

export async function loader({ params }: LoaderFunctionArgs) {
  const concept = getConcept(params.id ?? "");
  if (!concept) throw new Response("逻辑线不存在", { status: 404 });
  // 来源帖提到、但没进标的清单的名字单独列在清单下方：清单按环节挑选，这里兜住"所有相关"不漏
  const listed = new Set(concept.stocks.map((s) => s.name));
  const mentioned = [...new Set(concept.sources.flatMap((s) => s.stocks.map((n) => n.trim()).filter(Boolean)))].filter((n) => !listed.has(n));
  return { concept, mentioned };
}

function SectionHead({ title, count }: { title: string; count?: number }) {
  return (
    <div className="mb-2.5 flex items-center gap-2">
      <h2 className="text-sm font-bold">{title}</h2>
      {count !== undefined && (
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">{count}</span>
      )}
      <span className="h-px flex-1 bg-zinc-100 dark:bg-zinc-800" />
    </div>
  );
}

const CARD = "rounded-xl border border-zinc-200/80 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900";

export default function ConceptDetail() {
  const { concept: c, mentioned } = useLoaderData<typeof loader>();
  const isOther = c.title === OTHER_TITLE;
  const stocks = c.stocks.filter((s) => s.name.trim() !== "");
  const upcoming = c.catalysts.filter((x) => x.upcoming).length;
  const hasAdded = stocks.some((s) => s.added);
  const sourceById = new Map(c.sources.map((s) => [s.id, s]));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link
        to={dateLabel(c.dateKey) === "今天" ? "/" : `/?date=${c.dateKey}`}
        className="inline-block text-xs text-zinc-400 transition-colors hover:text-zinc-700 dark:text-zinc-500 dark:hover:text-zinc-200"
      >
        ← 返回{dateLabel(c.dateKey)}的逻辑线
      </Link>

      {/* 结论 */}
      <header className={`${CARD} relative overflow-hidden p-5`}>
        <div className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-rose-500 to-orange-400" />
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
          <span>
            {c.emoji} {c.categoryLabel}
          </span>
          <span className="text-zinc-300 dark:text-zinc-600">|</span>
          <span>
            {dateLabel(c.dateKey)} {c.dateKey}
          </span>
          <span className="text-zinc-300 dark:text-zinc-600">|</span>
          <span>{c.sources.length} 帖</span>
          <span className="text-zinc-300 dark:text-zinc-600">|</span>
          <span>当日第 {c.rank} 条</span>
        </div>
        <h1 className="mt-2 text-xl font-bold leading-snug">{c.title}</h1>
        {!isOther && <p className="mt-2.5 text-[15px] font-medium leading-relaxed text-zinc-800 dark:text-zinc-100">{c.takeaway}</p>}
      </header>

      {/* 催化信息：逐条事实，带时间、影响与出处；不是原文 */}
      {!isOther && (
        <section>
          <SectionHead title="催化信息" count={c.catalysts.length} />
          {c.catalysts.length === 0 ? (
            <p className="rounded-lg border border-dashed border-zinc-200 px-3.5 py-3 text-xs leading-relaxed text-zinc-400 dark:border-zinc-700 dark:text-zinc-500">
              这条逻辑线整理于催化明细功能上线前，还没有逐条催化。可以先看下方的因果链和来源帖摘要。
            </p>
          ) : (
            <ol className={`${CARD} divide-y divide-zinc-100 dark:divide-zinc-800`}>
              {c.catalysts.map((x) => {
                const source = x.eventId ? sourceById.get(x.eventId) : undefined;
                return (
                  <li key={`${x.when}-${x.fact}`} className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 px-4 py-3">
                    <div className="pt-0.5 font-mono text-[11px] leading-5 text-zinc-500 dark:text-zinc-400">{x.when || "—"}</div>
                    <div className="min-w-0">
                      <p className="text-[13px] leading-relaxed text-zinc-800 dark:text-zinc-100">
                        {x.upcoming && (
                          <span className="mr-1.5 rounded bg-violet-50 px-1.5 py-0.5 align-[1px] text-[10px] font-medium text-violet-600 dark:bg-violet-950 dark:text-violet-300">
                            预期
                          </span>
                        )}
                        {x.fact}
                      </p>
                      {x.impact && <p className="mt-0.5 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">→ {x.impact}</p>}
                      {source && (
                        <p className="mt-1 text-[11px] leading-relaxed text-zinc-400 dark:text-zinc-500">
                          出处：
                          <Link to={`/story/${source.id}`} className="hover:text-sky-700 hover:underline dark:hover:text-sky-300">
                            {source.title}
                          </Link>
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
          {upcoming > 0 && (
            <p className="mt-1.5 text-[11px] text-zinc-400 dark:text-zinc-500">
              其中 {upcoming} 条是尚未落地的预期时点（标「预期」），按时间排在已发生的事实之后。
            </p>
          )}
        </section>
      )}

      {/* 相关概念股：链条上帖子点名的个股尽量列全 */}
      {(stocks.length > 0 || mentioned.length > 0) && (
        <section>
          <SectionHead title="相关概念股" count={stocks.length || undefined} />
          {stocks.length > 0 && (
            <div className={`${CARD} overflow-x-auto`}>
              <table className="w-full min-w-[520px] text-left text-[13px]">
                <thead className="text-[11px] font-medium tracking-wide text-zinc-400 dark:text-zinc-500">
                  <tr>
                    <th className="px-4 py-2.5">个股</th>
                    <th className="px-3 py-2.5">环节 / 角色</th>
                    <th className="px-4 py-2.5">入选依据</th>
                  </tr>
                </thead>
                <tbody>
                  {stocks.map((s) => (
                    <tr key={s.name} className="border-t border-zinc-100 dark:border-zinc-800">
                      <td className="whitespace-nowrap px-4 py-2.5 align-top font-semibold text-sky-700 dark:text-sky-300">
                        {s.name}
                        {s.added && (
                          <span className="ml-1.5 rounded bg-zinc-100 px-1 py-0.5 text-[10px] font-normal text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                            补充
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 align-top leading-relaxed text-zinc-700 dark:text-zinc-300">{s.role || "—"}</td>
                      <td className={`px-4 py-2.5 align-top text-xs leading-relaxed ${s.basis ? "text-zinc-500 dark:text-zinc-400" : "text-zinc-300 dark:text-zinc-600"}`}>
                        {s.basis || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {stocks.length > 0 && hasAdded && (
            <p className="mt-1.5 text-[11px] text-zinc-400 dark:text-zinc-500">按逻辑相关度排序；带「补充」的是帖子里没有点名、按环节补上的公认龙头。</p>
          )}
          {mentioned.length > 0 && (
            <p className="mt-2.5 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
              <span className="text-zinc-400 dark:text-zinc-500">来源帖还提及：</span>
              {mentioned.map((n) => (
                <span key={n} className="mb-1 mr-1.5 inline-block rounded border border-zinc-200 px-1.5 py-0.5 text-[11px] leading-4 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
                  {n}
                </span>
              ))}
            </p>
          )}
        </section>
      )}

      {/* 因果链与风险 */}
      {!isOther && (
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className={`${CARD} p-4`}>
            <h2 className="text-sm font-bold">逻辑链</h2>
            <p className="mt-0.5 text-[11px] text-zinc-400 dark:text-zinc-500">催化如何一步步传导到受益环节</p>
            <ol className="mt-3 space-y-1.5 border-l-2 border-zinc-200 pl-3 dark:border-zinc-700">
              {c.chain.map((step, i) => (
                <li key={i} className="flex gap-2 text-[13px] leading-relaxed text-zinc-700 dark:text-zinc-200">
                  <span className="w-3 shrink-0 font-mono text-[10px] leading-[1.25rem] text-zinc-400 dark:text-zinc-500">{i + 1}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>
          <div className={`${CARD} p-4`}>
            <h2 className="text-sm font-bold">风险与分歧</h2>
            {c.risk ? (
              <p className="mt-2.5 rounded-md bg-amber-50 px-2.5 py-2 text-xs leading-relaxed text-amber-800 dark:bg-amber-950 dark:text-amber-200">{c.risk}</p>
            ) : (
              <p className="mt-2.5 text-xs leading-relaxed text-zinc-400 dark:text-zinc-500">来源帖里没有提到明显的分歧或证伪信息。</p>
            )}
          </div>
        </section>
      )}

      {/* 来源帖：标题可进事件页，右侧可开原帖核对 */}
      <section>
        <SectionHead title="来源帖" count={c.sources.length} />
        <ul className="space-y-2">
          {c.sources.map((s) => (
            <li key={s.id} className={`${CARD} px-4 py-3`}>
              <div className="flex items-start justify-between gap-3">
                <Link
                  to={`/story/${s.id}`}
                  className="min-w-0 text-[13px] font-medium leading-snug hover:text-sky-700 hover:underline dark:hover:text-sky-300"
                >
                  {s.title}
                </Link>
                {s.url && (
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 text-[11px] text-zinc-400 hover:text-sky-700 dark:text-zinc-500 dark:hover:text-sky-300"
                  >
                    原帖 ↗
                  </a>
                )}
              </div>
              <div className="mt-1 font-mono text-[10px] text-zinc-400 dark:text-zinc-600">
                {s.lastItemAt ? bjTime(s.lastItemAt) : ""}
                <span className="mx-1.5">·</span>🔥 {Math.round(s.heat)}
              </div>
              {s.summary && <p className="mt-1.5 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">{s.summary}</p>}
            </li>
          ))}
        </ul>
      </section>

      <p className="pb-4 text-center text-[11px] text-zinc-400 dark:text-zinc-500">
        催化与标的由管线从来源帖正文提炼，事实与推断已分开表述；不构成投资建议。
        {isOther && " 这一条是未归入其他逻辑线的零散信息。"}
      </p>
    </div>
  );
}
