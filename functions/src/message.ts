/**
 * 通知的文字。
 *
 * 金額與項目會顯示在鎖定畫面上，旁邊的人瞄一眼就看得到。2026-08-28 定案：
 * 使用者選擇完整顯示，接受這個取捨。想收斂的話只要改這裡，不影響其他部分。
 */
import { formatAmount } from "./amount.js";

export interface ExpenseNotification {
  title: string;
  body: string;
}

export interface ExpenseNotificationInput {
  taskName: string;
  author: string;
  expenseTitle: string;
  amount: number;
  currency: string;
}

/**
 * 使用者打進去的字要設上限，因為**通知列自己會截斷**，而它從尾巴砍 ——
 * 金額在尾巴。有人把整段備註打進支出名稱，收到的人就只看得到一串字、
 * 看不到金額，而金額正是這則通知唯一非看不可的東西。
 *
 * 30 個中文字大約是一行半，足夠表達「晚餐」「機場接送」這種正常的名稱。
 */
const MAX_TITLE = 30;
const MAX_AUTHOR = 20;

function clamp(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

export function expenseNotification({
  taskName,
  author,
  expenseTitle,
  amount,
  currency
}: ExpenseNotificationInput): ExpenseNotification {
  // 記帳的人可能已經被移除，member 文件查不到暱稱 —— 那時寧可說「有人」，
  // 也不要露出 uid 或留一段空白。
  const who = clamp(author, MAX_AUTHOR) || "有人";
  const money = `${currency} ${formatAmount(amount, currency)}`;

  // 支出名稱是選填的。空的時候整句改寫，不要留一對空引號 ——
  // 「小明新增「」TWD 1,200.00」看起來像壞掉了。
  const what = expenseTitle
    ? `新增「${clamp(expenseTitle, MAX_TITLE)}」${money}`
    : `新增一筆支出 ${money}`;

  return {
    title: taskName || "分帳更新",
    body: `${who}${what}`
  };
}
