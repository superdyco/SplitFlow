/**
 * AI 辨識點數的規則。寫入在 `index.ts`（扣點）與 `admin.ts`（調整）。
 *
 * 規則只有一條：**呼叫 AI 就扣 1 點**。不退點、沒有每日上限。讀不出來、
 * 不是收據、AI 出錯、逾時都照扣，結果全部記在 `aiLedger`；使用者申訴時，
 * 管理者看紀錄手動補。每個帳號只有 3 點，被刷也刷不出 3 張以上的費用。
 */

export const FREE_CREDITS = 3;
/** 管理者一次最多設到幾點。擋的是手滑多打幾個 0，不是業務上限。 */
export const MAX_BALANCE = 1000;

export const READ_RESULTS = ["pending", "read", "unreadable", "not_receipt", "ai_error", "timeout"] as const;
export type ReadResult = (typeof READ_RESULTS)[number];
export type FinalResult = Exclude<ReadResult, "pending">;

export interface CreditsDoc {
  balance?: unknown;
  freeGranted?: unknown;
}

/** 壞掉的餘額當作 0。反過來當成很多，就是一個無限點數的洞。 */
function balanceOf(doc: CreditsDoc | null): number {
  const value = doc?.balance;
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 0;
}

/**
 * 這次辨識能不能扣點。
 *
 * 免費點數看的是「文件存不存在」，不是 `freeGranted`：管理者先幫還沒用過的人
 * 調整點數時，文件就建好了，那時輸入幾點就是幾點（spec 的決定）。
 */
export function planUse(
  doc: CreditsDoc | null
): { ok: false } | { ok: true; grantFree: boolean; balanceAfter: number } {
  const grantFree = doc === null;
  const before = grantFree ? FREE_CREDITS : balanceOf(doc);
  if (before <= 0) return { ok: false };
  return { ok: true, grantFree, balanceAfter: before - 1 };
}

/** 管理者要設成的點數：0 到 MAX_BALANCE 的整數。 */
export function parseTargetBalance(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  return value >= 0 && value <= MAX_BALANCE ? value : null;
}

/**
 * 把點數設成 `target`。
 *
 * 收目標點數而不是加減量：管理者要的是「他現在該有幾點」，讓他自己算加減容易
 * 算錯。紀錄寫的是算出來的實際變動量 —— 對帳要加得起來。
 *
 * 變動量是在 transaction 裡對著「當下」的餘額算的，所以管理者按下去的同時他剛好
 * 用掉一點，結果還是管理者設的那個數字。
 */
export function planSetBalance(
  doc: CreditsDoc | null,
  target: number
): { delta: number; balanceAfter: number; created: boolean } {
  const before = balanceOf(doc);
  return { delta: target - before, balanceAfter: target, created: doc === null };
}

export function ledgerFree(input: { uid: string; at: Date }) {
  return { type: "free", uid: input.uid, delta: FREE_CREDITS, balanceAfter: FREE_CREDITS, at: input.at };
}

/**
 * 扣點當下就寫，結果先是 `pending`。
 *
 * 一直停在 pending 代表函式在呼叫 AI 之後當掉了 —— 扣了點卻沒有結果。
 * 後台看得到這種紀錄，申訴時一眼就知道不是使用者的問題。
 */
export function ledgerUse(input: { uid: string; at: Date; balanceAfter: number; model: string }) {
  return {
    type: "use",
    uid: input.uid,
    delta: -1,
    balanceAfter: input.balanceAfter,
    at: input.at,
    readResult: "pending" as ReadResult,
    model: input.model,
    inputTokens: null as number | null,
    outputTokens: null as number | null
  };
}

export function ledgerAdjust(input: {
  uid: string;
  at: Date;
  delta: number;
  balanceAfter: number;
  adminUid: string;
  adminEmail: string;
  reason: string;
}) {
  return {
    type: "adjust",
    uid: input.uid,
    delta: input.delta,
    balanceAfter: input.balanceAfter,
    at: input.at,
    adminUid: input.adminUid,
    adminEmail: input.adminEmail,
    reason: input.reason
  };
}

export function ledgerResult(input: {
  readResult: FinalResult;
  inputTokens: number | undefined;
  outputTokens: number | undefined;
}) {
  return {
    readResult: input.readResult,
    inputTokens: input.inputTokens ?? null,
    outputTokens: input.outputTokens ?? null
  };
}

export function isFailure(result: unknown): boolean {
  return result !== "read";
}
