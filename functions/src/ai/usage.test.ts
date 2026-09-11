import { describe, expect, it } from "vitest";
import { statIncrements, sumAiDays } from "./usage.js";

describe("statIncrements", () => {
  it("讀出：calls 與 reads 各 +1，token 照加", () => {
    expect(statIncrements({ readResult: "read", inputTokens: 2400, outputTokens: 80 })).toEqual({
      calls: 1,
      reads: 1,
      inputTokens: 2400,
      outputTokens: 80
    });
  });

  it("失敗：calls 與 failures 各 +1；沒有 token 就不帶那兩個欄位", () => {
    expect(statIncrements({ readResult: "timeout" })).toEqual({ calls: 1, failures: 1 });
  });
});

describe("sumAiDays", () => {
  const keys = ["2026-09-10", "2026-09-11", "2026-09-12"];

  it("只加區間內的天數，缺的欄位當 0", () => {
    const result = sumAiDays(
      [
        { date: "2026-09-09", calls: 99 },
        { date: "2026-09-10", calls: 2, reads: 1, failures: 1, inputTokens: 100, outputTokens: 10 },
        { date: "2026-09-12", calls: 1, reads: 1 }
      ],
      keys
    );
    expect(result).toEqual({
      totals: { calls: 3, reads: 2, failures: 1, inputTokens: 100, outputTokens: 10 },
      recordedDays: 2
    });
  });

  it("一筆都沒有：recordedDays 是 0 —— 畫面要說得出「還沒開始記」", () => {
    expect(sumAiDays([], keys).recordedDays).toBe(0);
  });
});
