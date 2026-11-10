-- 初始 schema（SQLite 写法，保持 Postgres 兼容：ISO8601 TEXT 时间戳、TEXT 主键）
-- 迁移到 Postgres 时仅需整体替换驱动层，DDL 语义一致

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_crawl_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,                    -- '{sourceId}:{extId}'
  source_id TEXT NOT NULL REFERENCES sources(id),
  ext_id TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  excerpt TEXT NOT NULL DEFAULT '',
  author_name TEXT NOT NULL DEFAULT '',
  author_url TEXT,
  author_badge TEXT,
  author_tier TEXT NOT NULL DEFAULT 'T2', -- T1_5 | T2
  published_at TEXT NOT NULL,             -- ISO8601 UTC
  stocks_json TEXT NOT NULL DEFAULT '[]',
  metrics_json TEXT NOT NULL DEFAULT '{}',
  boards_json TEXT NOT NULL DEFAULT '[]',
  like_count INTEGER NOT NULL DEFAULT 0,  -- 冗余列，便于排序与热度
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  crawl_count INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'new',     -- new|candidate|scored|selected|rejected|archived_old|blocked
  prefilter_reason TEXT,
  score1 REAL,
  score2 REAL,
  score_avg REAL,
  tags_json TEXT,                          -- LLM 结构化：行业/概念/驱动类型
  event_id TEXT,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_items_url ON items(url);
CREATE INDEX IF NOT EXISTS idx_items_published ON items(published_at);
CREATE INDEX IF NOT EXISTS idx_items_status ON items(status);
CREATE INDEX IF NOT EXISTS idx_items_event ON items(event_id);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT,
  reason TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  stocks_json TEXT NOT NULL DEFAULT '[]',
  heat REAL NOT NULL DEFAULT 0,
  prev_heat REAL NOT NULL DEFAULT 0,
  member_count INTEGER NOT NULL DEFAULT 0,
  first_item_at TEXT,
  last_item_at TEXT,
  pushed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_heat ON events(heat);
CREATE INDEX IF NOT EXISTS idx_events_first_item ON events(first_item_at);

CREATE TABLE IF NOT EXISTS event_members (
  event_id TEXT NOT NULL REFERENCES events(id),
  item_id TEXT NOT NULL REFERENCES items(id),
  role TEXT NOT NULL DEFAULT 'member',    -- representative | member
  PRIMARY KEY (event_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_event_members_item ON event_members(item_id);

CREATE TABLE IF NOT EXISTS pushes (
  id TEXT PRIMARY KEY,
  slot TEXT NOT NULL,                     -- morning | noon | evening
  event_ids_json TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  sent_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stage TEXT NOT NULL,
  status TEXT NOT NULL,                   -- running | success | failed
  stats_json TEXT,
  error TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_runs_stage ON runs(stage, started_at);
