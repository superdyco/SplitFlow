/**
 * 任務列表的查詢計畫。
 *
 * 比使用者那邊單純：三個狀態都是等值過濾，排序一律是最後活動由新到舊。
 * 抽出來是為了「不認得的篩選要回 null 不要給預設值」這條 —— 默默當成
 * 「全部」的話，前端傳錯值只會讓管理者看到一份不是他選的名單。
 */

import type { ExpenseCategory } from "./categories.js";

export type TaskFilter = "active" | "archived" | "deleted" | "all";

export function parseTaskFilter(value: unknown): TaskFilter | null {
  return value === "active" || value === "archived" || value === "deleted" || value === "all"
    ? value
    : null;
}

/**
 * 分類佔比。
 *
 * 傳進來的是各分類的金額，回傳的是**已排序、含百分比**的清單。百分比在這裡
 * 算完，是因為前端各自算會出現兩邊四捨五入不一致的情況 —— 而佔比條與旁邊的
 * 數字對不上，是那種一眼看得到卻查很久的問題。
 */
export interface CategorySlice {
  category: ExpenseCategory;
  amount: number;
  /** 0–100，四捨五入到整數。全部加起來不保證剛好 100，見下。 */
  percent: number;
}

export function categorySlices(
  amounts: Record<ExpenseCategory, number>,
  order: readonly ExpenseCategory[]
): CategorySlice[] {
  const total = order.reduce((sum, key) => sum + (amounts[key] || 0), 0);

  return order
    .map(category => {
      const amount = amounts[category] || 0;
      return {
        category,
        amount,
        /*
          總額是 0 的時候回 0 而不是 NaN。任務剛建立、一筆支出都還沒有的
          時候會走到這裡，而 NaN 會讓佔比條的寬度變成 "NaN%"，整條消失。
        */
        percent: total > 0 ? Math.round((amount / total) * 100) : 0
      };
    })
    .filter(slice => slice.amount > 0)
    .sort((a, b) => b.amount - a.amount);
}

/**
 * 四捨五入之後的百分比不保證加起來是 100（三個 33.3% 會變成 99）。
 *
 * 這裡不去湊。湊的做法是把差額塞給最大的那一項，而那會讓「最大的那一項」
 * 顯示一個跟它的金額對不上的百分比 —— 用一個看不見的錯換掉一個看得見的，
 * 不划算。佔比條用的是金額比例不是這個整數，所以條的長度是對的。
 */
export function percentSum(slices: CategorySlice[]): number {
  return slices.reduce((sum, slice) => sum + slice.percent, 0);
}
