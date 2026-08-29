/**
 * 移除成員的對話框內容。
 *
 * 移除只拿掉權限，不動帳目：既有支出的 `paidBy` 與 `splits` 原封不動，
 * 結算也照樣把他算進去（參與者是從支出本身收集的，不是從 memberIds）。
 * 真正改變的是他讀不到這個任務了 —— 所以未結清時要講清楚後果。
 *
 * 純函式，方便測試訊息本身，不牽扯 Firestore。
 */
import { formatAmount } from "@/utils/currency";

export interface RemoveMemberPromptInput {
  name: string;
  expenseCount: number;
  paymentCount: number;
  /**
   * 正數代表還有人要付給他，負數代表他還沒付。
   *
   * `null` 代表**算不出來**（結算還沒載完之類），跟 0 是兩回事 ——
   * 把兩者混為一談等於在一個不可逆的決定前面謊報「他沒有欠款」。
   */
  balance: number | null;
  currency: string;
  /** 虛擬成員沒有帳號，本來就看不到任務，那句後果對他沒有意義。 */
  virtual?: boolean;
  /** 要刪掉的支出裡，有沒有別人付的。有的話刪掉會連累到那些人。 */
  othersPaid?: boolean;
}

export interface RemoveMemberPrompt {
  title: string;
  message: string;
  /** true 代表要給「保留 / 真實移除」兩個選擇；false 代表直接刪。 */
  hasRecords: boolean;
}

/**
 * 沒有帳的人不給選擇 —— 沒東西可失去，多問一次只是擋路。
 *
 * 刻意**不要求打出名字**：那層摩擦留給刪整個任務（`taskActionPrompt`），
 * 成員移除已經有兩段式的選擇，而且訊息裡把後果都講明了。
 *
 * 兩個選項的說明都是**陳述句**，不是問句。這裡曾經直接嵌入一份獨立的確認
 * 訊息（結尾是「確定要移除嗎？」、中間還有空行），變成在選項裡再問一次，
 * 而且餘額不是 0 的時候會在兩個項目符號之間插進空行與一個懸空的問句。
 */
export function removeMemberPrompt({
  name,
  expenseCount,
  paymentCount,
  balance,
  currency,
  virtual = false,
  othersPaid = false
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

  const money = (amount: number) => `${currency} ${formatAmount(amount, currency)}`;

  // 虛擬成員從來就沒有帳號，「他之後看不到這個任務」對他不成立。
  const access = virtual ? "" : "他之後看不到這個任務。";

  const owing =
    balance === null
      ? "目前算不出他的結算餘額。"
      : balance < 0
        ? `他還有 ${money(-balance)} 沒付。`
        : balance > 0
          ? `還有 ${money(balance)} 要付給他。`
          : "";

  // 只有真的會連累別人時才警告。他自己付的帳刪掉只影響他自己。
  const others = othersPaid ? "其中有些支出是別人付的，刪掉之後那些人的帳也會跟著不見。" : "";

  const lines = [
    `${who} 出現在 ${counts}裡。`,
    "",
    `・保留結算資料：把他從成員名單移除，那 ${counts}與結算金額都保留。${access}${owing}`,
    "",
    `・真實移除：連同那 ${counts}一起刪除，無法復原。${others}結算紀錄裡仍然看得到他的名字。`
  ];

  return {
    title,
    message: lines.join("\n"),
    hasRecords: true
  };
}
