import { dateLabel } from "./EventCard";

/** 日期切换条（首页 / 日报共用）：今天、昨天、N 月 N 日 + 当日帖子数 */
export function DatePills({
  dates,
  value,
  onChange,
}: {
  dates: Array<{ date: string; count: number }>;
  value: string;
  onChange: (date: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {dates.slice(0, 14).map((d) => (
        <button
          key={d.date}
          onClick={() => onChange(d.date)}
          className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
            d.date === value
              ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
              : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400"
          }`}
        >
          {dateLabel(d.date)}
          <span className="ml-1 opacity-70">{d.count}</span>
        </button>
      ))}
    </div>
  );
}
