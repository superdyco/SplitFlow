import { describe, expect, it } from "vitest";
import {
  FREE_CREDITS,
  isFailure,
  ledgerAdjust,
  ledgerFree,
  ledgerPurchase,
  ledgerResult,
  ledgerRevoke,
  ledgerUse,
  parseTargetBalance,
  planSetBalance,
  planUse
} from "./credits.js";

const AT = new Date("2026-09-12T03:00:00Z");

describe("planUse", () => {
  it("文件不存在：先送 3 點再扣 1，剩 2", () => {
    expect(planUse(null)).toEqual({ ok: true, grantFree: true, balanceAfter: FREE_CREDITS - 1 });
  });

  it("有餘額：扣 1", () => {
    expect(planUse({ balance: 1, freeGranted: true })).toEqual({ ok: true, grantFree: false, balanceAfter: 0 });
  });

  it("餘額 0：拒絕", () => {
    expect(planUse({ balance: 0, freeGranted: true })).toEqual({ ok: false });
  });

  it("文件存在但沒有送過（管理者先建的也算送過）—— 不再送", () => {
    expect(planUse({ balance: 5, freeGranted: true })).toEqual({ ok: true, grantFree: false, balanceAfter: 4 });
  });

  it("餘額欄位壞掉（不是數字）當作 0，不能變成無限點數", () => {
    expect(planUse({ balance: "9999", freeGranted: true })).toEqual({ ok: false });
  });
});

describe("parseTargetBalance", () => {
  it("0 到 1000 的整數", () => {
    expect(parseTargetBalance(0)).toBe(0);
    expect(parseTargetBalance(5)).toBe(5);
    expect(parseTargetBalance(1000)).toBe(1000);
  });

  it("負數、超過上限、小數、字串都不行", () => {
    expect(parseTargetBalance(-1)).toBeNull();
    expect(parseTargetBalance(1001)).toBeNull();
    expect(parseTargetBalance(1.5)).toBeNull();
    expect(parseTargetBalance("5")).toBeNull();
  });
});

describe("planSetBalance", () => {
  it("設成比現在多：紀錄寫實際加了多少", () => {
    expect(planSetBalance({ balance: 2, freeGranted: true }, 5)).toEqual({
      delta: 3,
      balanceAfter: 5,
      created: false
    });
  });

  it("設成比現在少：紀錄寫實際扣了多少", () => {
    expect(planSetBalance({ balance: 5, freeGranted: true }, 1)).toEqual({
      delta: -4,
      balanceAfter: 1,
      created: false
    });
  });

  it("設成跟現在一樣：變動是 0（呼叫端要擋下來，不寫一筆沒意義的紀錄）", () => {
    expect(planSetBalance({ balance: 3, freeGranted: true }, 3)).toEqual({
      delta: 0,
      balanceAfter: 3,
      created: false
    });
  });

  it("文件不存在：設幾點就是幾點，不另外送 3 點", () => {
    expect(planSetBalance(null, 5)).toEqual({ delta: 5, balanceAfter: 5, created: true });
  });

  it("文件不存在設成 0：照樣建立 —— 之後第一次辨識不會再送 3 點", () => {
    expect(planSetBalance(null, 0)).toEqual({ delta: 0, balanceAfter: 0, created: true });
  });

  it("餘額欄位壞掉當作 0 算變動量", () => {
    expect(planSetBalance({ balance: "9999", freeGranted: true }, 2)).toEqual({
      delta: 2,
      balanceAfter: 2,
      created: false
    });
  });
});

describe("點數紀錄", () => {
  it("free", () => {
    expect(ledgerFree({ uid: "u1", at: AT })).toEqual({
      type: "free",
      uid: "u1",
      delta: FREE_CREDITS,
      balanceAfter: FREE_CREDITS,
      at: AT
    });
  });

  it("use 先寫 pending，模型也先記下來", () => {
    expect(ledgerUse({ uid: "u1", at: AT, balanceAfter: 2, model: "gpt-5.6-luna" })).toEqual({
      type: "use",
      uid: "u1",
      delta: -1,
      balanceAfter: 2,
      at: AT,
      readResult: "pending",
      model: "gpt-5.6-luna",
      inputTokens: null,
      outputTokens: null
    });
  });

  it("adjust 帶著誰調的與理由", () => {
    expect(
      ledgerAdjust({
        uid: "u1",
        at: AT,
        delta: -2,
        balanceAfter: 0,
        adminUid: "a1",
        adminEmail: "a@x.com",
        reason: "重複扣點"
      })
    ).toEqual({
      type: "adjust",
      uid: "u1",
      delta: -2,
      balanceAfter: 0,
      at: AT,
      adminUid: "a1",
      adminEmail: "a@x.com",
      reason: "重複扣點"
    });
  });

  it("結果只補三個欄位；token 沒有就是 null", () => {
    expect(ledgerResult({ readResult: "timeout", inputTokens: undefined, outputTokens: undefined })).toEqual({
      readResult: "timeout",
      inputTokens: null,
      outputTokens: null
    });
  });
});

describe("儲值與退款的紀錄", () => {
  it("purchase 帶著購買紀錄與商品", () => {
    expect(
      ledgerPurchase({
        uid: "u1",
        at: AT,
        delta: 66,
        balanceAfter: 68,
        purchaseId: "ios_1",
        productId: "ai_credits_60"
      })
    ).toEqual({
      type: "purchase",
      uid: "u1",
      delta: 66,
      balanceAfter: 68,
      at: AT,
      purchaseId: "ios_1",
      productId: "ai_credits_60"
    });
  });

  it("revoke 的變動是負的", () => {
    expect(ledgerRevoke({ uid: "u1", at: AT, delta: -20, balanceAfter: 0, purchaseId: "android_GPA.1" })).toEqual({
      type: "revoke",
      uid: "u1",
      delta: -20,
      balanceAfter: 0,
      at: AT,
      purchaseId: "android_GPA.1"
    });
  });
});

describe("isFailure", () => {
  it("只有 read 算成功；pending（沒有回來）也算失敗", () => {
    expect(isFailure("read")).toBe(false);
    for (const result of ["pending", "unreadable", "not_receipt", "ai_error", "timeout"]) {
      expect(isFailure(result)).toBe(true);
    }
  });
});
