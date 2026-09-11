import { describe, expect, it } from "vitest";
import { aiButtonState, aiMessage, aiPatch, splitAfterAi, type AiReceiptFields } from "@/utils/aiReceipt";

function fields(overrides: Partial<AiReceiptFields> = {}): AiReceiptFields {
  return {
    amount: "1280",
    currency: "JPY",
    currencySupported: true,
    date: "2026-09-10",
    time: "19:05",
    title: "すき家",
    category: "food",
    ...overrides
  };
}

describe("aiButtonState", () => {
  const base = { guest: false, online: true, balance: 2, busy: false };

  it("正常：顯示剩幾點", () => {
    expect(aiButtonState(base)).toEqual({ kind: "ready", label: "用 AI 讀收據（剩 2 點）", disabled: false });
  });

  it("還沒用過（沒有點數文件）顯示 3 點", () => {
    expect(aiButtonState({ ...base, balance: null }).label).toBe("用 AI 讀收據（剩 3 點）");
  });

  it("訪客：按鈕照樣按得下去（按下去才提示綁定）", () => {
    expect(aiButtonState({ ...base, guest: true })).toEqual({ kind: "guest", label: "用 AI 讀收據", disabled: false });
  });

  it("點數用完、沒網路都停用", () => {
    expect(aiButtonState({ ...base, balance: 0 })).toEqual({ kind: "empty", label: "AI 點數用完了", disabled: true });
    expect(aiButtonState({ ...base, online: false })).toEqual({ kind: "offline", label: "需要網路", disabled: true });
  });

  it("辨識中優先於一切", () => {
    expect(aiButtonState({ ...base, busy: true, online: false })).toEqual({
      kind: "busy",
      label: "辨識中…",
      disabled: true
    });
  });
});

describe("aiPatch", () => {
  const ctx = { baseCurrency: "TWD", currentCurrency: "TWD" };

  it("讀到的欄位全部蓋掉，照固定順序列出", () => {
    expect(aiPatch(fields(), ctx)).toEqual({
      amount: "1280",
      currency: "JPY",
      date: "2026-09-10",
      time: "19:05",
      title: "すき家",
      category: "food",
      filled: ["金額", "幣別", "日期", "時間", "支出名稱", "分類"],
      warning: null
    });
  });

  it("沒讀到的欄位不動", () => {
    const patch = aiPatch(fields({ time: null, category: null, title: null }), ctx);
    expect(patch).not.toHaveProperty("time");
    expect(patch).not.toHaveProperty("category");
    expect(patch.filled).toEqual(["金額", "幣別", "日期"]);
  });

  it("不支援的幣別：幣別改用主要幣別，金額依主要幣別的小數位整理，並警告", () => {
    const patch = aiPatch(fields({ amount: "40000", currency: "KHR", currencySupported: false }), ctx);
    expect(patch.currency).toBe("TWD");
    expect(patch.amount).toBe("40000.00");
    expect(patch.warning).toBe("收據上是 KHR 40000，目前不支援這個幣別，已改用 TWD —— 金額請自己換算後再存");
    expect(patch.filled).toContain("金額");
    expect(patch.filled).not.toContain("幣別");
  });

  it("主要幣別是日圓時 12.5 變 13", () => {
    const patch = aiPatch(fields({ amount: "12.5", currency: "KHR", currencySupported: false }), {
      baseCurrency: "JPY",
      currentCurrency: "JPY"
    });
    expect(patch.amount).toBe("13");
  });

  it("沒讀到幣別：金額依表單現在的幣別整理", () => {
    const patch = aiPatch(fields({ amount: "85", currency: null, currencySupported: false }), ctx);
    expect(patch).not.toHaveProperty("currency");
    expect(patch.amount).toBe("85.00");
    expect(patch.warning).toBeNull();
  });

  it("不支援的幣別又沒讀出金額：警告不提金額", () => {
    const patch = aiPatch(fields({ amount: null, currency: "KHR", currencySupported: false }), ctx);
    expect(patch.warning).toBe("收據上的幣別是 KHR，目前不支援，已改用 TWD");
  });
});

describe("splitAfterAi", () => {
  it("自訂分帳而且金額或幣別變了：切回平分，給原本有填金額的人", () => {
    expect(
      splitAfterAi({ mode: "custom", customAmounts: { a: "300", b: " 0 ", c: "", d: "12.5" }, changed: true })
    ).toEqual({ memberIds: ["a", "d"] });
  });

  it("自訂但沒有任何人有金額：切回平分，分攤的人不動", () => {
    expect(splitAfterAi({ mode: "custom", customAmounts: { a: "" }, changed: true })).toEqual({ memberIds: null });
  });

  it("自訂但都沒變：不動", () => {
    expect(splitAfterAi({ mode: "custom", customAmounts: { a: "300" }, changed: false })).toBeNull();
  });

  it("本來就是平分：不動", () => {
    expect(splitAfterAi({ mode: "even", customAmounts: {}, changed: true })).toBeNull();
  });
});

describe("aiMessage", () => {
  it("讀出", () => {
    expect(aiMessage({ readResult: "read", filled: ["金額", "幣別"], creditsLeft: 2, splitReset: false })).toBe(
      "AI 已填入：金額、幣別（剩 2 點）"
    );
  });

  it("讀出而且分帳改回平分", () => {
    expect(aiMessage({ readResult: "read", filled: ["金額"], creditsLeft: 0, splitReset: true })).toBe(
      "AI 已填入：金額（剩 0 點）。分帳已改回平分"
    );
  });

  it("沒讀出金額，但有其他欄位", () => {
    expect(aiMessage({ readResult: "unreadable", filled: ["日期"], creditsLeft: 1, splitReset: false })).toBe(
      "沒有讀出金額（已扣 1 點），其他有讀到的欄位已填入"
    );
  });

  it("什麼都沒讀到（包含不是收據）", () => {
    expect(aiMessage({ readResult: "not_receipt", filled: [], creditsLeft: 1, splitReset: false })).toBe(
      "沒有讀出金額（已扣 1 點）"
    );
  });
});
