/** SQLite 存储层：node:sqlite（Node >= 22.13 内置，无原生编译依赖） */
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export type Db = DatabaseSync;

export interface Row {
  [key: string]: unknown;
}

/** 打开数据库并执行未应用的迁移（database/migrations/*.sql 按文件名序） */
export function openDb(dbPath: string, migrationsDir: string): Db {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  migrate(db, migrationsDir);
  return db;
}

function migrate(db: Db, dir: string): void {
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
  const appliedRows = db.prepare("SELECT name FROM _migrations").all() as Array<{ name: string }>;
  const applied = new Set(appliedRows.map((r) => r.name));
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = readFileSync(join(dir, f), "utf8");
    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.prepare("INSERT INTO _migrations (name, applied_at) VALUES (?, ?)").run(f, new Date().toISOString());
      db.exec("COMMIT");
      console.log(`[db] 已应用迁移 ${f}`);
    } catch (e) {
      db.exec("ROLLBACK");
      throw new Error(`迁移 ${f} 失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

/** 默认路径（假定从仓库根目录运行） */
export function defaultDbPath(root = process.cwd()): string {
  return join(root, "data", "jycgs.db");
}

export function defaultMigrationsDir(root = process.cwd()): string {
  return join(root, "database", "migrations");
}

/** 从 start 向上找仓库根（含 database/migrations 的目录），供 cwd 不在根部的场景（如 web dev server） */
export function findRepoRoot(start = process.cwd()): string {
  let dir = resolve(start);
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "database", "migrations"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}
