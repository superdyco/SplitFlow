import { beforeEach, describe, expect, it } from "vitest";
import { clearErrors, describeError, logError, recentErrors } from "../src/utils/debugLog";

beforeEach(() => clearErrors());

describe("describeError", () => {
  it("留下 code —— 訊息會隨版本改寫，code 才查得到", () => {
    const error = { code: "permission-denied", message: "Missing or insufficient permissions." };
    expect(describeError(error)).toBe("permission-denied Missing or insufficient permissions.");
  });

  it("只有訊息沒有 code 也要看得懂", () => {
    expect(describeError(new Error("網路斷了"))).toBe("網路斷了");
  });

  it("丟出來的是字串或其他東西都不能變成 [object Object]", () => {
    expect(describeError("壞掉了")).toBe("壞掉了");
    expect(describeError(404)).toBe("404");
    expect(describeError(null)).toBe("null");
  });
});

describe("logError", () => {
  it("連續同樣的錯誤併成一筆，不佔滿清單", () => {
    for (let i = 0; i < 10; i += 1) logError("firebase", { code: "unavailable" });

    const entries = recentErrors();
    expect(entries).toHaveLength(1);
    expect(entries[0].count).toBe(10);
  });

  it("中間夾了別的錯誤就分開記 —— 那是兩件事", () => {
    logError("firebase", { code: "unavailable" });
    logError("window", "boom");
    logError("firebase", { code: "unavailable" });

    expect(recentErrors().map(entry => entry.count)).toEqual([1, 1, 1]);
  });

  it("同一段訊息從不同來源進來不算重複", () => {
    logError("firebase", "boom");
    logError("promise", "boom");
    expect(recentErrors()).toHaveLength(2);
  });

  it("超過上限時丟掉最舊的，留下最近的 50 筆", () => {
    for (let i = 0; i < 60; i += 1) logError("firebase", `錯誤 ${i}`);

    const entries = recentErrors();
    expect(entries).toHaveLength(50);
    expect(entries[0].message).toBe("錯誤 10");
    expect(entries[49].message).toBe("錯誤 59");
  });

  it("回傳的是複本，外面改不到清單裡的東西", () => {
    logError("firebase", "boom");
    recentErrors()[0].message = "被竄改";
    expect(recentErrors()[0].message).toBe("boom");
  });
});
