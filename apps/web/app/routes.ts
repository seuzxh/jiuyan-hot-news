import { type RouteConfig, index, route } from "@react-router/dev/routes";

// JYC_PUBLIC_SITE=1 时构建公网展示站：剔除 /ask 与 /api/ask（会触发爬虫与 LLM 任务，不适合托管站点）
const publicSite = process.env.JYC_PUBLIC_SITE === "1";

export default [
  index("routes/home.tsx"),
  route("hot", "routes/hot.tsx"),
  route("story/:id", "routes/story.$id.tsx"),
  route("search", "routes/search.tsx"),
  ...(publicSite ? [] : [route("ask", "routes/ask.tsx"), route("api/ask", "routes/api.ask.ts")]),
  route("report", "routes/report.tsx"),
  // 逻辑线详情页：逐条催化 + 全部相关标的（卡片与日报行点进来）
  route("concept/:id", "routes/concept.$id.tsx"),
  route("architecture", "routes/docs.tsx"),
] satisfies RouteConfig;
