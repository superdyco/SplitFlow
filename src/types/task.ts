import type { Timestamp } from "firebase/firestore";

export type TaskStatus = "active";

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
  /** 舊任務可能沒有這個欄位，判斷時用 `!== false`。 */
  inviteActive: boolean;
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
