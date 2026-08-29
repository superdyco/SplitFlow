/**
 * 一個成員在這個任務裡留下了哪些帳。
 *
 * 用來回答「移除他之後，結算頁還會不會看到他」——會，因為結算的參與者是從
 * 支出與付款推導的，不是從 `memberIds`。所以要讓他真的消失，得刪掉這些東西。
 *
 * **不必檢查 `splitMemberIds`**：那是自訂分攤之前的舊欄位，`normalizeExpense()`
 * 在讀取時就把它推回 `splits` 了，這裡拿到的一律是正規化之後的模型。
 */
import type { Expense } from "@/types/expense";
import type { Payment } from "@/types/payment";

export interface MemberFootprint {
  expenseIds: string[];
  paymentIds: string[];
  /**
   * 上面那些支出裡，有沒有**別人付的**。
   *
   * 真實移除會把整筆支出刪掉，所以只有這種時候才會連累到其他人 ——
   * 他自己付的帳刪掉只影響他自己。對話框靠這個決定要不要出那句警告。
   */
  othersPaid: boolean;
}

function inSplits(expense: Expense, uid: string): boolean {
  // 用 hasOwnProperty 而不是 `uid in splits`：後者會命中原型鏈上的東西，
  // uid 剛好叫 "toString" 的話會誤判。也不能用真值判斷 —— 自訂分攤
  // 可以給某個人 0 元，那也算參與。
  return Object.prototype.hasOwnProperty.call(expense.splits, uid);
}

export function memberFootprint(uid: string, expenses: Expense[], payments: Payment[]): MemberFootprint {
  const involved = expenses.filter(expense => expense.paidBy === uid || inSplits(expense, uid));

  return {
    expenseIds: involved.map(expense => expense.id),
    paymentIds: payments
      .filter(payment => payment.from === uid || payment.to === uid)
      .map(payment => payment.id),
    othersPaid: involved.some(expense => expense.paidBy !== uid)
  };
}

export function hasRecords(footprint: MemberFootprint): boolean {
  return footprint.expenseIds.length > 0 || footprint.paymentIds.length > 0;
}
