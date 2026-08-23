import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  activeTraceName,
  finishTrace,
  markPhase,
  phaseMap,
  slowestPhase,
  startTrace,
  traceDetail
} from "../src/utils/perfTrace";

/**
 * 假時鐘要連 performance 一起假：這個模組刻意不用 Date.now()（手機校時會讓
 * 差值跳掉），所以只假 Date 的話什麼都推不動。
 */
beforeEach(() => vi.useFakeTimers({ toFake: ["performance", "Date"] }));
afterEach(() => {
  finishTrace("清乾淨");
  vi.useRealTimers();
});

describe("分段", () => {
  it("每一段是距離上一段的時間，不是距離起點", () => {
    startTrace("tasks");
    vi.advanceTimersByTime(100);
    markPhase("auth");
    vi.advanceTimersByTime(400);
    markPhase("chunk");

    const trace = finishTrace("tasks");
    expect(trace?.phases).toEqual([
      { name: "auth", ms: 100 },
      { name: "chunk", ms: 400 }
    ]);
  });

  it("同名的併成一段累加 —— 寫進 Firestore 是 map，重複的 key 存不下兩份", () => {
    startTrace("tasks");
    vi.advanceTimersByTime(30);
    markPhase("query");
    vi.advanceTimersByTime(10);
    markPhase("render");
    vi.advanceTimersByTime(50);
    markPhase("query");

    expect(phaseMap(finishTrace("tasks")!)).toEqual({ query: 80, render: 10 });
  });

  it("總時間包含最後一段之後的時間，不是分段的加總", () => {
    startTrace("tasks");
    vi.advanceTimersByTime(200);
    markPhase("query");
    vi.advanceTimersByTime(300);

    expect(finishTrace("tasks")?.total).toBe(500);
  });
});

describe("沒有在追的時候", () => {
  it("markPhase 與 traceDetail 都是 no-op，呼叫點不必自己判斷", () => {
    expect(() => {
      markPhase("query");
      traceDetail("fromCache", true);
    }).not.toThrow();
    expect(activeTraceName()).toBeNull();
  });

  it("重試那一趟不會被算進去 —— 上一次已經收尾了", () => {
    startTrace("tasks");
    vi.advanceTimersByTime(50);
    markPhase("query");
    finishTrace("tasks");

    // 使用者按了重試，中間隔了很久。
    vi.advanceTimersByTime(120_000);
    markPhase("query");
    expect(finishTrace("tasks")).toBeNull();
  });
});

describe("收尾的守門", () => {
  it("名字對不上就不算數 —— 那是別人的 trace", () => {
    startTrace("tasks");
    expect(finishTrace("tasks-costs")).toBeNull();
  });

  it("被打斷的導航留下的 trace 會過期，不會變成假的慢", () => {
    startTrace("tasks");
    vi.advanceTimersByTime(10 * 60_000);
    markPhase("query");
    expect(finishTrace("tasks")).toBeNull();
  });

  it("重新開始會蓋掉沒收尾的那一個", () => {
    startTrace("tasks");
    vi.advanceTimersByTime(5_000);
    startTrace("tasks");
    vi.advanceTimersByTime(20);
    markPhase("query");

    expect(finishTrace("tasks")?.total).toBe(20);
  });

  it("收過一次之後就沒了，同一筆不會被回報兩次", () => {
    startTrace("tasks");
    expect(finishTrace("tasks")).not.toBeNull();
    expect(finishTrace("tasks")).toBeNull();
  });
});

describe("情境值", () => {
  it("原樣帶著走 —— 分段只講多久，這些才講得出為什麼", () => {
    startTrace("tasks");
    traceDetail("fromCache", false);
    traceDetail("taskCount", 12);
    traceDetail("from", "/profile");

    expect(finishTrace("tasks")?.detail).toEqual({
      fromCache: false,
      taskCount: 12,
      from: "/profile"
    });
  });
});

describe("slowestPhase", () => {
  it("挑出最慢的那一段，這是整份資料唯一要看的結論", () => {
    startTrace("tasks");
    vi.advanceTimersByTime(20);
    markPhase("auth");
    vi.advanceTimersByTime(900);
    markPhase("chunk");
    vi.advanceTimersByTime(120);
    markPhase("query");

    expect(slowestPhase(finishTrace("tasks")!)).toBe("chunk");
  });

  it("一段都沒有的時候回空字串，不是 undefined", () => {
    startTrace("tasks");
    expect(slowestPhase(finishTrace("tasks")!)).toBe("");
  });
});
