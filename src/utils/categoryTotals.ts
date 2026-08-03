/**
 * 各分類的支出金額與佔比。
 *
 * 用 `baseAmountOf` 取換算後的金額，跟 `settleExpenses` 是同一套規則 ——
 * 缺匯率的支出兩邊都排除。不一致的話圖表的總和會跟結算的總額對不起來，
 * 那比沒有圖表更糟。
 *
 * 純函式，不 import firebase 也不 import vue。
 */
import type { Expense, ExpenseCategory } from "@/types/expense";
import { EXPENSE_CATEGORIES } from "@/types/expense";
import { baseAmountOf } from "@/utils/settlement";

export interface CategoryTotal {
  category: ExpenseCategory;
  /** 主要幣別的最小單位整數。 */
  total: number;
  /** 佔列入金額的百分比，0-100。 */
  share: number;
}

/** 金額相同時的次要排序依據，讓結果不會因為輸入順序而跳動。 */
const CATEGORY_ORDER = new Map(EXPENSE_CATEGORIES.map((meta, index) => [meta.value, index]));

export function categoryTotals(expenses: Expense[], baseCurrency: string): CategoryTotal[] {
  const totals = new Map<ExpenseCategory, number>();
  let sum = 0;

  for (const expense of expenses) {
    const amount = baseAmountOf(expense, baseCurrency);
    if (amount === null) continue;
    totals.set(expense.category, (totals.get(expense.category) ?? 0) + amount);
    sum += amount;
  }

  return [...totals.entries()]
    .map(([category, total]) => ({
      category,
      total,
      share: sum > 0 ? (total / sum) * 100 : 0
    }))
    .sort(
      (a, b) =>
        b.total - a.total ||
        (CATEGORY_ORDER.get(a.category) ?? 0) - (CATEGORY_ORDER.get(b.category) ?? 0)
    );
}
