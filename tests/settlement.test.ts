import { describe, expect, it } from "vitest";
import type { Timestamp } from "firebase/firestore";
import type { Expense, SplitMode } from "@/types/expense";
import type { Payment, PaymentStatus } from "@/types/payment";
import type { SettlementSnapshot } from "@/types/settlement";
import {
  baseAmountOf,
  baseSplitsOf,
  matchesSnapshot,
  settleExpenses,
  toSnapshotInput
} from "@/utils/settlement";

const A = "uid_a";
const B = "uid_b";
const C = "uid_c";
const ORDER = [A, B, C];
const STAMP = null as unknown as Timestamp;

interface ExpenseOverrides {
  id?: string;
  amount?: number;
  currency?: string;
  rate?: number | null;
  baseAmount?: number | null;
  paidBy?: string;
  splitMode?: SplitMode;
  splits?: Record<string, number>;
}

function expense(overrides: ExpenseOverrides = {}): Expense {
  const amount = overrides.amount ?? 30000;
  const currency = overrides.currency ?? "TWD";
  return {
    id: overrides.id ?? "e1",
    title: "晚餐",
    category: "food",
    amount,
    currency,
    rate: overrides.rate === undefined ? 1 : overrides.rate,
    baseAmount: overrides.baseAmount === undefined ? amount : overrides.baseAmount,
    paidBy: overrides.paidBy ?? A,
    splitMode: overrides.splitMode ?? "even",
    splits: overrides.splits ?? { [A]: 10000, [B]: 10000, [C]: 10000 },
    place: null,
    createdBy: overrides.paidBy ?? A,
    createdAt: STAMP,
    updatedAt: STAMP
  };
}

function payment(from: string, to: string, amount: number, status: PaymentStatus = "confirmed"): Payment {
  return {
    id: `${from}-${to}-${amount}`,
    from,
    to,
    amount,
    currency: "TWD",
    status,
    createdBy: from,
    createdAt: STAMP,
    confirmedAt: status === "confirmed" ? STAMP : null,
    updatedAt: STAMP
  };
}

function balanceMap(result: ReturnType<typeof settleExpenses>) {
  return Object.fromEntries(result.balances.map(item => [item.uid, item.balance]));
}

describe("baseAmountOf", () => {
  it("有存換算金額就用存的", () => {
    expect(baseAmountOf(expense({ currency: "THB", baseAmount: 27600 }), "TWD")).toBe(27600);
  });

  it("舊資料同幣別時沿用原金額", () => {
    expect(baseAmountOf(expense({ currency: "TWD", baseAmount: null }), "TWD")).toBe(30000);
  });

  it("舊資料是外幣又沒有匯率就算不出來", () => {
    expect(baseAmountOf(expense({ currency: "THB", baseAmount: null }), "TWD")).toBeNull();
  });
});

describe("baseSplitsOf", () => {
  it("換算後的分攤總和等於換算後的總額", () => {
    const item = expense({ amount: 50000, currency: "THB", baseAmount: 46000 });
    const splits = baseSplitsOf(item, 46000, ORDER);
    expect([...splits.values()].reduce((acc, value) => acc + value, 0)).toBe(46000);
  });

  it("自訂比例換算後仍維持比例", () => {
    const item = expense({
      amount: 10000,
      splitMode: "custom",
      splits: { [A]: 2000, [B]: 8000 },
      currency: "THB",
      baseAmount: 100
    });
    expect([...baseSplitsOf(item, 100, ORDER)]).toEqual([
      [A, 20],
      [B, 80]
    ]);
  });

  it("除不盡時餘數依成員順序分配，不會漏掉", () => {
    const item = expense({ amount: 100, splits: { [A]: 34, [B]: 33, [C]: 33 } });
    const splits = baseSplitsOf(item, 100, ORDER);
    expect([...splits.values()].reduce((acc, value) => acc + value, 0)).toBe(100);
  });
});

describe("settleExpenses 均分", () => {
  it("一個人先付、三人均分", () => {
    const result = settleExpenses([expense()], [], ORDER, "TWD");
    expect(balanceMap(result)).toEqual({ [A]: 20000, [B]: -10000, [C]: -10000 });
    expect(result.transfers).toEqual([
      { from: B, to: A, amount: 10000 },
      { from: C, to: A, amount: 10000 }
    ]);
  });

  it("兩筆互抵後只剩必要的轉帳", () => {
    const result = settleExpenses(
      [expense({ id: "e1", paidBy: A }), expense({ id: "e2", paidBy: B })],
      [],
      ORDER,
      "TWD"
    );
    expect(balanceMap(result)).toEqual({ [A]: 10000, [B]: 10000, [C]: -20000 });
    expect(result.transfers).toEqual([
      { from: C, to: A, amount: 10000 },
      { from: C, to: B, amount: 10000 }
    ]);
  });

  it("只有部分人分攤", () => {
    const result = settleExpenses(
      [expense({ amount: 10000, baseAmount: 10000, splits: { [B]: 5000, [C]: 5000 } })],
      [],
      ORDER,
      "TWD"
    );
    expect(balanceMap(result)).toEqual({ [A]: 10000, [B]: -5000, [C]: -5000 });
  });

  it("全部結清時沒有轉帳", () => {
    const result = settleExpenses(
      [expense({ amount: 10000, baseAmount: 10000, paidBy: A, splits: { [A]: 10000 } })],
      [],
      ORDER,
      "TWD"
    );
    expect(result.transfers).toEqual([]);
  });
});

describe("settleExpenses 自訂分攤", () => {
  it("依自訂金額算應收應付", () => {
    const result = settleExpenses(
      [
        expense({
          amount: 10000,
          baseAmount: 10000,
          paidBy: A,
          splitMode: "custom",
          splits: { [A]: 2000, [B]: 3000, [C]: 5000 }
        })
      ],
      [],
      ORDER,
      "TWD"
    );
    expect(balanceMap(result)).toEqual({ [A]: 8000, [B]: -3000, [C]: -5000 });
  });

  it("自訂與均分混在一起也算得對", () => {
    const result = settleExpenses(
      [
        expense({ id: "e1", amount: 30000, baseAmount: 30000, paidBy: A }),
        expense({
          id: "e2",
          amount: 10000,
          baseAmount: 10000,
          paidBy: B,
          splitMode: "custom",
          splits: { [B]: 1000, [C]: 9000 }
        })
      ],
      [],
      ORDER,
      "TWD"
    );
    expect(balanceMap(result)).toEqual({ [A]: 20000, [B]: -1000, [C]: -19000 });
  });
});

describe("settleExpenses 多幣別", () => {
  it("外幣用存下來的換算金額併入主要幣別", () => {
    const result = settleExpenses(
      [
        expense({ id: "e1", amount: 30000, currency: "TWD", baseAmount: 30000, paidBy: A }),
        expense({
          id: "e2",
          amount: 50000,
          currency: "THB",
          rate: 0.92,
          baseAmount: 46000,
          paidBy: B,
          splits: { [A]: 25000, [B]: 25000 }
        })
      ],
      [],
      ORDER,
      "TWD"
    );
    expect(result.currency).toBe("TWD");
    expect(result.total).toBe(76000);
    expect(result.expenseCount).toBe(2);
    // A 先付 30000 但分攤 10000 + 23000；B 先付 46000 分攤 10000 + 23000；C 只分攤 10000。
    expect(balanceMap(result)).toEqual({ [A]: -3000, [B]: 13000, [C]: -10000 });
  });

  it("缺匯率的舊外幣支出被排除並列出來", () => {
    const result = settleExpenses(
      [
        expense({ id: "e1", amount: 30000, currency: "TWD", baseAmount: 30000 }),
        expense({ id: "e2", amount: 50000, currency: "THB", rate: null, baseAmount: null })
      ],
      [],
      ORDER,
      "TWD"
    );
    expect(result.expenseCount).toBe(1);
    expect(result.total).toBe(30000);
    expect(result.unconverted.map(item => item.id)).toEqual(["e2"]);
  });
});

describe("settleExpenses 已付款", () => {
  it("已確認的付款會把餘額扣掉", () => {
    const result = settleExpenses([expense()], [payment(B, A, 10000)], ORDER, "TWD");
    expect(balanceMap(result)).toEqual({ [A]: 10000, [B]: 0, [C]: -10000 });
    expect(result.paidTotal).toBe(10000);
    expect(result.transfers).toEqual([{ from: C, to: A, amount: 10000 }]);
  });

  it("全部付完就沒有建議轉帳了", () => {
    const result = settleExpenses(
      [expense()],
      [payment(B, A, 10000), payment(C, A, 10000)],
      ORDER,
      "TWD"
    );
    expect(balanceMap(result)).toEqual({ [A]: 0, [B]: 0, [C]: 0 });
    expect(result.transfers).toEqual([]);
  });

  it("只付一部分時剩下的金額還是對的", () => {
    const result = settleExpenses([expense()], [payment(B, A, 4000)], ORDER, "TWD");
    expect(balanceMap(result)).toEqual({ [A]: 16000, [B]: -6000, [C]: -10000 });
    expect(result.transfers).toEqual([
      { from: C, to: A, amount: 10000 },
      { from: B, to: A, amount: 6000 }
    ]);
  });

  it("還沒確認的付款不影響餘額", () => {
    const result = settleExpenses([expense()], [payment(B, A, 10000, "pending")], ORDER, "TWD");
    expect(balanceMap(result)).toEqual({ [A]: 20000, [B]: -10000, [C]: -10000 });
    expect(result.paidTotal).toBe(0);
  });

  it("付款不會被算進總支出", () => {
    const result = settleExpenses([expense()], [payment(B, A, 10000)], ORDER, "TWD");
    expect(result.total).toBe(30000);
    expect(result.expenseCount).toBe(1);
  });

  it("付多了會反向欠回去", () => {
    const result = settleExpenses([expense()], [payment(B, A, 15000)], ORDER, "TWD");
    expect(balanceMap(result)).toEqual({ [A]: 5000, [B]: 5000, [C]: -10000 });
  });

  it("沒有支出只有付款也算得出來", () => {
    const result = settleExpenses([], [payment(B, A, 5000)], ORDER, "TWD");
    expect(balanceMap(result)).toEqual({ [A]: -5000, [B]: 5000 });
    expect(result.transfers).toEqual([{ from: A, to: B, amount: 5000 }]);
  });
});

describe("結算快照", () => {
  const NAMES = { [A]: "小明", [B]: "小華", [C]: "小美" };

  function snapshotOf(settlement: ReturnType<typeof settleExpenses>, note = ""): SettlementSnapshot {
    return { id: "s1", createdBy: A, createdAt: STAMP, ...toSnapshotInput(settlement, NAMES, note) };
  }

  it("把即時結算轉成可以存的快照", () => {
    const settlement = settleExpenses([expense()], [], ORDER, "TWD");
    const input = toSnapshotInput(settlement, NAMES, "回國當天");

    expect(input.currency).toBe("TWD");
    expect(input.total).toBe(30000);
    expect(input.expenseCount).toBe(1);
    expect(input.paidTotal).toBe(0);
    expect(input.note).toBe("回國當天");
    expect(input.balances.map(item => item.uid)).toEqual([A, B, C]);
    expect(input.transfers.length).toBe(2);
  });

  it("暱稱一起存進快照，之後改暱稱不會改寫歷史", () => {
    const settlement = settleExpenses([expense()], [], ORDER, "TWD");
    const input = toSnapshotInput(settlement, NAMES, "");
    expect(input.memberNames).toEqual(NAMES);

    // 存完之後把暱稱都換掉，快照裡的名字不受影響。
    expect(toSnapshotInput(settlement, NAMES, "").memberNames[A]).toBe("小明");
  });

  it("已離開又查不到暱稱的人有備用名稱", () => {
    const settlement = settleExpenses(
      [expense({ paidBy: "uid_gone", splits: { [A]: 15000, uid_gone: 15000 } })],
      [],
      ORDER,
      "TWD"
    );
    expect(toSnapshotInput(settlement, NAMES, "").memberNames["uid_gone"]).toBe("已離開的成員");
  });

  it("快照存的是複本，之後改動原本的結算不會影響它", () => {
    const settlement = settleExpenses([expense()], [], ORDER, "TWD");
    const input = toSnapshotInput(settlement, NAMES, "");
    settlement.balances[0].balance = 999;
    expect(input.balances[0].balance).toBe(20000);
  });

  it("帳目沒變動時比對得出一致", () => {
    const settlement = settleExpenses([expense()], [], ORDER, "TWD");
    expect(matchesSnapshot(settlement, snapshotOf(settlement))).toBe(true);
  });

  it("多了一筆支出就比對得出不一致", () => {
    const before = settleExpenses([expense()], [], ORDER, "TWD");
    const snapshot = snapshotOf(before);
    const after = settleExpenses([expense({ id: "e1" }), expense({ id: "e2", paidBy: B })], [], ORDER, "TWD");
    expect(matchesSnapshot(after, snapshot)).toBe(false);
  });

  it("有人確認付款之後也算不一致", () => {
    const before = settleExpenses([expense()], [], ORDER, "TWD");
    const snapshot = snapshotOf(before);
    const after = settleExpenses([expense()], [payment(B, A, 10000)], ORDER, "TWD");
    expect(matchesSnapshot(after, snapshot)).toBe(false);
  });

  it("待確認的付款不會讓比對變成不一致", () => {
    const before = settleExpenses([expense()], [], ORDER, "TWD");
    const snapshot = snapshotOf(before);
    const after = settleExpenses([expense()], [payment(B, A, 10000, "pending")], ORDER, "TWD");
    expect(matchesSnapshot(after, snapshot)).toBe(true);
  });

  it("備註不影響比對結果", () => {
    const settlement = settleExpenses([expense()], [], ORDER, "TWD");
    expect(matchesSnapshot(settlement, snapshotOf(settlement, "隨便寫的備註"))).toBe(true);
  });

  it("金額總和一樣但欠款分布不同時仍算不一致", () => {
    const before = settleExpenses(
      [expense({ amount: 30000, baseAmount: 30000, paidBy: A })],
      [],
      ORDER,
      "TWD"
    );
    const snapshot = snapshotOf(before);
    const after = settleExpenses(
      [expense({ amount: 30000, baseAmount: 30000, paidBy: B })],
      [],
      ORDER,
      "TWD"
    );
    expect(after.total).toBe(snapshot.total);
    expect(matchesSnapshot(after, snapshot)).toBe(false);
  });
});

describe("settleExpenses 不變條件", () => {
  const scenarios: Array<[Expense[], Payment[]]> = [
    [[expense()], []],
    [[expense({ id: "e1" }), expense({ id: "e2", paidBy: B })], []],
    [[expense({ amount: 100, baseAmount: 100, splits: { [A]: 34, [B]: 33, [C]: 33 } })], []],
    [
      [
        expense({ id: "e1", amount: 7, baseAmount: 7, splits: { [A]: 3, [B]: 2, [C]: 2 } }),
        expense({
          id: "e2",
          amount: 999999,
          baseAmount: 999999,
          paidBy: C,
          splitMode: "custom",
          splits: { [A]: 333333, [B]: 333333, [C]: 333333 }
        })
      ],
      []
    ],
    [[expense({ id: "e1", currency: "THB", rate: 0.923, baseAmount: 27690, paidBy: B })], []],
    [[expense()], [payment(B, A, 10000), payment(C, A, 3333, "pending")]],
    [[expense()], [payment(B, A, 10000), payment(C, A, 10000)]],
    [[expense({ amount: 100, baseAmount: 100 })], [payment(B, A, 7)]],
    [[], [payment(A, B, 12345), payment(B, C, 999)]]
  ];

  it("每種情境的 balance 加總都是 0", () => {
    for (const [expenses, payments] of scenarios) {
      const result = settleExpenses(expenses, payments, ORDER, "TWD");
      const sum = result.balances.reduce((acc, item) => acc + item.balance, 0);
      expect(sum).toBe(0);
    }
  });

  it("轉帳金額加總等於應付總額", () => {
    for (const [expenses, payments] of scenarios) {
      const result = settleExpenses(expenses, payments, ORDER, "TWD");
      const owedTotal = result.balances
        .filter(item => item.balance < 0)
        .reduce((acc, item) => acc - item.balance, 0);
      const transferred = result.transfers.reduce((acc, item) => acc + item.amount, 0);
      expect(transferred).toBe(owedTotal);
    }
  });

  it("已離開的成員也會出現在結算裡", () => {
    const result = settleExpenses(
      [expense({ paidBy: "uid_gone", splits: { [A]: 15000, uid_gone: 15000 } })],
      [],
      ORDER,
      "TWD"
    );
    expect(result.balances.map(item => item.uid)).toEqual([A, "uid_gone"]);
  });
});
