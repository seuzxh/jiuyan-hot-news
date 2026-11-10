/** 开发工具：清空事件与归属（保留 items 打分结果），用于重跑聚簇 */
import { openDb, defaultDbPath, defaultMigrationsDir } from "@jyc/core";

const db = openDb(defaultDbPath(), defaultMigrationsDir());
db.exec("DELETE FROM event_members");
db.exec("DELETE FROM events");
db.exec("UPDATE items SET event_id = NULL WHERE event_id IS NOT NULL");
const n = (db.prepare("SELECT COUNT(*) n FROM items WHERE event_id IS NOT NULL").get() as { n: number }).n;
db.close();
console.log(`[reset-events] 已清空 events/event_members/item.event_id（残留归属 ${n} 条，应为 0）`);
