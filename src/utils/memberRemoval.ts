/**
 * 移除成員前的確認訊息。
 *
 * 移除只拿掉權限，不動帳目：既有支出的 `paidBy` 與 `splits` 原封不動，
 * 結算也照樣把他算進去（參與者是從支出本身收集的，不是從 memberIds）。
 * 真正改變的是他讀不到這個任務了 —— 所以未結清時要講清楚後果。
 *
 * 純函式，方便測試訊息本身，不牽扯 Firestore。
 */
import { formatAmount } from "@/utils/currency";

export interface RemoveMemberMessageInput {
  name: string;
  /** 正數代表還有人要付給他，負數代表他還沒付。 */
  balance: number;
  currency: string;
}

export function removeMemberMessage({ name, balance, currency }: RemoveMemberMessageInput): string {
  const who = name || "這位成員";
  const money = (amount: number) => `${currency} ${formatAmount(amount, currency)}`;

  if (balance === 0) {
    return `確定要把 ${who} 移出任務嗎？他就看不到這個任務了，但既有支出會保留。`;
  }

  // 欠錢跟被欠錢的後果不一樣：前者是他付不了，後者是他看不到誰還沒還他。
  const situation =
    balance < 0
      ? `${who} 還有 ${money(-balance)} 沒付。`
      : `還有 ${money(balance)} 要付給 ${who}。`;

  const consequence =
    balance < 0
      ? "移出後他就看不到這個任務，也沒辦法自己記錄付款，只能由管理員代記。"
      : "移出後他就看不到這個任務，也查不到誰還沒付他錢。";

  return `${situation}\n\n${consequence}既有支出與結算金額都會保留。\n\n確定要移除嗎？`;
}
