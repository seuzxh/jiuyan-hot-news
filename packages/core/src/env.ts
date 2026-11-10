/** 环境变量：.env 加载与类型化读取 */
import { config } from "dotenv";

let loaded = false;

export function loadEnv(): void {
  if (loaded) return;
  config();
  loaded = true;
}

export function requireEnv(name: string): string {
  loadEnv();
  const v = process.env[name];
  if (!v) throw new Error(`缺少环境变量 ${name}（见 .env.example）`);
  return v;
}

export function optEnv(name: string): string | undefined {
  loadEnv();
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}
