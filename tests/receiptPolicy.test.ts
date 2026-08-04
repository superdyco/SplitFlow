import { describe, expect, it } from "vitest";
import { MAX_AGE_MS, MAX_ATTEMPTS, queueAction, receiptPath } from "@/utils/receiptPolicy";

const NOW = Date.UTC(2026, 7, 4);

function item(overrides: Partial<{ createdAt: number; attempts: number }> = {}) {
  return { createdAt: NOW, attempts: 0, ...overrides };
}

describe("receiptPath", () => {
  it("路徑可以從 taskId 與 expenseId 推導出來，不需要另外記檔名", () => {
    expect(receiptPath("t1", "e1")).toBe("tasks/t1/expenses/e1/receipt.jpg");
  });
});

describe("queueAction", () => {
  it("剛入列的項目要上傳", () => {
    expect(queueAction(item(), NOW)).toBe("upload");
  });

  it("失敗次數還沒到上限就繼續自動重試", () => {
    expect(queueAction(item({ attempts: MAX_ATTEMPTS - 1 }), NOW)).toBe("upload");
  });

  it("失敗到上限就停止自動重試，但項目要保留給使用者手動重試", () => {
    expect(queueAction(item({ attempts: MAX_ATTEMPTS }), NOW)).toBe("hold-exhausted");
  });

  it("超過保存期限就丟棄，免得手機裡永遠躺著傳不出去的圖", () => {
    expect(queueAction(item({ createdAt: NOW - MAX_AGE_MS - 1 }), NOW)).toBe("drop-expired");
  });

  it("剛好在保存期限上還不算過期", () => {
    expect(queueAction(item({ createdAt: NOW - MAX_AGE_MS }), NOW)).toBe("upload");
  });

  it("又過期又試到上限的話以過期為準 —— 留著也沒有意義了", () => {
    expect(queueAction(item({ createdAt: NOW - MAX_AGE_MS - 1, attempts: MAX_ATTEMPTS }), NOW)).toBe(
      "drop-expired"
    );
  });
});
