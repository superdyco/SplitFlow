/**
 * 翻頁的游標與筆數上限。
 *
 * 本來寫在 `users.ts` 裡，但稽核日誌也要翻頁 —— 從那裡 import
 * `decodeCursor` 會讓讀的人以為它跟使用者有關。翻頁跟翻的是什麼無關。
 */

export interface Cursor {
  /** 排序欄位的值。時間存成毫秒，因為游標要能塞進 JSON。 */
  value: number;
  /** 同值時的第二排序鍵，也就是文件 ID。 */
  id: string;
}

/**
 * 游標帶著**兩個**值，不是只有時間。
 *
 * 只帶時間的話，同一毫秒的兩筆會在翻頁的邊界互相蓋掉 —— 其中一筆永遠出不來。
 * 批次匯入、種子資料、以及一次寫進好幾筆的稽核日誌都很容易撞在同一毫秒。
 */
export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

/**
 * 解不開就回 null，不要當成「從頭開始」。
 *
 * 默默從頭開始的話，使用者按下一頁會看到第一頁，而他會以為那就是全部。
 * 呼叫端拿到 null 要明確報錯。
 */
export function decodeCursor(raw: unknown): Cursor | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const { value, id } = parsed as { value?: unknown; id?: unknown };
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    if (typeof id !== "string" || !id) return null;
    return { value, id };
  } catch {
    return null;
  }
}

/** 一頁幾筆。上限擋住「limit: 100000」這種把整個集合撈出來的呼叫。 */
export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 100;

export function parseLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) return DEFAULT_LIMIT;
  return Math.min(value, MAX_LIMIT);
}
