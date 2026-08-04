import { describe, expect, it } from "vitest";
import { tripSummary } from "@/utils/tripSummary";
import type { Expense } from "@/types/expense";

function expense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: "e1",
    title: "晚餐",
    category: "food",
    amount: 10000,
    currency: "TWD",
    rate: 1,
    baseAmount: 10000,
    paidBy: "u1",
    splitMode: "even",
    splits: { u1: 10000 },
    place: null,
    receipt: null,
    date: "2026-03-01",
    ...overrides
  } as Expense;
}

function run(overrides: Partial<Parameters<typeof tripSummary>[0]> = {}) {
  return tripSummary({
    expenses: [expense()],
    baseCurrency: "TWD",
    memberCount: 2,
    startDate: null,
    endDate: null,
    ...overrides
  });
}

describe("tripSummary", () => {
  it("天數優先用任務的起迄日期，而且含頭尾", () => {
    expect(run({ startDate: "2026-03-01", endDate: "2026-03-05" }).days).toBe(5);
  });

  it("同一天出發與結束算一天，不是零天", () => {
    expect(run({ startDate: "2026-03-01", endDate: "2026-03-01" }).days).toBe(1);
  });

  it("沒設起迄日期就用支出日期的頭尾", () => {
    const result = run({
      expenses: [expense({ id: "a", date: "2026-03-02" }), expense({ id: "b", date: "2026-03-04" })]
    });
    expect(result.days).toBe(3);
  });

  it("沒有起迄也沒有支出時天數是 null，不要顯示假的數字", () => {
    expect(run({ expenses: [] }).days).toBeNull();
  });

  it("每人平均是總額除以人數", () => {
    const result = run({ expenses: [expense({ baseAmount: 30000 })], memberCount: 3 });
    expect(result.total).toBe(30000);
    expect(result.perPerson).toBe(10000);
  });

  it("除不盡就四捨五入到最小單位 —— 這是參考值，不需要分毫不差", () => {
    const result = run({ expenses: [expense({ baseAmount: 10000 })], memberCount: 3 });
    expect(result.perPerson).toBe(3333);
  });

  it("人數是 0 時不會除以零，回傳 0", () => {
    expect(run({ memberCount: 0 }).perPerson).toBe(0);
  });

  it("缺匯率的支出不算進總額與筆數，跟地點與分類保持一致", () => {
    const result = run({
      expenses: [
        expense({ id: "a", baseAmount: 10000 }),
        expense({ id: "x", currency: "THB", baseAmount: null, rate: null })
      ]
    });
    expect(result.total).toBe(10000);
    expect(result.expenseCount).toBe(1);
  });
});
