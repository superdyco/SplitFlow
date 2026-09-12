import { describe, expect, it } from "vitest";
import { canLeaveTask } from "./leave.js";

const ME = "uid_me";
const OWNER = "uid_owner";

function task(overrides: Record<string, unknown> = {}) {
  return { status: "active", ownerId: OWNER, memberIds: [OWNER, ME], ...overrides };
}

describe("canLeaveTask", () => {
  it("一般成員可以退出", () => {
    expect(canLeaveTask({ task: task(), member: { active: true }, uid: ME })).toEqual({ kind: "allow" });
  });

  it("管理員也可以退出 —— 降級不是退出的前提", () => {
    expect(
      canLeaveTask({ task: task({ adminIds: [OWNER, ME] }), member: { active: true, role: "admin" }, uid: ME })
    ).toEqual({ kind: "allow" });
  });

  it("擁有者不能退出 —— 退了就沒有人管得了這個任務", () => {
    expect(canLeaveTask({ task: task(), member: { active: true }, uid: OWNER })).toEqual({ kind: "owner" });
  });

  it("任務不存在：不說它存不存在", () => {
    expect(canLeaveTask({ task: null, member: null, uid: ME })).toEqual({ kind: "not-member" });
  });

  it("不在 memberIds 裡而且沒有成員文件：不是成員", () => {
    expect(canLeaveTask({ task: task({ memberIds: [OWNER] }), member: null, uid: ME })).toEqual({
      kind: "not-member"
    });
  });

  it("已經退出過：算成功，不要讓重按一次變成錯誤", () => {
    expect(canLeaveTask({ task: task({ memberIds: [OWNER] }), member: { active: false }, uid: ME })).toEqual({
      kind: "already-left"
    });
  });

  it("封存的任務不能變動成員", () => {
    expect(canLeaveTask({ task: task({ status: "archived" }), member: { active: true }, uid: ME })).toEqual({
      kind: "inactive-task"
    });
  });

  it("擁有者的判斷排在封存前面 —— 那句話對他才有用", () => {
    expect(canLeaveTask({ task: task({ status: "archived" }), member: { active: true }, uid: OWNER })).toEqual({
      kind: "owner"
    });
  });

  it("虛擬成員不會走到這裡，但真的走到也擋下來 —— 他沒有帳號，不可能是呼叫者", () => {
    expect(canLeaveTask({ task: task(), member: { active: true, virtual: true }, uid: ME })).toEqual({
      kind: "not-member"
    });
  });
});
