/**
 * 效能樣本的形狀，與百分位數的**精確**定義。
 *
 * `perf` 集合從 2026-06 就開始寫了，但規則是 `allow read: if false` —— 三個月
 * 的資料沒有任何人讀得到。這裡是把它變成看得懂的東西的第一步。
 *
 * 畫面上的數字不從這裡來。那條路是 histogram.ts：排程一天把樣本壓成一份
 * 直方圖，畫面讀彙總而不是讀原始樣本，區間才拉得到 90 天。這個檔案留下的
 * 是那條路的**對照組** —— 見 `percentile`。
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

/** 中位數的門檻。樣本少於這個數就不給 —— 三筆算出來的中位數不是統計是巧合。 */
export const MIN_SAMPLES = 5;

/**
 * 從**原始樣本**算百分位數。
 *
 * 用「最近排名」而不是內插：這些是毫秒，而使用者體驗過的是**某一次真實的
 * 載入**，不是兩次載入的加權平均。p95 應該是一個真的發生過的數字。
 *
 * 空陣列回 0。呼叫端本來就要先看 count —— 但回 NaN 的話那個 0 會變成
 * 畫面上的「NaN ms」，而那看起來像壞掉不像沒資料。
 *
 * ## 為什麼還在
 *
 * 沒有任何 callable 呼叫它了。它留下來是因為它是**精確的定義**，而
 * `percentileOf` 從桶算出來的答案必須跟它一致（只差一個桶寬）——
 * histogram.test.ts 裡那條等價性測試拿它當標準答案，而那條測試是「用直方圖
 * 換取更長的區間」這件事唯一的證明。刪掉它，那個證明就沒有對照組了。
 */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}
