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

export interface RemoveMemberPromptInput {
  name: string;
  expenseCount: number;
  paymentCount: number;
  balance: number;
  currency: string;
}

export interface RemoveMemberPrompt {
  title: string;
  message: string;
  /** true 代表要給「保留 / 真實移除」兩個選擇；false 代表直接刪。 */
  hasRecords: boolean;
}

/**
 * 移除成員的對話框內容。
 *
 * 沒有帳的人不給選擇 —— 沒東西可失去，多問一次只是擋路。
 *
 * 刻意**不要求打出名字**：那層摩擦留給刪整個任務（`taskActionPrompt`），
 * 成員移除已經有兩段式的選擇，而且訊息裡把後果都講明了。
 */
export function removeMemberPrompt({
  name,
  expenseCount,
  paymentCount,
  balance,
  currency
}: RemoveMemberPromptInput): RemoveMemberPrompt {
  const who = name || "這位成員";
  const title = `移除「${who}」`;

  if (expenseCount === 0 && paymentCount === 0) {
    return {
      title,
      message: `${who} 還沒有任何支出與付款記錄，會直接從這個任務移除。`,
      hasRecords: false
    };
  }

  // 只列真的有的那幾項，不然會出現「0 筆支出」這種讀起來很怪的句子。
  const counts = [
    expenseCount > 0 ? `${expenseCount} 筆支出` : null,
    paymentCount > 0 ? `${paymentCount} 筆付款記錄` : null
  ]
    .filter(Boolean)
    .join("、");

  const lines = [
    `${who} 出現在 ${counts}裡。`,
    "",
    `・保留結算資料：${removeMemberMessage({ name: who, balance, currency })}`,
    "",
    `・真實移除：連同那 ${counts}一起刪除，無法復原。其中有些支出是別人付的，刪掉之後那些人的帳也會跟著不見。結算紀錄裡仍然看得到他的名字。`
  ];

  return {
    title,
    message: lines.join("\n"),
    hasRecords: true
  };
}
