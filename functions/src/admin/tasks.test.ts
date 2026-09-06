import { describe, expect, it } from "vitest";
import { EXPENSE_CATEGORIES, type ExpenseCategory } from "./categories.js";
import { categorySlices, parseTaskFilter, percentSum } from "./tasks.js";

const empty = Object.fromEntries(EXPENSE_CATEGORIES.map(c => [c, 0])) as Record<
  ExpenseCategory,
  number
>;

describe("parseTaskFilter", () => {
  it("認得四個", () => {
    for (const value of ["active", "archived", "deleted", "all"]) {
      expect(parseTaskFilter(value)).toBe(value);
    }
  });

  it("其他回 null，不給預設值", () => {
    expect(parseTaskFilter("Active")).toBeNull();
    expect(parseTaskFilter("")).toBeNull();
    expect(parseTaskFilter(undefined)).toBeNull();
  });
});

describe("categorySlices", () => {
  it("照金額由大到小排，並算出百分比", () => {
    const slices = categorySlices(
      { ...empty, food: 5000, stay: 3000, transport: 2000 },
      EXPENSE_CATEGORIES
    );
    expect(slices.map(s => s.category)).toEqual(["food", "stay", "transport"]);
    expect(slices.map(s => s.percent)).toEqual([50, 30, 20]);
  });

  it("金額是 0 的分類不出現", () => {
    const slices = categorySlices({ ...empty, food: 100 }, EXPENSE_CATEGORIES);
    expect(slices).toHaveLength(1);
  });

  /*
    任務剛建立、一筆支出都還沒有的時候會走到這裡。除以 0 得到 NaN，
    而 NaN 會讓佔比條的寬度變成 "NaN%"，整條消失。
  */
  it("一筆支出都沒有的時候不會變成 NaN", () => {
    const slices = categorySlices(empty, EXPENSE_CATEGORIES);
    expect(slices).toEqual([]);
  });

  it("只有一個分類就是 100%", () => {
    expect(categorySlices({ ...empty, other: 42 }, EXPENSE_CATEGORIES)[0].percent).toBe(100);
  });
});

describe("percentSum", () => {
  /*
    三等分之後加起來是 99，不是 100。這一條不是要求它等於 100 ——
    是把「它不會等於 100」這件事寫下來，免得下一個人看到 99 以為是 bug
    然後去把差額塞給最大的那一項。
  */
  it("四捨五入之後不保證是 100，而那是刻意的", () => {
    const slices = categorySlices(
      { ...empty, food: 100, stay: 100, transport: 100 },
      EXPENSE_CATEGORIES
    );
    expect(slices.map(s => s.percent)).toEqual([33, 33, 33]);
    expect(percentSum(slices)).toBe(99);
  });
});
