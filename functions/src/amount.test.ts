import { describe, expect, it } from "vitest";
import { formatAmount, minorUnits } from "./amount.js";

/**
 * 這些期望值必須跟網頁版 `src/utils/currency.ts` 的 formatAmount 逐字相同 ——
 * 通知上的金額跟 App 裡看到的不一樣，使用者會以為自己記錯了。
 *
 * 這裡是寫死的期望值，好處是壞掉時看得出**應該**是什麼。真正比對兩份實作的
 * 是 `tests/currencyParity.test.ts`（在專案根目錄，那裡才 import 得到網頁版）。
 */
describe("formatAmount", () => {
  it("TWD 是兩位小數", () => {
    expect(formatAmount(120000, "TWD")).toBe("1,200.00");
  });

  it("JPY 沒有輔幣單位", () => {
    expect(formatAmount(1200, "JPY")).toBe("1,200");
  });

  it("USD 兩位小數", () => {
    expect(formatAmount(45050, "USD")).toBe("450.50");
  });

  it("小額不會冒出千分位", () => {
    expect(formatAmount(999, "TWD")).toBe("9.99");
  });

  it("不足一元時整數位要補 0，不能是 .99", () => {
    expect(formatAmount(99, "TWD")).toBe("0.99");
  });

  it("沒見過的幣別當成兩位小數", () => {
    expect(formatAmount(100, "XXX")).toBe("1.00");
  });

  it("千分位的出現時機：滿四位數才有", () => {
    expect(formatAmount(99999, "TWD")).toBe("999.99");
    expect(formatAmount(100000, "TWD")).toBe("1,000.00");
  });

  it("零小數幣別的千分位也要對", () => {
    expect(formatAmount(1000000, "VND")).toBe("1,000,000");
  });
});

describe("minorUnits", () => {
  it("認得零小數的幣別", () => {
    expect(minorUnits("JPY")).toBe(0);
    expect(minorUnits("KRW")).toBe(0);
    expect(minorUnits("VND")).toBe(0);
  });

  it("其餘一律兩位", () => {
    expect(minorUnits("TWD")).toBe(2);
    expect(minorUnits("沒見過")).toBe(2);
  });
});
