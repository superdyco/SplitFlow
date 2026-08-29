import { describe, expect, it } from "vitest";
import { hasRecords, memberFootprint } from "@/utils/memberFootprint";
import type { Expense } from "@/types/expense";
import type { Payment } from "@/types/payment";

function expense(id: string, paidBy: string, splits: Record<string, number>): Expense {
  return {
    id,
    title: "晚餐",
    category: "food",
    amount: 1000,
    currency: "TWD",
    rate: 1,
    baseAmount: 1000,
    paidBy,
    splitMode: "even",
    splits,
    note: "",
    place: null,
    receipt: null,
    date: "2026-08-28",
    time: "",
    createdBy: paidBy,
    createdAt: null,
    updatedAt: null
  } as unknown as Expense;
}

function payment(id: string, from: string, to: string, status: string): Payment {
  return { id, from, to, amount: 500, currency: "TWD", status, createdBy: from } as unknown as Payment;
}

describe("memberFootprint", () => {
  it("認得他是付款人的支出", () => {
    const result = memberFootprint("amma", [expense("e1", "amma", { ming: 1000 })], []);
    expect(result.expenseIds).toEqual(["e1"]);
  });

  it("認得他被分攤的支出 —— 就算是別人付的", () => {
    const result = memberFootprint("amma", [expense("e1", "ming", { ming: 500, amma: 500 })], []);
    expect(result.expenseIds).toEqual(["e1"]);
  });

  // 分攤金額是 0 也算參與 —— 自訂分攤可以給某個人 0 元。
  it("分攤金額 0 也算", () => {
    const result = memberFootprint("amma", [expense("e1", "ming", { ming: 1000, amma: 0 })], []);
    expect(result.expenseIds).toEqual(["e1"]);
  });

  it("既是付款人又在分攤裡，只算一次", () => {
    const result = memberFootprint("amma", [expense("e1", "amma", { amma: 500, ming: 500 })], []);
    expect(result.expenseIds).toEqual(["e1"]);
  });

  it("跟他無關的支出不算", () => {
    const result = memberFootprint("amma", [expense("e1", "ming", { ming: 500, hua: 500 })], []);
    expect(result.expenseIds).toEqual([]);
  });

  // uid 剛好叫 toString 的話，用 `uid in splits` 會誤判成有帳。
  it("不會被原型鏈上的名字騙到", () => {
    const result = memberFootprint("toString", [expense("e1", "ming", { ming: 1000 })], []);
    expect(result.expenseIds).toEqual([]);
  });

  it("認得付款的兩端，pending 與 confirmed 都算", () => {
    const result = memberFootprint("amma", [], [
      payment("p1", "amma", "ming", "pending"),
      payment("p2", "ming", "amma", "confirmed"),
      payment("p3", "ming", "hua", "confirmed")
    ]);
    expect(result.paymentIds).toEqual(["p1", "p2"]);
  });

  describe("othersPaid", () => {
    // 真實移除會把整筆支出刪掉，所以只有「別人付的」才會連累到其他人。
    // 對話框那句警告靠這個決定要不要出現，不該無條件嚇人。
    it("有別人付、他只是被分攤的支出 → true", () => {
      const result = memberFootprint("amma", [expense("e1", "ming", { amma: 100 })], []);
      expect(result.othersPaid).toBe(true);
    });

    it("全部都是他自己付的 → false", () => {
      const result = memberFootprint("amma", [expense("e1", "amma", { amma: 100 })], []);
      expect(result.othersPaid).toBe(false);
    });

    it("混在一起時仍然是 true —— 只要有一筆會連累別人就要講", () => {
      const result = memberFootprint(
        "amma",
        [expense("e1", "amma", { amma: 100 }), expense("e2", "ming", { amma: 50 })],
        []
      );
      expect(result.othersPaid).toBe(true);
    });

    it("完全沒帳時是 false", () => {
      const result = memberFootprint("amma", [expense("e1", "ming", { ming: 100 })], []);
      expect(result.othersPaid).toBe(false);
    });
  });

  it("完全沒帳時兩個陣列都是空的", () => {
    const result = memberFootprint("amma", [expense("e1", "ming", { ming: 1000 })], []);
    expect(result).toEqual({ expenseIds: [], paymentIds: [], othersPaid: false });
  });
});

describe("hasRecords", () => {
  it("有支出就算有帳", () => {
    expect(hasRecords({ expenseIds: ["e1"], paymentIds: [] })).toBe(true);
  });

  it("只有付款也算有帳", () => {
    expect(hasRecords({ expenseIds: [], paymentIds: ["p1"] })).toBe(true);
  });

  it("兩個都空才是沒帳", () => {
    expect(hasRecords({ expenseIds: [], paymentIds: [] })).toBe(false);
  });
});
