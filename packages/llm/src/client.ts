/** GLM API 客户端（智谱 OpenAI 兼容接口） */
import { optEnv } from "@jyc/core";

export class GlmKeyMissingError extends Error {
  constructor() {
    super("未设置 GLM_API_KEY（当前处于 agent-handoff 模式）");
  }
}

export interface ChatOptions {
  model?: string;
}

/** 单轮对话，返回文本（key/baseUrl 走环境变量） */
export async function chat(prompt: string, opts: ChatOptions = {}): Promise<string> {
  const apiKey = optEnv("GLM_API_KEY");
  if (!apiKey) throw new GlmKeyMissingError();
  const baseUrl = (optEnv("GLM_BASE_URL") ?? "https://open.bigmodel.cn/api/paas/v4").replace(/\/$/, "");
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: opts.model ?? "glm-4-flash",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 4096,
    }),
  });
  if (!res.ok) {
    throw new Error(`GLM API HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error(`GLM API 返回空内容: ${JSON.stringify(data).slice(0, 300)}`);
  return content;
}

/** 从模型输出中提取 JSON（容忍 ```json 围栏与前后废话） */
export function extractJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced?.[1] ?? text;
  const start = Math.min(
    ...[raw.indexOf("["), raw.indexOf("{")].filter((i) => i >= 0).concat([Number.POSITIVE_INFINITY]),
  );
  if (!Number.isFinite(start)) throw new Error(`输出中未找到 JSON: ${text.slice(0, 200)}`);
  const end = Math.max(raw.lastIndexOf("]"), raw.lastIndexOf("}"));
  try {
    return JSON.parse(raw.slice(start, end + 1)) as T;
  } catch (e) {
    throw new Error(`JSON 解析失败: ${e instanceof Error ? e.message : String(e)}；原文片段: ${raw.slice(start, start + 200)}`);
  }
}
