/**
 * 支出按日期分組，給列表收合用。
 *
 * 四十筆帳排成一長串很難找東西，分組之後「那筆晚餐在哪」從捲四十筆
 * 變成點一天。每組順便帶當天的小計。
 *
 * 純函式，不 import firebase 也不 import vue。
 */
import type { Expense } from "@/types/expense";
import { baseAmountOf } from "@/utils/settlement";
import { expenseDate } from "@/utils/expenseDate";

export interface ExpenseGroup {
  /** `"YYYY-MM-DD"`。 */
  date: string;
  expenses: Expense[];
  count: number;
  /** 當天小計，主要幣別的最小單位整數。只加得出換算金額的那些。 */
  total: number;
  /** 當天有沒有缺匯率、沒被計進小計的支出。 */
  hasUnconverted: boolean;
}

/**
 * 傳進來的順序就是組內的順序，不重新排 —— 列表已經用 `compareExpenses`
 * 排過（同一天後記的在前），這裡再排一次只會把那個順序弄掉。
 */
export function groupExpensesByDate(expenses: Expense[], baseCurrency: string): ExpenseGroup[] {
  const groups = new Map<string, ExpenseGroup>();

  for (const expense of expenses) {
    const date = expenseDate(expense);
    let group = groups.get(date);
    if (!group) {
      group = { date, expenses: [], count: 0, total: 0, hasUnconverted: false };
      groups.set(date, group);
    }

    group.expenses.push(expense);
    group.count += 1;

    // 缺匯率的仍然列出來 —— 看得到才知道要去補。但不能算進小計，不然數字是錯的。
    const amount = baseAmountOf(expense, baseCurrency);
    if (amount === null) group.hasUnconverted = true;
    else group.total += amount;
  }

  return [...groups.values()].sort((a, b) => b.date.localeCompare(a.date));
}
