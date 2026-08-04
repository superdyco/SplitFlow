/**
 * 任務狀態的顯示與分堆。
 *
 * 分堆放在這裡而不是散在頁面的 v-if，是因為「已刪除的絕對不能出現」是一條
 * 需要被測試釘住的規則 —— 漏在任何一個地方，使用者就會看到本來刪掉的東西。
 *
 * 純函式，不 import firebase 也不 import vue。
 */
import type { TaskStatus } from "@/types/task";

export const STATUS_LABELS: Record<TaskStatus, string> = {
  active: "進行中",
  archived: "已封存",
  deleted: "已刪除"
};

/**
 * 泛型而不是寫死 `Task[]`：呼叫端手上是 `{ task, role }`，
 * 拆開再組回去只會讓它變麻煩。這裡只看 status，其餘欄位原樣帶過。
 *
 * 這個功能之前建立的舊資料可能沒有 status 欄位，當成進行中 ——
 * 預設值選錯的話那些任務會整個從列表消失。
 */
export function partitionTasks<T extends { task: { status?: TaskStatus } }>(
  rows: T[]
): { active: T[]; archived: T[] } {
  const active: T[] = [];
  const archived: T[] = [];

  for (const row of rows) {
    const status = row.task.status ?? "active";
    if (status === "deleted") continue;
    if (status === "archived") archived.push(row);
    else active.push(row);
  }

  return { active, archived };
}
