import { describe, expect, it } from "vitest";
import {
  accountRoleAfterMerge,
  checkMergeCaller,
  mergeTarget,
  movedMember,
  rewriteExpense,
  rewritePayment,
  rewriteSettlement,
  rewriteTask,
  virtualIdFor,
  type MergeIds
} from "./guestMerge.js";

const G = "uid_guest_000000000000000000";
const A = "uid_account_0000000000000000";
const B = "uid_friend_00000000000000000";
const V = virtualIdFor(G, "task1");

const toAccount: MergeIds = { guest: G, account: A, target: A };
const toVirtual: MergeIds = { guest: G, account: A, target: V };

describe("virtualIdFor", () => {
  it("符合虛擬成員的格式", () => {
    expect(V).toMatch(/^v_[a-z0-9]{20}$/);
  });

  it("同樣的訪客與任務一定算出同一個 id —— 重跑才不會分裂成兩個人", () => {
    expect(virtualIdFor(G, "task1")).toBe(V);
  });

  it("不同任務算出不同的 id", () => {
    expect(virtualIdFor(G, "task2")).not.toBe(V);
  });
});

describe("mergeTarget", () => {
  it("正式帳號不在這個任務裡，目標就是正式帳號", () => {
    expect(mergeTarget({ guest: G, account: A, taskId: "task1", accountHasMember: false })).toBe(A);
  });

  it("正式帳號有成員文件（包含曾經被移出），目標是虛擬成員", () => {
    expect(mergeTarget({ guest: G, account: A, taskId: "task1", accountHasMember: true })).toBe(V);
  });
});

describe("rewriteExpense", () => {
  const expense = {
    title: "晚餐",
    paidBy: G,
    createdBy: G,
    splits: { [G]: 300, [B]: 300 },
    splitMemberIds: [G, B]
  };

  it("付款人、分攤、舊欄位換成目標；createdBy 一律給正式帳號", () => {
    expect(rewriteExpense(expense, toVirtual)).toEqual({
      paidBy: V,
      createdBy: A,
      splits: { [V]: 300, [B]: 300 },
      splitMemberIds: [V, B]
    });
  });

  it("目標是正式帳號時全部換成正式帳號", () => {
    expect(rewriteExpense(expense, toAccount)).toEqual({
      paidBy: A,
      createdBy: A,
      splits: { [A]: 300, [B]: 300 },
      splitMemberIds: [A, B]
    });
  });

  it("跟訪客無關的支出不改", () => {
    expect(rewriteExpense({ paidBy: B, createdBy: B, splits: { [B]: 100 } }, toAccount)).toBeNull();
  });

  it("冪等：改過的再改一次沒有東西要改", () => {
    const once = { ...expense, ...rewriteExpense(expense, toVirtual) };
    expect(rewriteExpense(once, toVirtual)).toBeNull();
  });
});

describe("rewritePayment", () => {
  it("共同任務裡訪客付給正式帳號，改寫後是虛擬成員付給正式帳號 —— 仍然是兩個人", () => {
    const changes = rewritePayment({ from: G, to: A, createdBy: G, amount: 100 }, toVirtual);
    expect(changes).toEqual({ from: V, createdBy: A });
    expect(changes?.from).not.toBe(A);
  });

  it("收款方是訪客也要換", () => {
    expect(rewritePayment({ from: B, to: G, createdBy: B }, toAccount)).toEqual({ to: A });
  });

  it("無關的付款不改", () => {
    expect(rewritePayment({ from: B, to: A, createdBy: B }, toAccount)).toBeNull();
  });
});

describe("rewriteSettlement", () => {
  const snapshot = {
    balances: [
      { uid: G, paid: 600, owed: 300, balance: 300 },
      { uid: B, paid: 0, owed: 300, balance: -300 }
    ],
    transfers: [{ from: B, to: G, amount: 300 }],
    memberNames: { [G]: "小試", [B]: "阿明" },
    createdBy: G
  };

  it("balances、transfers、memberNames 的 key 都換掉", () => {
    expect(rewriteSettlement(snapshot, toVirtual)).toEqual({
      balances: [
        { uid: V, paid: 600, owed: 300, balance: 300 },
        { uid: B, paid: 0, owed: 300, balance: -300 }
      ],
      transfers: [{ from: B, to: V, amount: 300 }],
      memberNames: { [V]: "小試", [B]: "阿明" },
      createdBy: A
    });
  });

  it("冪等", () => {
    const once = { ...snapshot, ...rewriteSettlement(snapshot, toVirtual) };
    expect(rewriteSettlement(once, toVirtual)).toBeNull();
  });
});

describe("rewriteTask", () => {
  it("非共同任務：訪客的位置整個交給正式帳號，人數不動", () => {
    const task = { ownerId: G, adminIds: [G], memberIds: [G, B], createdBy: G, memberCount: 2 };
    expect(rewriteTask(task, toAccount)).toEqual({
      ownerId: A,
      adminIds: [A],
      memberIds: [A, B],
      createdBy: A
    });
  });

  it("共同任務裡訪客是 owner：owner 給正式帳號，虛擬成員不進 adminIds", () => {
    const task = { ownerId: G, adminIds: [G], memberIds: [G, A, B], createdBy: G };
    expect(rewriteTask(task, toVirtual)).toEqual({
      ownerId: A,
      adminIds: [A],
      memberIds: [V, A, B],
      createdBy: A
    });
  });

  it("共同任務裡訪客是一般成員：只換 memberIds", () => {
    const task = { ownerId: B, adminIds: [B], memberIds: [B, A, G], createdBy: B };
    expect(rewriteTask(task, toVirtual)).toEqual({ memberIds: [B, A, V] });
  });

  it("共同任務裡訪客是 admin、正式帳號已經是 admin：adminIds 不重複", () => {
    const task = { ownerId: B, adminIds: [B, G, A], memberIds: [B, G, A] };
    expect(rewriteTask(task, toVirtual)).toEqual({ adminIds: [B, A], memberIds: [B, V, A] });
  });
});

describe("accountRoleAfterMerge", () => {
  it("訪客是 owner，正式帳號接 owner", () => {
    expect(accountRoleAfterMerge("owner", "member")).toBe("owner");
  });

  it("訪客是 admin、正式帳號是一般成員，升成 admin", () => {
    expect(accountRoleAfterMerge("admin", "member")).toBe("admin");
  });

  it("訪客是一般成員，正式帳號角色不變", () => {
    expect(accountRoleAfterMerge("member", "member")).toBeNull();
  });

  it("正式帳號已經是 admin，不必再寫", () => {
    expect(accountRoleAfterMerge("admin", "admin")).toBeNull();
  });
});

describe("movedMember", () => {
  const guestMember = { uid: G, nickname: "小試", role: "owner", joinedAt: "T0", active: true };

  it("目標是正式帳號：角色與 joinedAt 保留，暱稱用正式帳號的", () => {
    expect(movedMember(guestMember, { ids: toAccount, guestNickname: "小試", accountNickname: "阿華" })).toEqual({
      uid: A,
      nickname: "阿華",
      role: "owner",
      joinedAt: "T0",
      active: true
    });
  });

  it("目標是虛擬成員：一般成員、標上 virtual、暱稱加（訪客）", () => {
    expect(movedMember(guestMember, { ids: toVirtual, guestNickname: "小試", accountNickname: "阿華" })).toEqual({
      uid: V,
      nickname: "小試（訪客）",
      role: "member",
      joinedAt: "T0",
      active: true,
      virtual: true
    });
  });

  it("虛擬成員的暱稱不超過 20 字", () => {
    const long = "一二三四五六七八九十一二三四五六七八九十";
    const moved = movedMember(guestMember, { ids: toVirtual, guestNickname: long, accountNickname: "" });
    expect(Array.from(moved.nickname as string)).toHaveLength(20);
    expect(moved.nickname).toMatch(/（訪客）$/);
  });
});

describe("checkMergeCaller", () => {
  const ok = { callerUid: A, callerProvider: "google.com", guestUid: G, guestProvider: "anonymous" };

  it("正式帳號合併訪客，放行", () => {
    expect(checkMergeCaller(ok)).toBeNull();
  });

  it("呼叫者自己是訪客，拒絕", () => {
    expect(checkMergeCaller({ ...ok, callerProvider: "anonymous" })).not.toBeNull();
  });

  it("被合併的不是訪客，拒絕 —— 正式帳號之間不能互相吞", () => {
    expect(checkMergeCaller({ ...ok, guestProvider: "google.com" })).not.toBeNull();
  });

  it("合併到自己，拒絕", () => {
    expect(checkMergeCaller({ ...ok, guestUid: A })).not.toBeNull();
  });
});
