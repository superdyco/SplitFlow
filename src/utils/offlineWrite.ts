/**
 * Firestore 寫入的離線處理。
 *
 * Firestore 的寫入 promise 要等伺服器確認才 resolve —— 離線時它永遠不會回來，
 * 但資料其實已經安全寫進本機佇列、連上網就會自動送出。
 * 直接 await 的話畫面會卡死在「儲存中...」，使用者以為壞了然後重複按。
 *
 * 所以這裡等一小段時間就好：有回應就是 synced，沒回應當作 queued 讓使用者往下走。
 *
 * 純函式，不 import firebase 也不 import vue。
 */

export type WriteOutcome = "synced" | "queued";

/**
 * 逾時之後才發生的拒絕會被這裡吞掉，使用者看不到錯誤訊息。
 * 這是有意的取捨：那個情境幾乎只會是規則違反，而規則違反在送出前的表單驗證
 * 就該擋下來了；為了它把所有離線寫入都卡住並不划算。
 */
export function settleWrite(write: Promise<unknown>, timeoutMs = 2500): Promise<WriteOutcome> {
  return new Promise<WriteOutcome>((resolve, reject) => {
    const timer = setTimeout(() => resolve("queued"), timeoutMs);
    write.then(
      () => {
        clearTimeout(timer);
        resolve("synced");
      },
      (err: unknown) => {
        clearTimeout(timer);
        // 逾時後才走到這裡的話 resolve 已經先發生，這個 reject 是 no-op，
        // 但錯誤有被接住，不會變成 unhandled rejection。
        reject(err);
      }
    );
  });
}
