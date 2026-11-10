import type { MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import { hotEvents } from "../lib/queries";
import { EventCard } from "../components/EventCard";

export const meta: MetaFunction = () => [{ title: "热点榜 · 韭研热点" }];

export async function loader() {
  return { events: hotEvents(24) };
}

export default function Hot() {
  const { events } = useLoaderData<typeof loader>();
  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-400">按事件热度排序（48 小时窗口 · 每帖只计一次 · 24h 衰减）</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {events.map((e, i) => (
          <EventCard key={e.id} event={e} rank={i + 1} />
        ))}
      </div>
      {events.length === 0 && <p className="py-20 text-center text-sm text-zinc-400">暂无热点</p>}
    </div>
  );
}
