/**
 * 推送阶段：飞书推送"概念逻辑卡"。以概念为单位（结论 + 因果链 + 标的角色 + 风险），
 * 只推含新增帖子的概念；帖子本身不逐条转发（来源帖在站点上可展开查看）。
 * 无概念数据时退化为分类事件卡。
 * 用法：npm run push [-- --dry] [-- --all] [-- --slot=morning|noon|evening] [-- --since-hours=N]
 *   --dry --all：预览卡片——把窗口内全部帖子当作待推送，不看也不改推送记录
 */
import { createHmac } from "node:crypto";
import {
  bjDateKey,
  CONCEPT_OTHER_TITLE,
  currentSlot,
  defaultDbPath,
  defaultMigrationsDir,
  getConceptsByDate,
  getEventsForPush,
  getEventsWithMembers,
  groupByCategory,
  latestPushTime,
  nowIso,
  openDb,
  optEnv,
  requireEnv,
  setEventPushed,
  withRun,
  type ConceptRow,
  type ItemRow,
} from "@jyc/core";

const db = openDb(defaultDbPath(), defaultMigrationsDir());

const dry = process.argv.includes("--dry");
/** 仅配合 --dry：忽略已推送标记，窗口内全部帖子按待推送处理 */
const allFlag = process.argv.includes("--all");
/** --since-hours=N：覆盖默认增量窗口（用于补发） */
const sinceHoursArg = Number(process.argv.find((a) => a.startsWith("--since-hours="))?.slice(14));
const slotArg = process.argv.find((a) => a.startsWith("--slot="))?.slice(7);
const slot = (slotArg === "morning" || slotArg === "noon" || slotArg === "evening" ? slotArg : currentSlot()) as
  | "morning"
  | "noon"
  | "evening";

const SLOT_TITLE: Record<typeof slot, string> = { morning: "早报", noon: "午报", evening: "晚报" };
const SLOT_TEMPLATE: Record<typeof slot, string> = { morning: "blue", noon: "turquoise", evening: "orange" };

/** 单张卡片的概念数上限（8 条逻辑线约 7KB，12 条仍在卡片体积安全区内）；兜底"其他动态"里最多列几条未归概念的帖子 */
const MAX_CONCEPTS = 12;
const MAX_LEFTOVER_EVENTS = 3;

type EventWithRep = ReturnType<typeof getEventsWithMembers>[number];
type PendingRows = ReturnType<typeof getEventsForPush>;

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

/** 飞书卡片 markdown 不支持行内代码（反引号），徽章用 <font> 颜色实现 */
function badge(text: string, color: "blue" | "green" | "red" | "grey" = "grey"): string {
  return `<font color='${color}'>${text}</font>`;
}

function eventLines(events: EventWithRep[], startNum: number): { text: string; used: number } {
  let n = startNum;
  const lines: string[] = [];
  for (const e of events) {
    const rep = e.representative;
    n++;
    const parts = [
      `**${n}. ${e.title}** ${badge(`评分${rep?.score_avg ?? 0}`, "blue")} ${badge(`🔥${Math.round(e.heat)}`, "red")}`,
    ];
    if (e.summary) parts.push(firstSentence(e.summary));
    const stocks = (JSON.parse(e.stocks_json) as string[]).slice(0, 4).join(" · ");
    if (stocks) parts.push(`🎯 ${stocks}${e.member_count > 1 ? ` · 另有${e.member_count - 1}帖` : ""}`);
    if (rep) parts.push(`🔗 [原帖](${rep.url})`);
    // 飞书 markdown 只认单换行 \n，不支持 "  \n" 硬换行
    lines.push(parts.join("\n"));
  }
  return { text: lines.join("\n"), used: n - startNum };
}

/** 单个概念：标题行 + 结论 + 因果链 + 标的角色 + 风险 */
function conceptSection(c: ConceptRow, fresh: number): string {
  const chain = JSON.parse(c.chain_json) as string[];
  const stocks = JSON.parse(c.stocks_json) as Array<{ name: string; role: string }>;
  // 全部成员帖都是本次新增 → "新"；否则是已有逻辑线吸收了新素材 → "更新"
  const status = fresh >= c.event_count ? badge("新", "green") : badge(`更新 +${fresh}帖`, "blue");
  const lines = [`**${c.emoji} ${c.title}** ${status} ${badge(`${c.event_count}帖`, "grey")}`, `结论：${c.takeaway}`];
  // 兜底概念没有因果链，环节位置上放的是帖子标题，按并列列出而不是串成箭头
  lines.push(c.title === CONCEPT_OTHER_TITLE ? `涉及：${chain.join(" ｜ ")}` : `逻辑：${chain.join(" → ")}`);
  const stockText = stocks.map((s) => (s.role ? `${s.name}·${s.role}` : s.name)).join(" ｜ ");
  if (stockText) lines.push(`🎯 ${stockText}`);
  if (c.risk) lines.push(`⚠️ ${c.risk}`);
  return lines.join("\n");
}

/** 概念逻辑卡：只列含新增帖子的概念；未被任何概念覆盖的新帖以"其他动态"兜底，保证不丢信息 */
function buildConceptCard(concepts: Array<{ row: ConceptRow; fresh: number }>, leftover: EventWithRep[], dateKey: string): Record<string, unknown> {
  const elements: CardElement[] = [];
  concepts.forEach((c, i) => {
    if (i > 0) elements.push({ tag: "hr" });
    elements.push({ tag: "markdown", content: conceptSection(c.row, c.fresh) });
  });
  if (leftover.length > 0) {
    if (elements.length > 0) elements.push({ tag: "hr" });
    elements.push({ tag: "markdown", content: ["**📌 未归类的其他动态**", eventLines(leftover, 0).text].join("\n") });
  }
  const freshTotal = concepts.reduce((n, c) => n + c.fresh, 0) + leftover.length;
  const site = optEnv("JYC_SITE_URL");
  elements.push({
    tag: "note",
    elements: [
      {
        tag: "plain_text",
        content:
          `韭研公社 · ${dateKey} ${SLOT_TITLE[slot]} · ${concepts.length} 条逻辑线 / 新增 ${freshTotal} 帖` +
          (site ? ` · 来源帖与全文：${site}` : ""),
      },
    ],
  });
  return {
    msg_type: "interactive",
    card: {
      config: { wide_screen_mode: true },
      header: {
        template: SLOT_TEMPLATE[slot],
        title: { tag: "plain_text", content: `📈 韭研热点 · ${SLOT_TITLE[slot]} · ${concepts.length} 条逻辑线` },
      },
      elements,
    },
  };
}

/** 兜底：无概念数据时按事件分类卡 */
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
    elements.push({ tag: "markdown", content: [`**${g.category.emoji} ${g.category.label}**`, eventLines(g.events.map((x) => x.event), n).text].join("\n") });
    n += g.events.length;
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
  const pending = allFlag
    ? (db
        .prepare("SELECT * FROM events WHERE last_item_at > ? ORDER BY heat DESC LIMIT 60")
        .all(since) as unknown as PendingRows)
    : getEventsForPush(db, since, 60);
  if (pending.length === 0) return { pushed: 0, since, reason: "no_increment" } as const;

  const dateKey = bjDateKey(nowIso());
  const pendingIds = new Set(pending.map((e) => e.id));
  // 含新增帖子的概念（概念已按展示顺序排好，"其他动态"垫底）
  const matching = getConceptsByDate(db, dateKey)
    .map((row) => ({ row, fresh: (JSON.parse(row.event_ids_json) as string[]).filter((id) => pendingIds.has(id)).length }))
    .filter((t) => t.fresh > 0);
  // 超出卡片上限的概念本次不推（其帖子照常记为已推送，站点上完整展示）
  const targets = matching.slice(0, MAX_CONCEPTS);

  const events = getEventsWithMembers(db, pending.map((e) => e.id));
  let card: Record<string, unknown>;
  let usedConcepts = 0;
  if (targets.length > 0) {
    // 已归属到任一概念的帖子都不算"未归类"——包括本次因卡片上限没推出来的概念
    const covered = new Set(matching.flatMap((t) => JSON.parse(t.row.event_ids_json) as string[]));
    const leftover = events.filter((e) => !covered.has(e.id)).slice(0, MAX_LEFTOVER_EVENTS);
    card = buildConceptCard(targets, leftover, dateKey);
    usedConcepts = targets.length;
  } else {
    card = buildEventsCard(events.slice(0, 12));
  }

  if (dry) {
    console.log(JSON.stringify(card, null, 2));
    return { pushed: 0, since, reason: "dry_run", titles: targets.map((t) => t.row.title) } as const;
  }

  try {
    await sendFeishu(card);
  } catch {
    // 卡片失败退化为纯文本
    await sendFeishu({ msg_type: "text", content: { text: buildTextFallback(card) } });
  }

  const ts = nowIso();
  const eventIds = pending.map((e) => e.id);
  db.prepare("INSERT INTO pushes (id, slot, event_ids_json, payload_json, sent_at) VALUES (?, ?, ?, ?, ?)").run(
    `push_${ts}`,
    slot,
    JSON.stringify(eventIds),
    JSON.stringify({ titles: targets.map((t) => t.row.title), concepts: usedConcepts }),
    ts,
  );
  setEventPushed(db, eventIds, ts);
  return {
    pushed: pending.length,
    concepts: usedConcepts,
    since,
    titles: usedConcepts > 0 ? targets.map((t) => `${t.row.title}（+${t.fresh}帖）`) : events.slice(0, 12).map((e) => e.title),
  };
});

db.close();
if (stats.pushed === 0) {
  console.log(`[push] 无增量事件（since ${stats.since}${stats.reason === "dry_run" ? "，dry-run 未发送" : ""}）`);
} else {
  console.log(`[push] 已推送 ${stats.concepts} 条逻辑线，覆盖 ${stats.pushed} 帖:`);
  for (const t of stats.titles ?? []) console.log(`  - ${t}`);
}
