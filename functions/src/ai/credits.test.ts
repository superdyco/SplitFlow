import { describe, expect, it } from "vitest";
import {
  FREE_CREDITS,
  isFailure,
  ledgerAdjust,
  ledgerFree,
  ledgerResult,
  ledgerUse,
  parseAdjust,
  planAdjust,
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

describe("parseAdjust", () => {
  it("−100 到 +100 的非零整數", () => {
    expect(parseAdjust(5)).toBe(5);
    expect(parseAdjust(-100)).toBe(-100);
    expect(parseAdjust(100)).toBe(100);
  });

  it("0、超出範圍、小數、字串都不行", () => {
    expect(parseAdjust(0)).toBeNull();
    expect(parseAdjust(101)).toBeNull();
    expect(parseAdjust(-101)).toBeNull();
    expect(parseAdjust(1.5)).toBeNull();
    expect(parseAdjust("5")).toBeNull();
  });
});

describe("planAdjust", () => {
  it("加點", () => {
    expect(planAdjust({ balance: 2, freeGranted: true }, 3)).toEqual({ delta: 3, balanceAfter: 5, created: false });
  });

  it("減到 0 為止，紀錄寫實際扣掉的量", () => {
    expect(planAdjust({ balance: 2, freeGranted: true }, -5)).toEqual({ delta: -2, balanceAfter: 0, created: false });
  });

  it("文件不存在：輸入幾點就是幾點，不另外送 3 點", () => {
    expect(planAdjust(null, 5)).toEqual({ delta: 5, balanceAfter: 5, created: true });
  });

  it("文件不存在又是減點：當作 0，實際變動 0", () => {
    expect(planAdjust(null, -3)).toEqual({ delta: 0, balanceAfter: 0, created: true });
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

describe("isFailure", () => {
  it("只有 read 算成功；pending（沒有回來）也算失敗", () => {
    expect(isFailure("read")).toBe(false);
    for (const result of ["pending", "unreadable", "not_receipt", "ai_error", "timeout"]) {
      expect(isFailure(result)).toBe(true);
    }
  });
});
