/**
 * 依地點彙總金額與筆數，給公開的旅費報告用。
 *
 * 報告的目的是「這樣玩一趟要花多少錢」，所以金額掛在地點上才有價值 ——
 * 讀者要知道的是「去大皇宮要準備多少」，地點名稱本身 Google 查得到。
 *
 * 用 `baseAmountOf` 取金額，跟 `categoryTotals` 與 `settleExpenses` 同一套規則：
 * 缺匯率的支出三邊都排除。不一致的話報告裡的數字會互相矛盾，那比沒有報告更糟。
 *
 * 純函式，不 import firebase 也不 import vue。
 */
import type { Expense } from "@/types/expense";
import { baseAmountOf } from "@/utils/settlement";

export const NO_PLACE_LABEL = "未指定地點";

export interface PlaceTotal {
  name: string;
  /** 從 Google 搜尋選出來的才有。純文字地點與「未指定地點」都是 null。 */
  placeId: string | null;
  lat: number | null;
  lng: number | null;
  /** 主要幣別最小單位整數。 */
  total: number;
  expenseCount: number;
}

/**
 * 分組的鍵：有 placeId 就用它（同一間店不同打法會合併），
 * 否則用名稱（使用者打一樣的名字就是指同一個地方）。
 */
function groupKey(expense: Expense): string {
  const place = expense.place;
  if (!place) return NO_PLACE_LABEL;
  return place.placeId ?? `name:${place.name}`;
}

export function placeTotals(expenses: Expense[], baseCurrency: string): PlaceTotal[] {
  const groups = new Map<string, PlaceTotal>();

  for (const expense of expenses) {
    const amount = baseAmountOf(expense, baseCurrency);
    if (amount === null) continue;

    const key = groupKey(expense);
    const existing = groups.get(key);
    if (existing) {
      existing.total += amount;
      existing.expenseCount += 1;
      continue;
    }

    const place = expense.place;
    groups.set(key, {
      name: place?.name ?? NO_PLACE_LABEL,
      placeId: place?.placeId ?? null,
      lat: place?.lat ?? null,
      lng: place?.lng ?? null,
      total: amount,
      expenseCount: 1
    });
  }

  // 「未指定地點」不是目的地，是把剩下的錢交代清楚的那一列，所以固定排最後。
  // 名稱當次要排序依據，金額相同時結果才不會隨輸入順序跳動。
  return [...groups.values()].sort((a, b) => {
    if (a.name === NO_PLACE_LABEL) return 1;
    if (b.name === NO_PLACE_LABEL) return -1;
    return b.total - a.total || a.name.localeCompare(b.name);
  });
}
