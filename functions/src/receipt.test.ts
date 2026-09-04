import { describe, expect, it } from "vitest";
import { canDeleteReceipt } from "./receipt.js";

const OWNER = "uid_owner";
const ADMIN = "uid_admin";
const MEMBER = "uid_member";
const OTHER = "uid_other";
const OUTSIDER = "uid_outsider";

const task = {
  status: "active",
  memberIds: [OWNER, ADMIN, MEMBER, OTHER],
  adminIds: [OWNER, ADMIN]
};

/** MEMBER 建立、MEMBER 先付。 */
const expense = { createdBy: MEMBER, paidBy: MEMBER };

describe("canDeleteReceipt", () => {
  it("admin 刪得掉任何一張", () => {
    expect(canDeleteReceipt({ task, expense, uid: ADMIN })).toEqual({ kind: "allow" });
  });

  it("記帳的人刪得掉自己那張", () => {
    expect(canDeleteReceipt({ task, expense, uid: MEMBER })).toEqual({ kind: "allow" });
  });

  it("先付錢的人也刪得掉 —— 跟 canManageExpense 同一組條件", () => {
    expect(
      canDeleteReceipt({ task, expense: { createdBy: OTHER, paidBy: MEMBER }, uid: MEMBER })
    ).toEqual({ kind: "allow" });
  });

  /*
    這一條是整個修法的理由。舊版 Storage 規則只看 request.auth != null，
    所以同一個任務裡的一般成員刪不掉別人的支出，卻刪得掉那筆支出的照片 ——
    比 Firestore 那邊的 canManageExpense 鬆得多。
  */
  it("一般成員刪不掉別人的收據", () => {
    expect(canDeleteReceipt({ task, expense, uid: OTHER })).toEqual({ kind: "not-yours" });
  });

  it("不是成員就連存不存在都不該知道", () => {
    expect(canDeleteReceipt({ task, expense, uid: OUTSIDER })).toEqual({ kind: "denied" });
  });

  it("任務不存在也一樣", () => {
    expect(canDeleteReceipt({ task: null, expense, uid: ADMIN })).toEqual({ kind: "denied" });
  });

  it("封存的任務照片也刪不掉 —— 封存的重點就是留著查", () => {
    expect(
      canDeleteReceipt({ task: { ...task, status: "archived" }, expense, uid: ADMIN })
    ).toEqual({ kind: "inactive-task" });
  });

  // hardDeleteMember 先刪帳、最後才清照片，所以這時查不到支出是正常的。
  it("支出已經刪掉了，admin 仍清得掉剩下的孤兒檔案", () => {
    expect(canDeleteReceipt({ task, expense: null, uid: ADMIN })).toEqual({ kind: "allow" });
  });

  it("支出已經刪掉了，一般成員就沒有東西能證明那張圖是他的", () => {
    expect(canDeleteReceipt({ task, expense: null, uid: MEMBER })).toEqual({ kind: "not-yours" });
  });

  it("欄位缺漏的舊任務文件不會變成放行", () => {
    expect(canDeleteReceipt({ task: {}, expense, uid: ADMIN })).toEqual({ kind: "denied" });
  });
});
