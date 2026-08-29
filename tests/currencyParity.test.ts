import { describe, expect, it } from "vitest";
import { formatAmount as web, minorUnits as webMinorUnits } from "@/utils/currency";
import {
  formatAmount as fn,
  minorUnits as fnMinorUnits
} from "../functions/src/amount";

/**
 * 金額格式化有三份實作：網頁版、Flutter、Cloud Function。
 * 這支測試盯住其中兩份 —— 它是唯一能在 CI 裡自動抓到走鐘的地方。
 *
 * **為什麼會有三份**：函式部署時只上傳 `functions/` 目錄，import 上層的
 * `src/` 會在部署後找不到檔案。理由寫在 `functions/src/amount.ts`。
 *
 * 為什麼是對照而不是寫死期望值：寫死的話，改網頁版時只會讓**網頁版自己的**
 * 測試變紅，函式那份會安靜地留在舊格式。推播上的金額跟 App 裡看到的不一樣，
 * 使用者會以為自己記錯了 —— 而那種不一致沒有人會回報，只會讓人不信任數字。
 *
 * （Flutter 那份對不到這裡，語言不同。它靠 `flutter_app/test/currency_test.dart`
 * 裡跟這邊對齊的案例守著。）
 */
describe("Cloud Function 的金額格式化跟網頁版一致", () => {
  const currencies = ["TWD", "JPY", "USD", "KRW", "VND", "EUR", "THB", "XXX", ""];

  const amounts = [
    0,
    1,
    9,
    99,
    100,
    999,
    1000,
    1200,
    45050,
    99999,
    100000,
    120000,
    1000000,
    123456789,
    // 負數：結算的餘額會是負的，格式化那條路徑也走同一支。
    -1,
    -99,
    -120000
  ];

  it("每一組幣別與金額都得到同一個字串", () => {
    const mismatches: string[] = [];

    for (const currency of currencies) {
      for (const amount of amounts) {
        const a = web(amount, currency);
        const b = fn(amount, currency);
        if (a !== b) mismatches.push(`${amount}/${currency || "(空)"}: 網頁 ${a} vs 函式 ${b}`);
      }
    }

    expect(mismatches).toEqual([]);
  });

  it("minorUnits 也要一致 —— 小數位數錯了金額就差一百倍", () => {
    const mismatches: string[] = [];

    for (const currency of currencies) {
      const a = webMinorUnits(currency);
      const b = fnMinorUnits(currency);
      if (a !== b) mismatches.push(`${currency || "(空)"}: 網頁 ${a} vs 函式 ${b}`);
    }

    expect(mismatches).toEqual([]);
  });
});
