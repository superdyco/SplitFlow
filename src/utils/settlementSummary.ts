/**
 * 摘要卡要顯示什麼。規則放這裡而不是元件裡，元件只負責畫。
 *
 * 純函式，不 import vue。
 */
import type { MemberBalance, Transfer } from "@/types/settlement";

export interface SummaryLine {
  from: string;
  to: string;
  amount: number;
  /** true 代表這筆是「我要付出去」。 */
  outgoing: boolean;
}

/**
 * 摘要卡上跟我有關的轉帳。
 *
 * 最少轉帳次數的演算法很少讓一個人牽涉到很多筆，max 實務上幾乎碰不到 ——
 * 但沒有它，畫面可以無限長。
 */
export function myTransfers(
  transfers: Transfer[],
  uid: string,
  max = 3
): { lines: SummaryLine[]; rest: number } {
  const mine = transfers.filter(item => item.from === uid || item.to === uid);

  return {
    lines: mine.slice(0, max).map(item => ({
      from: item.from,
      to: item.to,
      amount: item.amount,
      outgoing: item.from === uid
    })),
    rest: Math.max(mine.length - max, 0)
  };
}

/**
 * 我該分攤多少。
 *
 * 是 owed 不是 balance —— balance 是「我多付或少付了多少」，那是另一件事，
 * 而兩者寫錯的畫面看起來完全正常。
 *
 * 找不到我就是 0：沒參與任何一筆支出的人不會出現在 balances 裡，
 * 那時候該顯示 0 而不是空白。
 */
export function myOwed(balances: MemberBalance[], uid: string): number {
  return balances.find(item => item.uid === uid)?.owed ?? 0;
}
