import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Form, Link, useLoaderData, useSearchParams } from "react-router";
import { availableDates, conceptsOnDate, eventsByIds, eventsOnDate, latestEvents } from "../lib/queries";
import { groupConcepts } from "../lib/grouping";
import { EventCard, dateLabel } from "../components/EventCard";
import { ConceptCard } from "../components/ConceptCard";
import { DatePills } from "../components/DatePills";
import { groupByCategory } from "@jyc/core";

export const meta: MetaFunction = () => [{ title: "韭研热点 · 每日逻辑线" }];

export async function loader({ request }: LoaderFunctionArgs) {
  const all = latestEvents(300);
  const dates = availableDates(all);
  const q = new URL(request.url).searchParams.get("date");
  const date = q && dates.some((d) => d.date === q) ? q : (dates[0]?.date ?? "");
  const events = date ? eventsOnDate(all, date) : [];
  // 概念逻辑卡：有则以概念为主视图（帖子退为素材）；没有（历史日期未回填）则回退到帖子视图
  const concepts = date ? conceptsOnDate(date) : [];
  // 逻辑线取的是滚动 24 小时窗口，来源帖可能发布在前一个日期：素材列表以逻辑线覆盖的帖子为准
  const covered = new Map(events.map((e) => [e.id, e]));
  for (const e of eventsByIds(concepts.flatMap((c) => c.eventIds))) covered.set(e.id, e);
  const materials = [...covered.values()].sort((a, b) => b.heat - a.heat);
  return { dates, date, events, materials, concepts, groups: groupByCategory(events) };
}

export default function Home() {
  const { dates, date, events, materials, concepts, groups } = useLoaderData<typeof loader>();
  const [, setSearchParams] = useSearchParams();
  const stockCount = new Set(concepts.flatMap((c) => c.stocks.map((s) => s.name))).size;
  const totalPosts = events.reduce((n, e) => n + e.member_count, 0);

  return (
    <div className="space-y-5">
      {/* 日期切换条 */}
      <DatePills dates={dates} value={date} onChange={(d) => setSearchParams(d === dates[0]?.date ? {} : { date: d })} />

      {/* 当日概览 */}
      {date && (
        <div className="relative overflow-hidden rounded-xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-rose-500 to-orange-400" />
          <div className="pl-2 text-xs text-zinc-500">
            <span className="font-semibold text-zinc-800 dark:text-zinc-100">{dateLabel(date)}</span>
            <span className="mx-1.5 text-zinc-300 dark:text-zinc-600">|</span>
            <span className="font-medium text-zinc-700 dark:text-zinc-300">{date}</span>
            {concepts.length > 0 ? (
              <>
                <span className="mx-2 text-zinc-300 dark:text-zinc-600">·</span>
                <span className="font-semibold text-zinc-800 dark:text-zinc-100">{concepts.length}</span> 条逻辑线
                <span className="mx-2 text-zinc-300 dark:text-zinc-600">·</span>
                <span className="font-semibold text-zinc-800 dark:text-zinc-100">{stockCount}</span> 个核心标的
              </>
            ) : (
              <>
                <span className="mx-2 text-zinc-300 dark:text-zinc-600">·</span>
                {events.length} 个事件
              </>
            )}
            {concepts.length > 0 ? (
              <>
                <span className="mx-2 text-zinc-300 dark:text-zinc-600">·</span>
                <span className="font-semibold text-zinc-800 dark:text-zinc-100">{materials.length}</span> 个帖子（近 24 小时）
              </>
            ) : (
              <>
                <span className="mx-2 text-zinc-300 dark:text-zinc-600">·</span>
                {events.length} 个帖子 · {totalPosts} 条讨论
              </>
            )}
            <span className="mx-2 text-zinc-300 dark:text-zinc-600">·</span>梳理自韭研公社
          </div>
        </div>
      )}

      {concepts.length > 0 ? (
        /* 概念逻辑卡：按分类分区，三列网格 */
        groupConcepts(concepts).map((g) => (
          <section key={g.id}>
            <div className="mb-2.5 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-zinc-100 text-sm dark:bg-zinc-800">{g.emoji}</span>
              <h2 className="text-sm font-bold">{g.label}</h2>
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                {g.concepts.length} 条逻辑线
              </span>
              <span className="h-px flex-1 bg-zinc-100 dark:bg-zinc-800" />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {g.concepts.map((c) => (
                <ConceptCard key={c.id} concept={c} />
              ))}
            </div>
          </section>
        ))
      ) : (
        /* 历史日期未生成逻辑卡时的回退：帖子视图 */
        <>
          <p className="rounded-lg bg-zinc-100 px-3 py-2 text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
            这一天还没有做概念梳理，先按帖子展示。
          </p>
          {groups.map(({ category, events: evts }) => (
            <section key={category.id}>
              <div className="mb-2.5 flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-zinc-100 text-sm dark:bg-zinc-800">{category.emoji}</span>
                <h2 className="text-sm font-bold">{category.label}</h2>
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                  {evts.length} 个帖子
                </span>
                <span className="h-px flex-1 bg-zinc-100 dark:bg-zinc-800" />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {evts.map((e) => (
                  <EventCard key={e.id} event={e} />
                ))}
              </div>
            </section>
          ))}
        </>
      )}

      {/* 概念卡之外的帖子素材：默认折叠，供核对与检索 */}
      {concepts.length > 0 && materials.length > 0 && (
        <details className="rounded-xl border border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <summary className="cursor-pointer select-none text-sm font-semibold text-zinc-600 dark:text-zinc-300">
            原帖素材（{materials.length} 个帖子）
          </summary>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {materials.map((e) => (
              <EventCard key={e.id} event={e} />
            ))}
          </div>
        </details>
      )}

      {events.length === 0 && (
        <div className="py-24 text-center">
          <p className="text-sm text-zinc-400">该日暂无数据</p>
          <Form method="get" action="/search" className="mt-4">
            <input
              name="q"
              placeholder="或试试搜索…"
              className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
            />
          </Form>
        </div>
      )}
    </div>
  );
}
