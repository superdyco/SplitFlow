import { describe, expect, it } from "vitest";
import { categoryTotals } from "@/utils/categoryTotals";
import type { Expense } from "@/types/expense";

/** 只給 categoryTotals 會用到的欄位，其餘用 as 補齊，測試不必湊出完整的 Expense。 */
function expense(category: Expense["category"], baseAmount: number | null, currency = "TWD"): Expense {
  return { category, baseAmount, currency, amount: baseAmount ?? 0 } as Expense;
}

describe("categoryTotals", () => {
  it("依分類加總，金額大的排前面", () => {
    const result = categoryTotals(
      [
        expense("transport", 30000),
        expense("food", 80000),
        expense("food", 20000),
        expense("stay", 50000)
      ],
      "TWD"
    );
    expect(result.map(item => [item.category, item.total])).toEqual([
      ["food", 100000],
      ["stay", 50000],
      ["transport", 30000]
    ]);
  });

  it("佔比以列入的總額為分母，加起來是 100", () => {
    const result = categoryTotals([expense("food", 75000), expense("stay", 25000)], "TWD");
    expect(result.map(item => item.share)).toEqual([75, 25]);
  });

  it("沒有支出時回空陣列，不是除以零", () => {
    expect(categoryTotals([], "TWD")).toEqual([]);
  });

  it("沒出現的分類不會佔位", () => {
    const result = categoryTotals([expense("food", 10000)], "TWD");
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe("food");
  });

  it("缺匯率的支出排除在外，跟結算同一套規則", () => {
    // baseAmount 是 null 且幣別不同 —— 這種在結算裡也不算，圖表跟著排除，
    // 否則圖表總和會跟結算的總額對不起來。
    const result = categoryTotals(
      [expense("food", 60000), expense("shopping", null, "THB"), expense("stay", 40000)],
      "TWD"
    );
    expect(result.map(item => item.category)).toEqual(["food", "stay"]);
    expect(result.map(item => item.share)).toEqual([60, 40]);
  });

  it("同幣別的舊資料沒有 baseAmount，用原金額當作已換算", () => {
    const result = categoryTotals([expense("food", null, "TWD")], "TWD");
    expect(result).toHaveLength(1);
    expect(result[0].total).toBe(0);
  });

  it("金額相同時依分類固定順序排，結果不會跳動", () => {
    const a = categoryTotals([expense("stay", 10000), expense("food", 10000)], "TWD");
    const b = categoryTotals([expense("food", 10000), expense("stay", 10000)], "TWD");
    expect(a.map(item => item.category)).toEqual(b.map(item => item.category));
  });
});
