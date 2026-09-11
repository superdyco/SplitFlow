import { describe, expect, it } from "vitest";
import { GUEST_PROVIDER_ID, isGuest, providerIdOf } from "@/utils/guest";

describe("isGuest", () => {
  it("匿名登入的是訪客", () => {
    expect(isGuest({ isAnonymous: true })).toBe(true);
  });

  it("正式帳號與沒登入都不是", () => {
    expect(isGuest({ isAnonymous: false })).toBe(false);
    expect(isGuest(null)).toBe(false);
    expect(isGuest(undefined)).toBe(false);
  });
});

describe("providerIdOf", () => {
  it("訪客寫 anonymous，不是 unknown —— 訪客的 providerData 是空的", () => {
    expect(providerIdOf({ isAnonymous: true, providerData: [] })).toBe(GUEST_PROVIDER_ID);
  });

  it("正式帳號取第一個供應商", () => {
    expect(providerIdOf({ isAnonymous: false, providerData: [{ providerId: "google.com" }] })).toBe(
      "google.com"
    );
  });

  it("綁定之後的帳號不再是訪客", () => {
    expect(providerIdOf({ isAnonymous: false, providerData: [{ providerId: "apple.com" }] })).toBe(
      "apple.com"
    );
  });

  it("什麼都沒有時是 unknown，跟原本的行為一樣", () => {
    expect(providerIdOf({ isAnonymous: false, providerData: [] })).toBe("unknown");
  });
});
