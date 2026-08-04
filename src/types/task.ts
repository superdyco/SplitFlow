import type { Timestamp } from "firebase/firestore";

/**
 * active   進行中，可讀可寫
 * archived 封存，唯讀。旅程結束了，帳留著查，但不能再改。
 * deleted  軟刪除。前端一律濾掉，使用者看不到。
 *
 * 用軟刪除是因為 Firestore 沒有 cascade delete —— 刪掉任務文件會讓底下的
 * members / expenses / payments / settlements 四個子集合變成永遠的孤兒。
 */
export type TaskStatus = "active" | "archived" | "deleted";

export interface Task {
  id: string;
  name: string;
  ownerId: string;
  adminIds: string[];
  memberIds: string[];
  defaultCurrency: string;
  startDate: string | null;
  endDate: string | null;
  status: TaskStatus;
  inviteCode: string;
  memberCount: number;
  expenseCount: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface CreateTaskInput {
  name: string;
  defaultCurrency: string;
  startDate: string | null;
  endDate: string | null;
}

export interface Invite {
  taskId: string;
  taskName: string;
  defaultCurrency: string;
  startDate: string | null;
  endDate: string | null;
  createdBy: string;
  active: boolean;
  createdAt: Timestamp;
}
