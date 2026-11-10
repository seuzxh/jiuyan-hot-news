/** 礼貌抓取：浏览器 UA、随机间隔、指数退避 */
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function randomInterval(rangeMs: [number, number]): number {
  return rangeMs[0] + Math.floor(Math.random() * (rangeMs[1] - rangeMs[0]));
}

/** GET 一个板块页，失败按 5s/15s/45s 退避重试 */
export async function fetchPage(url: string, opts: { maxRetries: number }): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    if (attempt > 0) await sleep(5000 * 3 ** (attempt - 1));
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": UA,
          Referer: "https://www.jiuyangongshe.com/",
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "zh-CN,zh;q=0.9",
        },
        redirect: "follow",
      });
      if (!res.ok) throw new HttpError(`HTTP ${res.status} ${url}`, res.status);
      return await res.text();
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
