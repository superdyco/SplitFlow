/**
 * 把結算結果變成可以貼進聊天室的純文字。
 *
 * 刻意不 import firebase、也不 import vue，理由跟 `utils/authError.ts` 一樣：
 * 純函式才測得動，不用為了跑字串測試去初始化整個 Firebase App。
 * （`Transfer` 是 `import type`，編譯後會被抹掉，不會變成執行期相依。）
 */
import type { Transfer } from "@/types/settlement";
import { formatAmount } from "@/utils/currency";

const DIVIDER = "────────────────";
const SETTLED = "大家都已結清，不需要轉帳。";
const UNKNOWN_MEMBER = "已離開的成員";

export interface SettlementTextInput {
  taskName: string;
  currency: string;
  transfers: Transfer[];
  /** uid 對暱稱。即時結算由成員列表組出來，快照用自己存的那份。 */
  memberNames: Record<string, string>;
  expenseCount: number;
  total: number;
  /** 缺匯率、沒被算進結算的支出筆數。快照沒有這個概念，省略即可。 */
  unconvertedCount?: number;
  /** 還沒扣進轉帳金額的待確認付款筆數。快照省略即可。 */
  pendingCount?: number;
  /** 快照才有，標在標題上。 */
  snapshotDate?: string;
  /** 快照的備註，空白就不輸出。 */
  note?: string;
}

export function buildSettlementText(input: SettlementTextInput): string {
  const { taskName, currency, transfers, memberNames, expenseCount, total } = input;

  const name = (uid: string) => memberNames[uid] || UNKNOWN_MEMBER;
  const money = (amount: number) => `${currency} ${formatAmount(amount, currency)}`;

  const lines: string[] = [];

  lines.push(input.snapshotDate ? `${taskName} · 結算（${input.snapshotDate}）` : `${taskName} · 結算`);

  const note = input.note?.trim();
  if (note) lines.push(note);

  lines.push(DIVIDER);

  if (transfers.length) {
    for (const transfer of transfers) {
      lines.push(`${name(transfer.from)} → ${name(transfer.to)}  ${money(transfer.amount)}`);
    }
  } else {
    lines.push(SETTLED);
  }

  lines.push("");
  lines.push(`${expenseCount} 筆支出 · 共 ${money(total)}`);

  // 這兩行是正確性需求：未換算的支出根本沒進結算，總額偏低；待確認的付款
  // 還沒從轉帳金額扣掉。不講的話，貼進群組就是散播錯的數字。
  const warnings: string[] = [];
  if (input.unconvertedCount) {
    warnings.push(`⚠ 有 ${input.unconvertedCount} 筆支出還沒有匯率，未算入上面的金額`);
  }
  if (input.pendingCount) {
    warnings.push(`⚠ 有 ${input.pendingCount} 筆付款等待確認，還沒從上面的金額扣除`);
  }
  if (warnings.length) {
    lines.push("");
    lines.push(...warnings);
  }

  return lines.join("\n");
}
