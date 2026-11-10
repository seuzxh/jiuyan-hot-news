/** 时间工具：统一 ISO8601 UTC 存储，展示/分槽按北京时区 */

const BJ_OFFSET_MS = 8 * 3600 * 1000;

/** 解析 "2026-11-07 12:27:08"（北京时间）为 ISO8601 UTC */
export function parseBjDateTime(s: string): string {
  const iso = s.trim().replace(" ", "T") + "+08:00";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) throw new Error(`无法解析北京时间: ${s}`);
  return new Date(t).toISOString();
}

/** 北京日期键 YYYY-MM-DD */
export function bjDateKey(isoUtc: string): string {
  return new Date(Date.parse(isoUtc) + BJ_OFFSET_MS).toISOString().slice(0, 10);
}

/** 北京小时（0-23） */
export function bjHour(isoUtc: string): number {
  return new Date(Date.parse(isoUtc) + BJ_OFFSET_MS).getUTCHours();
}

/** 当前时间对应的推送时段 */
export function currentSlot(isoUtc = new Date().toISOString()): "morning" | "noon" | "evening" {
  const h = bjHour(isoUtc);
  if (h >= 5 && h < 12) return "morning";
  if (h >= 12 && h < 16) return "noon";
  return "evening";
}

/** 两个 ISO 时间差（小时） */
export function hoursBetween(aIso: string, bIso: string): number {
  return Math.abs(Date.parse(aIso) - Date.parse(bIso)) / 3600_000;
}

export function nowIso(): string {
  return new Date().toISOString();
}
