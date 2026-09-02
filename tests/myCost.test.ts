import { describe, expect, it } from "vitest";
import { myTripCost, sharesOf, sumByCurrency, totalsOf, type TripCost } from "@/utils/myCost";
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

function trip(name: string, currency: string, amount: number): TripCost {
  return { taskId: `t_${name}`, name, currency, amount };
}

describe("totalsOf", () => {
  it("只加總傳進來的，沒傳進來的不會變成零", () => {
    // 讀失敗的旅程根本不該出現在輸入裡 —— 補一個 0 進去會讓總額
    // 少一截而畫面看起來完全正常，那正是這次要避免的事。
    const ok = [trip("東京", "TWD", 31480), trip("宜蘭", "TWD", 4260)];
    expect(totalsOf(ok)).toEqual([{ currency: "TWD", amount: 35740 }]);
  });

  it("跨幣別分開列，金額大的在前", () => {
    const ok = [trip("宜蘭", "TWD", 4260), trip("曼谷", "THB", 18900)];
    expect(totalsOf(ok)).toEqual([
      { currency: "THB", amount: 18900 },
      { currency: "TWD", amount: 4260 }
    ]);
  });

  it("沒有任何一趟就是空陣列，不是一個零", () => {
    expect(totalsOf([])).toEqual([]);
  });
});

describe("sharesOf", () => {
  it("只算指定幣別，其他幣別不進分母", () => {
    const ok = [trip("東京", "TWD", 75), trip("曼谷", "THB", 925), trip("宜蘭", "TWD", 25)];
    const shares = sharesOf(ok, "TWD");
    expect(shares.map(s => s.name)).toEqual(["東京", "宜蘭"]);
    expect(shares[0].ratio).toBeCloseTo(0.75);
  });

  it("比例加起來是一", () => {
    const ok = [trip("東京", "TWD", 31480), trip("大阪", "TWD", 12580), trip("宜蘭", "TWD", 4260)];
    const sum = sharesOf(ok, "TWD").reduce((acc, s) => acc + s.ratio, 0);
    expect(sum).toBeCloseTo(1);
  });

  it("金額大的排前面", () => {
    const ok = [trip("宜蘭", "TWD", 4260), trip("東京", "TWD", 31480)];
    expect(sharesOf(ok, "TWD").map(s => s.name)).toEqual(["東京", "宜蘭"]);
  });

  it("超過 max 趟時，多出來的併成一項其他，併完比例總和仍是一", () => {
    const ok = [
      trip("東京", "TWD", 50),
      trip("大阪", "TWD", 30),
      trip("宜蘭", "TWD", 10),
      trip("花蓮", "TWD", 6),
      trip("台南", "TWD", 4)
    ];
    const shares = sharesOf(ok, "TWD", 3);
    expect(shares.map(s => s.name)).toEqual(["東京", "大阪", "宜蘭", "其他"]);
    expect(shares[3].amount).toBe(10);
    expect(shares.reduce((acc, s) => acc + s.ratio, 0)).toBeCloseTo(1);
  });

  it("剛好比 max 多一趟時全部列出，不會把一趟改名叫其他", () => {
    // 併一項進「其他」等於把一個有名字的旅程改名，那比多列一行更糟。
    const ok = [
      trip("東京", "TWD", 50),
      trip("大阪", "TWD", 30),
      trip("宜蘭", "TWD", 15),
      trip("花蓮", "TWD", 5)
    ];
    expect(sharesOf(ok, "TWD", 3).map(s => s.name)).toEqual(["東京", "大阪", "宜蘭", "花蓮"]);
  });

  it("該幣別總額為零時回空陣列，不會除以零", () => {
    expect(sharesOf([trip("東京", "TWD", 0)], "TWD")).toEqual([]);
    expect(sharesOf([], "TWD")).toEqual([]);
  });

  it("金額為零的旅程不佔一段長條", () => {
    const ok = [trip("東京", "TWD", 100), trip("宜蘭", "TWD", 0)];
    expect(sharesOf(ok, "TWD").map(s => s.name)).toEqual(["東京"]);
  });
});
