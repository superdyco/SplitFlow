/**
 * AI 用量的每日統計，一天一份 `stats/ai/days/{YYYY-MM-DD}`。
 *
 * 做法跟訪客統計（`stats/guests/days`）一樣：當下用 increment 記，
 * 不放進每日彙總那份會在凌晨被整份覆寫的文件。
 */
import type { FinalResult } from "./credits.js";

export const AI_STATS = ["calls", "reads", "failures", "inputTokens", "outputTokens"] as const;
export type AiTotals = Record<(typeof AI_STATS)[number], number>;
export type AiDayDoc = { date: string } & Partial<AiTotals>;

/** 這次辨識要加哪些數字。沒有的欄位不帶，increment(0) 只是多寫一個欄位。 */
export function statIncrements(input: {
  readResult: FinalResult;
  inputTokens?: number;
  outputTokens?: number;
}): Partial<AiTotals> {
  const out: Partial<AiTotals> = { calls: 1 };
  if (input.readResult === "read") out.reads = 1;
  else out.failures = 1;
  if (input.inputTokens) out.inputTokens = input.inputTokens;
  if (input.outputTokens) out.outputTokens = input.outputTokens;
  return out;
}

export interface PurchaseDoc {
  status?: unknown;
  credits?: unknown;
  price?: unknown;
  currency?: unknown;
}

/**
 * 區間內的儲值加總。呼叫端只傳 production 的紀錄 —— 測試購買不是營收。
 *
 * 幣別分開加總，不換算：換算要匯率，而那個匯率每天在變，換出來的數字會讓人以為
 * 比實際精確。Android 的價格是商品表的標價（Google 不回價格），iOS 是交易上的實際價格。
 */
export function sumPurchases(docs: PurchaseDoc[]): {
  count: number;
  refunded: number;
  credits: number;
  revenue: Record<string, number>;
} {
  const revenue: Record<string, number> = {};
  let refunded = 0;
  let credits = 0;
  for (const doc of docs) {
    if (doc.status === "refunded") {
      refunded += 1;
      continue;
    }
    if (typeof doc.credits === "number") credits += doc.credits;
    if (typeof doc.price === "number" && typeof doc.currency === "string") {
      // 四捨五入到分，免得 0.1 + 0.2 這種浮點誤差出現在營收上。
      revenue[doc.currency] = Math.round(((revenue[doc.currency] ?? 0) + doc.price) * 100) / 100;
    }
  }
  return { count: docs.length, refunded, credits, revenue };
}

export function sumAiDays(docs: AiDayDoc[], keys: string[]): { totals: AiTotals; recordedDays: number } {
  const wanted = new Set(keys);
  const totals: AiTotals = { calls: 0, reads: 0, failures: 0, inputTokens: 0, outputTokens: 0 };
  let recordedDays = 0;
  for (const doc of docs) {
    if (!wanted.has(doc.date)) continue;
    recordedDays += 1;
    for (const key of AI_STATS) totals[key] += doc[key] ?? 0;
  }
  return { totals, recordedDays };
}
