/**
 * 收據照片的路徑規則與上傳佇列的判斷。
 *
 * 判斷跟 I/O 分開，是因為 IndexedDB 與 Storage 在測試環境裡都跑不起來，
 * 但真正容易寫錯的是「這個項目現在該怎麼辦」。那部分放在這裡就測得到。
 *
 * 純函式，不 import firebase、不 import vue，也不碰任何瀏覽器儲存。
 */

/** 壓縮後照片的長邊上限（px）。收據小字多，再小就開始糊到讀不出金額。 */
export const MAX_EDGE = 1600;

/** 連續失敗幾次之後停止自動重試，交還給使用者決定。 */
export const MAX_ATTEMPTS = 5;

/** 佇列項目的保存期限。超過就丟掉，不然傳不出去的圖會永遠佔著手機空間。 */
export const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * 一筆支出一張收據，所以路徑可以直接推導、不需要存檔名。
 * 這也讓「換照片」變成單純的覆蓋，不會累積舊檔。
 *
 * 分成獨立的目錄層而不是 `{expenseId}.jpg`，是因為 Storage 規則的路徑萬用字元
 * 只能吃整個 segment，帶字面後綴的寫法比對不到。
 */
export function receiptPath(taskId: string, expenseId: string): string {
  return `tasks/${taskId}/expenses/${expenseId}/receipt.jpg`;
}

export type QueueAction =
  /** 現在就傳。 */
  | "upload"
  /** 太舊了，從佇列刪掉。 */
  | "drop-expired"
  /** 試太多次了，保留項目但停止自動重試，等使用者手動觸發。 */
  | "hold-exhausted";

export interface QueueDecisionInput {
  createdAt: number;
  attempts: number;
}

/** 過期優先於試到上限 —— 都過期了，留著讓使用者手動重試也沒有意義。 */
export function queueAction(item: QueueDecisionInput, now: number): QueueAction {
  if (now - item.createdAt > MAX_AGE_MS) return "drop-expired";
  if (item.attempts >= MAX_ATTEMPTS) return "hold-exhausted";
  return "upload";
}
