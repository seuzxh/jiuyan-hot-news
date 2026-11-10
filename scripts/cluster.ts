/**
 * 聚簇阶段：把 selected 条目聚成事件（同一事件多篇帖子 → 一条事件）。
 * 规则候选（股票重叠/标题相似/同驱动同行业，48h 窗口）→ 并查集成组 → LLM 复核 →
 * 合并进已有事件或新建事件；孤立条目各自成事件。最后重算事件热度。
 *
 * API 模式直调 GLM；handoff 模式生成 cluster-*.json 任务，`npm run cluster -- --consume` 回填。
 */
import {
  getItem,
  getItemsByStatus,
  hoursBetween,
  jaccard,
  normalizeTitle,
  nowIso,
  setStatus,
  withRun,
  addEventMember,
  newEventId,
  recomputeHeat,
  upsertEvent,
  type ItemRow,
} from "@jyc/core";
import {
  buildPrompt,
  chat,
  completeTask,
  extractJson,
  listReadyTasks,
  loadPrompt,
  readResult,
  validateCluster,
  writeTask,
  type ClusterGroupInput,
  type ClusterGroupOutput,
} from "@jyc/llm";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { HEAT } from "../industry/selection.js";
import { agentInstructions, hasGlmKey, handoffDirs, openPipelineDb, parseTags, stocksOf, warnOutstanding } from "./lib.js";

const db = openPipelineDb();
const args = new Set(process.argv.slice(2));
const consume = args.has("--consume");
const NOW = nowIso();
const WINDOW_H = 48;

// ---------- 并查集 ----------

class UnionFind {
  parent = new Map<string, string>();
  find(x: string): string {
    let p = this.parent.get(x) ?? x;
    if (p !== x) {
      p = this.find(p);
      this.parent.set(x, p);
    }
    return p;
  }
  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

// ---------- 规则候选对 ----------

function isCandidatePair(a: ItemRow, b: ItemRow, normA: string, normB: string): boolean {
  if (hoursBetween(a.published_at, b.published_at) > WINDOW_H) return false;
  const titleSim = normA.length > 0 ? jaccard(normA, normB) : 0;
  if (titleSim >= 0.5) return true;
  // 股票重叠需标题相似佐证（单独的股票标签会传递性连锁扩散）
  const sa = stocksOf(a);
  const sb = stocksOf(b);
  const stocksOverlap = sa.length > 0 && sb.some((s) => sa.includes(s));
  if (stocksOverlap && titleSim >= 0.25) return true;
  // 打分阶段的概念标签 + 行业一致（如 Optimus、AppLovin、短剧），交给 LLM 复核把关
  const ta = parseTags(a);
  const tb = parseTags(b);
  const conceptOverlap = ta.concepts.some((c) => c.length >= 2 && tb.concepts.includes(c));
  if (conceptOverlap && ta.industry === tb.industry) return true;
  return false;
}

interface GroupPlan {
  groupId: string;
  members: ItemRow[]; // 含已归属与自由成员
  free: ItemRow[]; // 未归属成员（本次要写入 event 的）
}

/** 生成聚簇计划：规则组（≥2 成员且含自由成员） */
function buildGroups(selected: ItemRow[]): { groups: GroupPlan[]; singletons: ItemRow[] } {
  const free = selected.filter((i) => !i.event_id);
  const cutoff = new Date(Date.parse(NOW) - WINDOW_H * 3600_000).toISOString();
  const anchors = selected.filter((i) => i.event_id && i.published_at >= cutoff);
  const pool = [...free, ...anchors];
  const norms = new Map(pool.map((i) => [i.id, normalizeTitle(i.title)]));

  const uf = new UnionFind();
  const adjacency = new Map<string, string[]>();
  const addEdge = (a: string, b: string) => {
    uf.union(a, b);
    (adjacency.get(a) ?? adjacency.set(a, []).get(a)!).push(b);
    (adjacency.get(b) ?? adjacency.set(b, []).get(b)!).push(a);
  };
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const a = pool[i]!;
      const b = pool[j]!;
      if (isCandidatePair(a, b, norms.get(a.id)!, norms.get(b.id)!)) addEdge(a.id, b.id);
    }
  }

  const byRoot = new Map<string, ItemRow[]>();
  for (const item of pool) {
    const root = uf.find(item.id);
    const list = byRoot.get(root) ?? [];
    list.push(item);
    byRoot.set(root, list);
  }

  const groups: GroupPlan[] = [];
  const singletons: ItemRow[] = [];
  let g = 0;
  const byId = new Map(pool.map((i) => [i.id, i]));
  for (const members of byRoot.values()) {
    const freeM = members.filter((m) => !m.event_id);
    if (members.length < 2 || freeM.length === 0) {
      singletons.push(...freeM);
      continue;
    }
    if (members.length <= 6) {
      groups.push({ groupId: `g${g++}`, members, free: freeM });
      continue;
    }
    // 超大组：传递闭包扩散了。退化为"直接邻接"——以最高分成员为种子，只收直接相连的邻居
    const seed = representer(members);
    const direct = (adjacency.get(seed.id) ?? [])
      .map((id) => byId.get(id))
      .filter((m): m is ItemRow => !!m && members.includes(m));
    const groupMembers = [seed, ...direct].slice(0, 6);
    if (groupMembers.length >= 2 && groupMembers.some((m) => !m.event_id)) {
      groups.push({ groupId: `g${g++}`, members: groupMembers, free: groupMembers.filter((m) => !m.event_id) });
      const inGroup = new Set(groupMembers.map((m) => m.id));
      singletons.push(...members.filter((m) => !m.event_id && !inGroup.has(m.id)));
    } else {
      singletons.push(...freeM);
    }
  }
  return { groups, singletons };
}

function toGroupInput(gp: GroupPlan): ClusterGroupInput {
  return {
    groupId: gp.groupId,
    members: gp.members.map((m) => ({
      id: m.id,
      title: m.title.slice(0, 60),
      stocks: stocksOf(m).slice(0, 5),
      driver: parseTags(m).driver,
      publishedAt: m.published_at,
    })),
  };
}

// ---------- 应用聚簇结果 ----------

function representer(members: ItemRow[]): ItemRow {
  return [...members].sort((a, b) => {
    const d = (b.score_avg ?? 0) - (a.score_avg ?? 0);
    if (d !== 0) return d;
    if (a.author_tier !== b.author_tier) return a.author_tier === "T1_5" ? -1 : 1;
    return a.published_at.localeCompare(b.published_at);
  })[0]!;
}

function commitGroup(db2: typeof db, gp: GroupPlan): string {
  const assigned = gp.members.filter((m) => m.event_id);
  const eventId = assigned.length > 0 ? representer(assigned).event_id! : newEventId();
  const rep = representer(gp.members);
  const tags = [...new Set(gp.members.flatMap((m) => parseTags(m).concepts))].slice(0, 5);
  const stocks = [...new Set(gp.members.flatMap(stocksOf))].slice(0, 10);
  const times = gp.members.map((m) => m.published_at).sort();
  upsertEvent(db2, {
    id: eventId,
    title: rep.title.slice(0, 80),
    tags,
    stocks,
    firstItemAt: times[0]!,
    lastItemAt: times[times.length - 1]!,
  });
  for (const m of gp.members) {
    addEventMember(db2, eventId, m.id, m.id === rep.id ? "representative" : "member");
    if (m.event_id !== eventId) setStatus(db2, m.id, "selected", undefined, { eventId });
  }
  return eventId;
}

function commitSingleton(db2: typeof db, item: ItemRow): string {
  const eventId = newEventId();
  const t = parseTags(item);
  upsertEvent(db2, {
    id: eventId,
    title: item.title.slice(0, 80),
    tags: t.concepts,
    stocks: stocksOf(item),
    firstItemAt: item.published_at,
    lastItemAt: item.published_at,
  });
  addEventMember(db2, eventId, item.id, "representative");
  setStatus(db2, item.id, "selected", undefined, { eventId });
  return eventId;
}

// ---------- 主流程 ----------

if (consume) {
  const stats = await withRun(db, "cluster-consume", async () => {
    const outstanding = listReadyTasks(handoffDirs).filter((t) => t.stage === "cluster");
    const committedFree = new Set<string>();
    let merged = 0;
    let dissolved = 0;
    let consumed = 0;
    for (const t of outstanding) {
      const result = readResult<ClusterGroupOutput>(handoffDirs, "cluster", t.batch);
      const task = JSON.parse(readFileSync(t.file, "utf8")) as { input: ClusterGroupInput[] };
      const ids = new Set(task.input.map((x) => x.groupId));
      const outputs = validateCluster(result.outputs, ids);
      const byOut = new Map(outputs.map((o) => [o.groupId, o]));
      for (const gi of task.input) {
        const members = gi.members.map((m) => getItem(db, m.id)).filter((m): m is ItemRow => !!m);
        const free = members.filter((m) => !m.event_id);
        if (free.length === 0) continue;
        if (byOut.get(gi.groupId)?.sameEvent) {
          commitGroup(db, { groupId: gi.groupId, members, free });
          for (const f of free) committedFree.add(f.id);
          merged++;
        } else {
          dissolved++;
        }
      }
      completeTask(handoffDirs, "cluster", t.batch);
      consumed++;
    }
    // 剩余未归属的 selected 条目各自成事件（含生成任务时的孤立条目与被否决组的成员）
    let created = 0;
    for (const item of getItemsByStatus(db, "selected", 1000)) {
      if (item.event_id || committedFree.has(item.id)) continue;
      commitSingleton(db, item);
      created++;
    }
    const heat = recomputeHeat(db, HEAT);
    warnOutstanding("cluster");
    return { consumed, merged, dissolved, singletons: created, ...heat };
  });
  db.close();
  console.log(
    `[cluster] 回填完成: 合并组 ${stats.merged} | 否决组 ${stats.dissolved} | 独立事件 ${stats.singletons} | 热度重算 ${stats.events} 事件`,
  );
} else {
  const stats = await withRun(db, "cluster", async () => {
    const selected = getItemsByStatus(db, "selected", 1000);
    const { groups, singletons } = buildGroups(selected);
    if (groups.length === 0) {
      let created = 0;
      for (const s of singletons) {
        commitSingleton(db, s);
        created++;
      }
      const heat = recomputeHeat(db, HEAT);
      return { groups: 0, tasks: 0, singletons: created, merged: 0, ...heat };
    }

    const promptMd = loadPrompt("cluster-review");

    if (hasGlmKey()) {
      const model = process.env.GLM_MODEL_CLUSTER;
      const inputs = groups.map(toGroupInput);
      const raw = extractJson(await chat(buildPrompt(promptMd, inputs), { model }));
      const outputs = validateCluster(raw, new Set(inputs.map((x) => x.groupId)));
      const byOut = new Map(outputs.map((o) => [o.groupId, o]));
      let merged = 0;
      let newSingles: ItemRow[] = [];
      for (const gp of groups) {
        if (byOut.get(gp.groupId)?.sameEvent) {
          commitGroup(db, gp);
          merged++;
        } else {
          newSingles = newSingles.concat(gp.free);
        }
      }
      for (const s of [...singletons, ...newSingles]) commitSingleton(db, s);
      const heat = recomputeHeat(db, HEAT);
      return { groups: groups.length, tasks: 0, singletons: singletons.length + newSingles.length, merged, ...heat };
    }

    const batchName = new Date().toISOString().replace(/[-:]/g, "").slice(0, 14);
    const batchId = `${batchName}_00`;
    const outputFile = join(handoffDirs.resultsDir, `cluster-${batchId}.json`);
    writeTask(handoffDirs, {
      version: 1,
      stage: "cluster",
      batch: batchId,
      promptFile: "industry/prompts/cluster-review.md",
      prompt: buildPrompt(promptMd, groups.map(toGroupInput)),
      input: groups.map(toGroupInput),
      outputFile,
      agentInstructions: agentInstructions(outputFile, "cluster"),
    });
    return { groups: groups.length, tasks: 1, singletons: singletons.length, merged: 0, events: 0 };
  });
  db.close();
  if ((stats as { tasks?: number }).tasks) {
    console.log(
      `[cluster] 已生成 1 个 handoff 任务（${(stats as { groups?: number }).groups} 个候选组，` +
        `${(stats as { singletons?: number }).singletons} 个独立事件将直接创建）。` +
        `agent 处理后运行: npm run cluster -- --consume`,
    );
  } else {
    console.log(
      `[cluster] 完成: 候选组 ${(stats as { groups?: number }).groups} | 合并 ${(stats as { merged?: number }).merged} | 独立事件 ${(stats as { singletons?: number }).singletons}`,
    );
  }
}
