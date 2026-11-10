import { Link } from "react-router";
import type { EventView } from "../lib/queries";

function scoreColor(score: number | null): string {
  if (score === null) return "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400";
  if (score >= 85) return "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300";
  if (score >= 75) return "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300";
  return "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400";
}

export function bjTime(iso: string): string {
  return new Date(Date.parse(iso) + 8 * 3600_000).toISOString().slice(5, 16).replace("T", " ");
}

export function bjDay(iso: string): string {
  return new Date(Date.parse(iso) + 8 * 3600_000).toISOString().slice(0, 10);
}

export function dateLabel(date: string): string {
  const today = bjDay(new Date().toISOString());
  const yesterday = bjDay(new Date(Date.now() - 24 * 3600_000).toISOString());
  if (date === today) return "今天";
  if (date === yesterday) return "昨天";
  return date.slice(5).replace("-", "月") + "日";
}

/**
 * 紧凑事件卡（网格布局用）：标题 + 摘要为主体，时间/评分/热度/标的/帖数一行密度展示
 */
export function EventCard({ event, rank }: { event: EventView; rank?: number }) {
  const isNew = Date.now() - Date.parse(event.created_at) < 12 * 3600_000;
  const rising = event.prev_heat > 0 && event.heat > event.prev_heat * 1.3;
  return (
    <article className="group flex flex-col rounded-xl border border-zinc-200 bg-white p-3.5 transition-all hover:border-zinc-300 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700">
      <div className="flex items-center gap-1.5 text-[11px] leading-none text-zinc-400">
        {rank !== undefined && <span className="font-mono font-bold text-zinc-300 dark:text-zinc-600">#{rank}</span>}
        <span>{event.first_item_at ? bjTime(event.first_item_at) : ""}</span>
        {event.rep_score !== null && (
          <span className={`rounded px-1 py-0.5 font-medium ${scoreColor(event.rep_score)}`}>{event.rep_score}</span>
        )}
        <span className="rounded bg-orange-50 px-1 py-0.5 font-medium text-orange-600 dark:bg-orange-950 dark:text-orange-300">
          🔥{Math.round(event.heat)}
        </span>
        {isNew && <span className="rounded bg-blue-50 px-1 py-0.5 font-medium text-blue-600 dark:bg-blue-950 dark:text-blue-300">新</span>}
        {rising && (
          <span className="rounded bg-emerald-50 px-1 py-0.5 font-medium text-emerald-600 dark:bg-emerald-950 dark:text-emerald-300">涨</span>
        )}
        {event.member_count > 1 && <span className="ml-auto whitespace-nowrap">{event.member_count}帖</span>}
      </div>

      <Link to={`/story/${event.id}`} className="mt-1.5">
        <h2 className="line-clamp-2 text-sm font-semibold leading-snug group-hover:underline">{event.title}</h2>
      </Link>

      {event.summary && (
        <p className="mt-1.5 line-clamp-3 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">{event.summary}</p>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-1 pt-2.5 text-[11px]">
        {event.stocks.slice(0, 3).map((s) => (
          <span key={s} className="rounded bg-sky-50 px-1 py-0.5 font-medium text-sky-700 dark:bg-sky-950 dark:text-sky-300">
            {s}
          </span>
        ))}
        {event.tags.slice(0, 2).map((t) => (
          <Link
            key={t}
            to={`/search?q=${encodeURIComponent(t)}`}
            className="rounded bg-zinc-100 px-1 py-0.5 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400"
          >
            #{t}
          </Link>
        ))}
        <span className="ml-auto flex gap-2 text-zinc-400">
          <Link to={`/story/${event.id}`} className="hover:text-zinc-600 dark:hover:text-zinc-300">
            详情
          </Link>
          {event.rep_url && (
            <a href={event.rep_url} target="_blank" rel="noreferrer" className="hover:text-zinc-600 dark:hover:text-zinc-300">
              原帖↗
            </a>
          )}
        </span>
      </div>
    </article>
  );
}
