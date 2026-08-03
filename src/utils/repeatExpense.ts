/**
 * 「再記一筆」要帶走哪些欄位。
 *
 * 旅行支出重複性很高（每天的交通、便利商店、同一間餐廳），每次從頭填很煩。
 * 這裡明確界定什麼跟著走、什麼重來，免得散在表單各處難以看懂。
 *
 * 純函式，不 import firebase 也不 import vue。
 */
import type { Expense, ExpensePlace, SplitMode } from "@/types/expense";

export interface RepeatFields {
  title: string;
  category: Expense["category"];
  currency: string;
  paidBy: string;
  splitMode: SplitMode;
  splits: Record<string, number>;
  place: ExpensePlace | null;
}

/**
 * 刻意不帶的三樣：
 * - `amount`：那正是每次要改的東西
 * - `date`：再記一筆是記今天的
 * - `rate` / `baseAmount`：匯率是記帳當下鎖定的，新的一筆要重新查今天的
 */
export function repeatFieldsOf(expense: Expense): RepeatFields {
  return {
    title: expense.title,
    category: expense.category,
    currency: expense.currency,
    paidBy: expense.paidBy,
    splitMode: expense.splitMode,
    // 複製而不是共用，改新的一筆不會動到來源那筆。
    splits: { ...expense.splits },
    place: expense.place ? { ...expense.place } : null
  };
}
