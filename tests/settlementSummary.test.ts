import { describe, expect, it } from "vitest";
import { myOwed, myTransfers } from "@/utils/settlementSummary";
import type { MemberBalance, Transfer } from "@/types/settlement";

const ME = "u_ming";

function transfer(from: string, to: string, amount: number): Transfer {
  return { from, to, amount };
}

function balance(uid: string, paid: number, owed: number): MemberBalance {
  return { uid, paid, owed, balance: paid - owed };
}

describe("myTransfers", () => {
  it("只挑出跟我有關的那幾筆", () => {
    const all = [
      transfer(ME, "u_hua", 2340),
      transfer("u_hao", "u_jie", 900),
      transfer("u_jie", ME, 1180)
    ];
    expect(myTransfers(all, ME).lines).toHaveLength(2);
    expect(myTransfers(all, ME).lines.map(line => line.amount)).toEqual([2340, 1180]);
  });

  it("方向要分得出來 —— 付出去跟收進來是相反的行動", () => {
    const all = [transfer(ME, "u_hua", 2340), transfer("u_jie", ME, 1180)];
    const [out, into] = myTransfers(all, ME).lines;
    expect(out.outgoing).toBe(true);
    expect(into.outgoing).toBe(false);
  });

  it("超過 max 就只給前幾筆，剩下的筆數另外回", () => {
    const all = [
      transfer(ME, "a", 100),
      transfer(ME, "b", 90),
      transfer(ME, "c", 80),
      transfer(ME, "d", 70),
      transfer(ME, "e", 60)
    ];
    const result = myTransfers(all, ME, 3);
    expect(result.lines).toHaveLength(3);
    expect(result.rest).toBe(2);
  });

  it("沒超過 max 時 rest 是 0，不是負數", () => {
    const all = [transfer(ME, "u_hua", 2340)];
    expect(myTransfers(all, ME, 3).rest).toBe(0);
  });

  it("沒有跟我有關的轉帳就是空的 —— 那代表已經結清", () => {
    const all = [transfer("u_hua", "u_jie", 500)];
    expect(myTransfers(all, ME)).toEqual({ lines: [], rest: 0 });
  });

  it("完全沒有轉帳也不會爆", () => {
    expect(myTransfers([], ME)).toEqual({ lines: [], rest: 0 });
  });
});

describe("myOwed", () => {
  it("回的是 owed 不是 balance", () => {
    // owed 是「我該分攤多少」，balance 是「我多付或少付了多少」。
    // 這兩個很容易寫錯，而寫錯的畫面看起來完全正常。
    const balances = [balance(ME, 50000, 31480), balance("u_hua", 10000, 28520)];
    expect(myOwed(balances, ME)).toBe(31480);
  });

  it("找不到我時回 0 不是 undefined", () => {
    // 沒參與任何一筆支出的人不在 balances 裡。畫面上要顯示 0，不是空白。
    expect(myOwed([balance("u_hua", 10000, 10000)], ME)).toBe(0);
  });

  it("空陣列也回 0", () => {
    expect(myOwed([], ME)).toBe(0);
  });
});
