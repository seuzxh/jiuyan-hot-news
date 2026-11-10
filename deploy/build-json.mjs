// 部署脚本共用的 JSON 体构造器：输出纯 ASCII（非 ASCII 全部 \uXXXX 转义），规避任何环节的 GBK/编码破坏。
// 用法：
//   node deploy/build-json.mjs agent   → 读 agent-system.md + .github-token，写 .tmp/agent-body.json
//   node deploy/build-json.mjs events <taskFile> → 读任务文本文件，写 .tmp/events-body.json
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tmp = join(root, "deploy", ".tmp");
mkdirSync(tmp, { recursive: true });

/** 非 ASCII 全部转 \uXXXX，产出纯 ASCII JSON 文本 */
const asciiJson = (obj) =>
  JSON.stringify(obj).replace(/[\u007f-\uffff]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));

const mode = process.argv[2];
if (mode === "agent") {
  const gtoken = readFileSync(join(root, "deploy", ".github-token"), "utf8").trim();
  const system =
    readFileSync(join(root, "deploy", "agent-system.md"), "utf8") +
    `\n\n## Git 访问令牌（PAT，仅本仓库 contents 读写）\n` +
    `拼入克隆 URL 使用：https://x-access-token:${gtoken}@github.com/seuzxh/jiuyan-hot-news.git\n` +
    `⚠️ 绝不在任何输出、日志、汇报、代码中回显此令牌。\n`;
  writeFileSync(
    join(tmp, "agent-body.json"),
    asciiJson({ name: "jyc-hot-news-pipeline", model: "glm-5.3-flash", system, tools: [{ type: "agent_toolset_20260601" }] }),
  );
  console.log(`agent-body.json ok, system ${system.length} chars`);
} else if (mode === "events") {
  const text = readFileSync(process.argv[3], "utf8");
  writeFileSync(
    join(tmp, "events-body.json"),
    asciiJson({ events: [{ type: "user.message", content: [{ type: "text", text }] }] }),
  );
  console.log(`events-body.json ok, task ${text.length} chars`);
} else {
  console.error("usage: node deploy/build-json.mjs agent | events <taskFile>");
  process.exit(1);
}
