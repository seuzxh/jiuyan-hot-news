import type { LinksFunction, MetaFunction } from "react-router";
import { Links, Meta, Outlet, Scripts, ScrollRestoration, Link, NavLink } from "react-router";
import { useEffect, useState } from "react";
import appStyles from "./app.css?url";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: appStyles }];

export const meta: MetaFunction = () => [
  { title: "韭研热点 · 去噪聚合" },
  { name: "description", content: "韭研公社资讯去噪聚合：事件聚簇 · 双次评分 · 热度榜" },
];

const NAV = [
  { to: "/", label: "精选" },
  { to: "/hot", label: "热点榜" },
  { to: "/search", label: "搜索" },
  { to: "/report", label: "日报" },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("jyc-theme");
    const isDark = saved === "dark";
    setDark(isDark);
    document.documentElement.classList.toggle("dark", isDark);
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("jyc-theme", next ? "dark" : "light");
  };

  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem('jyc-theme')==='dark')document.documentElement.classList.add('dark')}catch(e){}`,
          }}
        />
      </head>
      <body className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100 antialiased">
        <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/80 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/80">
          <div className="mx-auto flex max-w-3xl items-center gap-1 px-4 py-2.5">
            <Link to="/" className="mr-2 flex items-center gap-1.5 font-bold">
              <span className="text-lg">📈</span>
              <span>韭研热点</span>
            </Link>
            <nav className="flex flex-1 gap-1">
              {NAV.map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  className={({ isActive }) =>
                    `rounded-lg px-3 py-1.5 text-sm transition-colors ${
                      isActive
                        ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                        : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                    }`
                  }
                >
                  {n.label}
                </NavLink>
              ))}
            </nav>
            <button
              onClick={toggle}
              className="rounded-lg px-2 py-1.5 text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              aria-label="切换深浅色"
            >
              {dark ? "☀️" : "🌙"}
            </button>
          </div>
        </header>
        <main className="mx-auto max-w-3xl px-4 py-6 pb-16">{children}</main>
        <footer className="border-t border-zinc-200 py-6 text-center text-xs text-zinc-400 dark:border-zinc-800">
          数据来源：韭研公社 · 评分/摘要由 JYC 管线生成 · 不构成投资建议
        </footer>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}
