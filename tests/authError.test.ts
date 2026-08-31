import { describe, expect, it } from "vitest";
import {
  ENABLED_PROVIDERS,
  describeSignInError,
  existingAccountMessage,
  isCancelledSignIn,
  providerLabel
} from "@/utils/authError";

describe("isCancelledSignIn", () => {
  it("使用者自己關掉彈窗算取消", () => {
    expect(isCancelledSignIn("auth/popup-closed-by-user")).toBe(true);
    expect(isCancelledSignIn("auth/cancelled-popup-request")).toBe(true);
    expect(isCancelledSignIn("auth/user-cancelled")).toBe(true);
  });

  it("真的出錯不算取消", () => {
    expect(isCancelledSignIn("auth/operation-not-allowed")).toBe(false);
    expect(isCancelledSignIn("auth/network-request-failed")).toBe(false);
  });
});

describe("providerLabel", () => {
  it("認得的 providerId 換成中文可讀名稱", () => {
    expect(providerLabel("google.com")).toBe("Google");
    expect(providerLabel("apple.com")).toBe("Apple");
    expect(providerLabel("facebook.com")).toBe("Facebook");
  });

  it("不認得的原樣回傳，不會變成空字串", () => {
    expect(providerLabel("github.com")).toBe("github.com");
  });
});

describe("describeSignInError", () => {
  it("取消時回 null，畫面就不會跳紅字", () => {
    expect(describeSignInError("auth/popup-closed-by-user", "apple", "原始訊息")).toBeNull();
  });

  it("供應商沒啟用時點名是哪一個", () => {
    const message = describeSignInError("auth/operation-not-allowed", "facebook", "原始訊息");
    expect(message).toContain("Facebook");
    expect(message).toContain("Firebase Console");
  });

  it("每個供應商都會帶到自己的名字", () => {
    expect(describeSignInError("auth/invalid-credential", "apple", "x")).toContain("Apple");
    expect(describeSignInError("auth/invalid-credential", "google", "x")).toContain("Google");
  });

  it("網域沒授權與彈窗被擋都有專屬訊息", () => {
    expect(describeSignInError("auth/unauthorized-domain", "google", "x")).toContain("Authorized domains");
    expect(describeSignInError("auth/popup-blocked", "google", "x")).toContain("彈出視窗");
  });

  it("沒對應的錯誤碼就用原始訊息，不會吞掉資訊", () => {
    expect(describeSignInError("auth/internal-error", "google", "原始訊息")).toBe("原始訊息");
  });
});

describe("existingAccountMessage", () => {
  it("查得到就點名原本用的供應商", () => {
    const message = existingAccountMessage("a@b.com", ["google.com"]);
    expect(message).toContain("a@b.com");
    expect(message).toContain("Google");
  });

  it("多個供應商會全部列出來", () => {
    expect(existingAccountMessage("a@b.com", ["google.com", "apple.com"])).toContain("Google、Apple");
  });

  it("查不到時給通用訊息，不亂猜供應商", () => {
    const message = existingAccountMessage("a@b.com", []);
    expect(message).toContain("a@b.com");
    expect(message).toContain("別的方式");
    expect(message).not.toContain("Google");
  });

  it("連 email 都沒有時也讀得通", () => {
    const message = existingAccountMessage("", []);
    expect(message).not.toContain("（）");
    expect(message).toContain("別的方式");
  });
});

describe("ENABLED_PROVIDERS", () => {
  it("登入頁提供 Apple —— iOS 上架的硬性要求，而網頁登不進去就會變成兩個帳號", () => {
    expect(ENABLED_PROVIDERS).toContain("apple");
  });
});
