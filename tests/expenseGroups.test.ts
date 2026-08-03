import { describe, expect, it } from "vitest";
import { groupExpensesByDate } from "@/utils/expenseGroups";
import type { Expense } from "@/types/expense";

function at(year: number, month: number, day: number, hour = 12) {
  const value = new Date(year, month - 1, day, hour);
  return { toDate: () => value };
}

function expense(
  id: string,
  date: string | null,
  baseAmount: number | null,
  createdAt = at(2026, 3, 1),
  currency = "TWD"
): Expense {
  return { id, date, baseAmount, currency, amount: baseAmount ?? 0, createdAt } as unknown as Expense;
}

describe("groupExpensesByDate", () => {
  it("同一天的收在一組，日期新的組排前面", () => {
    const groups = groupExpensesByDate(
      [
        expense("a", "2026-03-01", 10000),
        expense("b", "2026-03-05", 20000),
        expense("c", "2026-03-05", 30000)
      ],
      "TWD"
    );
    expect(groups.map(group => group.date)).toEqual(["2026-03-05", "2026-03-01"]);
    expect(groups[0].expenses.map(item => item.id)).toEqual(["b", "c"]);
  });

  it("每組帶當天的筆數與小計", () => {
    const groups = groupExpensesByDate(
      [expense("a", "2026-03-05", 20000), expense("b", "2026-03-05", 30000)],
      "TWD"
    );
    expect(groups[0].count).toBe(2);
    expect(groups[0].total).toBe(50000);
  });

  it("組內維持傳進來的順序，不重新排", () => {
    // 列表本身已經用 compareExpenses 排過（同一天後記的在前），
    // 這裡再排一次只會把那個順序弄掉。
    const groups = groupExpensesByDate(
      [expense("late", "2026-03-05", 100), expense("early", "2026-03-05", 200)],
      "TWD"
    );
    expect(groups[0].expenses.map(item => item.id)).toEqual(["late", "early"]);
  });

  it("舊資料沒有 date，用 createdAt 那天歸組", () => {
    const groups = groupExpensesByDate([expense("legacy", null, 10000, at(2026, 3, 9))], "TWD");
    expect(groups[0].date).toBe("2026-03-09");
  });

  it("缺匯率的支出仍然列在組裡，但不計進小計", () => {
    // 看得到才知道要去補匯率；算進去的話小計會是錯的。
    const groups = groupExpensesByDate(
      [expense("ok", "2026-03-05", 20000), expense("nope", "2026-03-05", null, at(2026, 3, 5), "THB")],
      "TWD"
    );
    expect(groups[0].count).toBe(2);
    expect(groups[0].expenses).toHaveLength(2);
    expect(groups[0].total).toBe(20000);
    expect(groups[0].hasUnconverted).toBe(true);
  });

  it("整組都換算得出來時 hasUnconverted 是 false", () => {
    const groups = groupExpensesByDate([expense("ok", "2026-03-05", 20000)], "TWD");
    expect(groups[0].hasUnconverted).toBe(false);
  });

  it("沒有支出就回空陣列", () => {
    expect(groupExpensesByDate([], "TWD")).toEqual([]);
  });
});
