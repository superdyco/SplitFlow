import { describe, expect, it } from "vitest";
import { percentile } from "./perf.js";

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
