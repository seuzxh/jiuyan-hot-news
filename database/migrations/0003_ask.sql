-- 关键词问答（问股）：查询结果 + 帖子全文缓存 + 指标埋点
-- 设计依据 docs/关键词问答技术方案.md §3.2

-- 一次查询一行，存完整中间产物（便于复盘调 prompt）
CREATE TABLE IF NOT EXISTS ask_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword TEXT NOT NULL,                 -- 用户原始输入
  keyword_norm TEXT NOT NULL,            -- 归一化（去空白/全角→半角/小写），单飞锁键
  kind TEXT,                             -- 个股 | 概念题材 | 模糊（段①产出）
  status TEXT NOT NULL DEFAULT 'running',-- running | awaiting_handoff | done | empty | failed
  phase TEXT NOT NULL DEFAULT 'intent',  -- intent | crawl | recall | aggregate | detail | answer
  window_start TEXT NOT NULL,            -- (anchor-24h, anchor] 左开右闭，UTC
  window_end TEXT NOT NULL,
  crawl_stats_json TEXT,                 -- 段②a：防抖命中与否 / 板块统计
  intent_json TEXT,                      -- 段①产物
  recall_json TEXT,                      -- 段②b：各路命中数 / 词表瘦身 / 候选 id
  detail_ids_json TEXT,                  -- 段③.5：抓全文的 item id 列表
  result_json TEXT,                      -- 段③④产物（keyPoints/relatedStocks/timeline/conclusion/gaps/rejected）
  error TEXT,
  created_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_ask_results_kw ON ask_results(keyword_norm, created_at DESC);

-- 帖子全文按需缓存（SSR 摘要仅 ~250 字实测不足；抓过一次不再重抓）
CREATE TABLE IF NOT EXISTS item_details (
  item_id TEXT PRIMARY KEY REFERENCES items(id),
  content TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  fetch_error TEXT                       -- 失败也留行，防止反复重抓；NULL=成功
);

-- M3 假设指标埋点（web 现无 analytics 设施，最小自研：/ask 页 click 委托 + POST /api/ask action 落此表）
CREATE TABLE IF NOT EXISTS ask_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ask_id INTEGER NOT NULL REFERENCES ask_results(id),
  type TEXT NOT NULL,                    -- view | source_click | chip_click
  target TEXT,                           -- 点击的 sourceId / chip label；view 为空
  ts TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ask_events_ask ON ask_events(ask_id, type);
