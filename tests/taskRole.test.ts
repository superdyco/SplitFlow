import { describe, expect, it } from "vitest";
import { taskRole } from "@/utils/taskRole";
import type { Task } from "@/types/task";

function task(fields: Partial<Task>): Task {
  return { id: "t", ownerId: "owner", adminIds: [], memberIds: [], ...fields } as Task;
}

describe("taskRole", () => {
  it("ownerId 相符就是 owner", () => {
    expect(taskRole(task({ ownerId: "u1" }), "u1")).toBe("owner");
  });

  it("在 adminIds 裡就是 admin", () => {
    expect(taskRole(task({ adminIds: ["u1", "u2"] }), "u2")).toBe("admin");
  });

  it("都不符就是 member", () => {
    expect(taskRole(task({ adminIds: ["u2"] }), "u1")).toBe("member");
  });

  it("owner 優先於 adminIds —— createTask 會把 owner 同時放進兩邊", () => {
    expect(taskRole(task({ ownerId: "u1", adminIds: ["u1"] }), "u1")).toBe("owner");
  });

  it("adminIds 缺欄位的舊資料當成 member，不會爆掉", () => {
    expect(taskRole({ id: "t", ownerId: "owner" } as Task, "u1")).toBe("member");
  });
});
