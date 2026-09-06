/**
 * 「這個 token 是不是平台管理者」。
 *
 * 抽成純函式的理由跟 `join.ts` 一樣：這裡是**安全邊界**。整個後台的每一支
 * callable 第一行都是它，判斷錯一次就是全部使用者的資料。
 *
 * 為什麼身分是 custom claim 而不是一份 `admins/{uid}` 文件：文件需要一組規則
 * 決定誰能寫它，而那組規則本身就是攻擊面。claim 只寫得進有 service account
 * 的地方，所以沒有「在網頁上把自己升成管理者」這條路。
 */

/**
 * `request.auth?.token` 的形狀。除了 admin 之外的欄位這裡都不看。
 *
 * 索引簽章不是裝飾：少了它，只有選填欄位的介面會觸發 TypeScript 的
 * weak type 檢查，而 `DecodedIdToken`（真正傳進來的東西）就會被判定成
 * 「沒有任何共同屬性」而拒收。
 */
export interface AdminClaims {
  admin?: unknown;
  [claim: string]: unknown;
}

/**
 * **一定要用 `=== true`，不能用真值判斷。**
 *
 * custom claim 是 JSON，設定的人手滑寫成字串是很容易發生的事，而
 * `"false"` 這個字串是真值 —— 真值判斷會把一個明顯想表達「不是管理者」的
 * 設定當成管理者。同理 `admin: 1`、`admin: "yes"` 也一律不算。
 *
 * 換句話說：只有 `set-admin` 腳本寫下的那個布林 true 算數，其餘一概不算，
 * 包含那些「看起來像 true」的。
 */
export function isAdmin(claims: AdminClaims | null | undefined): boolean {
  return claims?.admin === true;
}

/**
 * 權限不符時要回哪一種錯。
 *
 * 回 `not-found` 而不是 `permission-denied`：後者等於告訴對方「這支函式是真的，
 * 只是你不夠格」，那就把一份原本不該被知道存在的介面清單交出去了。前端的路由
 * 守衛用同一個原則 —— 不是管理者就顯示找不到頁面，網址不變。
 */
export const DENIED_CODE = "not-found" as const;

/** 給使用者看的訊息。跟真正的 404 一字不差，不然錯誤訊息本身就洩漏了差別。 */
export const DENIED_MESSAGE = "找不到這個頁面";
