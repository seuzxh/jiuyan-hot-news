import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Form, Link, useLoaderData, useSearchParams } from "react-router";
import { availableDates, eventsOnDate, latestEvents } from "../lib/queries";
import { EventCard, dateLabel } from "../components/EventCard";
import { groupByCategory } from "@jyc/core";

export const meta: MetaFunction = () => [{ title: "韭研热点 · 每日汇总" }];

export async function loader({ request }: LoaderFunctionArgs) {
  const all = latestEvents(300);
  const dates = availableDates(all);
  const q = new URL(request.url).searchParams.get("date");
  const date = q && dates.some((d) => d.date === q) ? q : (dates[0]?.date ?? "");
  const events = date ? eventsOnDate(all, date) : [];
  return { dates, date, events, groups: groupByCategory(events) };
}

export default function Home() {
  const { dates, date, events, groups } = useLoaderData<typeof loader>();
  const [, setSearchParams] = useSearchParams();
  const totalPosts = events.reduce((n, e) => n + e.member_count, 0);
  const topTags = [...new Set(events.flatMap((e) => e.tags))].slice(0, 6);

  return (
    <div className="space-y-5">
      {/* 日期切换条 */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        {dates.slice(0, 14).map((d) => (
          <button
            key={d.date}
            onClick={() => setSearchParams(d.date === dates[0]?.date ? {} : { date: d.date })}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              d.date === date
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400"
            }`}
          >
            {dateLabel(d.date)}
            <span className="ml-1 opacity-70">{d.count}</span>
          </button>
        ))}
      </div>

      {/* 当日概览 */}
      {date && (
        <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
          <span className="font-semibold text-zinc-700 dark:text-zinc-200">{dateLabel(date)}（{date}）</span>
          <span className="mx-2">·</span>{events.length} 个事件 · {totalPosts} 条帖子 · 汇总自韭研公社，按题材分类整理
          {topTags.length > 0 && (
            <span className="mt-1 block text-zinc-400">
              今日关键词：{topTags.map((t) => (
                <Link key={t} to={`/search?q=${encodeURIComponent(t)}`} className="mr-1.5 text-sky-600 hover:underline dark:text-sky-400">
                  #{t}
                </Link>
              ))}
            </span>
          )}
        </div>
      )}

      {/* 分类分区 + 三列卡片网格 */}
      {groups.map(({ category, events }) => (
        <section key={category.id}>
          <div className="mb-2 flex items-baseline gap-2">
            <h2 className="text-sm font-bold">
              <span className="mr-1">{category.emoji}</span>
              {category.label}
            </h2>
            <span className="text-xs text-zinc-400">{events.length} 个事件</span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {events.map((e) => (
              <EventCard key={e.id} event={e} />
            ))}
          </div>
        </section>
      ))}

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
