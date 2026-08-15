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
  /**
   * 消費發生的時間 `"HH:MM"`，選填。空字串（或這個功能之前的舊資料，欄位根本不存在）
   * 代表沒記時間 —— 那種支出只知道是哪一天。
   */
  time?: string | null;
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

/**
 * `<input type="time">` 要的 `"HH:MM"`，24 小時制。
 * 同樣走本地時區的欄位，理由跟 `toDateInput` 一樣。
 */
export function toTimeInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 表單新增時的預設值：現在幾點。記帳當下通常就是消費當下。 */
export function nowTimeInput(): string {
  return toTimeInput(new Date());
}

/**
 * 這筆支出的時間，沒記就是空字串。
 *
 * 刻意**不**用 `createdAt` 當退路 —— `date` 可以，因為「哪一天」不記也猜得到；
 * 但補記昨天晚餐的人是今天下午按的送出，拿 createdAt 當時間就是憑空捏造。
 * 沒記時間就是沒有，顯示與排序都當它不存在。
 */
export function expenseTime(expense: DatedExpense): string {
  return expense.time || "";
}

function toDateString(value: TimestampLike | null | undefined): string {
  if (!value || typeof value.toDate !== "function") return "";
  return toDateInput(value.toDate());
}

export function expenseDate(expense: DatedExpense): string {
  return expense.date || toDateString(expense.createdAt);
}

/**
 * 日期新的在前；同一天有記時間的先比時間（晚的在前），都沒記才比後記的在前。
 *
 * 為什麼有記時間的排在沒記的前面：`"HH:MM"` 跟空字串比大小，空字串一定小，
 * 所以降冪排下來自然沉底。這也是想要的順序 —— 說得出幾點的那幾筆先排好，
 * 剩下不知道幾點的接在後面，總比把它們插在中間某個猜出來的位置好。
 *
 * 排序刻意放在前端而不是改 Firestore 的 orderBy：`orderBy("date")` 會把
 * 沒有這個欄位的文件整個排除掉，舊支出會直接從列表消失。
 */
export function compareExpenses(a: DatedExpense, b: DatedExpense): number {
  const byDate = expenseDate(b).localeCompare(expenseDate(a));
  if (byDate !== 0) return byDate;

  const byTime = expenseTime(b).localeCompare(expenseTime(a));
  if (byTime !== 0) return byTime;

  // createdAt 還沒回來代表這是剛送出的那一筆，讓它待在當天最上面。
  const timeOf = (item: DatedExpense) =>
    item.createdAt && typeof item.createdAt.toDate === "function"
      ? item.createdAt.toDate().getTime()
      : Number.POSITIVE_INFINITY;

  return timeOf(b) - timeOf(a);
}
