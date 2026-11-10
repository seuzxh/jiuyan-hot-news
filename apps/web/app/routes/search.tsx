import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Form, useLoaderData } from "react-router";
import { searchAll } from "../lib/queries";
import { EventCard } from "../components/EventCard";

export const meta: MetaFunction = () => [{ title: "搜索 · 韭研热点" }];

export async function loader({ request }: LoaderFunctionArgs) {
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (!q) return { q, events: [], items: [] };
  return { q, ...searchAll(q) };
}

export default function Search() {
  const { q, events, items } = useLoaderData<typeof loader>();
  return (
    <div className="space-y-4">
      <Form method="get" className="flex gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder="搜索事件 / 标的 / 概念…"
          className="flex-1 rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900"
          autoFocus
        />
        <button className="rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
          搜索
        </button>
      </Form>

      {q && (
        <>
          <p className="text-xs text-zinc-400">
            匹配事件 {events.length} 个、帖子 {items.length} 条
          </p>
          <div className="space-y-2">
            {events.map((e) => (
              <EventCard key={e.id} event={e} />
            ))}
          </div>
          {items.length > 0 && (
            <div className="space-y-1.5">
              {items.map((i) => (
                <a key={i.id} href={i.url} target="_blank" rel="noreferrer" className="block rounded-lg border border-zinc-100 bg-white p-3 text-sm hover:shadow dark:border-zinc-800/60 dark:bg-zinc-900/60">
                  <span className="text-zinc-400">{i.published_at.slice(5, 10)} · </span>
                  {i.title}
                </a>
              ))}
            </div>
          )}
          {events.length === 0 && items.length === 0 && <p className="py-16 text-center text-sm text-zinc-400">无匹配结果</p>}
        </>
      )}
    </div>
  );
}
