/**
 * 只读检索 CLI：npm run search -- --q=关键词 | --hot | --date=YYYY-MM-DD | --event=<id>
 * 可选：--limit=N（默认按模式）、--json。
 * 只查库内数据（每日 08/12/20 三轮管线更新），输出头标注数据截止时间；
 * 个股/概念实时消息面走 npm run ask（实时爬取链路）。
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  dataFreshness,
  eventsOnDate,
  eventMembers,
  getEvent,
  hotEvents,
  latestEvents,
  searchAll,
  type EventView,
} from "@jyc/core";

const args = process.argv.slice(2);
const q = args.find((a) => a.startsWith("--q="))?.slice("--q=".length);
const hot = args.includes("--hot");
const date = args.find((a) => a.startsWith("--date="))?.slice("--date=".length);
const eventId = args.find((a) => a.startsWith("--event="))?.slice("--event=".length);
const asJson = args.includes("--json");
const limit = Number(args.find((a) => a.startsWith("--limit="))?.slice("--limit=".length) ?? 0) || undefined;

const root = process.cwd();
const dbPath = join(root, "data", "jycgs.db");
if (!existsSync(dbPath)) {
  console.error("[search] 数据库不存在（data/jycgs.db）：先跑 npm run crawl 入库");
  process.exit(1);
}
const db = new DatabaseSync(dbPath, { readOnly: true });

function bj(iso: string | null): string {
  if (!iso) return "-";
  return new Date(Date.parse(iso) + 8 * 3600_000).toISOString().replace("T", " ").slice(0, 16);
}

function heatDelta(e: EventView): string {
  const d = Math.round(e.heat - e.prev_heat);
  if (d > 0) return `↑${d}`;
  if (d < 0) return `↓${-d}`;
  return "持平";
}

function cut(s: string | null, n: number): string {
  if (!s) return "";
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function renderEventList(events: EventView[]): void {
  for (const [i, e] of events.entries()) {
    const stocks = e.stocks.length > 0 ? `｜标的 ${e.stocks.slice(0, 4).join("/")}${e.stocks.length > 4 ? "等" : ""}` : "";
    const tags = e.tags.length > 0 ? `｜${e.tags.slice(0, 3).join("/")}` : "";
    console.log(`${i + 1}. ${e.title}`);
    console.log(`   热度 ${Math.round(e.heat)}（${heatDelta(e)}）｜${e.member_count} 帖｜${bj(e.first_item_at)} 起${stocks}${tags}`);
    const summary = e.summary ?? e.reason;
    if (summary) console.log(`   ${cut(summary, 110)}`);
  }
}

function freshnessHeader(): string {
  const t = dataFreshness(db);
  return t ? `数据截止：${bj(t)}（北京时间）` : "数据截止：库内暂无 selected 帖";
}

function render(): void {
  if (q) {
    const r = searchAll(db, q, limit ?? 40);
    console.log(`[search] 关键词「${q}」｜${freshnessHeader()}`);
    console.log(`\n── 事件（${r.events.length}）──`);
    if (r.events.length === 0) console.log("（无命中事件）");
    else renderEventList(r.events);
    console.log(`\n── 帖子（${r.items.length}）──`);
    if (r.items.length === 0) console.log("（无命中帖子）");
    for (const it of r.items) {
      console.log(`· ${cut(it.title, 60)}｜${bj(it.published_at)}｜${it.url}`);
    }
    if (r.events.length === 0 && r.items.length === 0) {
      console.log("\n建议：换个说法（全称/简称/概念词），或用 npm run ask -- --keyword= 走实时问股。");
    }
    return;
  }
  if (hot || (!date && !eventId)) {
    const events = hotEvents(db, limit ?? 15);
    console.log(`[search] 48h 热点榜｜${freshnessHeader()}`);
    if (events.length === 0) console.log("（48h 内无事件）");
    else renderEventList(events);
    return;
  }
  if (date) {
    const all = latestEvents(db, 2000);
    const events = eventsOnDate(all, date);
    console.log(`[search] ${date} 事件（${events.length}）｜${freshnessHeader()}`);
    if (events.length === 0) console.log("（当日无事件；日期格式 YYYY-MM-DD，可用最近日期）");
    else renderEventList(events);
    return;
  }
  if (eventId) {
    const e = getEvent(db, eventId);
    if (!e) {
      console.error(`[search] 事件不存在：${eventId}`);
      process.exit(1);
    }
    console.log(`[search] 事件详情｜${freshnessHeader()}\n`);
    console.log(`${e.title}`);
    console.log(`热度 ${Math.round(e.heat)}（${heatDelta(e)}）｜${e.member_count} 帖｜${bj(e.first_item_at)} ~ ${bj(e.last_item_at)}`);
    if (e.tags.length > 0) console.log(`标签：${e.tags.join("/")}`);
    if (e.stocks.length > 0) console.log(`标的：${e.stocks.join("/")}`);
    if (e.summary) console.log(`\n摘要：${e.summary}`);
    if (e.reason) console.log(`理由：${e.reason}`);
    if (e.rep_url) {
      console.log(`代表帖：${e.rep_title}｜${e.rep_author}${e.rep_badge ? `（${e.rep_badge}）` : ""}｜${e.rep_url}`);
    }
    const members = eventMembers(db, eventId);
    console.log(`\n── 成员帖（${members.length}，按分数降序）──`);
    for (const m of members.slice(0, limit ?? 10)) {
      console.log(`· [${m.role}] ${cut(m.title, 55)}｜${m.author_name}｜${bj(m.published_at)}｜分数 ${m.score_avg ?? "-"}`);
      if (m.excerpt) console.log(`  ${cut(m.excerpt, 90)}`);
    }
    if (members.length > (limit ?? 10)) console.log(`…其余 ${members.length - (limit ?? 10)} 条用 --limit=N 展开`);
  }
}

if (q || hot || date || eventId) {
  if (asJson) {
    const payload = q
      ? { mode: "q", q, freshness: dataFreshness(db), ...searchAll(db, q, limit ?? 40) }
      : hot || (!date && !eventId)
        ? { mode: "hot", freshness: dataFreshness(db), events: hotEvents(db, limit ?? 15) }
        : date
          ? { mode: "date", date, freshness: dataFreshness(db), events: eventsOnDate(latestEvents(db, 2000), date) }
          : { mode: "event", freshness: dataFreshness(db), event: getEvent(db, eventId!), members: eventMembers(db, eventId!) };
    console.log(JSON.stringify(payload, null, 2));
  } else {
    render();
  }
} else {
  console.log("用法：npm run search -- --q=<关键词> | --hot | --date=YYYY-MM-DD | --event=<id> [--limit=N] [--json]");
  console.log("  --q      关键词搜事件与帖子（标题/摘要/全文缓存，LIKE 近似）");
  console.log("  --hot    48h 热点榜（默认模式）");
  console.log("  --date   某北京日期事件（热度降序）");
  console.log("  --event  事件详情 + 成员帖");
  console.log("个股/概念实时消息面：npm run ask -- --keyword=<关键词>");
}
db.close();
