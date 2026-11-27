-- 概念详情：催化明细，供站点逻辑线详情页展示。
-- 每条 = {when, fact, impact, upcoming, eventId}：时间 / 提炼后的事实 / 对逻辑链的影响 / 是否预期时点 / 出处帖。
-- chain 讲"怎么传导"，catalysts 讲"发生了什么、什么时候、数字多少"；旧行默认空数组（详情页回退到因果链）。
ALTER TABLE concepts ADD COLUMN catalysts_json TEXT NOT NULL DEFAULT '[]';
