/**
 * 使用者列表的查詢計畫與翻頁游標。
 *
 * 抽成純函式的理由跟這個資料夾裡其他幾支一樣：這幾個判斷錯了不會噴錯，
 * 只會安靜地回一份「看起來很正常但不對」的名單。
 */

/** 列表的篩選。刻意只有三個，理由見 `listPlan`。 */
export type UserFilter = "all" | "active7" | "idle30";

export interface ListPlan {
  /** 排序與範圍都用這個欄位。Firestore 要求範圍欄位必須是第一個排序欄位。 */
  field: "createdAt" | "lastSeenAt";
  direction: "asc" | "desc";
  /** 有的話是 `field >= since` 或 `field < since`，看 `compare`。 */
  since: { compare: ">=" | "<"; daysAgo: number } | null;
}

/**
 * 篩選 → 查詢的形狀。
 *
 * **為什麼只有三個篩選。** 設計稿上還有「未建立任務」與「已停用」，兩個都
 * 拿掉了：
 *
 *   - 「未建立任務」要知道每個人參與幾個任務，而那是 users 文件裡沒有的
 *     東西 —— 得對每一列各發一次查詢。一頁 25 個人就是 25 趟，而且是為了
 *     一個篩選。
 *   - 「已停用」的旗標在 Firebase Auth，不在 Firestore，所以 Firestore
 *     查詢查不到它。等停用功能做的時候在 users 文件上鏡射一份才有辦法。
 *
 * 兩個都不是「先做個簡單版」，是現在的資料形狀根本答不出來。寧可少一個
 * 篩選，也不要一個回答得不完整的篩選。
 */
export function listPlan(filter: UserFilter): ListPlan {
  switch (filter) {
    case "active7":
      return { field: "lastSeenAt", direction: "desc", since: { compare: ">=", daysAgo: 7 } };
    case "idle30":
      return { field: "lastSeenAt", direction: "desc", since: { compare: "<", daysAgo: 30 } };
    default:
      return { field: "createdAt", direction: "desc", since: null };
  }
}

/**
 * 那兩個篩選看不到誰。
 *
 * Firestore 的範圍查詢只掃有那個欄位的文件 —— 沒有 `lastSeenAt` 的帳號
 * （戳記上線之前註冊、之後沒再開過的人）**不會出現在任何一個篩選裡**，
 * 包括「30 天沒來」。那正是最該被看到的一群，所以畫面上要講出來。
 */
export const FILTER_BLIND_SPOT =
  "這兩個篩選只看得到有活動紀錄的帳號。戳記功能上線前註冊、之後沒再開過的人不會出現。";

export function parseFilter(value: unknown): UserFilter | null {
  return value === "all" || value === "active7" || value === "idle30" ? value : null;
}

/** 搜尋字串是哪一種。 */
export type SearchKind = "uid" | "email" | "prefix";

/**
 * Firestore 沒有全文搜尋，所以只能猜使用者想找什麼。
 *
 * 三種都是精確或前綴比對 —— **搜「小美」找不到「陳小美」**。這是資料庫的
 * 限制不是省事，畫面上要寫清楚，不然使用者會以為那個人不存在。
 */
export function classifySearch(raw: string): { kind: SearchKind; value: string } | null {
  const value = raw.trim();
  if (!value) return null;
  if (value.includes("@")) return { kind: "email", value: value.toLowerCase() };
  // Firebase 的 uid 固定 28 個字元。虛擬成員的合成 id 是 22 個，但那些不是
  // 帳號、不在 users 集合裡，所以不用管。
  if (/^[A-Za-z0-9]{28}$/.test(value)) return { kind: "uid", value };
  return { kind: "prefix", value };
}

/**
 * 前綴查詢的上界。
 *
 * `` 是私用區裡很後面的一個字元，比大多數會出現在暱稱裡的字都大，
 * 所以 `[q, q+)` 就是「以 q 開頭」。這是 Firestore 的標準做法。
 */
export function prefixEnd(value: string): string {
  return `${value}`;
}

export interface Cursor {
  /** 排序欄位的值。時間存成毫秒，因為游標要能塞進 JSON。 */
  value: number;
  /** 同值時的第二排序鍵，也就是文件 ID。 */
  id: string;
}

/**
 * 游標帶著**兩個**值，不是只有時間。
 *
 * 只帶時間的話，同一毫秒註冊的兩個人會在翻頁的邊界互相蓋掉 —— 其中一個
 * 永遠出不來。批次匯入或種子資料很容易造出同一毫秒的一批人。
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
