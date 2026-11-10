/** themes 表仓储：当日题材（每次 theme 阶段重建） */
import type { Db } from "../db.js";
import { nowIso } from "../time.js";

export interface ThemeRow {
  id: string;
  date_key: string;
  category_id: string;
  category_label: string;
  emoji: string;
  logic: string | null;
  top_stocks_json: string;
  event_ids_json: string;
  event_count: number;
  heat_total: number;
  updated_at: string;
}

export interface ThemeUpsert {
  id: string;
  dateKey: string;
  categoryId: string;
  categoryLabel: string;
  emoji: string;
  topStocksJson: string;
  eventIdsJson: string;
  eventCount: number;
  heatTotal: number;
}

/** 重建某日全部题材（先删后插，logic 由 consume 阶段补写） */
export function rebuildThemesForDate(db: Db, dateKey: string, themes: ThemeUpsert[]): void {
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM themes WHERE date_key = ?").run(dateKey);
    const ins = db.prepare(
      `INSERT INTO themes (id, date_key, category_id, category_label, emoji, top_stocks_json, event_ids_json, event_count, heat_total, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const t of themes) {
      ins.run(t.id, t.dateKey, t.categoryId, t.categoryLabel, t.emoji, t.topStocksJson, t.eventIdsJson, t.eventCount, t.heatTotal, nowIso());
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function setThemeLogic(db: Db, themeId: string, logic: string): void {
  db.prepare("UPDATE themes SET logic = ?, updated_at = ? WHERE id = ?").run(logic, nowIso(), themeId);
}

export function getThemesByDate(db: Db, dateKey: string): ThemeRow[] {
  return db
    .prepare("SELECT * FROM themes WHERE date_key = ? ORDER BY heat_total DESC")
    .all(dateKey) as unknown as ThemeRow[];
}
