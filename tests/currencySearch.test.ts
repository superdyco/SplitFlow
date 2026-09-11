import { describe, expect, it } from "vitest";
import {
  CURRENCIES,
  CURRENCY_INFO,
  currencyLabel,
  minorUnits,
  searchCurrencies,
  type CurrencyInfo
} from "@/utils/currency";

const codes = (list: CurrencyInfo[]) => list.map(item => item.code);

describe("幣別清單", () => {
  it("20 種，代碼不重複", () => {
    expect(CURRENCIES).toHaveLength(20);
    expect(new Set(CURRENCIES).size).toBe(20);
  });

  it("原本的十種一個都沒少 —— 既有任務與支出存的就是這些代碼", () => {
    for (const code of ["TWD", "JPY", "THB", "USD", "VND", "CNY", "EGP", "KRW", "EUR", "HKD"]) {
      expect(CURRENCIES).toContain(code);
    }
  });

  it("這次加的十種都在", () => {
    for (const code of ["SGD", "MYR", "PHP", "IDR", "MOP", "GBP", "CHF", "CAD", "AUD", "NZD"]) {
      expect(CURRENCIES).toContain(code);
    }
  });

  it("每一種都有中文名", () => {
    expect(CURRENCY_INFO.every(item => item.name.length > 0)).toBe(true);
  });
});

describe("minorUnits（新幣別）", () => {
  it("印尼盾實際上不用小數，跟日圓一樣是 0 位", () => {
    expect(minorUnits("IDR")).toBe(0);
  });

  it("其他新幣別是 2 位", () => {
    for (const code of ["SGD", "MYR", "PHP", "MOP", "GBP", "CHF", "CAD", "AUD", "NZD"]) {
      expect(minorUnits(code)).toBe(2);
    }
  });
});

describe("currencyLabel", () => {
  it("代碼在前、中文在後 —— 電腦上打代碼開頭就跳得到", () => {
    expect(currencyLabel("USD")).toBe("USD 美元");
    expect(currencyLabel("JPY")).toBe("JPY 日圓");
  });

  it("認不得的代碼原樣回傳，不會變成空白", () => {
    expect(currencyLabel("XXX")).toBe("XXX");
  });
});

describe("searchCurrencies", () => {
  it("沒打字時是整份清單，主要幣別排第一", () => {
    const result = codes(searchCurrencies("", "JPY"));
    expect(result[0]).toBe("JPY");
    expect(result).toHaveLength(20);
  });

  it("打代碼開頭找得到，不分大小寫", () => {
    expect(codes(searchCurrencies("us"))[0]).toBe("USD");
    expect(codes(searchCurrencies("US"))[0]).toBe("USD");
  });

  it("代碼開頭相符的排在只是包含的前面", () => {
    const result = codes(searchCurrencies("n"));
    expect(result[0]).toBe("NZD");
    expect(result).toContain("CNY");
    expect(result).toContain("VND");
  });

  it("打中文名找得到", () => {
    expect(codes(searchCurrencies("美元"))).toEqual(["USD"]);
    expect(codes(searchCurrencies("泰銖"))).toEqual(["THB"]);
  });

  it("打國家或俗稱也找得到", () => {
    expect(codes(searchCurrencies("日本"))).toEqual(["JPY"]);
    expect(codes(searchCurrencies("美國"))).toEqual(["USD"]);
    expect(codes(searchCurrencies("美金"))).toEqual(["USD"]);
    expect(codes(searchCurrencies("峇里島"))).toEqual(["IDR"]);
  });

  it("「澳」同時找到澳幣與澳門幣", () => {
    const result = codes(searchCurrencies("澳"));
    expect(result).toContain("AUD");
    expect(result).toContain("MOP");
  });

  it("有打字時主要幣別也排在同一級的最前面", () => {
    // 「新」同時是新台幣與新加坡幣；主要幣別是 SGD 時它排第一。
    expect(codes(searchCurrencies("新", "SGD"))[0]).toBe("SGD");
  });

  it("前後空白不影響", () => {
    expect(codes(searchCurrencies("  usd  "))[0]).toBe("USD");
  });

  it("找不到時回空陣列", () => {
    expect(searchCurrencies("zzz")).toEqual([]);
  });
});
