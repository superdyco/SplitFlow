/**
 * 旅程的整體數字：天數、總額、每人平均。
 *
 * 每人平均是「總額 ÷ 人數」，不是每個人的實際分攤 ——
 * 實際分攤會洩漏誰花得多，而且對報告的讀者沒有用，他要的是
 * 「這種玩法一個人大概多少」。簡單平均同時滿足隱私與用途。
 *
 * 純函式，不 import firebase 也不 import vue。
 */
import type { Expense } from "@/types/expense";
import { baseAmountOf } from "@/utils/settlement";
import { expenseDate } from "@/utils/expenseDate";

export interface TripSummary {
  /** 旅程天數，含頭尾。算不出來是 null。 */
  days: number | null;
  /** 主要幣別最小單位整數。 */
  total: number;
  perPerson: number;
  /** 列入計算的筆數（缺匯率的已排除）。 */
  expenseCount: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 用 UTC 解析 `"YYYY-MM-DD"`，不要走 `new Date(str)` 的本地時區解讀 ——
 * 那會在某些時區把日期偏移一天，天數就會少算或多算。
 */
function parseDay(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/**
 * 含頭尾，所以同一天是 1 天不是 0 天。
 *
 * 時間軸算「第幾天」也是同一套算法（`daysBetween(第一天, 那天)`），
 * 所以這裡 export 出去共用 —— 兩邊各寫一份日期數學遲早會對不起來。
 */
export function daysBetween(start: string, end: string): number | null {
  const from = parseDay(start);
  const to = parseDay(end);
  if (from === null || to === null) return null;
  return Math.floor((to - from) / DAY_MS) + 1;
}

export interface TripSummaryInput {
  expenses: Expense[];
  baseCurrency: string;
  memberCount: number;
  startDate: string | null;
  endDate: string | null;
}

export function tripSummary(input: TripSummaryInput): TripSummary {
  let total = 0;
  let expenseCount = 0;
  const dates: string[] = [];

  for (const expense of input.expenses) {
    const amount = baseAmountOf(expense, input.baseCurrency);
    if (amount === null) continue;
    total += amount;
    expenseCount += 1;
    dates.push(expenseDate(expense));
  }

  // 任務有設起迄就用那個，那是使用者自己宣告的旅程範圍，比支出日期準。
  let days: number | null = null;
  if (input.startDate && input.endDate) {
    days = daysBetween(input.startDate, input.endDate);
  } else if (dates.length) {
    const sorted = [...dates].sort();
    days = daysBetween(sorted[0], sorted[sorted.length - 1]);
  }

  return {
    days,
    total,
    perPerson: input.memberCount > 0 ? Math.round(total / input.memberCount) : 0,
    expenseCount
  };
}
