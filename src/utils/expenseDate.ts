/**
 * 支出的「發生日期」。
 *
 * `date` 是 `"YYYY-MM-DD"` 字串而不是 Timestamp，因為日期不該有時區：
 * 在曼谷凌晨一點買的東西，存成 Timestamp 之後換個時區看就變成前一天了。
 *
 * 舊資料沒有這個欄位，退回用 `createdAt` 的日期 —— 跟 `rate` 與 `baseAmount`
 * 同樣的 fallback 模式。
 *
 * 純函式，不 import firebase：Timestamp 只用 `toDate` 做結構比對就夠了。
 */

/** 結構上相容 Firestore Timestamp，測試可以直接給普通物件。 */
export interface TimestampLike {
  toDate: () => Date;
}

export interface DatedExpense {
  date: string | null;
  /** 離線新增時 serverTimestamp 還沒回來，這裡會是 null。 */
  createdAt: TimestampLike | null | undefined;
}

/**
 * `<input type="date">` 要的 `"YYYY-MM-DD"`。
 * 刻意用本地時區的欄位而不是 `toISOString()` —— 後者是 UTC，
 * 台灣時間凌晨記的帳會被算成前一天。
 */
export function toDateInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 表單新增時的預設值。 */
export function todayInput(): string {
  return toDateInput(new Date());
}

function toDateString(value: TimestampLike | null | undefined): string {
  if (!value || typeof value.toDate !== "function") return "";
  return toDateInput(value.toDate());
}

export function expenseDate(expense: DatedExpense): string {
  return expense.date || toDateString(expense.createdAt);
}

/**
 * 日期新的在前；同一天則後記的在前。
 *
 * 排序刻意放在前端而不是改 Firestore 的 orderBy：`orderBy("date")` 會把
 * 沒有這個欄位的文件整個排除掉，舊支出會直接從列表消失。
 */
export function compareExpenses(a: DatedExpense, b: DatedExpense): number {
  const byDate = expenseDate(b).localeCompare(expenseDate(a));
  if (byDate !== 0) return byDate;

  // createdAt 還沒回來代表這是剛送出的那一筆，讓它待在當天最上面。
  const timeOf = (item: DatedExpense) =>
    item.createdAt && typeof item.createdAt.toDate === "function"
      ? item.createdAt.toDate().getTime()
      : Number.POSITIVE_INFINITY;

  return timeOf(b) - timeOf(a);
}
