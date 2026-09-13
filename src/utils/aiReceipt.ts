/**
 * AI 讀收據在畫面這一側的規則：按鈕長什麼樣、結果怎麼套進表單、分帳要不要
 * 切回平分、提示那一行怎麼寫。
 *
 * Flutter 的 `lib/domain/ai_receipt.dart` 是同一套規則，改一邊要改另一邊；
 * 測試案例也是一比一照搬的。
 */
import { minorUnits } from "@/utils/currency";

/** 還沒用過的人第一次辨識時會拿到的點數。跟 functions 的 FREE_CREDITS 一樣。 */
export const FREE_CREDITS = 3;

export const GUEST_AI_NOTICE = "綁定帳號就能用 AI 辨識";

export interface AiReceiptFields {
  amount: string | null;
  currency: string | null;
  currencySupported: boolean;
  date: string | null;
  time: string | null;
  title: string | null;
  /** 收據上印的地址。不是表單欄位，只用來搜地點候選。 */
  address: string | null;
  category: string | null;
}

/**
 * AI 讀完之後拿來搜地點候選的字串：店名＋地址。
 *
 * 地址讓「すき家」這種到處都有的店名縮到那一家。兩個都沒有就回 null ——
 * 那時不查，查了也只是花一次錢拿到跟這張收據無關的結果。
 */
export function placeQueryFrom(fields: Pick<AiReceiptFields, "title" | "address">): string | null {
  const parts = [fields.title, fields.address].map(part => part?.trim() ?? "").filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}

export interface AiReadResult {
  readResult: "read" | "unreadable" | "not_receipt";
  fields: AiReceiptFields;
  creditsLeft: number;
}

export function aiButtonState(input: { guest: boolean; online: boolean; balance: number | null; busy: boolean }): {
  kind: "ready" | "guest" | "empty" | "offline" | "busy";
  label: string;
  disabled: boolean;
} {
  if (input.busy) return { kind: "busy", label: "辨識中…", disabled: true };
  // 訪客照樣按得下去：按下去才告訴他要綁定。停用的按鈕不會說明自己為什麼停用。
  if (input.guest) return { kind: "guest", label: "用 AI 讀收據", disabled: false };
  if (!input.online) return { kind: "offline", label: "需要網路", disabled: true };
  const balance = input.balance ?? FREE_CREDITS;
  if (balance <= 0) return { kind: "empty", label: "AI 點數用完了", disabled: true };
  return { kind: "ready", label: `用 AI 讀收據（剩 ${balance} 點）`, disabled: false };
}

export interface AiPatch {
  amount?: string;
  currency?: string;
  date?: string;
  time?: string;
  title?: string;
  category?: string;
  /** 「AI 已填入：…」那一行，照表單上的順序。 */
  filled: string[];
  warning: string | null;
}

function roundTo(text: string, currency: string): string | undefined {
  const value = Number(text);
  return Number.isFinite(value) && value > 0 ? value.toFixed(minorUnits(currency)) : undefined;
}

/**
 * 讀到的欄位全部蓋掉（使用者的決定），沒讀到的不動。
 *
 * 幣別不在支援清單裡時改用主要幣別，金額照收據上的數字、依主要幣別的小數位
 * 整理。**這樣存下來的金額是錯的幣別**，所以警告不會自己消失。
 */
export function aiPatch(fields: AiReceiptFields, ctx: { baseCurrency: string; currentCurrency: string }): AiPatch {
  const patch: AiPatch = { filled: [], warning: null };
  const unsupported = fields.currency !== null && !fields.currencySupported;
  const currency =
    fields.currency && fields.currencySupported ? fields.currency : unsupported ? ctx.baseCurrency : null;

  if (fields.amount !== null) {
    // 支援的幣別函式已經整理好了；其他情況照最後會用的那個幣別整理。
    const amount = fields.currencySupported ? fields.amount : roundTo(fields.amount, currency ?? ctx.currentCurrency);
    if (amount !== undefined) {
      patch.amount = amount;
      patch.filled.push("金額");
    }
  }
  if (currency !== null) {
    patch.currency = currency;
    if (!unsupported) patch.filled.push("幣別");
  }
  if (fields.date !== null) {
    patch.date = fields.date;
    patch.filled.push("日期");
  }
  if (fields.time !== null) {
    patch.time = fields.time;
    patch.filled.push("時間");
  }
  if (fields.title !== null) {
    patch.title = fields.title;
    patch.filled.push("支出名稱");
  }
  if (fields.category !== null) {
    patch.category = fields.category;
    patch.filled.push("分類");
  }

  if (unsupported) {
    patch.warning =
      fields.amount !== null
        ? `收據上是 ${fields.currency} ${fields.amount}，目前不支援這個幣別，已改用 ${ctx.baseCurrency} —— 金額請自己換算後再存`
        : `收據上的幣別是 ${fields.currency}，目前不支援，已改用 ${ctx.baseCurrency}`;
  }
  return patch;
}

/**
 * 自訂分帳遇上 AI 改了金額或幣別：切回平分。
 *
 * 不切的話各人金額加總對不上新的總額，儲存按不下去，而使用者看不出原因。
 * 平分給原本有填金額的那幾個人；一個都沒有就不動分攤的人。
 */
export function splitAfterAi(input: {
  mode: "even" | "custom";
  customAmounts: Record<string, string>;
  changed: boolean;
}): { memberIds: string[] | null } | null {
  if (input.mode !== "custom" || !input.changed) return null;
  const ids = Object.entries(input.customAmounts)
    .filter(([, value]) => Number(value.trim()) > 0)
    .map(([id]) => id);
  return { memberIds: ids.length ? ids : null };
}

export function aiMessage(input: {
  readResult: string;
  filled: string[];
  creditsLeft: number;
  splitReset: boolean;
}): string {
  const base =
    input.readResult === "read"
      ? `AI 已填入：${input.filled.join("、")}（剩 ${input.creditsLeft} 點）`
      : input.filled.length
        ? "沒有讀出金額（已扣 1 點），其他有讀到的欄位已填入"
        : "沒有讀出金額（已扣 1 點）";
  return input.splitReset ? `${base}。分帳已改回平分` : base;
}
