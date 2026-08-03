import { describe, expect, it } from "vitest";
import { buildSettlementText, type SettlementTextInput } from "@/utils/settlementText";

/** TWD 是兩位小數，所以金額都是最小單位整數：125000 等於 1,250.00。 */
function baseInput(overrides: Partial<SettlementTextInput> = {}): SettlementTextInput {
  return {
    taskName: "東京五日遊",
    currency: "TWD",
    transfers: [
      { from: "u_ming", to: "u_hao", amount: 125000 },
      { from: "u_hua", to: "u_hao", amount: 80000 },
      { from: "u_hua", to: "u_ming", amount: 34000 }
    ],
    memberNames: { u_ming: "小明", u_hua: "小華", u_hao: "阿浩" },
    expenseCount: 12,
    total: 2460000,
    ...overrides
  };
}

describe("buildSettlementText", () => {
  it("列出每一筆轉帳，結尾附上支出筆數與總額", () => {
    expect(buildSettlementText(baseInput())).toBe(
      [
        "東京五日遊 · 結算",
        "────────────────",
        "小明 → 阿浩  TWD 1,250.00",
        "小華 → 阿浩  TWD 800.00",
        "小華 → 小明  TWD 340.00",
        "",
        "12 筆支出 · 共 TWD 24,600.00"
      ].join("\n")
    );
  });

  it("沒有轉帳時說已結清，而不是留一塊空白", () => {
    const text = buildSettlementText(baseInput({ transfers: [] }));
    expect(text).toContain("大家都已結清，不需要轉帳。");
    expect(text).toContain("12 筆支出 · 共 TWD 24,600.00");
  });

  it("查不到暱稱的 uid 顯示為已離開的成員", () => {
    const text = buildSettlementText(
      baseInput({
        transfers: [{ from: "u_gone", to: "u_hao", amount: 50000 }],
        memberNames: { u_hao: "阿浩" }
      })
    );
    expect(text).toContain("已離開的成員 → 阿浩  TWD 500.00");
  });

  it("金額有千分位", () => {
    const text = buildSettlementText(
      baseInput({ transfers: [{ from: "u_ming", to: "u_hao", amount: 123456789 }] })
    );
    expect(text).toContain("小明 → 阿浩  TWD 1,234,567.89");
  });

  it("零小數幣別不會多出小數點", () => {
    const text = buildSettlementText(
      baseInput({
        currency: "KRW",
        transfers: [{ from: "u_ming", to: "u_hao", amount: 125000 }],
        total: 2460000
      })
    );
    expect(text).toContain("小明 → 阿浩  KRW 125,000");
    expect(text).toContain("共 KRW 2,460,000");
  });
});

describe("buildSettlementText 的警告", () => {
  it("有未換算的支出時警告總額偏低", () => {
    const text = buildSettlementText(baseInput({ unconvertedCount: 2 }));
    expect(text).toContain("⚠ 有 2 筆支出還沒有匯率，未算入上面的金額");
  });

  it("有待確認的付款時警告金額還沒扣除", () => {
    const text = buildSettlementText(baseInput({ pendingCount: 1 }));
    expect(text).toContain("⚠ 有 1 筆付款等待確認，還沒從上面的金額扣除");
  });

  it("兩種警告同時出現", () => {
    const text = buildSettlementText(baseInput({ unconvertedCount: 2, pendingCount: 1 }));
    expect(text).toContain("⚠ 有 2 筆支出還沒有匯率，未算入上面的金額");
    expect(text).toContain("⚠ 有 1 筆付款等待確認，還沒從上面的金額扣除");
  });

  it("計數是 0 或沒傳時不出現警告", () => {
    expect(buildSettlementText(baseInput())).not.toContain("⚠");
    expect(buildSettlementText(baseInput({ unconvertedCount: 0, pendingCount: 0 }))).not.toContain("⚠");
  });
});

describe("buildSettlementText 的快照模式", () => {
  it("標題帶上快照日期", () => {
    const text = buildSettlementText(baseInput({ snapshotDate: "2026/03/05 21:14" }));
    expect(text).toContain("東京五日遊 · 結算（2026/03/05 21:14）");
  });

  it("有備註就放在標題下一行", () => {
    const text = buildSettlementText(
      baseInput({ snapshotDate: "2026/03/05 21:14", note: "回國後結清" })
    );
    expect(text).toBe(
      [
        "東京五日遊 · 結算（2026/03/05 21:14）",
        "回國後結清",
        "────────────────",
        "小明 → 阿浩  TWD 1,250.00",
        "小華 → 阿浩  TWD 800.00",
        "小華 → 小明  TWD 340.00",
        "",
        "12 筆支出 · 共 TWD 24,600.00"
      ].join("\n")
    );
  });

  it("備註是空字串就不多一行", () => {
    const text = buildSettlementText(baseInput({ snapshotDate: "2026/03/05 21:14", note: "   " }));
    expect(text.split("\n")[1]).toBe("────────────────");
  });
});
