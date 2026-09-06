/**
 * 效能樣本的統計。
 *
 * `perf` 集合從 2026-06 就開始寫了，但規則是 `allow read: if false` —— 三個月
 * 的資料沒有任何人讀得到。這裡是把它變成看得懂的東西的那一半。
 *
 * 純函式：進來一疊數字，出去一份摘要。真正的查詢在 callable 裡。
 */

/** 一筆樣本裡這裡用得到的部分。 */
export interface PerfSample {
  page: string;
  total: number;
  /** 最慢的那一段的名字。空字串代表沒分段。 */
  slowest: string;
  /** 是不是這個文件第一次進這一頁。 */
  cold: boolean;
}

export interface PerfSummary {
  page: string;
  count: number;
  p50: number;
  p75: number;
  p95: number;
  /** 冷啟動與熱啟動各自的中位數。樣本不足時是 null。 */
  coldP50: number | null;
  warmP50: number | null;
  coldCount: number;
  /** 最慢的那一段各出現幾次，由多到少。 */
  slowest: Array<{ phase: string; count: number }>;
}

/**
 * 百分位數。
 *
 * 用「最近排名」而不是內插：這些是毫秒，而使用者體驗過的是**某一次真實的
 * 載入**，不是兩次載入的加權平均。p95 應該是一個真的發生過的數字。
 *
 * 空陣列回 0。呼叫端本來就要先看 count —— 但回 NaN 的話那個 0 會變成
 * 畫面上的「NaN ms」，而那看起來像壞掉不像沒資料。
 */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

/** 中位數。樣本少於這個數就不給 —— 三筆算出來的中位數不是統計是巧合。 */
export const MIN_SAMPLES = 5;

function medianOf(values: number[]): number | null {
  if (values.length < MIN_SAMPLES) return null;
  return percentile([...values].sort((a, b) => a - b), 50);
}

/**
 * 一疊樣本 → 每一頁一份摘要。
 *
 * 分頁統計而不是全部混在一起，是因為列表與內頁的讀取量差很多（列表一趟
 * 查詢，內頁一次六趟）—— 混在一起的中位數不描述任何一頁。
 */
export function summarize(samples: PerfSample[]): PerfSummary[] {
  const byPage = new Map<string, PerfSample[]>();
  for (const sample of samples) {
    const list = byPage.get(sample.page);
    if (list) list.push(sample);
    else byPage.set(sample.page, [sample]);
  }

  return [...byPage.entries()]
    .map(([page, list]) => {
      const totals = list.map(s => s.total).sort((a, b) => a - b);
      const cold = list.filter(s => s.cold).map(s => s.total);
      const warm = list.filter(s => !s.cold).map(s => s.total);

      const slowest = new Map<string, number>();
      for (const sample of list) {
        if (!sample.slowest) continue;
        slowest.set(sample.slowest, (slowest.get(sample.slowest) ?? 0) + 1);
      }

      return {
        page,
        count: list.length,
        p50: percentile(totals, 50),
        p75: percentile(totals, 75),
        p95: percentile(totals, 95),
        coldP50: medianOf(cold),
        warmP50: medianOf(warm),
        coldCount: cold.length,
        slowest: [...slowest.entries()]
          .map(([phase, count]) => ({ phase, count }))
          .sort((a, b) => b.count - a.count)
      };
    })
    .sort((a, b) => b.count - a.count);
}
