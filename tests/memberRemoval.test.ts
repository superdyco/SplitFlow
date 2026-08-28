import { describe, expect, it } from "vitest";
import { removeMemberMessage, removeMemberPrompt } from "@/utils/memberRemoval";

describe("removeMemberMessage", () => {
  it("已結清時只講權限，不提金額", () => {
    const text = removeMemberMessage({ name: "小明", balance: 0, currency: "TWD" });
    expect(text).toBe("確定要把 小明 移出任務嗎？他就看不到這個任務了，但既有支出會保留。");
  });

  it("他還沒付錢時提醒之後只能由管理員代記", () => {
    const text = removeMemberMessage({ name: "小明", balance: -80000, currency: "TWD" });
    expect(text).toContain("小明 還有 TWD 800.00 沒付");
    expect(text).toContain("沒辦法自己記錄付款");
    expect(text).toContain("既有支出與結算金額都會保留");
  });

  it("還有人要付錢給他時說的是另一回事", () => {
    const text = removeMemberMessage({ name: "小華", balance: 125000, currency: "TWD" });
    expect(text).toContain("還有 TWD 1,250.00 要付給 小華");
    expect(text).toContain("查不到誰還沒付他錢");
  });

  it("金額走 formatAmount，零小數幣別不會多出小數點", () => {
    const text = removeMemberMessage({ name: "小明", balance: -125000, currency: "KRW" });
    expect(text).toContain("KRW 125,000 沒付");
  });

  it("沒有暱稱時用通稱，不會出現空白", () => {
    const text = removeMemberMessage({ name: "", balance: 0, currency: "TWD" });
    expect(text).toContain("這位成員");
  });

  it("兩種未結清情況都以問句收尾，讓確認框讀起來完整", () => {
    expect(removeMemberMessage({ name: "小明", balance: -80000, currency: "TWD" })).toContain(
      "確定要移除嗎？"
    );
    expect(removeMemberMessage({ name: "小明", balance: 80000, currency: "TWD" })).toContain(
      "確定要移除嗎？"
    );
  });
});

describe("removeMemberPrompt", () => {
  const base = { name: "阿嬤", balance: 0, currency: "TWD" };

  it("沒有帳時不給選擇", () => {
    const prompt = removeMemberPrompt({ ...base, expenseCount: 0, paymentCount: 0 });
    expect(prompt.hasRecords).toBe(false);
    expect(prompt.message).toContain("還沒有任何支出與付款記錄");
  });

  it("有帳時要給兩個選擇", () => {
    const prompt = removeMemberPrompt({ ...base, expenseCount: 12, paymentCount: 2 });
    expect(prompt.hasRecords).toBe(true);
  });

  it("把筆數數給使用者看", () => {
    const prompt = removeMemberPrompt({ ...base, expenseCount: 12, paymentCount: 2 });
    expect(prompt.message).toContain("12 筆支出");
    expect(prompt.message).toContain("2 筆付款記錄");
  });

  // 這兩句是整個功能的風險揭露，少一句都不行。
  it("講明會誤傷別人的帳", () => {
    const prompt = removeMemberPrompt({ ...base, expenseCount: 12, paymentCount: 0 });
    expect(prompt.message).toContain("別人付的");
  });

  it("講明結算紀錄裡他還在", () => {
    const prompt = removeMemberPrompt({ ...base, expenseCount: 12, paymentCount: 0 });
    expect(prompt.message).toContain("結算紀錄");
  });

  it("只有付款沒有支出時不會冒出「0 筆支出」", () => {
    const prompt = removeMemberPrompt({ ...base, expenseCount: 0, paymentCount: 3 });
    expect(prompt.message).toContain("3 筆付款記錄");
    expect(prompt.message).not.toContain("0 筆支出");
  });

  it("沒有名字時用代稱", () => {
    const prompt = removeMemberPrompt({ ...base, name: "", expenseCount: 0, paymentCount: 0 });
    expect(prompt.title).toContain("這位成員");
  });
});
