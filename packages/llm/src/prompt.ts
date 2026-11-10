/** 提示词加载：industry/prompts/*.md（know-how 外置） */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export function loadPrompt(name: string, root = process.cwd()): string {
  return readFileSync(join(root, "industry", "prompts", `${name}.md`), "utf8");
}

/** 拼装完整提示词：说明 + 输入数据（紧凑 JSON 行） */
export function buildPrompt(promptMd: string, inputs: unknown[]): string {
  const lines = inputs.map((x, i) => `${i + 1}. ${JSON.stringify(x)}`).join("\n");
  return `${promptMd}\n\n===== 待处理条目（共 ${inputs.length} 条）=====\n${lines}\n`;
}
