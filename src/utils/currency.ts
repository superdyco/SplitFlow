export interface CurrencyInfo {
  code: string;
  /** 選單上跟代碼並列的中文名。 */
  name: string;
  /** 搜尋用：國家、俗稱。打「美國」「美金」要找得到 USD。 */
  keywords: string[];
}

/**
 * 支援的幣別。**順序就是選單的順序**：依地區排，台灣人常去的在前面。
 *
 * 金額旁邊只顯示代碼（「USD 1,234」）—— 那裡是在讀，短而且不會混淆；
 * `$` 同時是美元、港幣、台幣、新加坡幣，`¥` 同時是日圓與人民幣。
 * 中文名只在選單出現，那裡是在找。
 *
 * 加一個幣別要改三份小數位數表（這裡、`functions/src/amount.ts`、Flutter 的
 * `currency.dart`），`tests/currencyParity.test.ts` 盯著前兩份。
 */
export const CURRENCY_INFO: CurrencyInfo[] = [
  { code: "TWD", name: "新台幣", keywords: ["台灣", "臺灣", "台幣", "臺幣"] },
  { code: "JPY", name: "日圓", keywords: ["日本", "日幣", "円"] },
  { code: "KRW", name: "韓元", keywords: ["韓國", "韓幣"] },
  { code: "CNY", name: "人民幣", keywords: ["中國", "大陸"] },
  { code: "HKD", name: "港幣", keywords: ["香港"] },
  { code: "MOP", name: "澳門幣", keywords: ["澳門"] },
  { code: "THB", name: "泰銖", keywords: ["泰國"] },
  { code: "VND", name: "越南盾", keywords: ["越南"] },
  { code: "SGD", name: "新加坡幣", keywords: ["新加坡"] },
  { code: "MYR", name: "馬幣", keywords: ["馬來西亞", "令吉"] },
  { code: "PHP", name: "菲律賓披索", keywords: ["菲律賓", "披索"] },
  { code: "IDR", name: "印尼盾", keywords: ["印尼", "峇里島", "巴里島"] },
  { code: "USD", name: "美元", keywords: ["美國", "美金"] },
  { code: "CAD", name: "加幣", keywords: ["加拿大"] },
  { code: "EUR", name: "歐元", keywords: ["歐洲", "歐盟"] },
  { code: "GBP", name: "英鎊", keywords: ["英國"] },
  { code: "CHF", name: "瑞士法郎", keywords: ["瑞士"] },
  { code: "AUD", name: "澳幣", keywords: ["澳洲"] },
  { code: "NZD", name: "紐西蘭幣", keywords: ["紐西蘭", "紐幣"] },
  { code: "EGP", name: "埃及鎊", keywords: ["埃及"] }
];

export const CURRENCIES = CURRENCY_INFO.map(item => item.code);

const MINOR_UNITS: Record<string, number> = {
  TWD: 2,
  THB: 2,
  USD: 2,
  CNY: 2,
  EGP: 2,
  EUR: 2,
  HKD: 2,
  MOP: 2,
  SGD: 2,
  MYR: 2,
  PHP: 2,
  GBP: 2,
  CHF: 2,
  CAD: 2,
  AUD: 2,
  NZD: 2,
  VND: 0,
  KRW: 0,
  // 日圓沒有輔幣單位，1 円就是最小單位 —— 跟 VND、KRW 同一類。
  JPY: 0,
  // 印尼盾在 ISO 上寫 2 位，但實際上沒有人用小數 —— 當成 2 位的話，
  // 一碗麵會寫成「Rp 35,000.00」，而且輸入時多兩個永遠是 0 的位數。
  IDR: 0
};

export function minorUnits(currency: string): number {
  return MINOR_UNITS[currency] ?? 2;
}

/** 選單上的樣子：代碼在前（電腦上打代碼開頭就跳得到）、中文在後。 */
export function currencyLabel(code: string): string {
  const info = CURRENCY_INFO.find(item => item.code === code);
  return info ? `${info.code} ${info.name}` : code;
}

/** 0 = 代碼開頭相符，1 = 代碼包含，2 = 中文名或關鍵字包含；null = 不相符。 */
function matchRank(item: CurrencyInfo, query: string): number | null {
  if (!query) return 0;
  const code = item.code.toLowerCase();
  if (code.startsWith(query)) return 0;
  if (code.includes(query)) return 1;
  if (item.name.includes(query) || item.keywords.some(keyword => keyword.includes(query))) return 2;
  return null;
}

/**
 * 幣別選單的搜尋。代碼不分大小寫，中文名、國家、俗稱都比對。
 *
 * 排序：相符程度 → 主要幣別優先 → 清單原本的順序。主要幣別在同一級裡排第一，
 * 因為一趟旅程裡最常選的就是它。
 */
export function searchCurrencies(query: string, pinned?: string): CurrencyInfo[] {
  const normalized = query.trim().toLowerCase();
  const pin = (item: CurrencyInfo) => (item.code === pinned ? 0 : 1);

  return CURRENCY_INFO.map((item, index) => ({ item, index, rank: matchRank(item, normalized) }))
    .filter((entry): entry is { item: CurrencyInfo; index: number; rank: number } => entry.rank !== null)
    .sort((a, b) => a.rank - b.rank || pin(a.item) - pin(b.item) || a.index - b.index)
    .map(entry => entry.item);
}

/** 把使用者輸入的金額字串換成最小單位整數，例如 TWD "450.5" -> 45050。 */
export function parseAmountInput(value: string, currency: string): number {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("金額為必填");

  const digits = minorUnits(currency);
  const pattern = digits > 0 ? new RegExp(`^\\d+(\\.\\d{1,${digits}})?$`) : /^\d+$/;
  if (!pattern.test(trimmed)) {
    throw new Error(digits > 0 ? `金額只能是數字，最多 ${digits} 位小數` : `${currency} 金額只能是整數`);
  }

  const [whole, fraction = ""] = trimmed.split(".");
  const amount = Number(whole + (fraction + "0".repeat(digits)).slice(0, digits));
  if (!Number.isSafeInteger(amount)) throw new Error("金額太大");
  if (amount <= 0) throw new Error("金額必須大於 0");
  return amount;
}

function splitAmount(amount: number, currency: string) {
  const digits = minorUnits(currency);
  const base = String(Math.abs(amount)).padStart(digits + 1, "0");
  return {
    negative: amount < 0,
    whole: base.slice(0, base.length - digits),
    fraction: digits ? base.slice(base.length - digits) : ""
  };
}

/** 最小單位整數轉成顯示字串，含千分位，例如 45050 / TWD -> "450.50"。 */
export function formatAmount(amount: number, currency: string): string {
  const { negative, whole, fraction } = splitAmount(amount, currency);
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}${fraction ? `.${fraction}` : ""}`;
}

/** 最小單位整數轉回表單輸入值，不含千分位。 */
export function amountToInput(amount: number, currency: string): string {
  const { negative, whole, fraction } = splitAmount(amount, currency);
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

/**
 * 把 total 依 weights 的比例拆成整數，結果總和一定等於 total。
 * 除不盡的部分用最大餘數法補：小數部分大的先拿，平手時取索引小的，所以結果是確定的。
 * 均分就是所有 weight 相同，換算幣別就是用原幣別的分攤金額當 weight。
 */
export function allocate(total: number, weights: number[]): number[] {
  if (!weights.length) return [];

  const sum = weights.reduce((acc, weight) => acc + weight, 0);
  // 權重全是 0 的話沒有比例可言，退回均分。
  if (sum <= 0) return allocate(total, weights.map(() => 1));

  const exact = weights.map(weight => (total * weight) / sum);
  const result = exact.map(Math.floor);
  const remainder = total - result.reduce((acc, value) => acc + value, 0);

  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  for (let i = 0; i < remainder; i += 1) {
    result[order[i % order.length].index] += 1;
  }
  return result;
}

/** rate 是「1 單位 from 幣別等於多少 to 幣別」，兩邊小數位數不同要各自換算。 */
export function convertAmount(amount: number, from: string, to: string, rate: number): number {
  if (from === to) return amount;
  const fromUnits = 10 ** minorUnits(from);
  const toUnits = 10 ** minorUnits(to);
  return Math.round((amount / fromUnits) * rate * toUnits);
}

/** 匯率輸入框的驗證，最多六位小數。 */
export function parseRateInput(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("匯率為必填");
  if (!/^\d+(\.\d{1,6})?$/.test(trimmed)) throw new Error("匯率只能是數字，最多 6 位小數");
  const rate = Number(trimmed);
  if (!(rate > 0)) throw new Error("匯率必須大於 0");
  return rate;
}

/** 把 parse 丟出來的訊息接住。空白回 null —— 還沒填不該在畫面上跳紅字。 */
function messageOf(value: string, parse: (input: string) => unknown): string | null {
  if (!value.trim()) return null;
  try {
    parse(value);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/**
 * 金額字串在這個幣別下的錯誤訊息，合法或空白時是 null。
 *
 * 存在的理由是一個實際發生過的 bug：編輯支出時換幣別，儲存鍵突然變灰、
 * 畫面上卻沒有任何說明。原因是既有的 "450.50" 在 THB 合法，換成 0 位小數的
 * VND 就不合法了，而呼叫端只拿得到 null，只能讓按鈕變灰。
 *
 * `parseAmountInput` 本來就會產生好訊息（「VND 金額只能是整數」），
 * 之前只是被 catch 吞掉。這支函式就是把它接回來。
 */
export function amountInputError(value: string, currency: string): string | null {
  return messageOf(value, input => parseAmountInput(input, currency));
}

/** 匯率字串的錯誤訊息，理由同上：打錯字不該只是讓送出鍵默默變灰。 */
export function rateInputError(value: string): string | null {
  return messageOf(value, parseRateInput);
}
