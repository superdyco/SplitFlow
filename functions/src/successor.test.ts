import { describe, expect, it } from "vitest";
import { pickSuccessor } from "./successor.js";

const real = (uid: string) => ({ uid, active: true, virtual: false });

describe("pickSuccessor", () => {
  it("優先交給另一位 admin", () => {
    expect(
      pickSuccessor(["owner1", "admin1"], [real("owner1"), real("admin1"), real("m1")], "owner1")
    ).toBe("admin1");
  });

  it("沒有其他 admin 就交給最早加入的成員", () => {
    // members 進來時已依 joinedAt 排序，所以「最早」就是第一個。
    expect(
      pickSuccessor(["owner1"], [real("owner1"), real("m1"), real("m2")], "owner1")
    ).toBe("m1");
  });

  it("跳過虛擬成員 —— 他沒有帳號，接手了也沒有人能操作", () => {
    expect(
      pickSuccessor(
        ["owner1"],
        [real("owner1"), { uid: "v_aaaaaaaaaaaaaaaaaaaa", active: true, virtual: true }, real("m2")],
        "owner1"
      )
    ).toBe("m2");
  });

  it("跳過已被移除的成員 —— 他看不到這個任務", () => {
    expect(
      pickSuccessor(
        ["owner1"],
        [real("owner1"), { uid: "m1", active: false, virtual: false }, real("m2")],
        "owner1"
      )
    ).toBe("m2");
  });

  it("只剩他自己就回傳 null，呼叫端會把整個任務刪掉", () => {
    expect(pickSuccessor(["owner1"], [real("owner1")], "owner1")).toBeNull();
  });

  it("只剩虛擬成員也回傳 null —— 沒有人看得到這個任務", () => {
    expect(
      pickSuccessor(
        ["owner1"],
        [real("owner1"), { uid: "v_aaaaaaaaaaaaaaaaaaaa", active: true, virtual: true }],
        "owner1"
      )
    ).toBeNull();
  });

  it("adminIds 裡的人已經不在成員名單就不算數", () => {
    // 資料可能不一致（舊資料、寫入失敗）。挑一個不存在的人接手，
    // 任務會直接壞掉而且沒有人能修。
    expect(
      pickSuccessor(["owner1", "ghost"], [real("owner1"), real("m1")], "owner1")
    ).toBe("m1");
  });
});
