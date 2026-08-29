/**
 * 金額格式化。**這是第三份副本**（網頁版 `src/utils/currency.ts`、
 * Flutter `lib/domain/currency.dart`，現在再加這裡）。
 *
 * 沒有更好的辦法：函式部署時只上傳 `functions/` 目錄，import 上層的 `src/`
 * 會在部署後找不到檔案。讓 client 先算好寫進文件更糟 —— 那是可以被竄改的
 * 顯示字串，而且污染資料模型。
 *
 * 只搬通知需要的那兩個函式。防止走鐘的是 `tests/currencyParity.test.ts`：
 * 它把這裡跟網頁版的實作放在一起跑同一批輸入，兩邊不一樣就紅。
 */

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

/** 最小單位整數轉成顯示字串，含千分位，例如 45050 / USD -> "450.50"。 */
export function formatAmount(amount: number, currency: string): string {
  const digits = minorUnits(currency);
  // padStart 到 digits + 1：不足一元時整數位要補出那個 0，
  // 不然 99 分會變成 ".99"。
  const base = String(Math.abs(amount)).padStart(digits + 1, "0");
  const whole = base.slice(0, base.length - digits);
  const fraction = digits ? base.slice(base.length - digits) : "";

  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const sign = amount < 0 ? "-" : "";
  return fraction ? `${sign}${grouped}.${fraction}` : `${sign}${grouped}`;
}
