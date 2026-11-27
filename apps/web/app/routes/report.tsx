import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Link, useLoaderData, useSearchParams } from "react-router";
import { availableDates, dailyReport, latestEvents, pushHistory, type ReportRow } from "../lib/queries";
import { DatePills } from "../components/DatePills";
import { bjTime, dateLabel } from "../components/EventCard";

export const meta: MetaFunction = () => [{ title: "日报 · 韭研热点" }];

const SLOT_LABEL: Record<string, string> = { morning: "早报", noon: "午报", evening: "晚报" };

/** 北京日期对应的星期（1970-01-01 是周四；不走 Intl，避免服务端与浏览器 ICU 版本不一致导致水合错位） */
function weekdayZh(date: string): string {
  const days = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400_000);
  return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][(days + 4) % 7] ?? "";
}

export async function loader({ request }: LoaderFunctionArgs) {
  const dates = availableDates(latestEvents(300));
  const q = new URL(request.url).searchParams.get("date");
  const date = q && dates.some((d) => d.date === q) ? q : (dates[0]?.date ?? "");
  const report = date ? dailyReport(date) : { source: "concept" as const, groups: [], stockCount: 0 };
  return { dates, date, report, pushes: pushHistory(30) };
}

/** 日报的一行：左边题材（名称 + 结论），右边核心个股及其角色；有逻辑链的行可展开 */
function ReportRowItem({ row, expandable }: { row: ReportRow; expandable: boolean }) {
  const head = (
    <div className="grid grid-cols-1 gap-x-6 gap-y-1.5 px-4 py-2.5 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:items-center">
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          {expandable && (
            <span className="shrink-0 self-center text-[10px] leading-none text-zinc-400 transition-transform group-open:rotate-90">▸</span>
          )}
          <span className="text-sm font-semibold leading-snug">{row.title}</span>
          <span className="shrink-0 text-[11px] text-zinc-400">{row.eventCount} 帖</span>
        </div>
        {row.takeaway && (
          <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">{row.takeaway}</p>
        )}
      </div>
      <div className="flex flex-wrap gap-1">
        {row.stocks.map((s) => (
          <span
            key={s.name}
            className="rounded-md border border-sky-100 bg-sky-50 px-1.5 py-0.5 text-[11px] leading-4 dark:border-sky-900 dark:bg-sky-950"
          >
            <span className="font-semibold text-sky-700 dark:text-sky-300">{s.name}</span>
            {s.role && <span className="ml-1 text-zinc-500 dark:text-zinc-400">{s.role}</span>}
          </span>
        ))}
        {row.stocks.length === 0 && <span className="text-[11px] text-zinc-400">—</span>}
      </div>
    </div>
  );

  if (!expandable) return <div>{head}</div>;
  return (
    <details className="group">
      <summary className="cursor-pointer select-none list-none transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/40 [&::-webkit-details-marker]:hidden">
        {head}
      </summary>
      <div className="border-t border-dashed border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <ol className="space-y-1 border-l-2 border-zinc-200 pl-2.5 dark:border-zinc-700">
          {row.chain.map((step, i) => (
            <li key={i} className="flex gap-1.5 text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
              <span className="w-3 shrink-0 font-mono text-[10px] leading-[1.1rem] text-zinc-400 dark:text-zinc-500">{i + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
        {row.risk && (
          <p className="mt-2 rounded-md bg-amber-50 px-2 py-1 text-[11px] leading-relaxed text-amber-800 dark:bg-amber-950 dark:text-amber-200">
            ⚠ {row.risk}
          </p>
        )}
        <p className="mt-2 text-[11px] leading-relaxed text-zinc-400">
          来源：
          {row.sources.map((s, i) => (
            <span key={s.id}>
              {i > 0 && " · "}
              <Link to={`/story/${s.id}`} className="text-zinc-500 hover:text-sky-700 hover:underline dark:text-zinc-400 dark:hover:text-sky-300">
                {s.title}
              </Link>
            </span>
          ))}
        </p>
      </div>
    </details>
  );
}

export default function Report() {
  const { dates, date, report, pushes } = useLoaderData<typeof loader>();
  const [, setSearchParams] = useSearchParams();
  const rowCount = report.groups.reduce((n, g) => n + g.rows.length, 0);
  const postCount = new Set(report.groups.flatMap((g) => g.rows.flatMap((r) => r.sources.map((s) => s.id)))).size;
  const isConcept = report.source === "concept";

  return (
    <div className="space-y-5">
      <DatePills dates={dates} value={date} onChange={(d) => setSearchParams(d === dates[0]?.date ? {} : { date: d })} />

      {date && (
        <div className="relative overflow-hidden rounded-xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-rose-500 to-orange-400" />
          <div className="pl-2 text-xs text-zinc-500">
            <span className="font-semibold text-zinc-800 dark:text-zinc-100">{dateLabel(date)}</span>
            <span className="mx-1.5 text-zinc-300 dark:text-zinc-600">|</span>
            <span className="font-medium text-zinc-700 dark:text-zinc-300">
              {date} {weekdayZh(date)}
            </span>
            <span className="mx-2 text-zinc-300 dark:text-zinc-600">·</span>
            <span className="font-semibold text-zinc-800 dark:text-zinc-100">{rowCount}</span> {isConcept ? "条逻辑线" : "个题材"}
            <span className="mx-2 text-zinc-300 dark:text-zinc-600">·</span>
            <span className="font-semibold text-zinc-800 dark:text-zinc-100">{report.stockCount}</span> 个核心标的
            <span className="mx-2 text-zinc-300 dark:text-zinc-600">·</span>
            {postCount} 个帖子
            {!isConcept && (
              <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                这一天还没做逻辑梳理，先按分类汇总
              </span>
            )}
          </div>
        </div>
      )}

      {report.groups.map((g) => (
        <section key={g.label || "auto"}>
          {g.label && (
            <div className="mb-2.5 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-zinc-100 text-sm dark:bg-zinc-800">{g.emoji}</span>
              <h2 className="text-sm font-bold">{g.label}</h2>
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                {g.rows.length} 条
              </span>
              <span className="h-px flex-1 bg-zinc-100 dark:bg-zinc-800" />
            </div>
          )}
          <div className="divide-y divide-zinc-100 rounded-xl border border-zinc-200/80 bg-white shadow-sm dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-6 border-b border-zinc-100 px-4 py-2 text-[11px] font-medium tracking-wide text-zinc-400 dark:border-zinc-800 md:grid">
              <span>{isConcept ? "逻辑线" : "题材"}</span>
              <span>核心个股</span>
            </div>
            {g.rows.map((r) => (
              <ReportRowItem key={`${g.label}-${r.title}`} row={r} expandable={isConcept} />
            ))}
          </div>
        </section>
      ))}

      {date && rowCount === 0 && <p className="py-16 text-center text-sm text-zinc-400">这一天暂无数据</p>}

      {/* 推送记录：留作回溯，默认折叠 */}
      {pushes.length > 0 && (
        <details className="rounded-xl border border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <summary className="cursor-pointer select-none text-sm font-semibold text-zinc-600 dark:text-zinc-300">
            推送记录（{pushes.length} 次）
          </summary>
          <ul className="mt-3 space-y-1.5 text-xs">
            {pushes.map((p) => (
              <li key={p.id} className="leading-relaxed text-zinc-500 dark:text-zinc-400">
                <span className="font-medium text-zinc-700 dark:text-zinc-200">📈 {SLOT_LABEL[p.slot] ?? p.slot}</span>
                <span className="ml-1.5 font-mono text-[11px]">{bjTime(p.sent_at)}</span>
                <span className="mx-1.5 text-zinc-300 dark:text-zinc-600">|</span>
                {p.titles.join(" · ")}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
