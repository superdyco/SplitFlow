import type { Timestamp } from "firebase/firestore";

/**
 * pending：付款人說付了，等收款人確認。
 * confirmed：收款人確認收到，這筆才會折抵結算餘額。
 */
export type PaymentStatus = "pending" | "confirmed";

export interface Payment {
  id: string;
  from: string;
  to: string;
  /** 任務主要幣別的最小單位整數。 */
  amount: number;
  currency: string;
  status: PaymentStatus;
  createdBy: string;
  createdAt: Timestamp;
  confirmedAt: Timestamp | null;
  updatedAt: Timestamp;
}

export interface PaymentInput {
  from: string;
  to: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
}
