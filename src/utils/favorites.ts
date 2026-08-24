/**
 * 收藏的純邏輯：id 怎麼組、報告怎麼壓成一份快照。
 *
 * 抽出來是因為這兩件事決定了「同一份報告會不會被收藏兩次」與「收藏頁看得到
 * 什麼」，兩個都值得用測試釘住。純函式模組，不 import firebase 也不 import vue。
 */
import type { FavoriteInput } from "@/types/favorite";

/**
 * 收藏文件的 id。
 *
 * 用 `taskId_reportId` 這種算得出來的 id，而不是隨機 id：
 *
 *   - 同一份報告按兩次收藏只會蓋寫同一份，不會變成兩筆
 *   - 「這份我收藏過了嗎」是一次 doc 讀取，不用先查一遍清單
 *
 * 兩個 id 都是 Firestore 的自動 id（英數字，不含底線），所以底線當分隔符
 * 不會撞到內容。
 */
export function favoriteId(taskId: string, reportId: string): string {
  return `${taskId}_${reportId}`;
}

/** 報告快照裡，收藏清單真的會顯示的那幾個欄位。 */
export interface ReportSnapshot {
  taskName: string;
  currency: string;
  startDate: string | null;
  endDate: string | null;
  days: number | null;
  memberCount: number;
  total: number;
}

/**
 * 把一份報告壓成要存進收藏的樣子。
 *
 * 明確列出每一個欄位而不是整份展開 —— 報告以後多了什麼（時間軸、地點、
 * 分類明細）都不該自動跟著跑進使用者的收藏裡。收藏頁畫不到的東西就不要存。
 */
export function toFavoriteInput(
  taskId: string,
  reportId: string,
  report: ReportSnapshot
): FavoriteInput {
  return {
    taskId,
    reportId,
    taskName: report.taskName,
    currency: report.currency,
    startDate: report.startDate,
    endDate: report.endDate,
    days: report.days,
    memberCount: report.memberCount,
    total: report.total
  };
}
