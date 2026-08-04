import type { Timestamp } from "firebase/firestore";

export type ExpenseCategory = "food" | "transport" | "stay" | "ticket" | "shopping" | "other";

/** even：所有參與者均分。custom：每個人的金額由使用者自己填。 */
export type SplitMode = "even" | "custom";

export interface ExpenseCategoryMeta {
  value: ExpenseCategory;
  label: string;
  icon: string;
}

export const EXPENSE_CATEGORIES: ExpenseCategoryMeta[] = [
  { value: "food", label: "餐飲", icon: "🍽" },
  { value: "transport", label: "交通", icon: "🚗" },
  { value: "stay", label: "住宿", icon: "🏨" },
  { value: "ticket", label: "門票", icon: "🎟" },
  { value: "shopping", label: "購物", icon: "🛍" },
  { value: "other", label: "其他", icon: "📦" }
];

export const DEFAULT_CATEGORY: ExpenseCategory = "food";

export function categoryMeta(value: ExpenseCategory): ExpenseCategoryMeta {
  return EXPENSE_CATEGORIES.find(item => item.value === value) ?? { value, label: value, icon: "📦" };
}

/**
 * 支出發生的地點。用 Google Places 選的會有完整資訊，
 * 沒設定地點服務金鑰時使用者仍可以只打名稱，其餘欄位是 null。
 */
export interface ExpensePlace {
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  placeId: string | null;
}

/**
 * 支出的收據照片。用兩個欄位表達三種狀態，不另外開 status 欄位，
 * 因為多一個列舉就多一個會跟實際欄位對不上的機會。
 *
 *   path=null, localId="xxx"  待上傳（照片還在拍攝者的手機裡）
 *   path="...", localId=null  已上傳
 *   receipt 整個是 null        這筆支出沒有收據
 */
export interface ExpenseReceipt {
  /** Storage 物件路徑。等上傳時是 null。 */
  path: string | null;
  /** 本機待上傳佇列的 key。上傳成功後設回 null。 */
  localId: string | null;
}

export interface Expense {
  id: string;
  title: string;
  category: ExpenseCategory;
  /** 原幣別最小單位的整數，例如 THB 450.00 存成 45000。 */
  amount: number;
  currency: string;
  /**
   * 記帳當下的匯率：1 單位 currency 等於多少任務主要幣別。
   * 同幣別是 1。這個功能之前建立的舊資料可能是 null。
   */
  rate: number | null;
  /** amount 用 rate 換算成任務主要幣別後的最小單位整數。舊資料可能是 null。 */
  baseAmount: number | null;
  paidBy: string;
  splitMode: SplitMode;
  /** uid 對應該人分攤的原幣別金額，只包含有參與的人，總和等於 amount。 */
  splits: Record<string, number>;
  /** 選填，沒填就是 null。 */
  place: ExpensePlace | null;
  /** 收據照片，選填。這個功能之前建立的舊資料是 null。 */
  receipt: ExpenseReceipt | null;
  /**
   * 消費實際發生的日期，`"YYYY-MM-DD"`。
   * 用字串不用 Timestamp 是因為日期不該有時區：在曼谷凌晨買的東西，
   * 存成 Timestamp 之後換個時區看會變成前一天。
   * 這個欄位之前建立的舊資料是 null，顯示與排序會退回用 `createdAt`。
   */
  date: string | null;
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface ExpenseInput {
  title: string;
  category: ExpenseCategory;
  amount: number;
  currency: string;
  rate: number;
  baseAmount: number;
  paidBy: string;
  splitMode: SplitMode;
  splits: Record<string, number>;
  place: ExpensePlace | null;
  receipt: ExpenseReceipt | null;
  date: string;
}
