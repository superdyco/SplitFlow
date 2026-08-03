/**
 * 「我花了多少錢」—— 指的是我該分攤的，不是我先付出去的。
 * 先付的錢會被還，所以不是這趟旅行的成本。
 *
 * 純函式，不 import firebase 也不 import vue。
 */
import type { Expense } from "@/types/expense";
import { settleExpenses } from "@/utils/settlement";

/**
 * 刻意複用 `settleExpenses` 而不是另寫一套加總。
 *
 * 換算後的分攤金額沒有存在資料庫裡，是 `baseSplitsOf` 當場用原幣別金額當權重
 * 分配出來的，而餘數要分給誰取決於 `memberOrder`。自己寫一套的話，列表頁跟
 * 結算頁會差幾分錢，看起來就像 bug。走同一個函式，數字是構造上一致的。
 *
 * payments 傳空陣列：要的是「支出的分攤」，已經還過多少錢不影響這趟花了多少。
 */
export function myTripCost(
  expenses: Expense[],
  memberOrder: string[],
  uid: string,
  baseCurrency: string
): number {
  const { balances } = settleExpenses(expenses, [], memberOrder, baseCurrency);
  return balances.find(item => item.uid === uid)?.owed ?? 0;
}

export interface CurrencyAmount {
  currency: string;
  amount: number;
}

/**
 * 跨旅程的總計依幣別分開列，不合併。
 *
 * 每個任務有自己的主要幣別，把 TWD 跟 THB 加在一起是錯的。而且匯率是各筆
 * 支出記帳當下鎖定的，硬要再換一次會破壞「同一筆帳今天看跟下個月看一樣」。
 */
export function sumByCurrency(items: CurrencyAmount[]): CurrencyAmount[] {
  const totals = new Map<string, number>();
  for (const item of items) {
    totals.set(item.currency, (totals.get(item.currency) ?? 0) + item.amount);
  }

  return [...totals.entries()]
    .map(([currency, amount]) => ({ currency, amount }))
    .filter(item => item.amount !== 0)
    .sort((a, b) => b.amount - a.amount || a.currency.localeCompare(b.currency));
}
