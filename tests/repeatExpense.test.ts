import { describe, expect, it } from "vitest";
import { repeatFieldsOf } from "@/utils/repeatExpense";
import type { Expense } from "@/types/expense";

function source(overrides: Partial<Expense> = {}): Expense {
  return {
    id: "src",
    title: "7-11",
    category: "food",
    amount: 12000,
    currency: "THB",
    rate: 0.9,
    baseAmount: 10800,
    paidBy: "u_ming",
    splitMode: "even",
    splits: { u_ming: 6000, u_hua: 6000 },
    place: { name: "7-ELEVEN", address: null, lat: null, lng: null, placeId: null },
    date: "2026-03-01",
    ...overrides
  } as Expense;
}

describe("repeatFieldsOf", () => {
  it("帶走會重複的那些設定", () => {
    const fields = repeatFieldsOf(source());
    expect(fields.title).toBe("7-11");
    expect(fields.category).toBe("food");
    expect(fields.currency).toBe("THB");
    expect(fields.paidBy).toBe("u_ming");
    expect(fields.splitMode).toBe("even");
    expect(fields.splits).toEqual({ u_ming: 6000, u_hua: 6000 });
    expect(fields.place).toEqual(source().place);
  });

  it("不帶金額 —— 那正是每次要改的東西", () => {
    expect("amount" in fields()).toBe(false);
    function fields() {
      return repeatFieldsOf(source()) as Record<string, unknown>;
    }
  });

  it("不帶日期 —— 再記一筆是記今天的，不是原本那天的", () => {
    expect("date" in (repeatFieldsOf(source()) as Record<string, unknown>)).toBe(false);
  });

  it("不帶匯率 —— 匯率是記帳當下鎖定的，新的一筆要用今天的", () => {
    expect("rate" in (repeatFieldsOf(source()) as Record<string, unknown>)).toBe(false);
    expect("baseAmount" in (repeatFieldsOf(source()) as Record<string, unknown>)).toBe(false);
  });

  it("splits 是複製不是共用，改新的不會動到來源", () => {
    const original = source();
    const fields = repeatFieldsOf(original);
    fields.splits.u_ming = 999;
    expect(original.splits.u_ming).toBe(6000);
  });

  it("沒有地點的支出，place 是 null 不是壞掉", () => {
    expect(repeatFieldsOf(source({ place: null })).place).toBeNull();
  });
});
