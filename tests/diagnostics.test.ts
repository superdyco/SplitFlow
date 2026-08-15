import { describe, expect, it } from "vitest";
import { buildDiagnosticsText, type DiagnosticsInput } from "../src/utils/diagnostics";

function input(overrides: Partial<DiagnosticsInput> = {}): DiagnosticsInput {
  return {
    version: "a1b2c3d 2026-08-16 01:20",
    uid: "user-1",
    loginMethod: "Google",
    online: true,
    installed: true,
    queuedReceipts: [],
    placesKey: true,
    mapsKey: true,
    userAgent: "Mozilla/5.0",
    errors: [],
    ...overrides
  };
}

describe("buildDiagnosticsText", () => {
  it("版本排在第一行 —— 那是回報問題時第一個要問的", () => {
    const lines = buildDiagnosticsText(input()).split("\n");
    expect(lines[1]).toBe("版本 a1b2c3d 2026-08-16 01:20");
  });

  it("沒有錯誤時直說，不要留一個空的區塊讓人猜", () => {
    expect(buildDiagnosticsText(input())).toContain("這次開啟之後沒有記錄到錯誤。");
  });

  it("待上傳收據要講出失敗次數 —— 沒失敗過與一直失敗的處置不同", () => {
    const text = buildDiagnosticsText(input({ queuedReceipts: [0, 3, 5] }));
    expect(text).toContain("待上傳收據 3 筆，其中 2 筆試過 3、5 次");
  });

  it("佇列讀不到本身就是線索，不能跟「沒有待上傳」混為一談", () => {
    const text = buildDiagnosticsText(input({ queuedReceipts: null }));
    expect(text).toContain("讀不到");
    expect(text).not.toContain("待上傳收據 沒有");
  });

  it("金鑰只講有沒有設定，絕不印出金鑰本身", () => {
    const text = buildDiagnosticsText(input({ placesKey: false, mapsKey: true }));
    expect(text).toContain("地點搜尋金鑰 未設定");
    expect(text).toContain("地圖金鑰 已設定");
  });

  it("重複的錯誤標次數，只出現一次的不加尾巴", () => {
    const at = Date.now();
    const text = buildDiagnosticsText(
      input({
        errors: [
          { at, source: "firebase", message: "permission-denied", count: 4 },
          { at, source: "promise", message: "boom", count: 1 }
        ]
      })
    );
    expect(text).toContain("[firebase] permission-denied ×4");
    expect(text).toContain("[promise] boom");
    expect(text).not.toContain("boom ×");
  });
});
