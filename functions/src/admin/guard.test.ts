import { describe, expect, it } from "vitest";
import { isAdmin } from "./guard.js";

describe("isAdmin", () => {
  it("claim 是布林 true 才算管理者", () => {
    expect(isAdmin({ admin: true })).toBe(true);
  });

  it("沒有 claim 就不是", () => {
    expect(isAdmin({})).toBe(false);
    expect(isAdmin(null)).toBe(false);
    expect(isAdmin(undefined)).toBe(false);
  });

  it("admin: false 不是", () => {
    expect(isAdmin({ admin: false })).toBe(false);
  });

  /*
    這幾條才是這支函式存在的理由。custom claim 是 JSON，設定的人手滑寫成
    字串或數字是很容易發生的事，而 "false" 這個字串在 JS 裡是真值 ——
    真值判斷會把一個明顯想表達「不是管理者」的設定當成管理者。
  */
  it("看起來像 true 的字串與數字一律不算", () => {
    expect(isAdmin({ admin: "true" })).toBe(false);
    expect(isAdmin({ admin: 1 })).toBe(false);
    expect(isAdmin({ admin: "yes" })).toBe(false);
  });

  it("字串 false 也不算 —— 它是真值，這條沒過就代表用了真值判斷", () => {
    expect(isAdmin({ admin: "false" })).toBe(false);
  });
});
