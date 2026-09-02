import { describe, expect, it } from "vitest";
import { parseMapMode, parseTaskView } from "@/utils/taskView";

describe("parseTaskView", () => {
  it("認得成員與結算", () => {
    expect(parseTaskView("members")).toBe("members");
    expect(parseTaskView("settlement")).toBe("settlement");
  });

  it("明寫 expenses 也認得 —— 那是人會手打或別人貼過來的", () => {
    expect(parseTaskView("expenses")).toBe("expenses");
  });

  it("缺值、空字串、不認得的值一律回支出", () => {
    // 網址是使用者可以亂打的，不能因為打錯就給一個空畫面。
    expect(parseTaskView(undefined)).toBe("expenses");
    expect(parseTaskView(null)).toBe("expenses");
    expect(parseTaskView("")).toBe("expenses");
    expect(parseTaskView("settlements")).toBe("expenses");
    expect(parseTaskView("SETTLEMENT")).toBe("expenses");
  });

  it("重複參數會拿到陣列，一樣回支出", () => {
    // ?view=members&view=settlement 在 vue-router 會是 ["members", "settlement"]。
    expect(parseTaskView(["members", "settlement"])).toBe("expenses");
  });
});

describe("parseMapMode", () => {
  it("只有支出檢視看得到地圖", () => {
    expect(parseMapMode("1", "expenses")).toBe(true);
    expect(parseMapMode("1", "members")).toBe(false);
    expect(parseMapMode("1", "settlement")).toBe(false);
  });

  it("沒帶 map 或值不是 1 就是清單", () => {
    expect(parseMapMode(undefined, "expenses")).toBe(false);
    expect(parseMapMode(null, "expenses")).toBe(false);
    expect(parseMapMode("0", "expenses")).toBe(false);
    expect(parseMapMode("true", "expenses")).toBe(false);
  });

  it("重複參數的陣列不算開啟", () => {
    expect(parseMapMode(["1"], "expenses")).toBe(false);
  });
});
