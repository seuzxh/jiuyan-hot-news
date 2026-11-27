/** concepts 表仓储：某日的概念逻辑卡（每次 concept 阶段整日重建） */
import type { Db } from "../db.js";
import { nowIso } from "../time.js";

export interface ConceptRow {
  id: string;
  date_key: string;
  rank: number;
  title: string;
  category_id: string;
  category_label: string;
  emoji: string;
  takeaway: string;
  chain_json: string;
  stocks_json: string;
  /** 催化明细 [{when, fact, impact, upcoming, eventId}]（迁移 0005 之前的行默认空数组） */
  catalysts_json: string;
  risk: string | null;
  event_ids_json: string;
  event_count: number;
  heat_total: number;
  updated_at: string;
}

export interface ConceptUpsert {
  id: string;
  dateKey: string;
  rank: number;
  title: string;
  categoryId: string;
  categoryLabel: string;
  emoji: string;
  takeaway: string;
  chainJson: string;
  stocksJson: string;
  catalystsJson: string;
  risk: string;
  eventIdsJson: string;
  eventCount: number;
  heatTotal: number;
}

/** 重建某日全部概念（先删后插） */
export function replaceConceptsForDate(db: Db, dateKey: string, concepts: ConceptUpsert[]): void {
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM concepts WHERE date_key = ?").run(dateKey);
    const ins = db.prepare(
      `INSERT INTO concepts (id, date_key, rank, title, category_id, category_label, emoji, takeaway, chain_json, stocks_json, catalysts_json, risk, event_ids_json, event_count, heat_total, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const ts = nowIso();
    for (const c of concepts) {
      ins.run(
        c.id, c.dateKey, c.rank, c.title, c.categoryId, c.categoryLabel, c.emoji, c.takeaway,
        c.chainJson, c.stocksJson, c.catalystsJson, c.risk, c.eventIdsJson, c.eventCount, c.heatTotal, ts,
      );
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function getConceptsByDate(db: Db, dateKey: string): ConceptRow[] {
  return db.prepare("SELECT * FROM concepts WHERE date_key = ? ORDER BY rank").all(dateKey) as unknown as ConceptRow[];
}
