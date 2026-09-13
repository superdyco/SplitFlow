/**
 * 收據辨識的輸入檢查、給 AI 的格式與指令、以及回來之後的整理。
 *
 * **AI 回來的東西一律再檢查一次。** 結構化輸出保證的是形狀，不是內容：
 * 它照樣可能回「2026-02-30」、回小寫的幣別、回一個負的金額。這些值會直接
 * 填進使用者的表單，填錯的代價是一筆錯的帳。
 */
import { minorUnits, SUPPORTED_CURRENCIES } from "../amount.js";

/** 跟收據上傳的 `MAX_UPLOAD_BYTES` 一樣。壓縮後正常是 200–400 KB。 */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

const CATEGORIES = ["food", "transport", "stay", "ticket", "shopping", "other"];
const TITLE_MAX = 60;
/** 地址只拿來搜地點，不存進支出。長度擋在這裡是為了不讓一段亂碼變成搜尋字串。 */
const ADDRESS_MAX = 200;

/**
 * 收 JPEG 與 PNG。網頁版一律轉成 JPEG，但 Flutter 的 image_picker 從相簿選
 * PNG 時不保證轉檔 —— 只收 JPEG 的話，那張照片會被擋下，而使用者什麼都沒做錯。
 */
export function decodeImage(
  value: unknown
): { ok: true; base64: string; mime: "image/jpeg" | "image/png" } | { ok: false } {
  if (typeof value !== "string" || !value) return { ok: false };
  const bytes = Buffer.from(value, "base64");
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) return { ok: false };
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return { ok: true, base64: value, mime: "image/jpeg" };
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { ok: true, base64: value, mime: "image/png" };
  }
  return { ok: false };
}

const nullable = (type: string) => ({ type: [type, "null"] });

/** strict 模式：每個欄位都要列在 required，可以沒有的用 null 表示。 */
export const RECEIPT_SCHEMA = {
  type: "object",
  properties: {
    is_receipt: { type: "boolean" },
    amount: nullable("number"),
    currency: nullable("string"),
    date: nullable("string"),
    time: nullable("string"),
    merchant: nullable("string"),
    address: nullable("string"),
    category: { type: ["string", "null"], enum: [...CATEGORIES, null] }
  },
  required: ["is_receipt", "amount", "currency", "date", "time", "merchant", "address", "category"],
  additionalProperties: false
} as const;

export const RECEIPT_INSTRUCTIONS = [
  "你會看到一張消費收據的照片。把下面這些欄位讀出來，讀不到的一律回 null，不要猜。",
  "- is_receipt：這張照片是不是消費收據或發票。不是的話其他欄位全部回 null。",
  "- amount：最後實際支付的總額（含稅、服務費、小費），不是小計。只回數字。",
  "- currency：ISO 4217 三碼大寫代碼。收據上沒寫明時，從貨幣符號、語言、店家所在國家推斷；不確定就回 null。",
  "- date：YYYY-MM-DD。time：HH:MM，24 小時制。",
  "- merchant：店名，照收據上印的寫，不要翻譯。",
  "- address：收據上印的店家地址，照印的寫、不要翻譯；沒有印就回 null，不要從店名推測。",
  "- category：從 food、transport、stay、ticket、shopping、other 挑最接近的一個。"
].join("\n");

export interface ReceiptFields {
  amount: string | null;
  currency: string | null;
  currencySupported: boolean;
  date: string | null;
  time: string | null;
  title: string | null;
  /**
   * 收據上印的地址。**不是表單欄位** —— 只用來跟店名一起搜地點候選，
   * 使用者點了其中一個才會填進地點。
   */
  address: string | null;
  category: string | null;
}

export function parseOutput(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function realDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? value : null;
}

function clock(value: unknown): string | null {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : null;
}

function clipped(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // 用 Array.from 數字元，不然表情符號會被切成半個。
  return Array.from(trimmed).slice(0, max).join("");
}

/**
 * 金額照幣別整理成表單直接能用的字串（日圓 `1280`、美元 `12.50`）。
 * 不支援的幣別照收據上的數字 —— 換成主要幣別、依它的小數位整理，是畫面的事，
 * 函式不知道這個任務的主要幣別是什麼。
 */
function amountText(value: number, currency: string | null, supported: boolean): string {
  if (!supported || !currency) return String(value);
  return value.toFixed(minorUnits(currency));
}

export function cleanReceipt(raw: unknown): {
  readResult: "read" | "unreadable" | "not_receipt";
  fields: ReceiptFields;
} {
  const data = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  const currency =
    typeof data.currency === "string" && /^[A-Z]{3}$/.test(data.currency) ? data.currency : null;
  const currencySupported = currency !== null && SUPPORTED_CURRENCIES.includes(currency);
  const amount =
    typeof data.amount === "number" && Number.isFinite(data.amount) && data.amount > 0 ? data.amount : null;
  const notReceipt = data.is_receipt === false;

  const fields: ReceiptFields = {
    amount: amount !== null && !notReceipt ? amountText(amount, currency, currencySupported) : null,
    currency,
    currencySupported,
    date: realDate(data.date),
    time: clock(data.time),
    title: clipped(data.merchant, TITLE_MAX),
    address: clipped(data.address, ADDRESS_MAX),
    category: typeof data.category === "string" && CATEGORIES.includes(data.category) ? data.category : null
  };

  const readResult = notReceipt ? "not_receipt" : fields.amount !== null ? "read" : "unreadable";
  return { readResult, fields };
}
