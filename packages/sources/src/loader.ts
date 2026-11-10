/** industry/sources.json 加载与适配器工厂 */
import { readFileSync } from "node:fs";
import type { SourceAdapter } from "./types.js";
import { createJiuYanGongSheAdapter, type JycBoardConfig } from "./jiuyangongshe/adapter.js";

export interface SourceConfigEntry {
  id: string;
  name: string;
  kind: string;
  enabled: boolean;
  config: JycBoardConfig & {
    requestIntervalMs?: [number, number];
    maxRetries?: number;
  };
}

export function loadSourcesConfig(path: string): SourceConfigEntry[] {
  const raw = JSON.parse(readFileSync(path, "utf8")) as { sources: SourceConfigEntry[] };
  if (!Array.isArray(raw.sources)) throw new Error(`sources.json 格式错误: ${path}`);
  return raw.sources;
}

/** 按 id 分发到具体适配器；新增信源在此注册 */
export function createAdapter(entry: SourceConfigEntry): SourceAdapter {
  switch (entry.id) {
    case "jiuyangongshe":
      return createJiuYanGongSheAdapter({
        baseUrl: entry.config.baseUrl,
        boards: entry.config.boards,
      });
    default:
      throw new Error(`未知信源: ${entry.id}（需在 loader.ts 注册适配器）`);
  }
}
