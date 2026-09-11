import { describe, expect, it } from "vitest";
import { dateRangeError, firebaseErrorMessage, required, textFieldError } from "@/utils/firestore";

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

describe("firebaseErrorMessage", () => {
  it("缺索引的原文不能給使用者看 —— 那裡面有 Console 網址與專案 id", () => {
    const raw =
      "The query requires an index. That index is currently building and cannot be used yet. " +
      "See its status here: https://console.firebase.google.com/v1/r/project/splitflow-e39c0/firestore/indexes?create_composite=Clpwcm9q";
    const message = firebaseErrorMessage({ code: "failed-precondition", message: raw });

    expect(message).not.toContain("console.firebase.google.com");
    expect(message).not.toContain("splitflow-e39c0");
    expect(message).toBe("這一頁還在準備中，請稍後再試一次。");
  });

  it("認的是 code 不是訊息 —— 訊息會隨 SDK 版本改寫", () => {
    expect(firebaseErrorMessage({ code: "unavailable", message: "whatever the SDK says today" }))
      .toBe("連不上伺服器。檢查一下網路，或稍後再試。");
  });

  it("權限不足翻成中文，不再把 Firebase 的英文原文丟給使用者", () => {
    const message = firebaseErrorMessage({
      code: "permission-denied",
      message: "Missing or insufficient permissions."
    });
    expect(message).toContain("沒有權限");
    expect(message).not.toContain("Missing");
  });

  it("雲端函式自己寫的中文理由照原樣顯示 —— 那比任何通用文案都準確", () => {
    expect(firebaseErrorMessage({ code: "functions/failed-precondition", message: "請先設定暱稱" }))
      .toBe("請先設定暱稱");
    expect(firebaseErrorMessage({ code: "functions/not-found", message: "這個邀請連結不存在或已停用" }))
      .toBe("這個邀請連結不存在或已停用");
  });

  it("雲端函式的通用錯誤（英文的 internal）翻成中文", () => {
    expect(firebaseErrorMessage({ code: "functions/internal", message: "internal" }))
      .toContain("伺服器出了點問題");
  });

  it("Storage 的錯誤碼也認得（收據上傳走這裡）", () => {
    expect(firebaseErrorMessage({ code: "storage/unauthorized", message: "User does not have permission" }))
      .toBe("沒有權限存取這個檔案。");
    expect(firebaseErrorMessage({ code: "storage/retry-limit-exceeded", message: "Max retry time exceeded" }))
      .toContain("太久沒有回應");
  });

  it("不認得的 code 照原樣傳出去，不要憑空發明訊息", () => {
    expect(firebaseErrorMessage({ code: "some-brand-new-code", message: "Something new happened" }))
      .toBe("Something new happened");
  });

  it("本來就是中文的一般錯誤照原樣（例如必填檢查丟出來的）", () => {
    expect(firebaseErrorMessage(new Error("暱稱為必填"))).toBe("暱稱為必填");
  });

  it("不是 Firebase 錯誤的東西也不能讓它爆掉", () => {
    expect(firebaseErrorMessage("壞掉了")).toBe("壞掉了");
    expect(firebaseErrorMessage(null)).toBe("null");
  });
});
