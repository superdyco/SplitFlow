import { describe, expect, it } from "vitest";
import { removeMemberMessage } from "@/utils/memberRemoval";

describe("removeMemberMessage", () => {
  it("已結清時只講權限，不提金額", () => {
    const text = removeMemberMessage({ name: "小明", balance: 0, currency: "TWD" });
    expect(text).toBe("確定要把 小明 移出任務嗎？他就看不到這個任務了，但既有支出會保留。");
  });

  it("他還沒付錢時提醒之後只能由管理員代記", () => {
    const text = removeMemberMessage({ name: "小明", balance: -80000, currency: "TWD" });
    expect(text).toContain("小明 還有 TWD 800.00 沒付");
    expect(text).toContain("沒辦法自己記錄付款");
    expect(text).toContain("既有支出與結算金額都會保留");
  });

  it("還有人要付錢給他時說的是另一回事", () => {
    const text = removeMemberMessage({ name: "小華", balance: 125000, currency: "TWD" });
    expect(text).toContain("還有 TWD 1,250.00 要付給 小華");
    expect(text).toContain("查不到誰還沒付他錢");
  });

  it("金額走 formatAmount，零小數幣別不會多出小數點", () => {
    const text = removeMemberMessage({ name: "小明", balance: -125000, currency: "KRW" });
    expect(text).toContain("KRW 125,000 沒付");
  });

  it("沒有暱稱時用通稱，不會出現空白", () => {
    const text = removeMemberMessage({ name: "", balance: 0, currency: "TWD" });
    expect(text).toContain("這位成員");
  });

  it("兩種未結清情況都以問句收尾，讓確認框讀起來完整", () => {
    expect(removeMemberMessage({ name: "小明", balance: -80000, currency: "TWD" })).toContain(
      "確定要移除嗎？"
    );
    expect(removeMemberMessage({ name: "小明", balance: 80000, currency: "TWD" })).toContain(
      "確定要移除嗎？"
    );
  });
});
