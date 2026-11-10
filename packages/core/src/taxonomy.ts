/**
 * 展示分类体系（know-how 配置：调整分类口径改这里）。
 * 分类优先级：概念关键词 > 驱动类型 > 行业 > 其他。
 */

export interface Category {
  id: string;
  label: string;
  emoji: string;
  /** 概念关键词（包含匹配，命中即归入） */
  conceptKeywords: string[];
  /** 驱动类型精确匹配 */
  drivers: string[];
  /** 行业精确匹配（兜底） */
  industries: string[];
}

export const CATEGORIES: Category[] = [
  {
    id: "ai",
    label: "AI·算力·半导体",
    emoji: "🤖",
    conceptKeywords: ["AI", "算力", "芯片", "半导体", "CPO", "端侧", "国产替代", "AppLovin", "存储", "数据中心", "光模块"],
    drivers: [],
    industries: ["电子", "计算机"],
  },
  {
    id: "robot",
    label: "机器人·智能制造",
    emoji: "🦾",
    conceptKeywords: ["机器人", "Optimus", "物理AI", "人形", "智能工厂", "具身"],
    drivers: [],
    industries: ["机械"],
  },
  {
    id: "space",
    label: "商业航天·卫星",
    emoji: "🛰️",
    conceptKeywords: ["商业航天", "卫星", "星链", "SpaceX", "长征", "火箭", "ATP", "组网", "太空"],
    drivers: [],
    industries: ["国防军工"],
  },
  {
    id: "pharma",
    label: "医药·生物",
    emoji: "🧪",
    conceptKeywords: ["创新药", "细胞治疗", "iPSC", "中医药", "中药", "流感", "疫苗", "CXO", "帕金森", "医疗器械", "临床"],
    drivers: [],
    industries: ["医药"],
  },
  {
    id: "media",
    label: "传媒·短剧",
    emoji: "🎬",
    conceptKeywords: ["短剧", "漫剧", "IP改编", "IP运营", "IP储备", "影视", "游戏", "互动影游"],
    drivers: [],
    industries: ["传媒"],
  },
  {
    id: "energy",
    label: "新能源·电力",
    emoji: "⚡",
    conceptKeywords: ["光伏", "储能", "风电", "锂电", "反内卷", "绿电", "算电", "电网", "虚拟电厂", "寒潮", "供暖", "采暖", "取暖", "燃气", "煤炭", "热泵", "冰雪", "雪场"],
    drivers: [],
    industries: ["电力设备", "环保", "化工", "煤炭", "公用事业"],
  },
  {
    id: "sentiment",
    label: "情绪·复盘",
    emoji: "📊",
    conceptKeywords: ["复盘", "连板", "情绪", "涨停", "梯队", "温度计", "轮动", "东方系", "玄学"],
    drivers: ["情绪周期"],
    industries: [],
  },
  {
    id: "stock",
    label: "个股·公告",
    emoji: "📌",
    conceptKeywords: ["回购", "公告", "并购", "重组", "订单", "中标", "业绩"],
    drivers: ["业绩", "重组", "订单"],
    industries: [],
  },
  {
    id: "macro",
    label: "政策·宏观·资金",
    emoji: "🏛️",
    conceptKeywords: ["央行", "SFISF", "财政", "美联储", "加息", "降息", "国债", "金融政策"],
    drivers: ["政策", "资金"],
    industries: ["非银金融", "银行"],
  },
  {
    id: "other",
    label: "其他",
    emoji: "🗂️",
    conceptKeywords: [],
    drivers: [],
    industries: [],
  },
];

export interface ClassifiableEvent {
  tags: string[];
  repIndustry?: string | null;
  repDriver?: string | null;
}

/**
 * 单事件分类：概念关键词计分（命中数 × 关键词长度，越长越具体权重越高，
 * 避免"物理AI"因包含"AI"被误归 AI 类），无命中再按驱动 → 行业兜底。
 */
export function classifyEvent(e: ClassifiableEvent): Category {
  const tags = e.tags.map((t) => t.toLowerCase());
  let best: { cat: Category; score: number } | null = null;
  for (const cat of CATEGORIES) {
    if (cat.id === "other") continue;
    let score = 0;
    for (const kw of cat.conceptKeywords) {
      const k = kw.toLowerCase();
      if (tags.some((t) => t.includes(k))) score += k.length;
    }
    if (score > 0 && (!best || score > best.score)) best = { cat, score };
  }
  if (best) return best.cat;
  if (e.repDriver) {
    for (const cat of CATEGORIES) {
      if (cat.drivers.includes(e.repDriver)) return cat;
    }
  }
  if (e.repIndustry) {
    for (const cat of CATEGORIES) {
      if (cat.industries.includes(e.repIndustry)) return cat;
    }
  }
  return CATEGORIES[CATEGORIES.length - 1]!;
}

/** 按分类分组（保持事件传入顺序；空分类不出现；「其他」恒排最后） */
export function groupByCategory<T extends ClassifiableEvent>(events: T[]): Array<{ category: Category; events: T[] }> {
  const buckets = new Map<string, T[]>();
  for (const e of events) {
    const cat = classifyEvent(e);
    const list = buckets.get(cat.id) ?? [];
    list.push(e);
    buckets.set(cat.id, list);
  }
  const groups = CATEGORIES.filter((c) => buckets.has(c.id)).map((c) => ({
    category: c,
    events: buckets.get(c.id)!,
  }));
  // 「其他」移到最后
  const other = groups.find((g) => g.category.id === "other");
  if (other) {
    return [...groups.filter((g) => g.category.id !== "other"), other];
  }
  return groups;
}
