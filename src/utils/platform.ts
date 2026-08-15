/**
 * 執行環境的判斷。
 *
 * 純函式，但會讀 `window` —— 不 import firebase 也不 import vue。
 */

/**
 * 是不是從主畫面的圖示啟動的（PWA standalone），而不是在瀏覽器分頁裡。
 *
 * 差別在於**有沒有分頁列與上一頁**：沒有的話 `target="_blank"` 開出去的頁面
 * 就是一條死路，站內導航才回得來。
 */
export function isInstalledApp(): boolean {
  // iOS 的 Safari 到現在還是只認 navigator.standalone，不吃 display-mode。
  const iosStandalone = (window.navigator as { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia("(display-mode: standalone)").matches;
}
