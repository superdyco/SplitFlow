import { describe, expect, it } from "vitest";
import { favoriteId, toFavoriteInput } from "../src/utils/favorites";

describe("favoriteId", () => {
  it("同一份報告永遠算出同一個 id —— 按兩次收藏不會變成兩筆", () => {
    expect(favoriteId("task1", "report1")).toBe(favoriteId("task1", "report1"));
  });

  it("不同的報告不會撞在一起", () => {
    expect(favoriteId("task1", "report1")).not.toBe(favoriteId("task1", "report2"));
    expect(favoriteId("task1", "report1")).not.toBe(favoriteId("task2", "report1"));
  });

  it("兩段是分開的，不會因為切在別的位置就湊出同一個 id", () => {
    // 沒有分隔符的話 "ab"+"c" 跟 "a"+"bc" 會是同一個字串。
    expect(favoriteId("ab", "c")).not.toBe(favoriteId("a", "bc"));
  });
});

describe("toFavoriteInput", () => {
  const report = {
    taskName: "河內・下龍灣 六天五夜",
    currency: "TWD",
    startDate: "2026-06-15",
    endDate: "2026-06-20",
    days: 6,
    memberCount: 15,
    total: 38986900
  };

  it("收藏頁畫得出來的欄位都要在", () => {
    expect(toFavoriteInput("task1", "report1", report)).toEqual({
      taskId: "task1",
      reportId: "report1",
      taskName: "河內・下龍灣 六天五夜",
      currency: "TWD",
      startDate: "2026-06-15",
      endDate: "2026-06-20",
      days: 6,
      memberCount: 15,
      total: 38986900
    });
  });

  it("報告多出來的東西不會跟著跑進收藏裡", () => {
    const withExtras = {
      ...report,
      // 這些是報告有、但收藏頁畫不到的：逐筆的時間軸與地點明細。
      timeline: [{ date: "2026-06-15", entries: [] }],
      places: [{ name: "還劍湖", total: 100 }],
      perPerson: 2599127,
      active: true,
      listed: true
    };

    const input = toFavoriteInput("task1", "report1", withExtras);
    expect(input).not.toHaveProperty("timeline");
    expect(input).not.toHaveProperty("places");
    expect(input).not.toHaveProperty("perPerson");
    expect(input).not.toHaveProperty("listed");
  });

  it("沒填日期的旅程照樣收藏得起來，不會變成 undefined", () => {
    const undated = { ...report, startDate: null, endDate: null, days: null };
    const input = toFavoriteInput("task1", "report1", undated);

    expect(input.startDate).toBeNull();
    expect(input.endDate).toBeNull();
    expect(input.days).toBeNull();
  });
});
