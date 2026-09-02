/**
 * 任務頁的檢視狀態。放在網址的 query 裡而不是元件的 ref ——
 * 這樣重整活得下來、連結傳得出去、返回鍵也有意義。
 *
 * 純函式，不 import vue 也不 import vue-router。
 */

export type TaskView = "expenses" | "members" | "settlement";

const VIEWS: readonly TaskView[] = ["expenses", "members", "settlement"];

/**
 * 只認得白名單裡的值，其餘一律回支出。
 *
 * 參數型別是 unknown 而不是 string：vue-router 的 query 值在缺值時是
 * undefined，在 `?view=a&view=b` 時是陣列。網址是使用者可以亂打的，
 * 打錯不該給一個空畫面。
 */
export function parseTaskView(raw: unknown): TaskView {
  return VIEWS.includes(raw as TaskView) ? (raw as TaskView) : "expenses";
}

/**
 * 地圖是支出清單的另一種呈現，不是獨立的檢視 —— 成員與結算頁面上
 * 沒有地圖可看，所以 `?view=members&map=1` 不該開出一張地圖。
 */
export function parseMapMode(raw: unknown, view: TaskView): boolean {
  return view === "expenses" && raw === "1";
}
