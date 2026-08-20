import type { TaskRole } from "@/types/member";
import type { Task } from "@/types/task";

/**
 * 從 task 文件推導我的角色，不用再讀 members 子集合。
 *
 * 這是安全的，因為兩邊永遠一起改：createTask 同時寫 ownerId/adminIds 與 member
 * 文件的 role，setMemberRole 與 removeMember 則是用同一個 writeBatch 改兩邊，
 * 不會出現 member 文件說 admin、adminIds 裡卻沒有他的狀態。
 *
 * 動機是速度：列表原本每個任務都要多讀一次 members/{uid}，量測顯示這組扇出
 * 佔掉整個冷啟動的 44%（四個任務 958ms），而且 Promise.all 讓最慢的那筆決定
 * 全部——三筆卡住時整份清單都不會出現。改成推導之後這段歸零。
 */
export function taskRole(task: Task, uid: string): TaskRole {
  if (task.ownerId === uid) return "owner";
  return task.adminIds?.includes(uid) ? "admin" : "member";
}
