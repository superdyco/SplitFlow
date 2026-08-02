import type { Timestamp } from "firebase/firestore";
import type { Expense } from "@/types/expense";

export interface MemberBalance {
  uid: string;
  /** 這個人先付出去的總額（主要幣別最小單位）。 */
  paid: number;
  /** 這個人該分攤的總額（主要幣別最小單位）。 */
  owed: number;
  /** paid - owed，正數應收、負數應付。 */
  balance: number;
}

export interface Transfer {
  from: string;
  to: string;
  amount: number;
}

/** 即時算出來的結算結果，不寫進 Firestore。 */
export interface Settlement {
  /** 任務的主要幣別，所有金額都已經換算成這個幣別。 */
  currency: string;
  total: number;
  expenseCount: number;
  /** 已確認付款的總額。 */
  paidTotal: number;
  balances: MemberBalance[];
  transfers: Transfer[];
  /** 缺匯率所以沒辦法併進來的支出，畫面要提示使用者補。 */
  unconverted: Expense[];
}

/**
 * 存進 Firestore 的結算快照，是某個時間點的歷史紀錄。
 * 存下來之後不能修改，只能刪除，不然就不叫紀錄了。
 */
export interface SettlementSnapshot {
  id: string;
  currency: string;
  total: number;
  paidTotal: number;
  expenseCount: number;
  balances: MemberBalance[];
  transfers: Transfer[];
  /**
   * 存快照當下的暱稱。之後有人改暱稱或被移出任務，歷史紀錄仍顯示當時的名字，
   * 不會被後來的變動改寫。
   */
  memberNames: Record<string, string>;
  note: string;
  createdBy: string;
  createdAt: Timestamp;
}

export type SettlementSnapshotInput = Omit<SettlementSnapshot, "id" | "createdBy" | "createdAt">;
