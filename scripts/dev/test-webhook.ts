/** 开发工具：向当前 webhook 发送 UTF-8 测试消息（验证连接与编码） */
import { createHmac } from "node:crypto";
import { requireEnv } from "@jyc/core";

const webhook = requireEnv("FEISHU_WEBHOOK_URL");
const secret = process.env.FEISHU_SECRET;

const body: Record<string, unknown> = {
  msg_type: "text",
  content: {
    text: "✅ 韭研热点管线 webhook 测试（UTF-8 编码）\n连接正常，后续每日 08:00 / 12:00 / 20:00 自动推送分类汇总卡片。\n如本条中文正常显示即配置成功。",
  },
};
if (secret) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  body.timestamp = timestamp;
  body.sign = createHmac("sha256", `${timestamp}\n${secret}`).update("").digest("base64");
}

const res = await fetch(webhook, {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify(body),
});
console.log(await res.text());
