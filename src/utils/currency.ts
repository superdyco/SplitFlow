export const CURRENCIES = ["TWD", "JPY", "THB", "USD", "VND", "CNY", "EGP", "KRW", "EUR", "HKD"];

const MINOR_UNITS: Record<string, number> = {
  TWD: 2,
  THB: 2,
  USD: 2,
  CNY: 2,
  EGP: 2,
  EUR: 2,
  HKD: 2,
  VND: 0,
  KRW: 0,
  // 日圓沒有輔幣單位，1 円就是最小單位 —— 跟 VND、KRW 同一類。
  JPY: 0
};

export function minorUnits(currency: string): number {
  return MINOR_UNITS[currency] ?? 2;
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
