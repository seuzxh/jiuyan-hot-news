import type { MetaFunction } from "react-router";
import { marked } from "marked";
// 构建期内联仓库 docs/architecture.md 原文（?raw 由 Vite 处理，随 bundle 发布，云端无需携带 docs/ 目录）
import architectureMd from "../../../../docs/architecture.md?raw";

export const meta: MetaFunction = () => [
  { title: "架构文档 · 韭研热点" },
  { name: "description", content: "韭研热点聚合系统架构：分层去噪、七阶段管线、LLM 双模式" },
];

export default function DocsPage() {
  const html = marked.parse(architectureMd, { async: false });
  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex items-baseline justify-between">
        <h1 className="text-lg font-bold">架构文档</h1>
        <span className="text-xs text-zinc-400">源文件 docs/architecture.md · 随站点构建更新</span>
      </div>
      {/* marked 输出受限于仓库内文档原文；样式见 app.css 的 .md 命名空间 */}
      <article className="md" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
