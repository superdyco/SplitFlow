import { describe, expect, it } from "vitest";
import { myTripCost, sumByCurrency } from "@/utils/myCost";
import type { Expense } from "@/types/expense";

function expense(
  paidBy: string,
  splits: Record<string, number>,
  amount: number,
  { currency = "TWD", rate = 1, baseAmount = amount } = {}
): Expense {
  return {
    id: Math.random().toString(36),
    paidBy,
    splits,
    amount,
    currency,
    rate,
    baseAmount,
    category: "food",
    splitMode: "even"
  } as Expense;
}

const ORDER = ["u_ming", "u_hua", "u_hao"];

describe("myTripCost", () => {
  it("算的是我該分攤的，不是我先付的", () => {
    // 小明先付 30000 全額，三人均分 → 他的成本是 10000 不是 30000。
    const expenses = [expense("u_ming", { u_ming: 10000, u_hua: 10000, u_hao: 10000 }, 30000)];
    expect(myTripCost(expenses, ORDER, "u_ming", "TWD")).toBe(10000);
  });

  it("沒參與的支出不算進我的成本", () => {
    const expenses = [expense("u_hua", { u_hua: 5000, u_hao: 5000 }, 10000)];
    expect(myTripCost(expenses, ORDER, "u_ming", "TWD")).toBe(0);
  });

  it("多筆累加", () => {
    const expenses = [
      expense("u_ming", { u_ming: 10000, u_hua: 10000 }, 20000),
      expense("u_hua", { u_ming: 3000, u_hua: 3000 }, 6000)
    ];
    expect(myTripCost(expenses, ORDER, "u_ming", "TWD")).toBe(13000);
  });

  it("外幣用換算後的金額算，不是原幣別", () => {
    // THB 1000，匯率 0.9 → TWD 900，兩人均分 → 我分攤 450。
    const expenses = [
      expense("u_ming", { u_ming: 50000, u_hua: 50000 }, 100000, {
        currency: "THB",
        rate: 0.9,
        baseAmount: 90000
      })
    ];
    expect(myTripCost(expenses, ORDER, "u_ming", "TWD")).toBe(45000);
  });

  it("缺匯率的支出不算，跟結算同一套規則", () => {
    const broken = expense("u_ming", { u_ming: 5000, u_hua: 5000 }, 10000, {
      currency: "THB",
      rate: 1,
      baseAmount: null as unknown as number
    });
    expect(myTripCost([broken], ORDER, "u_ming", "TWD")).toBe(0);
  });

  it("沒有支出就是 0，不是 NaN", () => {
    expect(myTripCost([], ORDER, "u_ming", "TWD")).toBe(0);
  });
});

describe("sumByCurrency", () => {
  it("同幣別的加起來", () => {
    expect(sumByCurrency([
      { currency: "TWD", amount: 10000 },
      { currency: "TWD", amount: 5000 }
    ])).toEqual([{ currency: "TWD", amount: 15000 }]);
  });

  it("不同幣別分開列，不會被合併成一個錯的數字", () => {
    const result = sumByCurrency([
      { currency: "TWD", amount: 10000 },
      { currency: "THB", amount: 3000 },
      { currency: "TWD", amount: 5000 }
    ]);
    expect(result).toEqual([
      { currency: "TWD", amount: 15000 },
      { currency: "THB", amount: 3000 }
    ]);
  });

  it("金額大的幣別排前面，順序不會因為輸入而跳動", () => {
    const result = sumByCurrency([
      { currency: "THB", amount: 90000 },
      { currency: "TWD", amount: 10000 }
    ]);
    expect(result[0].currency).toBe("THB");
  });

  it("金額為零的幣別不列出來", () => {
    expect(sumByCurrency([{ currency: "TWD", amount: 0 }])).toEqual([]);
  });
});
