import { describe, expect, it } from "vitest";
import { joinDecision } from "./join.js";

const CODE = "0123456789abcdef0123456789abcdef";
const TASK = "task1";
const UID = "uid_joiner";

type JoinInput = Parameters<typeof joinDecision>[0];

function decide(overrides: Partial<JoinInput> = {}) {
  return joinDecision({
    inviteCode: CODE,
    invite: { taskId: TASK, active: true },
    taskId: TASK,
    task: { status: "active", inviteCode: CODE, memberIds: ["uid_owner"] },
    member: null,
    uid: UID,
    ...overrides
  });
}

describe("joinDecision", () => {
  it("拿著有效邀請碼的新人可以加入，人數加一", () => {
    expect(decide()).toEqual({ kind: "join", isNew: true, countsUp: true });
  });

  it("邀請碼查無此文件就是無效", () => {
    expect(decide({ invite: null })).toEqual({ kind: "invalid" });
  });

  it("停用的邀請無效", () => {
    expect(decide({ invite: { taskId: TASK, active: false } })).toEqual({ kind: "invalid" });
  });

  // 這一條是整個修法的核心。任何人都可以往 /invites 寫文件的話，偽造一份
  // 指向別人的 taskId 就能把自己加進去 —— 所以要拿任務自己記的那份碼回來對。
  it("偽造的邀請文件擋得住 —— 任務記的碼跟送進來的對不上", () => {
    expect(
      decide({
        invite: { taskId: TASK, active: true },
        inviteCode: "forged00000000000000000000000000",
        task: { status: "active", inviteCode: CODE, memberIds: ["uid_owner"] }
      })
    ).toEqual({ kind: "invalid" });
  });

  it("邀請指向的任務跟呼叫端說的不是同一個就無效", () => {
    expect(decide({ invite: { taskId: "別的任務", active: true } })).toEqual({ kind: "invalid" });
  });

  it("任務不存在就無效 —— 對使用者跟連結壞掉是同一件事", () => {
    expect(decide({ task: null })).toEqual({ kind: "invalid" });
  });

  it("封存的任務要跟「連結無效」分開講，使用者才知道要找發起人", () => {
    expect(decide({ task: { status: "archived", inviteCode: CODE, memberIds: [] } })).toEqual({
      kind: "inactive-task"
    });
  });

  it("已經是成員就什麼都不做 —— 重複點連結不該把人數加第二次", () => {
    expect(
      decide({
        task: { status: "active", inviteCode: CODE, memberIds: ["uid_owner", UID] },
        member: { active: true }
      })
    ).toEqual({ kind: "already" });
  });

  it("舊的 member 文件沒有 active 欄位，那時候的成員都算有效", () => {
    expect(
      decide({
        task: { status: "active", inviteCode: CODE, memberIds: ["uid_owner", UID] },
        member: {}
      })
    ).toEqual({ kind: "already" });
  });

  // 被移除的人是 memberIds 拿掉、member 文件留著。復活舊文件才保得住
  // 原本的角色與 joinedAt，而人數要加回來。
  it("被移除過的人重新加入：沿用舊文件，人數加一", () => {
    expect(decide({ member: { active: false } })).toEqual({
      kind: "join",
      isNew: false,
      countsUp: true
    });
  });

  // 寫入不是原子的，中途失敗會留下這種狀態。再按一次要能補完，而且
  // 不能重複加人數。
  it("memberIds 有他但文件是停用的：復活文件，人數不動", () => {
    expect(
      decide({
        task: { status: "active", inviteCode: CODE, memberIds: ["uid_owner", UID] },
        member: { active: false }
      })
    ).toEqual({ kind: "join", isNew: false, countsUp: false });
  });

  it("memberIds 沒有他但文件不存在也不會漏算人數", () => {
    expect(decide({ member: null })).toEqual({ kind: "join", isNew: true, countsUp: true });
  });
});
