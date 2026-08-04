import { describe, expect, it } from "vitest";
import { STATUS_LABELS, partitionTasks } from "@/utils/taskStatus";
import type { TaskStatus } from "@/types/task";

function row(id: string, status?: TaskStatus) {
  return { task: { id, status }, role: "owner" as const };
}

describe("partitionTasks", () => {
  it("分成進行中與已封存兩堆", () => {
    const result = partitionTasks([row("a", "active"), row("b", "archived"), row("c", "active")]);
    expect(result.active.map(item => item.task.id)).toEqual(["a", "c"]);
    expect(result.archived.map(item => item.task.id)).toEqual(["b"]);
  });

  it("已刪除的不出現在任何一堆 —— 使用者不該再看到它", () => {
    const result = partitionTasks([row("a", "active"), row("gone", "deleted")]);
    expect(result.active.map(item => item.task.id)).toEqual(["a"]);
    expect(result.archived).toEqual([]);
  });

  it("沒有 status 的舊資料當成進行中，不會憑空消失", () => {
    const result = partitionTasks([row("legacy", undefined)]);
    expect(result.active.map(item => item.task.id)).toEqual(["legacy"]);
  });

  it("空清單回傳兩個空陣列，不是 undefined", () => {
    expect(partitionTasks([])).toEqual({ active: [], archived: [] });
  });

  it("保留原本的順序", () => {
    const result = partitionTasks([row("c", "active"), row("a", "active"), row("b", "active")]);
    expect(result.active.map(item => item.task.id)).toEqual(["c", "a", "b"]);
  });

  it("原樣帶過呼叫端自己的欄位，不只回傳 task", () => {
    const result = partitionTasks([row("a", "active")]);
    expect(result.active[0].role).toBe("owner");
  });
});

describe("STATUS_LABELS", () => {
  it("三個狀態都有中文標籤 —— 畫面上不該出現英文的 active", () => {
    expect(STATUS_LABELS.active).toBe("進行中");
    expect(STATUS_LABELS.archived).toBe("已封存");
    expect(STATUS_LABELS.deleted).toBe("已刪除");
  });
});
