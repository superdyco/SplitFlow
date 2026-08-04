# 支出收據照片

日期：2026-08-04

## 目標

在支出上附一張收據照片，作為事後對帳的憑證。旅行分帳最常見的爭議是「這筆 850
是誰記的、包含小費嗎」，一張收據比任何備註欄都有說服力。

## 範圍

**要做的**

- 一筆支出最多一張收據照片，純憑證用途
- 新增與編輯支出時都能附照片，可從相機拍或從相簿選
- 離線時拍的照片存在本機，連線後自動補傳
- 支出列表標示哪些筆有憑證；點進去可看縮圖與全螢幕大圖
- 修正現有的離線送出卡住問題（見「一併修正」）

**明確不做的**

- OCR 自動帶入金額／店名。旅行收據常是泰文、日文或手寫，辨識率不穩，改錯字比
  直接打還慢；而且要嘛接 Cloud Vision、要嘛接 LLM，兩者都是新的計費服務。
  資料結構不會擋住之後加。
- 一筆支出多張照片。單張的 `receipt: T | null` 升級成 `receipts: T[]` 是標準遷移，
  比一開始就背陣列的複雜度划算。
- 跨裝置的待上傳佇列。佇列在本機，換裝置那筆會一直是「待上傳」，使用者可以直接
  移除收據解決。
- 保證清乾淨的孤兒檔案回收。需要 Cloud Functions，換來的只是幾 KB 免費額度。

## 前提

- 使用 Firebase Cloud Storage，專案採 Blaze 方案。免費額度（5GB 儲存、每日 1GB
  下載）對此用途遠遠足夠。
- 專案目前完全沒有用過 Storage：[src/firebase/config.ts](../../../src/firebase/config.ts)
  有 `storageBucket` 設定字串但從未被引用，[firebase.json](../../../firebase.json)
  沒有 storage 段。這次要新增。

## 架構決策

### 為什麼是「本機先存、連線後補傳」

Firestore 的寫入會排進離線佇列，Storage 的上傳不會。這個 App 的離線能力是
[src/firebase/config.ts](../../../src/firebase/config.ts) 裡花了十幾行註解特別設計的，
場景是「出國、網路時好時壞」。

而在餐廳沒訊號的當下，正是最想拍收據的時候 —— 等回飯店有 Wi-Fi 才能補，收據
八成已經丟了。所以「線上才能附照片」這條路會在功能最有價值的時刻失效。

反方向的「上傳完才寫 Firestore」更糟：它把原本能離線的記帳也一起拖下水，是退步。

代價是要自己寫一個上傳佇列。這是本功能最大的一塊工，但屬於一次性成本。

### 一併修正：離線送出會卡住

[src/services/expenseService.ts](../../../src/services/expenseService.ts) 的
`createExpense` 用 `doc(expensesRef(taskId))` 產生 ref —— ID 是 client 端同步產生的，
離線也拿得到。這是本設計成立的基礎。

但同一函式結尾的 `await batch.commit()` 是問題：Firestore 的寫入 promise 要等
伺服器確認才 resolve。所以離線新增支出時，資料確實安全排進佇列，但
[src/pages/ExpenseFormPage.vue](../../../src/pages/ExpenseFormPage.vue) 的 `await`
會一直卡住，按鈕停在「儲存中...」也不跳頁，使用者會以為壞了而重複按。

也就是說「支出可以離線記帳」目前只做對了資料層、沒做對 UI 層。

收據功能依賴「使用者能走完表單」才能把照片排進佇列，所以這個修正納入本次範圍：
離線時不等 commit 的 promise，直接跳轉並提示「已離線儲存，連線後同步」。

## 資料模型

### Firestore

[src/types/expense.ts](../../../src/types/expense.ts) 新增型別，掛在 `Expense` 與
`ExpenseInput` 上，形狀比照既有的 `place`：

```ts
/**
 * 支出的收據照片。用兩個欄位表達三種狀態，不另外開 status 欄位，
 * 因為多一個列舉就多一個會跟實際欄位對不上的機會。
 *
 *   path=null, localId="xxx"  待上傳（照片還在拍攝者的手機裡）
 *   path="...", localId=null  已上傳
 *   receipt 整個是 null        這筆支出沒有收據
 */
export interface ExpenseReceipt {
  /** Storage 物件路徑。等上傳時是 null。 */
  path: string | null;
  /** 本機待上傳佇列的 key。上傳成功後設回 null。 */
  localId: string | null;
}
```

`normalizeExpense` 要把舊文件缺少的 `receipt` 補成 `null`，跟現有的 `place`、`date`
一樣處理。

### Storage 路徑

```
tasks/{taskId}/expenses/{expenseId}/receipt.jpg
```

刻意用可推導的固定路徑而非隨機檔名，一次解掉三件事：換照片直接覆蓋、不累積舊檔；
刪支出時就算 `receipt` 欄位讀不到也知道該刪誰；「一筆支出一張照片」由路徑本身保證。
這成立的前提是 `expenseId` 為 client 端先產生。

分成獨立目錄層而不是 `{expenseId}.jpg`，是因為 Storage 規則的路徑萬用字元只能吃
整個 segment，帶字面後綴的 `{expenseId}.jpg` 比對不到。

### 已知的安全限制

Firebase Storage 的規則**無法查詢 Firestore**，所以「只有這個任務的成員能看這張
照片」在 `storage.rules` 裡寫不出來。實際只能寫成「登入者且路徑正確」，防線是那兩段
20 字元的隨機 ID —— 要拿到 ID 得先通過 Firestore 的成員檢查。

對「朋友出國分帳」的威脅模型（威脅是同團的人，而同團的人本來就看得到所有支出）
可以接受。要做到嚴格得上 Cloud Functions 發簽名 URL，不值得為此加一個服務。
這是有意識的降級，不是疏漏。

## 元件劃分

| 檔案 | 職責 | 依賴 |
|---|---|---|
| `src/utils/imageCompress.ts` | `File → Blob`，純函式，不碰網路也不碰儲存 | 無 |
| `src/utils/receiptPolicy.ts` | 路徑組合與佇列判斷，全部是純函式 | 無 |
| `src/services/receiptQueue.ts` | IndexedDB 的增刪查，完全不知道 Firebase 存在 | receiptPolicy |
| `src/services/receiptService.ts` | 上傳／刪除 Storage、跑 flush 迴圈 | 上面三者 + firebase |
| `src/composables/useReceipt.ts` | 表單用的狀態（預覽、上傳中、失敗） | receiptService |
| `src/components/expense/ReceiptField.vue` | 表單裡的收據欄位 | useReceipt |
| `src/components/expense/ReceiptViewer.vue` | 全螢幕檢視 overlay | 無 |

佇列和上傳分開，是因為兩者會各自出錯 —— IndexedDB 可能被瀏覽器清掉或在無痕模式
不能用，Storage 可能 403 或斷線。分開之後每一層的失敗都能獨立測、獨立處理。

判斷邏輯集中在 `utils/` 的純函式裡，`services/` 只剩 I/O。這讓測試能守住現有
「每個 util 一支測試」的格局。

## 上傳佇列

### 資料形狀

```ts
interface QueuedReceipt {
  /** 佇列 key，同時也是 expense.receipt.localId。crypto.randomUUID()。 */
  id: string;
  /** 存目標位置而不是回頭查 Firestore —— 上傳時可能還在離線。 */
  taskId: string;
  expenseId: string;
  /** 壓縮後的 JPEG。IndexedDB 可以直接存 Blob，不需要 base64。 */
  blob: Blob;
  createdAt: number;
  /** 連續失敗次數。 */
  attempts: number;
}
```

用 IndexedDB 而非 localStorage：後者只能存字串，圖片轉 base64 膨脹三分之一，
還有 5MB 上限且同步阻塞主執行緒。

### 觸發時機

1. App 啟動時
2. `window` 的 `online` 事件
3. 剛入列的當下 —— 線上的話這一次就傳完了，使用者不會看到「待上傳」

模組層級一個 `flushing` 旗標擋重入。項目序列處理不併發：行動網路上併發傳圖沒有
好處，還會讓記憶體同時扛好幾張。

### 三種收尾

每種都必須明確處理，否則佇列會變成垃圾場。

| 情況 | 處理 |
|---|---|
| 上傳成功 | `updateDoc` 把 `receipt` 改成 `{ path, localId: null }`，然後從 IndexedDB 刪除 |
| 支出已被刪掉（`updateDoc` 丟 `not-found`） | 直接丟棄該項目，不重試 |
| 其他失敗 | `attempts++` 留在佇列；到 5 次就不再自動重試，項目**保留**在佇列，UI 顯示「上傳失敗，點一下重試」，使用者點了才把 `attempts` 歸零重來 |

另外掃掉 `createdAt` 超過 30 天的項目，免得手機裡永遠躺著一張傳不出去的圖。

`updateDoc` 只寫 `receipt` 欄位，不動 `updatedAt` —— 這是系統補傳，不是使用者編輯。

## UI 流程

### 表單

收據欄位放在 `ExpenseFormPage` 的地點區塊之後、「誰先付」之前。地點與收據都是
「這筆消費的佐證」，擺一起讀起來是一組；擠在金額旁會打斷金額 → 幣別 → 日期 →
匯率那條輸入節奏。

選檔用 `<input type="file" accept="image/*">`，**刻意不加 `capture`**。加了
`capture="environment"` 會強制直接開相機、不能從相簿選，但實際情境是「當場拍」與
「晚上回飯店補進去」各佔一半。不加這個屬性，iOS 才會給「拍照／照片圖庫」選單。

**新增與編輯統一在按下送出時才入列**，不在選完照片時就傳。新增模式下 `expenseId`
要等 `createExpense` 才產生；如果編輯模式提早入列、新增模式不提早，兩條路徑的
狀態機就會分岔 —— 一致比早幾秒重要。選完到送出之間，預覽用記憶體裡的 blob URL。

### 列表

`ExpenseRow` 只加一個小迴紋針圖示表示「這筆有憑證」，**不放縮圖**。列表放縮圖的話
`ExpenseDayGroup` 一天十筆就是十個網路請求，漫遊網路下會很難看，而且列表本來就密。

### 檢視大圖

自製 overlay 元件，**不用 `window.open`**。PWA 在 standalone 模式下 `window.open`
會把使用者踢到瀏覽器、回不來原本的頁面；未來若包成 Capacitor 則是直接跳出 App。

### 狀態與權限

縮圖右上角掛標籤：待上傳是灰色「待上傳」，失敗是紅色「上傳失敗 · 重試」（可點，
重設 `attempts` 再 flush 一次）。已上傳不掛標籤 —— 沒有消息就是好消息。

權限沿用 `ExpenseFormPage` 既有的 `canManage` 判斷（建立者、付款人、管理員）。
沒權限的成員看得到縮圖、點得開大圖，但沒有「更換／移除」按鈕。

### 快取

`getDownloadURL` 每次都是一趟網路請求。`receiptService` 裡放一個模組層級的
`Map<path, url>`：同一個物件的 URL 是穩定的，同一次 session 進出編輯頁好幾次不該
重複問。

## 影像壓縮

canvas 縮到長邊 1600px、JPEG quality 0.8，約 200–400KB。原圖 3–5MB 直接傳既吃額度
又拖慢行動網路。

用 1600 而不是 1200，是因為收據小字多，再小就開始糊到讀不出金額。

已經小於上限的圖不放大。

## 安全規則

### 新檔案 `storage.rules`

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /tasks/{taskId}/expenses/{expenseId}/receipt.jpg {
      allow read: if request.auth != null;
      // 2MB 上限是壓縮後大小的五倍以上，正常照片一定過得了，
      // 但擋掉繞過前端直接上傳大檔把額度吃光。
      allow create, update: if request.auth != null
        && request.resource.size <= 2 * 1024 * 1024
        && request.resource.contentType == 'image/jpeg';
      allow delete: if request.auth != null;
    }
  }
}
```

[firebase.json](../../../firebase.json) 加 `"storage": { "rules": "storage.rules" }`，
emulators 加 storage 段，`package.json` 的 `deploy` script 的 `--only` 清單補上 `storage`。

### Firestore 規則

**不需要放寬 update 規則。** 兩個原因：

1. Firestore 在 update 時 `request.resource.data` 是「現有文件 + 這次異動」的合併
   結果，所以只寫 `receipt` 一個欄位，`validExpenseShape()` 仍看得到 title/amount，
   會通過。
2. 執行 flush 的一定是當初拍照的人，而那個人必然是該支出的建立者或付款人，
   `canManageExpense()` 天然成立。

只需**新增**一個 `validReceipt()`，形狀比照旁邊的 `validPlace()`，並掛進
`validExpenseShape()`：

```
function validReceipt() {
  let receipt = request.resource.data.get("receipt", null);
  return receipt == null
    || (
      receipt is map
      && (receipt.path == null || receipt.path is string)
      && (receipt.localId == null || receipt.localId is string)
    );
}
```

用 `.get("receipt", null)` 而非直接取，理由跟現有的 `validEditedParticipants()` 一樣：
這功能之前建立的舊支出沒有這個欄位。

## 邊界情況

| 情況 | 處理 |
|---|---|
| 無痕模式／IndexedDB 被擋 | 降級成「照片必須當場傳完」，傳不掉就明確告訴使用者。不可靜默吞掉 —— 那會讓使用者以為存了、其實照片消失 |
| 換照片時舊檔還在佇列 | 覆寫同一個 `localId` 的項目，不留兩筆搶同一個路徑 |
| 刪支出時照片還在佇列 | 一併刪掉佇列項目，不留永遠 `not-found` 的殭屍 |
| 編輯時移除收據 | `receipt` 設 null、刪 Storage 檔案、清佇列項目三件都要做；Storage 刪除失敗就算了（接受的孤兒），不能讓使用者的編輯因此存不進去 |
| 使用者換裝置 | 那筆支出一直顯示「待上傳」。使用者可移除收據解決，不另造機制 |

## Bundle

[vite.config.js](../../../vite.config.js) 的註解說「Firebase 一定要整包放同一個
chunk」，但真正的原因是**不能把 umbrella 與實作拆開**。把 `firebase/storage` 與
`@firebase/storage` 一起放進獨立 chunk 是單向依賴、不會成環，跟同一支檔案裡
chart.js 的處理方式一致。

這樣首屏不用背那約 35KB（gzip），沒開過有收據的支出的人不必付這個錢。

不需要賭：[scripts/check-chunks.mjs](../../../scripts/check-chunks.mjs) 本來就會在
build 時抓循環相依，寫錯了 build 直接紅燈。同時要更新 `vite.config.js` 裡那段
註解，讓它說出真正的理由。

## 測試

現有 [tests/](../../../tests/) 是「每個 util 一支測試」的一對一格局，守住它。做法是
把判斷從 I/O 裡拉出來變純函式。

| 測試 | 涵蓋 |
|---|---|
| `tests/receiptPolicy.test.ts` | `receiptPath(taskId, expenseId)` 組路徑；`queueAction(item, now)` 回傳 `"upload" \| "drop-expired" \| "hold-exhausted"`（`hold` 是保留項目但停止自動重試，等使用者手動觸發） |
| `tests/imageCompress.test.ts` | `scaledSize(w, h, maxEdge)`：直式收據、橫式、已小於上限不放大、正方形 |
| `tests/firestore.rules.test.mjs`（既有，補案例） | `receipt` 形狀錯要被擋；非管理者不能改別人支出的 `receipt` |
| storage rules 案例（`@firebase/rules-unit-testing`，跟著 `npm run test:rules` 跑） | 超過 2MB 被擋、非 jpeg 被擋、未登入被擋、登入者可讀寫 |

canvas 在 vitest 的 node 環境跑不起來，所以 `compressImage` 本身不寫單元測試；
真正容易算錯的是尺寸邏輯，那部分獨立成 `scaledSize` 後測得到。

同理，IndexedDB 那層不寫單元測試 —— 它在抽出 `queueAction` 之後只剩讀寫，
沒有判斷可測。

## 驗收標準

1. 線上新增一筆帶收據的支出，送出後照片在數秒內出現，`receipt.path` 有值、
   `localId` 是 null。
2. 開飛航模式新增一筆帶收據的支出：表單能送出、頁面正常跳轉、列表看得到那筆支出、
   收據顯示「待上傳」。恢復連線後照片自動上傳，標籤消失。
3. 離線送出**不帶**收據的支出也不再卡在「儲存中...」。
4. 沒有管理權的成員看得到收據、看不到「更換／移除」。
5. `npm run build` 通過（含 chunk 循環檢查），`npm test` 與 `npm run test:rules` 全綠。
