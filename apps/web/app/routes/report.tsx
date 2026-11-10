import type { MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import { pushHistory } from "../lib/queries";
import { bjTime } from "../components/EventCard";

export const meta: MetaFunction = () => [{ title: "推送日报 · 韭研热点" }];

const SLOT_LABEL: Record<string, string> = { morning: "早报", noon: "午报", evening: "晚报" };

export async function loader() {
  return { pushes: pushHistory(30) };
}

export default function Report() {
  const { pushes } = useLoaderData<typeof loader>();
  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-400">飞书推送历史（每日 08:00 / 12:00 / 20:00）</p>
      {pushes.map((p) => (
        <div key={p.id} className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="text-sm font-semibold">
            📈 {SLOT_LABEL[p.slot] ?? p.slot}{" "}
            <span className="ml-1 font-normal text-xs text-zinc-400">{bjTime(p.sent_at)}</span>
          </div>
          <ol className="mt-2 list-inside list-decimal space-y-1 text-sm text-zinc-600 dark:text-zinc-400">
            {p.titles.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ol>
        </div>
      ))}
      {pushes.length === 0 && <p className="py-16 text-center text-sm text-zinc-400">还没有推送记录</p>}
    </div>
  );
}
