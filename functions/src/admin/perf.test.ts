import { describe, expect, it } from "vitest";
import { MIN_SAMPLES, percentile, summarize, type PerfSample } from "./perf.js";

function sample(overrides: Partial<PerfSample> = {}): PerfSample {
  return { page: "tasks", total: 1000, slowest: "query", cold: false, ...overrides };
}

describe("percentile", () => {
  const sorted = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];

  it("p50 是中間那個", () => {
    expect(percentile(sorted, 50)).toBe(500);
  });

  it("p95 是接近最大的那個", () => {
    expect(percentile(sorted, 95)).toBe(1000);
  });

  /*
    用最近排名而不是內插：這些是毫秒，而使用者體驗過的是某一次真實的載入，
    不是兩次載入的加權平均。p95 應該是一個真的發生過的數字。
  */
  it("回傳的一定是樣本裡真的出現過的值", () => {
    for (const p of [10, 25, 50, 75, 90, 95, 99]) {
      expect(sorted).toContain(percentile(sorted, p));
    }
  });

  it("只有一筆的時候不管問幾趴都是它", () => {
    expect(percentile([42], 95)).toBe(42);
  });

  // 回 NaN 的話畫面上會出現「NaN ms」，那看起來像壞掉不像沒資料。
  it("空的回 0 不是 NaN", () => {
    expect(percentile([], 50)).toBe(0);
  });
});

describe("summarize", () => {
  /*
    分頁統計而不是全部混在一起：列表一趟查詢、內頁一次六趟，兩者的讀取量
    差很多 —— 混在一起的中位數不描述任何一頁。
  */
  it("每一頁各自算，照樣本數由多到少", () => {
    const result = summarize([
      ...Array.from({ length: 3 }, () => sample({ page: "task" })),
      ...Array.from({ length: 5 }, () => sample({ page: "tasks" }))
    ]);
    expect(result.map(r => r.page)).toEqual(["tasks", "task"]);
    expect(result[0].count).toBe(5);
  });

  it("冷熱各自算中位數", () => {
    const result = summarize([
      ...Array.from({ length: 5 }, () => sample({ cold: true, total: 3000 })),
      ...Array.from({ length: 5 }, () => sample({ cold: false, total: 600 }))
    ]);
    expect(result[0].coldP50).toBe(3000);
    expect(result[0].warmP50).toBe(600);
    expect(result[0].coldCount).toBe(5);
  });

  /*
    三筆算出來的中位數不是統計是巧合。給 null 讓畫面說「樣本不足」，
    而不是給一個看起來很確定的數字。
  */
  it("樣本少於門檻就不給中位數", () => {
    const result = summarize(
      Array.from({ length: MIN_SAMPLES - 1 }, () => sample({ cold: true, total: 3000 }))
    );
    expect(result[0].coldP50).toBeNull();
    // 但總數與 p50 照算 —— 那是「這段期間發生了什麼」，不是統計推論。
    expect(result[0].count).toBe(MIN_SAMPLES - 1);
    expect(result[0].p50).toBe(3000);
  });

  it("最慢的那一段照次數排", () => {
    const result = summarize([
      sample({ slowest: "query" }),
      sample({ slowest: "query" }),
      sample({ slowest: "auth" })
    ]);
    expect(result[0].slowest).toEqual([
      { phase: "query", count: 2 },
      { phase: "auth", count: 1 }
    ]);
  });

  it("沒有分段的樣本不會變成一個空字串分類", () => {
    const result = summarize([sample({ slowest: "" }), sample({ slowest: "query" })]);
    expect(result[0].slowest).toEqual([{ phase: "query", count: 1 }]);
  });

  it("完全沒有樣本就是空陣列", () => {
    expect(summarize([])).toEqual([]);
  });
});
