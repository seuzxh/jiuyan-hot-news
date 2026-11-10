import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import { eventMembers, getEvent } from "../lib/queries";
import { bjTime } from "../components/EventCard";

export const meta: MetaFunction<typeof loader> = ({ data }) => [{ title: `${data?.event?.title ?? "事件"} · 韭研热点` }];

export async function loader({ params }: LoaderFunctionArgs) {
  const event = getEvent(params.id!);
  if (!event) throw new Response("事件不存在", { status: 404 });
  return { event, members: eventMembers(params.id!) };
}

export default function Story() {
  const { event, members } = useLoaderData<typeof loader>();
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="text-lg font-bold leading-snug">{event.title}</h1>
        <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
          <span className="rounded bg-orange-50 px-1.5 py-0.5 font-medium text-orange-600 dark:bg-orange-950 dark:text-orange-300">
            🔥 {Math.round(event.heat)}
          </span>
          {event.rep_score !== null && <span className="rounded bg-amber-50 px-1.5 py-0.5 font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">评分 {event.rep_score}</span>}
          {event.tags.map((t) => (
            <span key={t} className="rounded bg-zinc-100 px-1.5 py-0.5 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">{t}</span>
          ))}
        </div>
        {event.summary && <p className="mt-3 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">{event.summary}</p>}
        {event.reason && (
          <p className="mt-2 border-l-2 border-amber-300 pl-2 text-xs text-zinc-500">{event.reason}</p>
        )}
        {event.stocks.length > 0 && (
          <p className="mt-3 text-xs text-zinc-400">
            关联标的：
            {event.stocks.map((s) => (
              <span key={s} className="mr-1.5 text-sky-600 dark:text-sky-400">
                {s}
              </span>
            ))}
          </p>
        )}
      </div>

      <h2 className="text-sm font-semibold text-zinc-500">成员帖（{members.length}）</h2>
      <div className="space-y-2">
        {members.map((m) => (
          <a
            key={m.id}
            href={m.url}
            target="_blank"
            rel="noreferrer"
            className="block rounded-xl border border-zinc-200 bg-white p-4 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="flex items-center gap-2 text-xs text-zinc-400">
              <span className="font-medium text-zinc-600 dark:text-zinc-300">{m.author_name}</span>
              {m.author_badge && <span className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">{m.author_badge}</span>}
              <span>{bjTime(m.published_at)}</span>
              {m.score_avg !== null && <span className="ml-auto">评分 {m.score_avg}</span>}
              <span>👍 {m.like_count}</span>
            </div>
            <h3 className="mt-1 text-sm font-medium leading-snug">{m.title}</h3>
            {m.excerpt && <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">{m.excerpt}</p>}
          </a>
        ))}
      </div>
    </div>
  );
}
