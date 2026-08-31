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

  /**
   * 這個成員沒有帳號，由 owner/admin 代為建立，只存在於帳目上。
   * 舊文件沒有這個欄位，一律當成 false。
   */
  virtual?: boolean;

  /**
   * 這個人刪掉了自己的帳號。他的帳目留著，但他永遠不會回來。
   * 舊文件沒有這個欄位，一律當成 false。
   */
  deleted?: boolean;
}
