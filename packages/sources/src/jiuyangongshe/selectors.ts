/**
 * 韭研公社 CSS 选择器集中定义（2026-11 验证于 Nuxt2 SSR 页面）。
 * 站点改版导致解析失败时，先跑 `npx tsx scripts/dev/inspect-fixture.ts` 重新探结构，
 * 更新此处与 __fixtures__ 快照。
 */
export const SELECTORS = {
  /** 帖子条目容器 */
  postRow: "div.row.straight-line",
  /** 帖子正文摘要链接（href = /a/{id}） */
  postLink: 'a[href^="/a/"]',
  /** 标题 */
  title: ".book-title",
  /** 正文摘要 */
  excerpt: ".html-text",
  /** 作者名 */
  authorName: ".fs16-bold",
  /** 作者徽章（机构/游资/公社达人等） */
  authorBadge: ".style-tag",
  /** 发布时间（绝对时间文本 "YYYY-MM-DD HH:mm:ss" 北京时间） */
  time: ".fs13-ash",
  /** 关联股票标签 */
  stockTag: ".source .text",
  /** 互动按钮组 */
  handle: ".handle",
  /** 互动图标类型（forward=转发 reply=评论 fabulous=点赞） */
  handleIcon: "i.icon",
} as const;

/** 互动图标类名 → 指标名 */
export const ICON_TO_METRIC = {
  forward: "forward",
  reply: "reply",
  fabulous: "like",
} as const;

/** 徽章 → 作者分级：机构/游资/达人视作准官方级（T1_5），其余普通用户（T2） */
const T15_BADGE = /(机构|游资|达人|大神|长老|圈主)/;

export function tierFromBadge(badge: string | undefined): "T1_5" | "T2" {
  if (!badge) return "T2";
  return T15_BADGE.test(badge) ? "T1_5" : "T2";
}
