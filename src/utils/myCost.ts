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

/** 一趟旅程算出來的成本。只有算成功的才會有這個東西。 */
export interface TripCost {
  taskId: string;
  name: string;
  currency: string;
  amount: number;
}

/** 佔比條的一段。 */
export interface CostShare {
  name: string;
  amount: number;
  ratio: number;
}

/**
 * 總計只包含傳進來的旅程。
 *
 * 讀失敗的旅程不該出現在輸入裡，也不該在別處被補成 0 ——「算不出來」
 * 跟「花了零元」是兩件事，混在一起會讓總額少一截，而畫面上看起來
 * 完全正常。
 */
export function totalsOf(ok: TripCost[]): CurrencyAmount[] {
  return sumByCurrency(ok.map(item => ({ currency: item.currency, amount: item.amount })));
}

/**
 * 某個幣別底下各趟的佔比。
 *
 * 只算同一個幣別：跨幣別的金額不能相加，分母混進別的幣別會得到一個
 * 沒有意義的數字。這跟 `sumByCurrency` 不合併幣別是同一個理由。
 */
export function sharesOf(ok: TripCost[], currency: string, max = 3): CostShare[] {
  const rows = ok
    .filter(item => item.currency === currency && item.amount > 0)
    .sort((a, b) => b.amount - a.amount);

  const total = rows.reduce((sum, item) => sum + item.amount, 0);
  // 分母是 0 的長條沒有意義，而且會產生 NaN。
  if (total <= 0) return [];

  const share = (item: TripCost): CostShare => ({
    name: item.name,
    amount: item.amount,
    ratio: item.amount / total
  });

  /*
    只多一趟就不併。併一項進「其他」等於把一個有名字的旅程改名，
    那比多列一行更糟 —— 使用者會找不到自己認得的那趟去哪了。
  */
  if (rows.length <= max + 1) return rows.map(share);

  const rest = rows.slice(max).reduce((sum, item) => sum + item.amount, 0);
  return [...rows.slice(0, max).map(share), { name: "其他", amount: rest, ratio: rest / total }];
}
