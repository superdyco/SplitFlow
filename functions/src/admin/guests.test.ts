import { describe, expect, it } from "vitest";
import { GUEST_EVENTS, guestKeys, isAnonymousRecord, isBinding, sumGuests } from "./guests.js";

describe("GUEST_EVENTS", () => {
  it("四種事件，順序就是卡片上的順序", () => {
    expect(GUEST_EVENTS).toEqual(["started", "bound", "merged", "left"]);
  });
});

describe("guestKeys", () => {
  it("跟儀表板的區間一樣長，但算到今天 —— 訪客是當下記的，不用等排程", () => {
    const now = new Date("2026-09-11T03:00:00Z"); // 台北 09-11 11:00
    expect(guestKeys(3, now)).toEqual(["2026-09-09", "2026-09-10", "2026-09-11"]);
  });

  it("台北已經過了午夜而 UTC 還沒，今天是台北的今天", () => {
    const now = new Date("2026-09-10T17:00:00Z"); // 台北 09-11 01:00
    expect(guestKeys(1, now)).toEqual(["2026-09-11"]);
  });
});

describe("sumGuests", () => {
  const keys = ["2026-09-10", "2026-09-11"];

  it("把區間內每天的次數加起來，沒記過的欄位當 0", () => {
    const docs = [
      { date: "2026-09-10", started: 3, left: 1 },
      { date: "2026-09-11", started: 2, bound: 1, merged: 1 }
    ];
    expect(sumGuests(docs, keys)).toEqual({
      totals: { started: 5, bound: 1, merged: 1, left: 1 },
      recordedDays: 2
    });
  });

  it("區間外的文件不算", () => {
    const docs = [
      { date: "2026-09-01", started: 9 },
      { date: "2026-09-11", started: 1 }
    ];
    expect(sumGuests(docs, keys).totals.started).toBe(1);
  });

  it("一筆紀錄都沒有時 recordedDays 是 0 —— 畫面要說還沒有紀錄，而不是四個 0", () => {
    expect(sumGuests([], keys)).toEqual({
      totals: { started: 0, bound: 0, merged: 0, left: 0 },
      recordedDays: 0
    });
  });
});

describe("isBinding", () => {
  it("從訪客變成正式帳號的那一次寫入才算綁定", () => {
    expect(isBinding("anonymous", "google.com")).toBe(true);
    expect(isBinding("anonymous", "apple.com")).toBe(true);
  });

  it("訪客自己改暱稱、蓋戳記，provider 沒變，不算", () => {
    expect(isBinding("anonymous", "anonymous")).toBe(false);
  });

  it("正式帳號之間的變動不算", () => {
    expect(isBinding("google.com", "apple.com")).toBe(false);
  });

  it("欄位不見了不算綁定", () => {
    expect(isBinding("anonymous", undefined)).toBe(false);
  });
});

describe("isAnonymousRecord", () => {
  it("匿名帳號沒有任何供應商", () => {
    expect(isAnonymousRecord([])).toBe(true);
  });

  it("有供應商的是正式帳號", () => {
    expect(isAnonymousRecord(["google.com"])).toBe(false);
  });
});
