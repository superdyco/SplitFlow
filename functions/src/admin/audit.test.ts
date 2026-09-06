import { describe, expect, it } from "vitest";
import {
  auditEntry,
  disableEffectiveAt,
  kindOf,
  parseAuditFilter,
  RETENTION_DAYS,
  type AuditInput
} from "./audit.js";

const AT = new Date("2026-09-06T06:38:00Z");

function build(overrides: Partial<AuditInput> = {}) {
  return auditEntry({
    action: "view.user",
    adminUid: "uid_admin",
    adminEmail: "dyco@example.com",
    targetType: "user",
    targetId: "uid_kim",
    targetLabel: "Kim",
    ip: "203.0.113.24",
    userAgent: "Mozilla/5.0",
    at: AT,
    ...overrides
  });
}

describe("auditEntry", () => {
  it("檢視不需要理由", () => {
    const result = build();
    expect(result.ok).toBe(true);
  });

  it("expireAt 是 400 天後", () => {
    const result = build();
    if (!result.ok) throw new Error("應該要成功");
    const days = (result.entry.expireAt.getTime() - AT.getTime()) / 86_400_000;
    expect(days).toBe(RETENTION_DAYS);
  });

  describe("處置必須有理由", () => {
    it("沒填就擋下來", () => {
      expect(build({ action: "act.disableUser" })).toEqual({
        ok: false,
        problem: "reason-required"
      });
    });

    /*
      不 trim 的話，一個空格就能通過必填檢查 —— 而那正是趕時間的人會做的事。
    */
    it("只打空白也不算", () => {
      expect(build({ action: "act.disableUser", reason: "   \n  " })).toEqual({
        ok: false,
        problem: "reason-required"
      });
    });

    it("填了就過，而且前後空白會被修掉", () => {
      const result = build({ action: "act.disableUser", reason: "  大量建立空任務  " });
      if (!result.ok) throw new Error("應該要成功");
      expect(result.entry.reason).toBe("大量建立空任務");
    });

    it("三個處置都要理由", () => {
      for (const action of ["act.revokeReport", "act.disableUser", "act.archiveTask"] as const) {
        expect(build({ action })).toEqual({ ok: false, problem: "reason-required" });
      }
    });

    it("太長的理由擋下來", () => {
      expect(build({ action: "act.archiveTask", reason: "太".repeat(501) })).toEqual({
        ok: false,
        problem: "reason-too-long"
      });
    });
  });

  /*
    reason 這個欄位在日誌裡的意思是「這次處置的正當理由」。讓檢視也能塞
    字串進去，日誌讀起來就會像有人替一次純瀏覽寫了辯解，而且那段字是前端
    給的，不是誰審過的。
  */
  it("檢視就算送了理由也會被丟掉", () => {
    const result = build({ action: "view.task", reason: "隨便寫的" });
    if (!result.ok) throw new Error("應該要成功");
    expect(result.entry.reason).toBeNull();
  });

  it("被擋下的存取也記，而且不需要理由", () => {
    const result = build({
      action: "denied.access",
      targetType: "route",
      targetId: "/admin",
      targetLabel: "/admin"
    });
    if (!result.ok) throw new Error("應該要成功");
    expect(result.entry.action).toBe("denied.access");
    expect(result.entry.reason).toBeNull();
  });

  it("過長的暱稱會被截斷 —— 那是使用者輸入，不能決定日誌文件多大", () => {
    const result = build({ targetLabel: "長".repeat(500) });
    if (!result.ok) throw new Error("應該要成功");
    expect(result.entry.targetLabel).toHaveLength(120);
  });

  it("result 預設是 ok，也可以指定 error", () => {
    const fine = build();
    if (!fine.ok) throw new Error("應該要成功");
    expect(fine.entry.result).toBe("ok");

    const failed = build({ result: "error" });
    if (!failed.ok) throw new Error("應該要成功");
    expect(failed.entry.result).toBe("error");
  });
});

describe("disableEffectiveAt", () => {
  /*
    停用不是立刻生效：disabled 擋的是換發新憑證，對方手上那張 ID token 最長
    還能用 1 小時。這個限制被接受了，但不能只活在文件裡 —— callable 回傳這個
    時間，讓對話框說得出確切幾點。
  */
  it("是一小時後", () => {
    expect(disableEffectiveAt(AT).toISOString()).toBe("2026-09-06T07:38:00.000Z");
  });
});

describe("kindOf", () => {
  /*
    這個欄位是「只看處置」做得出來的前提。Firestore 要求範圍欄位必須是第一個
    排序欄位，所以拿 action 的前綴過濾就得照 action 排 —— 而稽核日誌唯一有
    意義的排序是時間由新到舊。
  */
  it("三個處置是 act", () => {
    for (const action of ["act.revokeReport", "act.disableUser", "act.archiveTask"] as const) {
      expect(kindOf(action)).toBe("act");
    }
  });

  it("檢視與匯出都是 view", () => {
    for (const action of ["view.user", "view.task", "view.report", "export.stats"] as const) {
      expect(kindOf(action)).toBe("view");
    }
  });

  it("被擋下的存取自成一類 —— 那不是管理者做的", () => {
    expect(kindOf("denied.access")).toBe("denied");
  });

  it("組出來的日誌帶著 kind", () => {
    const result = build({ action: "act.archiveTask", reason: "濫用" });
    if (!result.ok) throw new Error("應該要成功");
    expect(result.entry.kind).toBe("act");
  });
});

describe("parseAuditFilter", () => {
  it("認得三個", () => {
    expect(parseAuditFilter("all")).toBe("all");
    expect(parseAuditFilter("act")).toBe("act");
    expect(parseAuditFilter("view")).toBe("view");
  });

  it("其他回 null", () => {
    expect(parseAuditFilter("denied")).toBeNull();
    expect(parseAuditFilter(undefined)).toBeNull();
  });
});
