import type { Timestamp } from "firebase/firestore";

export type TaskRole = "owner" | "admin" | "member";

export interface TaskMember {
  uid: string;
  nickname: string;
  role: TaskRole;
  joinedAt: Timestamp;
  active: boolean;
}
