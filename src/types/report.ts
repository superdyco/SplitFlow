import type { Timestamp } from "firebase/firestore";
import type { CategoryTotal } from "@/utils/categoryTotals";
import type { PlaceTotal } from "@/utils/placeTotals";
import type { ReportDay } from "@/utils/reportTimeline";

/**
 * 公開的旅費報告快照。
 *
 * **這份文件任何人拿到連結都讀得到**，所以裡面絕對不能有 uid、成員暱稱
 * 或誰欠誰。除了時間軸之外只放算好的彙總數字。
 *
 * `timeline` 是唯一逐筆列出來的地方：時間、分類、支出名稱、金額。名稱是
 * 使用者自己打的字串，會跟著連結公開 —— 產生報告的畫面上有講這件事。
 * 人的部分（誰付的、怎麼分的）在任何地方都不出現。
 */
export interface TripReport {
  id: string;
  taskName: string;
  currency: string;
  startDate: string | null;
  endDate: string | null;
  /** 旅程天數，含頭尾。算不出來是 null。 */
  days: number | null;
  memberCount: number;
  /** 列入計算的支出筆數（缺匯率的已排除）。 */
  expenseCount: number;
  total: number;
  perPerson: number;
  categories: CategoryTotal[];
  places: PlaceTotal[];
  /** 一天一段的行程時間軸。這個功能之前產生的報告是空陣列。 */
  timeline: ReportDay[];
  /** Storage 物件路徑。沒有地圖時是 null。 */
  mapPath: string | null;
  /** 撤銷就是這個變 false。拿到連結的人讀不讀得到，看這個。 */
  active: boolean;
  /**
   * 要不要列進「探索」那一頁讓所有人瀏覽得到。
   *
   * 跟 `active` 是兩件事：`active` 是「拿到連結的人看不看得到」，這個是
   * 「陌生人找不找得到」。只想傳給朋友的人，連結開著但這個不勾。
   *
   * 這個功能之前產生的報告沒有這個欄位，讀取時補成 false —— 沒有人被迫
   * 在不知情的狀況下公開自己的旅程。
   */
  listed: boolean;
  /** 第一次產生的時間，重新產生時保留不動。 */
  createdAt: Timestamp;
  /** 最後一次重新產生的時間，報告上顯示這個。 */
  updatedAt: Timestamp;
}

export type TripReportInput = Omit<TripReport, "id" | "createdAt" | "updatedAt">;

/**
 * 探索頁列出來的報告。
 *
 * 多一個 taskId 是因為報告文件本身不存自己的任務 id —— 它藏在路徑裡，
 * 而 collection group 查詢回來之後路徑就散了。連結要靠它才組得出來。
 */
export interface PublicReport extends TripReport {
  taskId: string;
}
