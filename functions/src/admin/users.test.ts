import { describe, expect, it } from "vitest";
import { classifySearch, listPlan, parseFilter, prefixEnd } from "./users.js";

describe("listPlan", () => {
  it("預設照註冊日由新到舊", () => {
    expect(listPlan("all")).toEqual({ field: "createdAt", direction: "desc", since: null });
  });

  /*
    Firestore 要求範圍欄位必須是第一個排序欄位。篩選近期活躍卻照註冊日排的話
    查詢會直接被拒絕 —— 這一條就是釘住那個約束。
  */
  it("兩個活躍篩選都改成照 lastSeenAt 排", () => {
    expect(listPlan("active7").field).toBe("lastSeenAt");
    expect(listPlan("idle30").field).toBe("lastSeenAt");
  });

  it("近 7 日是大於等於，30 天沒來是小於", () => {
    expect(listPlan("active7").since).toEqual({ compare: ">=", daysAgo: 7 });
    expect(listPlan("idle30").since).toEqual({ compare: "<", daysAgo: 30 });
  });
});

describe("parseFilter", () => {
  it("認得三個", () => {
    expect(parseFilter("all")).toBe("all");
    expect(parseFilter("active7")).toBe("active7");
    expect(parseFilter("idle30")).toBe("idle30");
  });

  it("其他回 null，不給預設值", () => {
    expect(parseFilter("disabled")).toBeNull();
    expect(parseFilter("")).toBeNull();
    expect(parseFilter(undefined)).toBeNull();
  });
});

describe("classifySearch", () => {
  it("有小老鼠就是 email，而且轉成小寫", () => {
    expect(classifySearch("Kim@Example.com")).toEqual({ kind: "email", value: "kim@example.com" });
  });

  it("28 個英數字是 uid", () => {
    const uid = "a".repeat(28);
    expect(classifySearch(uid)).toEqual({ kind: "uid", value: uid });
  });

  it("27 或 29 個字不是 uid，當成暱稱前綴", () => {
    expect(classifySearch("a".repeat(27))?.kind).toBe("prefix");
    expect(classifySearch("a".repeat(29))?.kind).toBe("prefix");
  });

  it("其他一律當暱稱前綴", () => {
    expect(classifySearch("小美")).toEqual({ kind: "prefix", value: "小美" });
  });

  it("前後空白修掉", () => {
    expect(classifySearch("  小美  ")).toEqual({ kind: "prefix", value: "小美" });
  });

  it("空字串與只有空白都回 null", () => {
    expect(classifySearch("")).toBeNull();
    expect(classifySearch("   ")).toBeNull();
  });
});

describe("prefixEnd", () => {
  it("上界比任何以它開頭的字串都大", () => {
    const end = prefixEnd("陳");
    expect("陳".localeCompare(end) < 0).toBe(true);
    expect("陳小美" < end).toBe(true);
  });
});
