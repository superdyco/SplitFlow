import { describe, expect, it } from "vitest";
import {
  compareExpenses,
  expenseDate,
  expenseTime,
  toDateInput,
  toTimeInput,
  type DatedExpense
} from "@/utils/expenseDate";

/** 模擬 Firestore Timestamp：只要有 toDate 就夠了，不用拖進 firebase。 */
function at(year: number, month: number, day: number, hour = 12, minute = 0): DatedExpense["createdAt"] {
  const value = new Date(year, month - 1, day, hour, minute);
  return { toDate: () => value };
}

function expense(
  date: string | null,
  createdAt: DatedExpense["createdAt"],
  time = ""
): DatedExpense {
  return { date, time, createdAt };
}

describe("expenseDate", () => {
  it("有 date 就直接用", () => {
    expect(expenseDate(expense("2026-03-05", at(2026, 3, 9)))).toBe("2026-03-05");
  });

  it("舊資料沒有 date，退回 createdAt 的日期", () => {
    expect(expenseDate(expense(null, at(2026, 3, 9)))).toBe("2026-03-09");
  });

  it("月份與日期補零", () => {
    expect(expenseDate(expense(null, at(2026, 1, 2)))).toBe("2026-01-02");
  });

  it("剛建立還沒同步時 createdAt 是 null，兩者都沒有就回空字串", () => {
    expect(expenseDate(expense(null, null))).toBe("");
  });
});

describe("toDateInput", () => {
  it("轉成 date input 要的 YYYY-MM-DD", () => {
    expect(toDateInput(new Date(2026, 2, 5))).toBe("2026-03-05");
  });

  it("補零", () => {
    expect(toDateInput(new Date(2026, 0, 2))).toBe("2026-01-02");
  });

  it("用本地時區，不是 UTC —— 深夜的時間不會跳成前一天", () => {
    // toISOString 會把本地 2026-03-05 23:30（UTC+8）變成 2026-03-05T15:30Z，
    // 看似沒事；但本地 00:30 會變成前一天。這裡確認我們走的是本地欄位。
    expect(toDateInput(new Date(2026, 2, 5, 0, 30))).toBe("2026-03-05");
    expect(toDateInput(new Date(2026, 2, 5, 23, 30))).toBe("2026-03-05");
  });
});

describe("expenseTime", () => {
  it("有記時間就回時間", () => {
    expect(expenseTime(expense("2026-03-05", at(2026, 3, 5), "19:30"))).toBe("19:30");
  });

  it("沒記時間就是空字串，不會拿 createdAt 來湊", () => {
    // 補記昨天晚餐的人是今天下午按的送出，用 createdAt 當時間等於捏造。
    expect(expenseTime(expense("2026-03-05", at(2026, 3, 6, 15, 20)))).toBe("");
  });

  it("舊資料根本沒有這個欄位也不會壞", () => {
    expect(expenseTime({ date: "2026-03-05", createdAt: at(2026, 3, 5) })).toBe("");
  });
});

describe("toTimeInput", () => {
  it("轉成 time input 要的 HH:MM，24 小時制", () => {
    expect(toTimeInput(new Date(2026, 2, 5, 19, 30))).toBe("19:30");
  });

  it("補零", () => {
    expect(toTimeInput(new Date(2026, 2, 5, 9, 5))).toBe("09:05");
    expect(toTimeInput(new Date(2026, 2, 5, 0, 0))).toBe("00:00");
  });
});

describe("compareExpenses", () => {
  it("日期新的排前面", () => {
    const older = expense("2026-03-01", at(2026, 3, 1));
    const newer = expense("2026-03-05", at(2026, 3, 5));
    expect(compareExpenses(newer, older)).toBeLessThan(0);
    expect(compareExpenses(older, newer)).toBeGreaterThan(0);
  });

  it("同一天的話後記的排前面", () => {
    const early = expense("2026-03-05", at(2026, 3, 5, 9));
    const late = expense("2026-03-05", at(2026, 3, 5, 21));
    expect(compareExpenses(late, early)).toBeLessThan(0);
  });

  it("同一天有記時間的話，晚的排前面 —— 就算是先記進去的", () => {
    // 中午吃完先記午餐，晚上才想起來補早餐：順序要照時間，不是照記帳先後。
    const lunch = expense("2026-03-05", at(2026, 3, 5, 13), "12:00");
    const breakfast = expense("2026-03-05", at(2026, 3, 5, 21), "08:00");
    expect(compareExpenses(lunch, breakfast)).toBeLessThan(0);
  });

  it("同一天裡，有記時間的排在沒記時間的前面", () => {
    const timed = expense("2026-03-05", at(2026, 3, 5, 9), "08:00");
    const untimed = expense("2026-03-05", at(2026, 3, 5, 21));
    expect(compareExpenses(timed, untimed)).toBeLessThan(0);
    expect(compareExpenses(untimed, timed)).toBeGreaterThan(0);
  });

  it("時間一樣就回頭比後記的在前", () => {
    const early = expense("2026-03-05", at(2026, 3, 5, 9), "12:00");
    const late = expense("2026-03-05", at(2026, 3, 5, 21), "12:00");
    expect(compareExpenses(late, early)).toBeLessThan(0);
  });

  it("時間不影響跨日的順序", () => {
    // 3/01 的 23:00 還是排在 3/05 的 08:00 後面。
    const older = expense("2026-03-01", at(2026, 3, 1), "23:00");
    const newer = expense("2026-03-05", at(2026, 3, 5), "08:00");
    expect(compareExpenses(newer, older)).toBeLessThan(0);
  });

  it("舊資料沒有 date 也能跟新資料一起排，各自用有效日期比", () => {
    const legacy = expense(null, at(2026, 3, 10)); // 有效日期 3/10
    const dated = expense("2026-03-05", at(2026, 3, 20)); // 有效日期 3/05
    expect(compareExpenses(legacy, dated)).toBeLessThan(0);
  });

  it("剛建立還沒同步的排在同一天的最前面", () => {
    // 離線新增時 serverTimestamp 還沒回來，createdAt 是 null，
    // 但使用者剛按下送出，它應該出現在當天的最上面而不是沉到底。
    const pending = expense("2026-03-05", null);
    const synced = expense("2026-03-05", at(2026, 3, 5, 23, 59));
    expect(compareExpenses(pending, synced)).toBeLessThan(0);
  });

  it("排序整個列表的結果是穩定且符合預期的", () => {
    const list = [
      expense("2026-03-01", at(2026, 3, 1, 10)),
      expense("2026-03-05", at(2026, 3, 5, 9)),
      expense(null, at(2026, 3, 10, 8)),
      expense("2026-03-05", at(2026, 3, 5, 20))
    ];
    const sorted = [...list].sort(compareExpenses).map(expenseDate);
    expect(sorted).toEqual(["2026-03-10", "2026-03-05", "2026-03-05", "2026-03-01"]);
    // 同一天的兩筆，晚記的要在前
    expect(sorted[1]).toBe("2026-03-05");
  });
});
