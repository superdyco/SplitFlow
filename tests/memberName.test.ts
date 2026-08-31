import { describe, expect, it } from "vitest";
import { memberDisplayName } from "@/utils/memberName";

describe("memberDisplayName", () => {
  it("正常成員就是暱稱本身", () => {
    expect(memberDisplayName({ nickname: "小美", active: true })).toBe("小美");
  });

  it("被移除的成員標成已離開", () => {
    expect(memberDisplayName({ nickname: "小美", active: false })).toBe("小美（已離開）");
  });

  it("刪除帳號的人標成已刪除，不是已離開", () => {
    // 兩件事對其他人意義不同：已離開的人可以用邀請連結回來，
    // 刪掉帳號的人永遠不會。
    expect(
      memberDisplayName({ nickname: "小美", active: false, deleted: true })
    ).toBe("小美（已刪除）");
  });

  it("舊文件沒有 deleted 欄位，當成沒刪除", () => {
    expect(memberDisplayName({ nickname: "小美", active: true })).toBe("小美");
  });

  it("沒有暱稱時不要只留下一個括號", () => {
    expect(memberDisplayName({ nickname: "", active: false })).toBe("（沒有暱稱）（已離開）");
  });
});
