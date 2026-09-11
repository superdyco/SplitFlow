/**
 * 訪客統計的純函式。寫入與讀取在 `admin.ts`。
 *
 * 訪客登出就刪文件，所以事後掃 users 數不到當天來、當天走的人 —— 這裡的
 * 次數是在事情發生的當下記的，一天一份 `stats/guests/days/{YYYY-MM-DD}`。
 */
import { GUEST_PROVIDER } from "../guestMerge.js";
import { dayKeyOf, shiftDay } from "./range.js";

/** 卡片上就是這個順序：來了、留下（綁定或合併）、走了。 */
export const GUEST_EVENTS = ["started", "bound", "merged", "left"] as const;

export type GuestEvent = (typeof GUEST_EVENTS)[number];
export type GuestTotals = Record<GuestEvent, number>;

export interface GuestDayDoc {
  date: string;
  started?: number;
  bound?: number;
  merged?: number;
  left?: number;
}

/**
 * 跟儀表板的區間一樣長，但**最後一天是今天**。
 *
 * 其他數字要等凌晨的排程所以只到昨天；這些是當下記的，只到昨天的話，今天
 * 試用的人要等明天才看得到，而今天正是剛上線時最想看的那一天。
 */
export function guestKeys(count: number, now: Date): string[] {
  const today = dayKeyOf(now);
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i--) keys.push(shiftDay(today, -i));
  return keys;
}

/**
 * 區間內的次數加總。
 *
 * 回傳有紀錄的天數，因為「四個 0」有兩種意思：這段期間真的沒有訪客，或者
 * 統計還沒開始記。只有後者 recordedDays 是 0，畫面靠它說出差別。
 */
export function sumGuests(
  docs: GuestDayDoc[],
  keys: string[]
): { totals: GuestTotals; recordedDays: number } {
  const wanted = new Set(keys);
  const totals: GuestTotals = { started: 0, bound: 0, merged: 0, left: 0 };
  let recordedDays = 0;

  for (const doc of docs) {
    if (!wanted.has(doc.date)) continue;
    recordedDays += 1;
    for (const event of GUEST_EVENTS) totals[event] += doc[event] ?? 0;
  }

  return { totals, recordedDays };
}

/**
 * 這次 users 更新是不是一次綁定：provider 從訪客變成別的供應商。
 *
 * 訪客自己改暱稱、每天的 lastSeenAt 戳記都會觸發同一支函式，那些 provider
 * 前後一樣，要在這裡擋掉。
 */
export function isBinding(before: unknown, after: unknown): boolean {
  return before === GUEST_PROVIDER && typeof after === "string" && after !== GUEST_PROVIDER;
}

/** Auth 的 UserRecord 沒有 isAnonymous；匿名帳號就是沒有任何供應商的帳號。 */
export function isAnonymousRecord(providerIds: string[]): boolean {
  return providerIds.length === 0;
}
