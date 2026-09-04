/**
 * 「這個人能不能刪掉這張收據」的判斷。
 *
 * 抽成純函式的理由跟 `joinDecision` 一樣：這是安全邊界，值得被單獨測到。
 *
 * 為什麼這件事非得在伺服器端做：**Storage 規則讀不到 Firestore**，所以
 * 它寫得出「這個人登入了」，寫不出「這個人動得了這筆支出」。舊版的
 * `allow delete: if request.auth != null` 因此比 Firestore 那邊的
 * `canManageExpense` 鬆得多 —— 同一個任務裡的一般成員刪不掉別人的支出，
 * 卻刪得掉那筆支出的照片。
 */

export interface ReceiptTaskDoc {
  status?: unknown;
  memberIds?: unknown;
  adminIds?: unknown;
}

export interface ReceiptExpenseDoc {
  createdBy?: unknown;
  paidBy?: unknown;
}

export type ReceiptVerdict =
  /** 可以刪。 */
  | { kind: "allow" }
  /** 不是這個任務的成員，或任務不存在。連這張圖存不存在都不該讓他知道。 */
  | { kind: "denied" }
  /** 是成員，但動不了這筆支出。 */
  | { kind: "not-yours" }
  /** 任務已封存 —— 封存的重點就是留著查，照片也一樣。 */
  | { kind: "inactive-task" };

export function canDeleteReceipt(input: {
  task: ReceiptTaskDoc | null;
  /** 支出可能已經不在了：刪成員時是先刪帳、最後才清照片。 */
  expense: ReceiptExpenseDoc | null;
  uid: string;
}): ReceiptVerdict {
  const { task, expense, uid } = input;

  if (!task) return { kind: "denied" };

  const memberIds = Array.isArray(task.memberIds) ? task.memberIds : [];
  if (!memberIds.includes(uid)) return { kind: "denied" };

  // 封存的任務唯讀。Firestore 那邊的支出刪除也擋著同一件事。
  if (task.status !== "active") return { kind: "inactive-task" };

  const adminIds = Array.isArray(task.adminIds) ? task.adminIds : [];
  if (adminIds.includes(uid)) return { kind: "allow" };

  /*
    支出已經不在了，剩下的只有孤兒檔案。這是 `hardDeleteMember` 的路徑：
    它先把帳刪光，最後才清照片 —— 那個順序是刻意的（見 memberService 的
    註解），所以這裡查不到支出是正常的，不是異常。

    那時候沒有東西可以比對 createdBy/paidBy，只能退回「你是不是 admin」。
    這不會放寬任何東西：會走到這條路的本來就只有 admin。
  */
  if (!expense) return { kind: "not-yours" };

  // 跟 firestore.rules 的 canManageExpense() 同一組條件。兩邊分岔的症狀是
  // 「支出刪得掉但照片刪不掉」，留下一張沒有帳的收據。
  const mine = expense.createdBy === uid || expense.paidBy === uid;
  return mine ? { kind: "allow" } : { kind: "not-yours" };
}
