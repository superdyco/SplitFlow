import { describe, expect, it } from "vitest";
import { dauSummary, shortDate } from "@/utils/dauChart";

describe("shortDate", () => {
  it("軸上只放月/日，不補零 —— 30 天的軸塞不下完整日期", () => {
    expect(shortDate("2026-09-11")).toBe("9/11");
    expect(shortDate("2026-10-01")).toBe("10/1");
  });
});

describe("dauSummary", () => {
  it("講出最近一天與期間最高，讀螢幕的人也拿得到重點", () => {
    const points = [
      { date: "2026-09-09", value: 3 },
      { date: "2026-09-10", value: 7 },
      { date: "2026-09-11", value: 5 }
    ];
    expect(dauSummary(points)).toBe("最近一天（9/11）5 人，期間最高 7 人（9/10）");
  });

  it("最近一天沒有資料時，講的是最後一個有資料的日子，不是 0", () => {
    const points = [
      { date: "2026-09-10", value: 4 },
      { date: "2026-09-11", value: null }
    ];
    expect(dauSummary(points)).toBe("最近一天（9/10）4 人，期間最高 4 人（9/10）");
  });

  it("同樣高的日子取最早的那天", () => {
    const points = [
      { date: "2026-09-09", value: 6 },
      { date: "2026-09-10", value: 6 }
    ];
    expect(dauSummary(points)).toContain("期間最高 6 人（9/9）");
  });

  it("整段都沒有資料時直接說沒有，不編一個 0 出來", () => {
    expect(dauSummary([{ date: "2026-09-11", value: null }])).toBe("這段期間沒有活躍人數的資料");
  });
});
