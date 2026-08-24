import type { Timestamp } from "firebase/firestore";

/**
 * 收藏起來的旅費報告。存在 `users/{uid}/favorites/{taskId}_{reportId}`，
 * **純私人資料，只有自己讀得到**。
 *
 * 刻意存一份快照而不是只存 taskId + reportId：收藏頁如果只存兩個 id，
 * 每畫一列就要多讀一次報告文件，二十筆收藏就是二十趟往返。而這一頁要的
 * 只是名字、天數、總額這幾個字，抄一份下來就能一次查詢畫完。
 *
 * 代價是原作者重新產生報告後，收藏裡的數字會停在收藏當下 —— 對「我存起來
 * 之後想再看看」這個用途，那反而是對的：看到的是你當初收藏的那一版。
 * 點進去看到的報告永遠是最新的。
 */
export interface FavoriteReport {
  /** `${taskId}_${reportId}`。用固定 id 才不會同一份報告收藏兩次。 */
  id: string;
  taskId: string;
  reportId: string;
  taskName: string;
  currency: string;
  startDate: string | null;
  endDate: string | null;
  /** 旅程天數，含頭尾。算不出來是 null。 */
  days: number | null;
  memberCount: number;
  /** 收藏當下的總額，最小單位整數。 */
  total: number;
  savedAt: Timestamp;
}

export type FavoriteInput = Omit<FavoriteReport, "id" | "savedAt">;
