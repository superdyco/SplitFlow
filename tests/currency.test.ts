import { describe, expect, it } from "vitest";
import {
  allocate,
  amountInputError,
  amountToInput,
  convertAmount,
  formatAmount,
  rateInputError,
  minorUnits,
  parseAmountInput,
  parseRateInput
} from "@/utils/currency";

describe("minorUnits", () => {
  it("沒有小數的幣別是 0 位", () => {
    expect(minorUnits("VND")).toBe(0);
    expect(minorUnits("KRW")).toBe(0);
    // 日圓最容易被誤當成 2 位 —— 它跟美元一樣有「元」的感覺，但 1 円就是最小單位。
    expect(minorUnits("JPY")).toBe(0);
  });

  it("其他幣別預設 2 位", () => {
    expect(minorUnits("TWD")).toBe(2);
    expect(minorUnits("沒聽過的幣別")).toBe(2);
  });
});

describe("parseAmountInput", () => {
  it("換成最小單位整數", () => {
    expect(parseAmountInput("450", "TWD")).toBe(45000);
    expect(parseAmountInput("450.5", "TWD")).toBe(45050);
    expect(parseAmountInput("0.07", "TWD")).toBe(7);
    expect(parseAmountInput(" 1234.05 ", "TWD")).toBe(123405);
  });

  it("0 位小數的幣別不放大", () => {
    expect(parseAmountInput("50000", "VND")).toBe(50000);
  });

  it("擋掉不合法的輸入", () => {
    expect(() => parseAmountInput("", "TWD")).toThrow();
    expect(() => parseAmountInput("0", "TWD")).toThrow();
    expect(() => parseAmountInput("-5", "TWD")).toThrow();
    expect(() => parseAmountInput("1.234", "TWD")).toThrow();
    expect(() => parseAmountInput("1.5", "KRW")).toThrow();
    expect(() => parseAmountInput("abc", "TWD")).toThrow();
  });
});

describe("formatAmount / amountToInput", () => {
  it("補小數位並加千分位", () => {
    expect(formatAmount(45050, "TWD")).toBe("450.50");
    expect(formatAmount(123456789, "TWD")).toBe("1,234,567.89");
    expect(formatAmount(7, "TWD")).toBe("0.07");
    expect(formatAmount(50000, "VND")).toBe("50,000");
  });

  it("負數保留負號", () => {
    expect(formatAmount(-45050, "TWD")).toBe("-450.50");
  });

  it("轉回輸入值不含千分位，且可以來回轉換", () => {
    expect(amountToInput(123456789, "TWD")).toBe("1234567.89");
    expect(parseAmountInput(amountToInput(123405, "TWD"), "TWD")).toBe(123405);
    expect(parseAmountInput(amountToInput(50000, "VND"), "VND")).toBe(50000);
  });
});

describe("parseRateInput", () => {
  it("接受最多六位小數", () => {
    expect(parseRateInput("0.921534")).toBe(0.921534);
    expect(parseRateInput("32")).toBe(32);
  });

  it("擋掉 0、負數與過多小數", () => {
    expect(() => parseRateInput("0")).toThrow();
    expect(() => parseRateInput("-1")).toThrow();
    expect(() => parseRateInput("0.1234567")).toThrow();
    expect(() => parseRateInput("")).toThrow();
  });
});

describe("allocate", () => {
  it("均分且餘數全部分完", () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(10, [1, 1, 1, 1])).toEqual([3, 3, 2, 2]);
    expect(allocate(9, [1, 1, 1])).toEqual([3, 3, 3]);
  });

  it("依權重比例分配", () => {
    expect(allocate(100, [1, 3])).toEqual([25, 75]);
    expect(allocate(1000, [2, 3, 5])).toEqual([200, 300, 500]);
  });

  it("總和永遠等於 total", () => {
    const cases: Array<[number, number[]]> = [
      [100, [1, 1, 1]],
      [101, [1, 1, 1, 1, 1, 1, 7]],
      [1, [1, 1, 1, 1, 1]],
      [999999, [17, 5, 3, 11]],
      [7, [1, 1]]
    ];
    for (const [total, weights] of cases) {
      const result = allocate(total, weights);
      expect(result.reduce((acc, value) => acc + value, 0)).toBe(total);
    }
  });

  it("權重全 0 時退回均分", () => {
    expect(allocate(10, [0, 0, 0, 0])).toEqual([3, 3, 2, 2]);
  });

  it("空陣列回空陣列", () => {
    expect(allocate(100, [])).toEqual([]);
  });

  it("total 比人數少時也不會少分或多分", () => {
    const result = allocate(2, [1, 1, 1, 1, 1]);
    expect(result.reduce((acc, value) => acc + value, 0)).toBe(2);
    expect(result).toEqual([1, 1, 0, 0, 0]);
  });
});

describe("convertAmount", () => {
  it("同幣別原樣回傳", () => {
    expect(convertAmount(45000, "TWD", "TWD", 1)).toBe(45000);
  });

  it("兩邊都有小數位", () => {
    // THB 500.00 * 0.92 = TWD 460.00
    expect(convertAmount(50000, "THB", "TWD", 0.92)).toBe(46000);
  });

  it("來源沒有小數位、目標有小數位", () => {
    // VND 50000 * 0.00123 = TWD 61.50
    expect(convertAmount(50000, "VND", "TWD", 0.00123)).toBe(6150);
  });

  it("目標沒有小數位", () => {
    // TWD 100.00 * 41.5 = KRW 4150
    expect(convertAmount(10000, "TWD", "KRW", 41.5)).toBe(4150);
  });

  it("四捨五入到最小單位", () => {
    expect(convertAmount(100, "THB", "TWD", 0.925)).toBe(93);
  });
});

describe("amountInputError", () => {
  it("合法的金額沒有錯誤", () => {
    expect(amountInputError("450.50", "THB")).toBeNull();
    expect(amountInputError("450", "VND")).toBeNull();
  });

  it("空白不算錯 —— 還沒填不該在畫面上跳紅字", () => {
    expect(amountInputError("", "THB")).toBeNull();
    expect(amountInputError("   ", "THB")).toBeNull();
  });

  // 這就是「編輯支出換幣別後儲存鍵變灰」的根因：
  // 既有的 "450.50" 在 THB 合法，換成 0 位小數的 VND 就不合法了，
  // 而原本的程式把錯誤吞掉，使用者只看到按鈕變灰、沒有任何說明。
  it("換成不用小數的幣別時，帶小數的金額要講出原因", () => {
    expect(amountInputError("450.50", "VND")).toBe("VND 金額只能是整數");
  });

  it("小數位超過上限也要講出原因", () => {
    expect(amountInputError("450.567", "THB")).toBe("金額只能是數字，最多 2 位小數");
  });

  it("零與負數要擋", () => {
    expect(amountInputError("0", "TWD")).toBe("金額必須大於 0");
    expect(amountInputError("-5", "TWD")).toBe("金額只能是數字，最多 2 位小數");
  });
});

describe("rateInputError", () => {
  it("合法的匯率沒有錯誤", () => {
    expect(rateInputError("0.92")).toBeNull();
    expect(rateInputError("41.5")).toBeNull();
  });

  it("空白不算錯", () => {
    expect(rateInputError("")).toBeNull();
  });

  it("打錯字要講出原因，而不是讓送出鍵默默變灰", () => {
    expect(rateInputError("abc")).toBe("匯率只能是數字，最多 6 位小數");
    expect(rateInputError("0")).toBe("匯率必須大於 0");
  });
});
