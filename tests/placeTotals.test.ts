import { describe, expect, it } from "vitest";
import { NO_PLACE_LABEL, placeTotals } from "@/utils/placeTotals";
import type { Expense, ExpensePlace } from "@/types/expense";

function place(overrides: Partial<ExpensePlace> = {}): ExpensePlace {
  return { name: "大皇宮", address: null, lat: 13.75, lng: 100.49, placeId: "p_palace", ...overrides };
}

function expense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: "e1",
    title: "門票",
    category: "ticket",
    amount: 10000,
    currency: "TWD",
    rate: 1,
    baseAmount: 10000,
    paidBy: "u1",
    splitMode: "even",
    splits: { u1: 10000 },
    place: place(),
    receipt: null,
    date: "2026-03-01",
    ...overrides
  } as Expense;
}

describe("placeTotals", () => {
  it("同一個地點的多筆支出合併成一列", () => {
    const result = placeTotals(
      [expense({ id: "a", baseAmount: 10000 }), expense({ id: "b", baseAmount: 5000 })],
      "TWD"
    );
    expect(result).toHaveLength(1);
    expect(result[0].total).toBe(15000);
    expect(result[0].expenseCount).toBe(2);
  });

  it("依金額由大到小排序", () => {
    const result = placeTotals(
      [
        expense({ id: "a", baseAmount: 3000, place: place({ name: "小的", placeId: "p_small" }) }),
        expense({ id: "b", baseAmount: 9000, place: place({ name: "大的", placeId: "p_big" }) })
      ],
      "TWD"
    );
    expect(result.map(item => item.name)).toEqual(["大的", "小的"]);
  });

  it("沒有地點的支出歸到「未指定地點」", () => {
    const result = placeTotals([expense({ place: null, baseAmount: 8000 })], "TWD");
    expect(result[0].name).toBe(NO_PLACE_LABEL);
    expect(result[0].total).toBe(8000);
    expect(result[0].placeId).toBeNull();
  });

  // 「未指定地點」不是一個目的地，是把剩下的錢交代清楚的那一列。
  // 讀者會自己加總來驗證數字，所以它必須存在，但排在最後才讀得順。
  it("「未指定地點」永遠排在最後，就算金額最大", () => {
    const result = placeTotals(
      [
        expense({ id: "a", place: null, baseAmount: 90000 }),
        expense({ id: "b", baseAmount: 1000 })
      ],
      "TWD"
    );
    expect(result[result.length - 1].name).toBe(NO_PLACE_LABEL);
  });

  it("只打名字沒選建議的地點也算一個地點，但沒有座標", () => {
    const textOnly = place({ name: "路邊攤", placeId: null, lat: null, lng: null });
    const result = placeTotals([expense({ place: textOnly })], "TWD");
    expect(result[0].name).toBe("路邊攤");
    expect(result[0].lat).toBeNull();
  });

  it("同名的純文字地點會合併 —— 使用者打一樣的名字就是指同一個地方", () => {
    const textOnly = place({ name: "7-11", placeId: null, lat: null, lng: null });
    const result = placeTotals(
      [
        expense({ id: "a", place: textOnly, baseAmount: 100 }),
        expense({ id: "b", place: textOnly, baseAmount: 200 })
      ],
      "TWD"
    );
    expect(result).toHaveLength(1);
    expect(result[0].total).toBe(300);
  });

  it("缺匯率換算不出來的支出要排除，否則總額會跟結算對不起來", () => {
    const noRate = expense({ id: "x", currency: "THB", baseAmount: null, rate: null });
    const result = placeTotals([noRate], "TWD");
    expect(result).toEqual([]);
  });

  it("空清單回傳空陣列", () => {
    expect(placeTotals([], "TWD")).toEqual([]);
  });
});
