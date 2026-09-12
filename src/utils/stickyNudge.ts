/**
 * 逼瀏覽器重算 sticky 元素的位置。
 *
 * **這是為了一個真的踩到的 bug**：支出表單的送出列是 `position: sticky`，
 * 在 iOS 加到主畫面的 standalone 模式下，從相機／相簿回來、或版面因為縮圖與
 * 「用 AI 讀收據」變高之後，那一列會停在變高之前的位置 —— 浮在畫面中間、
 * 蓋住備註欄，而下面的內容照常往下延伸。使用者只要隨便捲一下就會跳回底部，
 * 所以缺的就是一次重算。
 *
 * 捲 1px 再捲回來：sticky 的位置是在捲動時重算的，這等於幫使用者做一次他
 * 本來要自己做的動作。淨位移是 0，看不出畫面有動。
 *
 * 兩次之間隔一個影格，不然同一個影格裡的兩次 scrollBy 會被合併成沒有捲動。
 */
export function nudgeSticky(): void {
  if (typeof window === "undefined") return;
  window.scrollBy(0, 1);
  requestAnimationFrame(() => window.scrollBy(0, -1));
}
