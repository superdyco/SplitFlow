import { describe, expect, it } from "vitest";
import {
  checkAppleTransaction,
  checkPlayPurchase,
  parsePlatform,
  planCredit,
  planRevoke,
  purchaseDocId
} from "./decide.js";

const APPLE_OK = {
  transactionId: "2000000123",
  bundleId: "com.dyco.splitflow",
  productId: "ai_credits_60",
  environment: "Production",
  price: 60000,
  currency: "TWD"
};

const PLAY_OK = { orderId: "GPA.1234-5678", productId: "ai_credits_60", purchaseState: 0, consumptionState: 0 };

describe("parsePlatform / purchaseDocId", () => {
  it("只認 ios 與 android", () => {
    expect(parsePlatform("ios")).toBe("ios");
    expect(parsePlatform("android")).toBe("android");
    expect(parsePlatform("web")).toBeNull();
  });

  it("文件 ID 帶平台前綴；斜線換掉，免得被當成路徑", () => {
    expect(purchaseDocId("ios", "2000000123")).toBe("ios_2000000123");
    expect(purchaseDocId("android", "a/b")).toBe("android_a_b");
  });
});

describe("checkAppleTransaction", () => {
  const expected = { bundleId: "com.dyco.splitflow", productId: "ai_credits_60" };

  it("合格：價格從千分之一單位換回來", () => {
    expect(checkAppleTransaction(APPLE_OK, expected)).toEqual({
      ok: true,
      purchase: { storeId: "2000000123", environment: "production", price: 60, currency: "TWD", priceSource: "store" }
    });
  });

  it("sandbox 記成 sandbox", () => {
    const result = checkAppleTransaction({ ...APPLE_OK, environment: "Sandbox" }, expected);
    expect(result.ok && result.purchase.environment).toBe("sandbox");
  });

  it("別的 App 的交易、商品對不上、已被撤銷、查不到都擋", () => {
    expect(checkAppleTransaction({ ...APPLE_OK, bundleId: "com.other" }, expected)).toEqual({
      ok: false,
      problem: "bundle"
    });
    expect(checkAppleTransaction({ ...APPLE_OK, productId: "ai_credits_100" }, expected)).toEqual({
      ok: false,
      problem: "product"
    });
    expect(checkAppleTransaction({ ...APPLE_OK, revocationDate: 1 }, expected)).toEqual({
      ok: false,
      problem: "revoked"
    });
    expect(checkAppleTransaction(null, expected)).toEqual({ ok: false, problem: "missing" });
  });
});

describe("checkPlayPurchase", () => {
  const expected = { productId: "ai_credits_60", listPriceTwd: 60 };

  it("合格：價格用台幣標價，來源寫 list", () => {
    expect(checkPlayPurchase(PLAY_OK, expected)).toEqual({
      ok: true,
      consumed: false,
      purchase: { storeId: "GPA.1234-5678", environment: "production", price: 60, currency: "TWD", priceSource: "list" }
    });
  });

  it("授權測試帳號的購買（purchaseType 0）記成 sandbox", () => {
    const result = checkPlayPurchase({ ...PLAY_OK, purchaseType: 0 }, expected);
    expect(result.ok && result.purchase.environment).toBe("sandbox");
  });

  it("已經消耗過的照樣合格，只是標出來（重送時不必再消耗）", () => {
    const result = checkPlayPurchase({ ...PLAY_OK, consumptionState: 1 }, expected);
    expect(result.ok && result.consumed).toBe(true);
  });

  it("待處理、已取消、商品對不上、查不到", () => {
    expect(checkPlayPurchase({ ...PLAY_OK, purchaseState: 2 }, expected)).toEqual({ ok: false, problem: "pending" });
    expect(checkPlayPurchase({ ...PLAY_OK, purchaseState: 1 }, expected)).toEqual({ ok: false, problem: "canceled" });
    expect(checkPlayPurchase({ ...PLAY_OK, productId: "ai_credits_30" }, expected)).toEqual({
      ok: false,
      problem: "product"
    });
    expect(checkPlayPurchase(null, expected)).toEqual({ ok: false, problem: "missing" });
  });
});

describe("planCredit", () => {
  it("沒有紀錄：加點", () => {
    expect(planCredit(null, "u1")).toEqual({ kind: "credit" });
  });

  it("同一個帳號重送：之前加過了，不重加", () => {
    expect(planCredit({ uid: "u1" }, "u1")).toEqual({ kind: "already" });
  });

  it("另一個帳號送來：點數跟著第一次送來的帳號", () => {
    expect(planCredit({ uid: "u1" }, "u2")).toEqual({ kind: "other-account" });
  });
});

describe("planRevoke", () => {
  it("扣回買的點數", () => {
    expect(planRevoke({ status: "credited", credits: 66 }, { balance: 100 })).toEqual({
      kind: "revoke",
      delta: -66,
      balanceAfter: 34
    });
  });

  it("扣到 0 為止：用掉的扣不回來", () => {
    expect(planRevoke({ status: "credited", credits: 120 }, { balance: 20 })).toEqual({
      kind: "revoke",
      delta: -20,
      balanceAfter: 0
    });
  });

  it("帳號已經刪了（沒有點數文件）：照樣標成退款，變動 0", () => {
    expect(planRevoke({ status: "credited", credits: 30 }, null)).toEqual({
      kind: "revoke",
      delta: 0,
      balanceAfter: 0
    });
  });

  it("已經退過、或找不到購買紀錄：跳過 —— 通知可能重送", () => {
    expect(planRevoke({ status: "refunded", credits: 30 }, { balance: 30 })).toEqual({ kind: "skip" });
    expect(planRevoke(null, { balance: 30 })).toEqual({ kind: "skip" });
  });
});
