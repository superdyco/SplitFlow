/**
 * 公開報告地圖的路徑與網址。
 *
 * **這個模組刻意獨立於 `staticMap.ts`。** 那裡有
 * `import.meta.env.VITE_GOOGLE_MAPS_API_KEY`，而 Vite 會在 build 時把 env 的值
 * 字面內嵌進 chunk。報告連結設計上就是要到處轉傳，不能夾帶金鑰 ——
 * 所以「公開頁只碰得到這個檔」必須由模組邊界保證，不能賭 tree-shaking。
 *
 * 純字串組合，不 import firebase 也不 import vue。
 */

const STORAGE_HOST = "https://firebasestorage.googleapis.com/v0/b";

export function reportMapPath(taskId: string, reportId: string): string {
  return `tasks/${taskId}/reports/${reportId}/map.png`;
}

/**
 * 直接組出下載網址，不呼叫 `getDownloadURL()`。
 *
 * 成立的前提是 storage.rules 對這個路徑是 `allow read: if true` —— 那條規則
 * 本來就是為了「沒登入的人也要看得到圖」而存在的，不是巧合。日後若收緊，
 * 這裡要一起改。
 *
 * 換來的是省掉一次 firebase/storage 的 chunk 下載與一次 API 往返，
 * 地圖從三段串行變成兩段。
 *
 * 路徑必須整段 encode，`/` 要變成 `%2F`：REST 端點把物件名稱當成單一路徑參數。
 */
export function reportMapUrl(taskId: string, reportId: string): string {
  const bucket = import.meta.env.VITE_FIREBASE_STORAGE_BUCKET;
  return `${STORAGE_HOST}/${bucket}/o/${encodeURIComponent(reportMapPath(taskId, reportId))}?alt=media`;
}
