import { describe, expect, it } from "vitest";
import { ledgerResultLabel, ledgerTypeLabel } from "@/utils/aiLedger";

const NOW = new Date("2026-09-12T10:00:00Z");

describe("ledgerTypeLabel", () => {
  it("三種類型", () => {
    expect(ledgerTypeLabel("use")).toBe("辨識");
    expect(ledgerTypeLabel("adjust")).toBe("調整");
    expect(ledgerTypeLabel("free")).toBe("免費");
  });

  it("不認得的照原文 —— 第二階段的 purchase 在畫面更新前也看得到", () => {
    expect(ledgerTypeLabel("purchase")).toBe("purchase");
  });
});

describe("ledgerResultLabel", () => {
  const use = (readResult: string | null, at = "2026-09-12T09:59:30Z") => ({ type: "use", readResult, at });

  it("辨識的結果", () => {
    expect(ledgerResultLabel(use("read"), NOW)).toBe("讀出");
    expect(ledgerResultLabel(use("unreadable"), NOW)).toBe("讀不出金額");
    expect(ledgerResultLabel(use("not_receipt"), NOW)).toBe("不是收據");
    expect(ledgerResultLabel(use("ai_error"), NOW)).toBe("AI 出錯");
    expect(ledgerResultLabel(use("timeout"), NOW)).toBe("逾時");
  });

  it("pending 一分鐘內是「辨識中」，超過就是「沒有回來」—— 扣了點卻沒有結果", () => {
    expect(ledgerResultLabel(use("pending"), NOW)).toBe("辨識中");
    expect(ledgerResultLabel(use("pending", "2026-09-12T09:58:00Z"), NOW)).toBe("沒有回來");
  });

  it("不是辨識的紀錄沒有結果", () => {
    expect(ledgerResultLabel({ type: "adjust", readResult: null, at: null }, NOW)).toBe("");
  });
});
