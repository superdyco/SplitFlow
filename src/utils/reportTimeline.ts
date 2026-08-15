/**
 * 公開旅費報告的時間軸：一天一段，裡面照時間排的支出。
 *
 * **這是要放進公開文件的資料，所以只放時間、分類、地點與金額** ——
 * 沒有支出名稱、沒有 uid、沒有誰付的。分類與地點本來就已經公開在
 * 「花在哪」與「去過的地方」兩區，時間軸只是把它們按當天的順序重排一次；
 * 名稱則是自己人才看得懂的東西（「阿明的點心」），不該跟著連結傳出去。
 *
 * 金額同樣用 `baseAmountOf`，跟 tripSummary / categoryTotals / placeTotals 同一套規則：
 * 缺匯率的支出四邊都排除。不一致的話每日小計加起來不等於總額，那比沒有時間軸更糟。
 *
 * 純函式，不 import firebase 也不 import vue。
 */
import type { Expense, ExpenseCategory } from "@/types/expense";
import { baseAmountOf } from "@/utils/settlement";
import { compareExpenses, expenseDate, expenseTime } from "@/utils/expenseDate";
import { daysBetween } from "@/utils/tripSummary";

export interface ReportEntry {
  /** `"HH:MM"`。沒記時間是空字串 —— 舊支出與懶得填的都會是這樣。 */
  time: string;
  category: ExpenseCategory;
  /** 地點名稱，沒有就是 null。不放 placeId 與座標，那是地圖那邊的事。 */
  place: string | null;
  /** 主要幣別最小單位整數。 */
  amount: number;
}

export interface ReportDay {
  /** `"YYYY-MM-DD"`。 */
  date: string;
  /** 旅程的第幾天，從 1 起算。 */
  day: number;
  /** 當天小計。 */
  total: number;
  entries: ReportEntry[];
}

/**
 * 一天之內：有記時間的照時間由早到晚排在前面，沒記時間的維持傳入順序接在後面。
 *
 * 沒記時間的不能塞在中間 —— 那等於幫使用者猜它發生在哪兩筆之間，猜錯了讀者
 * 也看不出來。排在最後至少是誠實的「這幾筆不知道幾點」。
 */
function compareEntries(a: ReportEntry, b: ReportEntry): number {
  if (a.time && b.time) return a.time.localeCompare(b.time);
  if (a.time) return -1;
  if (b.time) return 1;
  return 0;
}

/**
 * 第幾天的原點：任務有設起始日就用它（使用者自己宣告的行程第一天），
 * 但如果有支出早於它（提前買的機票之類），就退回用最早的那天，
 * 免得算出 Day 0 或負數。
 */
function originDay(firstDate: string, startDate: string | null): string {
  return startDate && startDate < firstDate ? startDate : firstDate;
}

export function reportTimeline(
  expenses: Expense[],
  baseCurrency: string,
  startDate: string | null = null
): ReportDay[] {
  const days = new Map<string, ReportDay>();

  // 先排成「由舊到新」再分組：同一天裡沒記時間的那幾筆就會照記帳先後排，
  // 而不是跟著呼叫端傳進來的順序跑。時間軸是順著看的，跟支出列表相反。
  const ordered = [...expenses].sort(compareExpenses).reverse();

  for (const expense of ordered) {
    const amount = baseAmountOf(expense, baseCurrency);
    if (amount === null) continue;

    // 連日期都沒有的支出（沒填、createdAt 也還沒回來）放不上時間軸。
    // 它仍然算在總額裡，只是這裡沒有位置給它。
    const date = expenseDate(expense);
    if (!date) continue;

    let group = days.get(date);
    if (!group) {
      group = { date, day: 0, total: 0, entries: [] };
      days.set(date, group);
    }

    group.total += amount;
    group.entries.push({
      time: expenseTime(expense),
      category: expense.category,
      place: expense.place?.name ?? null,
      amount
    });
  }

  const sorted = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
  if (!sorted.length) return [];

  const origin = originDay(sorted[0].date, startDate);
  for (const [index, group] of sorted.entries()) {
    // 日期格式壞掉時退回用序號，寧可 Day 編號不準也不要整個時間軸消失。
    group.day = daysBetween(origin, group.date) ?? index + 1;
    group.entries.sort(compareEntries);
  }
  return sorted;
}
