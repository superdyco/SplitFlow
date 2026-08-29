import { describe, expect, it } from "vitest";
import { removeMemberPrompt } from "@/utils/memberRemoval";

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

  // 選項說明是陳述句。這裡曾經直接嵌入一份獨立的確認訊息，變成在選項裡
  // 再問一次，而且餘額不是 0 時會在兩個項目符號之間插進空行與懸空的問句。
  describe("兩個選項的說明", () => {
    it("不是問句", () => {
      const prompt = removeMemberPrompt({
        ...base,
        balance: -80000,
        expenseCount: 3,
        paymentCount: 0
      });
      expect(prompt.message).not.toContain("嗎？");
      expect(prompt.message).not.toContain("確定要移除");
    });

    it("兩個項目符號之間只有一個空行", () => {
      const prompt = removeMemberPrompt({
        ...base,
        balance: -80000,
        expenseCount: 3,
        paymentCount: 0
      });
      const between = prompt.message.split("・保留結算資料：")[1].split("・真實移除：")[0];
      expect(between).not.toContain("\n\n\n");
      expect(between.trimEnd().split("\n").length).toBe(1);
    });
  });

  describe("餘額", () => {
    it("他還沒付時講出金額", () => {
      const prompt = removeMemberPrompt({
        ...base,
        balance: -80000,
        expenseCount: 3,
        paymentCount: 0
      });
      expect(prompt.message).toContain("他還有 TWD 800.00 沒付");
    });

    it("還有人要付給他時是另一句", () => {
      const prompt = removeMemberPrompt({
        ...base,
        balance: 125000,
        expenseCount: 3,
        paymentCount: 0
      });
      expect(prompt.message).toContain("還有 TWD 1,250.00 要付給他");
    });

    it("金額走 formatAmount，零小數幣別不會多出小數點", () => {
      const prompt = removeMemberPrompt({
        ...base,
        balance: -125000,
        currency: "KRW",
        expenseCount: 3,
        paymentCount: 0
      });
      expect(prompt.message).toContain("KRW 125,000 沒付");
    });

    it("已結清時不提金額", () => {
      const prompt = removeMemberPrompt({ ...base, balance: 0, expenseCount: 3, paymentCount: 0 });
      expect(prompt.message).not.toContain("沒付");
      expect(prompt.message).not.toContain("要付給");
    });

    // 這一條是這次修的核心：算不出來跟已結清是兩回事，混為一談就是在
    // 一個不可逆的決定前面謊報「他沒有欠款」。
    it("算不出來時照實說，不能講得像已結清", () => {
      const prompt = removeMemberPrompt({
        ...base,
        balance: null,
        expenseCount: 3,
        paymentCount: 0
      });
      expect(prompt.message).toContain("算不出他的結算餘額");
    });
  });

  describe("虛擬成員", () => {
    it("不講「看不到這個任務」—— 他從來就沒有帳號", () => {
      const prompt = removeMemberPrompt({
        ...base,
        expenseCount: 3,
        paymentCount: 0,
        virtual: true
      });
      expect(prompt.message).not.toContain("看不到這個任務");
    });

    it("真實成員照講", () => {
      const prompt = removeMemberPrompt({ ...base, expenseCount: 3, paymentCount: 0 });
      expect(prompt.message).toContain("他之後看不到這個任務");
    });
  });

  describe("會不會誤傷別人的帳", () => {
    // 這句是整個功能的風險揭露，該出現的時候少一句都不行。
    it("有別人付的支出時要警告", () => {
      const prompt = removeMemberPrompt({
        ...base,
        expenseCount: 12,
        paymentCount: 0,
        othersPaid: true
      });
      expect(prompt.message).toContain("別人付的");
    });

    it("全部都是他自己付的就不要嚇人", () => {
      const prompt = removeMemberPrompt({
        ...base,
        expenseCount: 12,
        paymentCount: 0,
        othersPaid: false
      });
      expect(prompt.message).not.toContain("別人付的");
    });
  });
});
