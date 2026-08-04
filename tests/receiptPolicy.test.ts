import { describe, expect, it } from "vitest";
import {
  MAX_AGE_MS,
  MAX_ATTEMPTS,
  MAX_SOURCE_BYTES,
  MAX_UPLOAD_BYTES,
  formatBytes,
  queueAction,
  receiptPath,
  sizeRejection
} from "@/utils/receiptPolicy";

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

describe("sizeRejection", () => {
  it("一般大小的照片放行", () => {
    expect(sizeRejection("source", 4 * 1024 * 1024)).toBeNull();
    expect(sizeRejection("upload", 300 * 1024)).toBeNull();
  });

  it("原始檔超過上限就擋在解碼之前 —— 解碼超大圖會把手機記憶體吃爆", () => {
    expect(sizeRejection("source", MAX_SOURCE_BYTES + 1)).toContain("太大");
  });

  it("壓縮後仍然超過 Storage 上限也要擋，不能傳出去才被規則拒絕", () => {
    expect(sizeRejection("upload", MAX_UPLOAD_BYTES + 1)).toContain("2.0 MB");
  });

  it("剛好等於上限是放行，不是拒絕", () => {
    expect(sizeRejection("source", MAX_SOURCE_BYTES)).toBeNull();
    expect(sizeRejection("upload", MAX_UPLOAD_BYTES)).toBeNull();
  });

  it("訊息裡要有實際大小，使用者才知道差多少", () => {
    expect(sizeRejection("upload", 3 * 1024 * 1024)).toContain("3.0 MB");
  });
});

describe("formatBytes", () => {
  it("MB 等級取一位小數", () => {
    expect(formatBytes(2 * 1024 * 1024)).toBe("2.0 MB");
    expect(formatBytes(3.45 * 1024 * 1024)).toBe("3.5 MB");
  });

  it("不到 1MB 用 KB，不然會全部顯示成 0.0 MB", () => {
    expect(formatBytes(300 * 1024)).toBe("300 KB");
  });

  it("0 不會變成空字串或 NaN", () => {
    expect(formatBytes(0)).toBe("0 KB");
  });
});
