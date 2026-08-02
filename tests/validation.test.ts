import { describe, expect, it } from "vitest";
import { dateRangeError, required, textFieldError } from "@/utils/firestore";

describe("required", () => {
  it("去掉前後空白後回傳", () => {
    expect(required("  曼谷旅行 ", "任務名稱")).toBe("曼谷旅行");
  });

  it("空白字串會丟例外", () => {
    expect(() => required("   ", "任務名稱")).toThrow("任務名稱為必填");
  });
});

describe("textFieldError", () => {
  it("還沒碰過欄位時不嘮叨", () => {
    expect(textFieldError("", "暱稱", { touched: false })).toBeNull();
  });

  it("碰過之後空白就提示必填", () => {
    expect(textFieldError("", "暱稱", { touched: true })).toBe("暱稱為必填");
    expect(textFieldError("   ", "暱稱", { touched: true })).toBe("暱稱為必填");
  });

  it("超過長度會提示，且用去空白後的長度算", () => {
    expect(textFieldError("12345", "暱稱", { max: 4 })).toBe("暱稱最多 4 個字");
    expect(textFieldError("  1234  ", "暱稱", { max: 4 })).toBeNull();
  });

  it("沒碰過但已經超長還是要提示", () => {
    expect(textFieldError("12345", "暱稱", { max: 4, touched: false })).toBe("暱稱最多 4 個字");
  });

  it("正常值沒有錯誤", () => {
    expect(textFieldError("小明", "暱稱", { max: 20 })).toBeNull();
  });
});

describe("dateRangeError", () => {
  it("兩邊都有填才檢查", () => {
    expect(dateRangeError("", "")).toBeNull();
    expect(dateRangeError("2026-08-01", "")).toBeNull();
    expect(dateRangeError("", "2026-08-01")).toBeNull();
  });

  it("結束早於開始會提示", () => {
    expect(dateRangeError("2026-08-10", "2026-08-01")).toBe("結束日期不能早於開始日期");
  });

  it("同一天或之後都可以", () => {
    expect(dateRangeError("2026-08-01", "2026-08-01")).toBeNull();
    expect(dateRangeError("2026-08-01", "2026-08-10")).toBeNull();
  });

  it("跨年比較也正確", () => {
    expect(dateRangeError("2026-12-31", "2027-01-01")).toBeNull();
    expect(dateRangeError("2027-01-01", "2026-12-31")).toBe("結束日期不能早於開始日期");
  });
});
