import type { Timestamp } from "firebase/firestore";
import type { CategoryTotal } from "@/utils/categoryTotals";
import type { PlaceTotal } from "@/utils/placeTotals";

/**
 * 公開的旅費報告快照。
 *
 * **這份文件任何人拿到連結都讀得到**，所以裡面絕對不能有 uid、成員暱稱、
 * 支出名稱或誰欠誰。只放算好的彙總數字。
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
  /** Storage 物件路徑。沒有地圖時是 null。 */
  mapPath: string | null;
  /** 撤銷就是這個變 false。 */
  active: boolean;
  /** 第一次產生的時間，重新產生時保留不動。 */
  createdAt: Timestamp;
  /** 最後一次重新產生的時間，報告上顯示這個。 */
  updatedAt: Timestamp;
}

export type TripReportInput = Omit<TripReport, "id" | "createdAt" | "updatedAt">;
