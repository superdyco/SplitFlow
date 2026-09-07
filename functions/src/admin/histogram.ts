/**
 * 效能樣本的每日直方圖。
 *
 * ## 為什麼不存每天的百分位數
 *
 * 因為**百分位數不能跨天相加**。七天的 p95 不是七個 p95 的平均，也不是它們
 * 的最大值 —— 那兩個數字都不對應任何一次真實的載入。要在任意區間算出正確的
 * 百分位數，唯一的辦法是保留分佈本身。
 *
 * 所以排程一天寫一份直方圖：把當天的樣本丟進 100 毫秒一格的桶裡，只記每桶
 * 幾筆。要看 30 天就把 30 份的桶相加再算 —— 結果跟拿原始的三萬筆去算一樣，
 * 只差一個桶寬。`percentileOf` 的測試就是在證明這件事。
 *
 * ## 為什麼是 100 毫秒等寬，不是等比
 *
 * 等比（每桶是前一桶的 1.1 倍）給的是固定的**相對**誤差，等寬給的是固定的
 * **絕對**誤差。而人對載入時間的感受是絕對的：沒有人在乎 300 還是 350 毫秒，
 * 但 1.9 秒跟 2.4 秒是兩種體感。誤差該固定在對的那個維度上。
 *
 * 純函式：進來一疊數字，出去一份摘要。真正的查詢與寫入在 callable 與排程裡。
 */

import { MIN_SAMPLES, type PerfSample, type PerfSummary } from "./perf.js";

/** 桶寬。改了這個值，舊的文件就要重算 —— 桶號的意思變了。 */
export const BUCKET_MS = 100;

/**
 * 溢位桶的桶號，也就是 60 秒。
 *
 * 60 秒以上的載入不是效能問題是壞掉了 —— 分辨 61 秒跟 400 秒沒有意義，
 * 但把它們算進樣本數有：它們得留在分母裡，不然 p95 會因為丟掉了最慢的
 * 那幾筆而變好看。
 */
export const OVERFLOW = 600;

/** 稀疏的桶：只記有樣本的那幾格。一天大部分的桶都是空的。 */
export type Buckets = Record<string, number>;

/** 一天、一頁的分佈。這就是 Firestore 裡存的形狀。 */
export interface PerfDayPage {
  page: string;
  cold: Buckets;
  warm: Buckets;
  /** 最慢的那一段各出現幾次。 */
  slowest: Record<string, number>;
}

/**
 * 毫秒 → 桶號。
 *
 * 壞掉的數字（負數、NaN）落在第 0 桶而不是噴錯：樣本是前端送上來的，
 * 一筆爛資料不該讓整天的彙總失敗。
 */
export function bucketOf(ms: number): number {
  if (!Number.isFinite(ms) || ms < 0) return 0;
  const index = Math.floor(ms / BUCKET_MS);
  return index >= OVERFLOW ? OVERFLOW : index;
}

/**
 * 桶號 → 這個桶代表的毫秒數。
 *
 * 回**上界**不是下界。桶化一定有誤差，而誤差的方向要選：高估自己的載入時間
 * 是安全的，低估會讓一個真的在變慢的頁面看起來還好。
 *
 * 溢位桶回 60 秒 —— 那是它的下界。落在那裡的百分位數代表「至少 60 秒」，
 * 而如果真的發生了，畫面上顯示 60 還是 400 已經不重要了。
 */
export function bucketCeiling(index: number): number {
  return index >= OVERFLOW ? OVERFLOW * BUCKET_MS : (index + 1) * BUCKET_MS;
}

function bump(into: Record<string, number>, key: string | number, by = 1): void {
  const k = String(key);
  into[k] = (into[k] ?? 0) + by;
}

/** 桶裡總共幾筆樣本。 */
export function samplesIn(buckets: Buckets): number {
  let total = 0;
  for (const count of Object.values(buckets)) total += count;
  return total;
}

/**
 * 一天的樣本 → 每頁一份直方圖。
 *
 * 分頁統計而不是全部混在一起，是因為列表與內頁的讀取量差很多（列表一趟
 * 查詢，內頁一次六趟）—— 混在一起的中位數不描述任何一頁。
 */
export function histogramOf(samples: PerfSample[]): PerfDayPage[] {
  const byPage = new Map<string, PerfDayPage>();

  for (const sample of samples) {
    let day = byPage.get(sample.page);
    if (!day) {
      day = { page: sample.page, cold: {}, warm: {}, slowest: {} };
      byPage.set(sample.page, day);
    }
    bump(sample.cold ? day.cold : day.warm, bucketOf(sample.total));
    // 沒分段的樣本 slowest 是空字串。那不是一個階段的名字，不該變成一類。
    if (sample.slowest) bump(day.slowest, sample.slowest);
  }

  return [...byPage.values()];
}

function mergeInto(target: Record<string, number>, source: Record<string, number>): void {
  for (const [key, count] of Object.entries(source)) bump(target, key, count);
}

/**
 * 跨天合併。
 *
 * 這是「更長的區間」真正發生的地方 —— 把 N 天的桶相加，就得到那 N 天的
 * 完整分佈，然後才算百分位數。順序不影響結果。
 */
export function mergeDays(days: PerfDayPage[]): PerfDayPage[] {
  const byPage = new Map<string, PerfDayPage>();

  for (const day of days) {
    let into = byPage.get(day.page);
    if (!into) {
      into = { page: day.page, cold: {}, warm: {}, slowest: {} };
      byPage.set(day.page, into);
    }
    mergeInto(into.cold, day.cold);
    mergeInto(into.warm, day.warm);
    mergeInto(into.slowest, day.slowest);
  }

  return [...byPage.values()];
}

/**
 * 從桶算百分位數。
 *
 * 用的是跟 `percentile` 一模一樣的「最近排名」定義 —— 第 `ceil(p/100 × n)`
 * 筆落在哪個桶，答案就是那個桶。兩邊的排名公式一致，是「桶算出來的跟原始
 * 樣本算出來的只差一個桶寬」能成立的原因。
 *
 * 空的回 0：呼叫端本來就要先看 count，但回 NaN 的話畫面上會出現「NaN 秒」，
 * 而那看起來像壞掉不像沒資料。
 */
export function percentileOf(buckets: Buckets, p: number): number {
  const total = samplesIn(buckets);
  if (total === 0) return 0;

  const rank = Math.max(1, Math.ceil((p / 100) * total));
  const indexes = Object.keys(buckets)
    .map(Number)
    .sort((a, b) => a - b);

  let seen = 0;
  for (const index of indexes) {
    seen += buckets[String(index)];
    if (seen >= rank) return bucketCeiling(index);
  }

  return bucketCeiling(indexes[indexes.length - 1]);
}

function medianOf(buckets: Buckets): number | null {
  // 五筆以下算出來的中位數不是統計是巧合，而畫面上的數字看起來一樣確定。
  return samplesIn(buckets) < MIN_SAMPLES ? null : percentileOf(buckets, 50);
}

/**
 * 合併過的直方圖 → 畫面要的摘要。
 *
 * 回的是跟 `summarize` 同一個 `PerfSummary`，所以前端不必知道數字是從原始
 * 樣本還是從彙總來的 —— 那是後端的實作細節，不是使用者要理解的事。
 */
export function summarizeDays(days: PerfDayPage[]): PerfSummary[] {
  return mergeDays(days)
    .map(day => {
      const all: Buckets = {};
      mergeInto(all, day.cold);
      mergeInto(all, day.warm);

      return {
        page: day.page,
        count: samplesIn(all),
        p50: percentileOf(all, 50),
        p75: percentileOf(all, 75),
        p95: percentileOf(all, 95),
        coldP50: medianOf(day.cold),
        warmP50: medianOf(day.warm),
        coldCount: samplesIn(day.cold),
        slowest: Object.entries(day.slowest)
          .map(([phase, count]) => ({ phase, count }))
          .sort((a, b) => b.count - a.count)
      };
    })
    .sort((a, b) => b.count - a.count);
}

/**
 * 直方圖的版本。**改了桶寬或桶數就要加一。**
 *
 * 桶號的意思會跟著桶寬變 —— 沒有這個欄位，一份用 100 毫秒算的文件跟一份用
 * 50 毫秒算的文件會被若無其事地加在一起，而結果不會噴錯，只是錯的。
 */
export const PERF_VERSION = 1;

/** 一天一份，存在 `stats/perf/days/{YYYY-MM-DD}`。 */
export interface PerfDoc {
  date: string;
  pages: PerfDayPage[];
  computedAt: Date;
  version: number;
}

export function perfDoc(date: string, pages: PerfDayPage[], computedAt: Date): PerfDoc {
  return { date, pages, computedAt, version: PERF_VERSION };
}

/**
 * 區間裡沒有文件的那幾天。
 *
 * 排程會失敗，而少了一天的後果是「近 30 天的 p95」默默變成「近 29 天的」——
 * 一個看起來完全正常、只是不是你以為的那個區間的數字。畫面拿到這個不是
 * 空陣列時要說一句「資料不完整」。
 */
export function missingDays(docs: PerfDoc[], keys: string[]): string[] {
  const have = new Set(docs.map(doc => doc.date));
  return keys.filter(key => !have.has(key));
}
