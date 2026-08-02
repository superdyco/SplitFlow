import type { Timestamp } from "firebase/firestore";

export type TaskRole = "owner" | "admin" | "member";

/** owner 不能被降級或移除，所以角色切換只在這兩個值之間。 */
export type AssignableRole = Exclude<TaskRole, "owner">;

export const ROLE_LABELS: Record<TaskRole, string> = {
  owner: "擁有者",
  admin: "管理員",
  member: "成員"
};

export interface TaskMember {
  uid: string;
  nickname: string;
  role: TaskRole;
  joinedAt: Timestamp;
  active: boolean;
}
