import { describe, expect, it } from "vitest";
import { compareExpenses, expenseDate, toDateInput, type DatedExpense } from "@/utils/expenseDate";

/** 模擬 Firestore Timestamp：只要有 toDate 就夠了，不用拖進 firebase。 */
function at(year: number, month: number, day: number, hour = 12, minute = 0): DatedExpense["createdAt"] {
  const value = new Date(year, month - 1, day, hour, minute);
  return { toDate: () => value };
}

function expense(date: string | null, createdAt: DatedExpense["createdAt"]): DatedExpense {
  return { date, createdAt };
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
