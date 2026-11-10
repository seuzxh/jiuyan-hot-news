/**
 * 推送阶段：飞书推送"自上次推送以来的新增/更新事件"，按题材组织卡片
 * （题材催化逻辑综述 + Top5 概念股 + 事件列表）。无题材数据时退化为分类事件卡。
 * 用法：npm run push [-- --dry] [-- --slot=morning|noon|evening] [-- --since-hours=N]
 */
import { createHmac } from "node:crypto";
import {
  bjDateKey,
  currentSlot,
  defaultDbPath,
  defaultMigrationsDir,
  getEventsForPush,
  getEventsWithMembers,
  getThemesByDate,
  groupByCategory,
  latestPushTime,
  nowIso,
  openDb,
  requireEnv,
  setEventPushed,
  withRun,
  type ItemRow,
  type ThemeRow,
} from "@jyc/core";

const db = openDb(defaultDbPath(), defaultMigrationsDir());

const dry = process.argv.includes("--dry");
/** --since-hours=N：覆盖默认增量窗口（用于补发） */
const sinceHoursArg = Number(process.argv.find((a) => a.startsWith("--since-hours="))?.slice(14));
const slotArg = process.argv.find((a) => a.startsWith("--slot="))?.slice(7);
const slot = (slotArg === "morning" || slotArg === "noon" || slotArg === "evening" ? slotArg : currentSlot()) as
  | "morning"
  | "noon"
  | "evening";

const SLOT_TITLE: Record<typeof slot, string> = { morning: "早报", noon: "午报", evening: "晚报" };
const SLOT_TEMPLATE: Record<typeof slot, string> = { morning: "blue", noon: "turquoise", evening: "orange" };

/** 卡片上限：题材数 × 每题材事件数 */
const MAX_THEMES = 5;
const MAX_EVENTS_PER_THEME = 3;

type EventWithRep = ReturnType<typeof getEventsWithMembers>[number];

// ---------- 飞书消息构造 ----------

interface CardElement {
  tag: string;
  content?: string;
  elements?: unknown[];
}

function firstSentence(s: string): string {
  const m = s.match(/^[^。！？!?]*[。！？!?]?/);
  return (m?.[0] ?? s).slice(0, 60);
}

interface StockBadge {
  name: string;
  score: number;
  mentions: number;
}

function eventLines(events: EventWithRep[], startNum: number): { text: string; used: number } {
  let n = startNum;
  const lines: string[] = [];
  for (const e of events) {
    const rep = e.representative;
    n++;
    const parts = [`**${n}. ${e.title}**\`评分${rep?.score_avg ?? 0}\`\`🔥${Math.round(e.heat)}\``];
    if (e.summary) parts.push(firstSentence(e.summary));
    const stocks = (JSON.parse(e.stocks_json) as string[]).slice(0, 2).join("/");
    if (stocks) parts.push(`🎯${stocks}${e.member_count > 1 ? ` · 另有${e.member_count - 1}帖` : ""}`);
    if (rep) parts.push(`🔗 [原帖](${rep.url})`);
    lines.push(parts.join("  \n"));
  }
  return { text: lines.join("\n"), used: n - startNum };
}

/** 题材优先卡片：催化逻辑 + Top5 概念股 + 增量事件列表（"其他"恒排最后） */
function buildThemeCard(themes: ThemeRow[], events: EventWithRep[]): Record<string, unknown> {
  const eligibleIds = new Set(events.map((e) => e.id));
  const ordered = [
    ...themes.filter((t) => t.category_id !== "other").sort((a, b) => b.heat_total - a.heat_total),
    ...themes.filter((t) => t.category_id === "other"),
  ];
  const sections: Array<{ theme: ThemeRow; events: EventWithRep[] }> = [];
  const covered = new Set<string>();
  for (const t of ordered) {
    if (sections.length >= MAX_THEMES) break;
    const ids = new Set(JSON.parse(t.event_ids_json) as string[]);
    const mine = events.filter((e) => ids.has(e.id)).sort((a, b) => b.heat - a.heat).slice(0, MAX_EVENTS_PER_THEME);
    if (mine.length === 0) continue;
    mine.forEach((e) => covered.add(e.id));
    sections.push({ theme: t, events: mine });
  }
  const leftover = events.filter((e) => !covered.has(e.id)).slice(0, 3);

  const elements: CardElement[] = [];
  let n = 0;
  sections.forEach((sec, i) => {
    if (i > 0) elements.push({ tag: "hr" });
    const topStocks = (JSON.parse(sec.theme.top_stocks_json) as StockBadge[]).map((s) => s.name);
    const head = [
      `**${sec.theme.emoji} ${sec.theme.category_label}**　\`${sec.theme.event_count}事件\` \`🔥${Math.round(sec.theme.heat_total)}\``,
    ];
    if (sec.theme.logic) head.push(sec.theme.logic);
    if (topStocks.length > 0) head.push(`🎯 **Top**: ${topStocks.join(" · ")}`);
    const body = eventLines(sec.events, n);
    n += body.used;
    elements.push({ tag: "markdown", content: [...head, body.text].join("\n") });
  });
  if (leftover.length > 0) {
    if (elements.length > 0) elements.push({ tag: "hr" });
    const body = eventLines(leftover, n);
    elements.push({ tag: "markdown", content: [`**📌 其他动态**`, body.text].join("\n") });
  }
  elements.push({
    tag: "note",
    elements: [{ tag: "plain_text", content: `数据来源：韭研公社 · ${bjDateKey(nowIso())} ${SLOT_TITLE[slot]} · 按题材分类汇总` }],
  });
  return {
    msg_type: "interactive",
    card: {
      config: { wide_screen_mode: true },
      header: {
        template: SLOT_TEMPLATE[slot],
        title: { tag: "plain_text", content: `📈 韭研热点 · ${SLOT_TITLE[slot]}（${events.length} 事件 / ${sections.length} 题材）` },
      },
      elements,
    },
  };
}

/** 兜底：无题材数据时按事件分类卡 */
function buildEventsCard(events: EventWithRep[]): Record<string, unknown> {
  const wrapped = events.map((e) => {
    let repIndustry: string | null = null;
    let repDriver: string | null = null;
    const repTags = (e.representative as ItemRow | null)?.tags_json;
    if (repTags) {
      try {
        const t = JSON.parse(repTags) as { industry?: string; driver?: string };
        repIndustry = t.industry ?? null;
        repDriver = t.driver ?? null;
      } catch {
        /* 忽略 */
      }
    }
    return { event: e, tags: JSON.parse(e.tags_json) as string[], repIndustry, repDriver };
  });
  const groups = groupByCategory(wrapped);
  const elements: CardElement[] = [];
  let n = 0;
  groups.forEach((g, i) => {
    if (i > 0) elements.push({ tag: "hr" });
    const lines = [`**${g.category.emoji} ${g.category.label}**`];
    for (const { event: e } of g.events) {
      n++;
      const rep = e.representative;
      const parts = [`**${n}. ${e.title}**\`评分${rep?.score_avg ?? 0}\`\`🔥${Math.round(e.heat)}\``];
      if (e.summary) parts.push(firstSentence(e.summary));
      const stocks = (JSON.parse(e.stocks_json) as string[]).slice(0, 2).join("/");
      if (stocks) parts.push(`🎯${stocks}`);
      if (rep) parts.push(`🔗 [原帖](${rep.url})`);
      lines.push(parts.join("  \n"));
    }
    elements.push({ tag: "markdown", content: lines.join("\n") });
  });
  elements.push({
    tag: "note",
    elements: [{ tag: "plain_text", content: `数据来源：韭研公社 · ${bjDateKey(nowIso())} ${SLOT_TITLE[slot]} · 由 JYC 聚合管线生成` }],
  });
  return {
    msg_type: "interactive",
    card: {
      config: { wide_screen_mode: true },
      header: {
        template: SLOT_TEMPLATE[slot],
        title: { tag: "plain_text", content: `📈 韭研热点 · ${SLOT_TITLE[slot]} Top ${events.length}` },
      },
      elements,
    },
  };
}

function buildTextFallback(card: Record<string, unknown>): string {
  const c = card as { card?: { header?: { title?: { content?: string } }; elements?: Array<{ content?: string }> } };
  const title = c.card?.header?.title?.content ?? `📈 韭研热点 · ${SLOT_TITLE[slot]}`;
  const body = (c.card?.elements ?? [])
    .filter((el) => typeof el.content === "string")
    .map((el) => (el.content as string).replace(/\*\*/g, "").replace(/`/g, "").replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1($2)"))
    .join("\n--------------------\n");
  return `${title}\n\n${body}\n\n—— 数据来源：韭研公社`;
}

// ---------- 发送 ----------

async function sendFeishu(payload: Record<string, unknown>): Promise<void> {
  const webhook = requireEnv("FEISHU_WEBHOOK_URL");
  const secret = process.env.FEISHU_SECRET;
  const body: Record<string, unknown> = { ...payload };
  if (secret) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const sign = createHmac("sha256", `${timestamp}\n${secret}`).update("").digest("base64");
    body.timestamp = timestamp;
    body.sign = sign;
  }
  const res = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as { code?: number; msg?: string };
  if (!res.ok || (data.code !== undefined && data.code !== 0)) {
    throw new Error(`飞书推送失败: HTTP ${res.status} ${JSON.stringify(data)}`);
  }
}

// ---------- 主流程 ----------

const stats = await withRun(db, `push-${slot}`, async () => {
  const since = Number.isFinite(sinceHoursArg) && sinceHoursArg > 0
    ? new Date(Date.now() - sinceHoursArg * 3600_000).toISOString()
    : (latestPushTime(db) ?? new Date(Date.now() - 12 * 3600_000).toISOString());
  const eventRows = getEventsForPush(db, since, 12);
  if (eventRows.length === 0) return { pushed: 0, since, reason: "no_increment" };

  const events = getEventsWithMembers(db, eventRows.map((e) => e.id));
  const themeRows = getThemesByDate(db, bjDateKey(nowIso()));
  const card = themeRows.length > 0 ? buildThemeCard(themeRows, events) : buildEventsCard(events);

  if (dry) {
    console.log(JSON.stringify(card, null, 2));
    return { pushed: 0, since, reason: "dry_run" };
  }

  try {
    await sendFeishu(card);
  } catch {
    // 卡片失败退化为纯文本
    await sendFeishu({ msg_type: "text", content: { text: buildTextFallback(card) } });
  }

  const ts = nowIso();
  const eventIds = events.map((e) => e.id);
  db.prepare("INSERT INTO pushes (id, slot, event_ids_json, payload_json, sent_at) VALUES (?, ?, ?, ?, ?)").run(
    `push_${ts}`,
    slot,
    JSON.stringify(eventIds),
    JSON.stringify({ titles: events.map((e) => e.title), themes: themeRows.map((t) => t.category_label) }),
    ts,
  );
  setEventPushed(db, eventIds, ts);
  return { pushed: events.length, themes: themeRows.length, since, titles: events.map((e) => e.title) };
});

db.close();
if (stats.pushed === 0) {
  console.log(`[push] 无增量事件（since ${stats.since}${(stats as { reason?: string }).reason === "dry_run" ? "，dry-run 未发送" : ""}）`);
} else {
  console.log(`[push] 已推送 ${stats.pushed} 个事件（${(stats as { themes?: number }).themes ?? 0} 个题材）:`);
  for (const t of (stats as { titles?: string[] }).titles ?? []) console.log(`  - ${t}`);
}
