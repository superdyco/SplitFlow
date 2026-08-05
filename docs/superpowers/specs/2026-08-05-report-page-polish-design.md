# 旅費報告頁改版與地圖載入優化

日期：2026-08-05

## 目標

公開報告頁（`ReportPage.vue`）目前三個區塊視覺重量相同、算好的百分比只印數字沒有
視覺化、地圖要等三段串行請求才開始下載而且載入期間整塊不存在。這份規格處理這三件事，
並補上分享區缺少的「開啟」按鈕。

## 範圍

**要做的**

- 報告頁版面重排，建立「每人平均」為單一主角的層次
- 分類與地點加水平長條
- 地圖改用直接組出的 URL，載入期間顯示骨架屏
- 補上 `updatedAt` 的顯示
- `TaskPage` 分享區加「開啟」連結

**明確不做的**

- **不做 og:image 與轉傳預覽。** 這是 SPA，要做得先有 SSR 或 prerender，
  是另一個等級的工程。
- **不改報告的資料內容。** 不新增欄位、不改 `TripReport` 形狀，
  這次只動呈現。公開報告不含人名與支出名稱的原則不受影響。
- **不動 `staticMap.ts` 的抓圖邏輯。** 它剛在 `0264c88` 改過而且有測試。

## 一、版面結構

由上而下：

```
標題 · 日期 · 天數 · 人數
┌ Hero ───────────────────────┐
│  每人平均                     │
│  TWD 12,345                  │
│  總 61,725 · 38 筆 · 5 個地點  │
└──────────────────────────────┘
┌ 花在哪 ──────────────────────┐
┌ 地圖（骨架 → 淡入）───────────┐
┌ 去過的地方 ──────────────────┐
產生於 2026-08-05 · 由 SplitFlow 產生
```

兩個刻意的安排：

- **地圖緊鄰「去過的地方」**。兩者講的是同一件事，現在地圖夾在 hero 與地點列表
  之間，讀起來是硬插進去的一塊。
- **地圖排在頁面較下方**。手機上多半落在第一屏之外，等使用者滑到時通常已經載完，
  等於用版面順序換到幾百毫秒的緩衝。

## 二、視覺層次

| 項目 | 現在 | 改成 |
|---|---|---|
| Hero 卡底色 | 與列表卡同為白 | `--color-primary-soft` |
| 大數字 | 34px | 46px（維持 `tabular-nums`） |
| 總花費 | 與大數字擠在同一組 | 獨立一行，與筆數、地點數並列 |
| Hero 後間距 | 16px | 24px |
| 產生時間 | **沒有顯示** | footer 顯示 `updatedAt` |

`TripReport.updatedAt` 的型別註解寫著「報告上顯示這個」，但頁面從來沒有渲染它。
這是實作缺漏，不是設計決定，一併補上。

## 三、長條視覺化

新增 `src/components/report/ReportBar.vue`，用於分類與地點兩處。

| | 長條長度基準 | 顏色 |
|---|---|---|
| 花在哪 | `share`（佔總額的百分比） | `--color-primary` |
| 去過的地方 | `total ÷ 最大地點的 total` | `--color-primary` 疊 35% 透明度 |

用透明度而不是 `--color-primary-soft`：後者是 `#fff0e4`，那是給卡片底色用的，
當長條會淡到看不出長度。

**兩個基準不同是刻意的**。分類的百分比本身就是要傳達的資訊；地點則沒有「佔比」
的語意，要比的是「哪裡花最多」，所以用相對於最大值的比例，最大的那個滿格。

**「未指定地點」不畫長條。** `placeTotals` 已經把它固定排在最後，它是把剩下的錢
交代清楚的一列、不是目的地。畫了長條會讓人以為那是個花很多錢的地方。

**地點列表預設顯示前 8 個**，其餘收成「還有 N 個地點」。目前無上限，
`fetchStaticMap` 的地圖標記上限是 20，二十幾列會把頁面拉得很長。

## 四、地圖載入

### 新模組 `src/services/reportMap.ts`

```ts
reportMapPath(taskId, reportId)   // 從 staticMap.ts 搬過來
reportMapUrl(taskId, reportId)    // 新增
```

import 關係改成：

- `ReportPage.vue` → **只** import `reportMap.ts`（它不能碰到 `staticMap.ts`）
- `useTripReport.ts` → `reportMapPath` 改從 `reportMap.ts` import，
  `fetchStaticMap` 與 `MAX_MAP_BYTES` 仍從 `staticMap.ts` import
- `staticMap.ts` → 不再定義也不 re-export `reportMapPath`

**不留 re-export**，否則「公開頁不准碰 `staticMap.ts`」這條界線就只是口頭約定，
下一個人從 `staticMap.ts` import 路徑函式不會有任何阻力。

**為什麼開新檔而不是加在 `staticMap.ts`**：`staticMap.ts` 裡有
`import.meta.env.VITE_GOOGLE_MAPS_API_KEY`，Vite 會在 build 時把 env 的值
**字面內嵌進 chunk**。公開報告頁一旦 import 那個模組，金鑰會不會進到 bundle
就取決於 tree-shaking 有沒有成功——而 `ReportPage.vue` 開頭的註解明講這個頁面
「不帶任何 API 金鑰」，因為連結設計上就是要到處轉傳。這個不變量不該靠
最佳化行為來維持，用模組邊界隔開才是確定的。

### URL 組合

```
https://firebasestorage.googleapis.com/v0/b/{bucket}/o/{encodeURIComponent(path)}?alt=media
```

`bucket` 取自 `VITE_FIREBASE_STORAGE_BUCKET`。路徑必須整段 `encodeURIComponent`，
`/` 會變成 `%2F`——這是這段唯一會寫錯的地方。

**成立的前提**是 `storage.rules` 對 `tasks/{taskId}/reports/{reportId}/map.png`
是 `allow read: if true`。那條規則本來就是為了「沒登入的人也要看得到圖」而存在的，
不是巧合。若日後收緊該規則，這裡要一起改。

### 載入流程

```
讀報告文件
  └─ mapPath 是 null → 完全不渲染地圖區塊，不發任何請求
  └─ mapPath 非 null → 渲染 8:5 骨架 → <img> 直接載
                          ├─ @load  → 淡入
                          └─ @error → 收掉整個區塊
```

不再 `import("firebase/storage")`，也不再呼叫 `getDownloadURL()`。
省掉一次 chunk 下載與一次 API 往返，從三段串行變成兩段。

骨架用 8:5（`aspect-ratio`，對應 640x400）預留空間並跑微光動畫。
`styles.css` 目前沒有任何 skeleton 樣式，需新增。

## 五、分享區加「開啟」

`TaskPage.vue` 的分享區，在「複製」右邊加一顆「開啟」。

```
[ https://.../r/xxx/yyy ] [複製] [開啟]
目前已關閉，連結打不開。          ← 此時「開啟」不渲染
[重新產生] [關閉連結]
```

- 用 **`<a target="_blank" rel="noopener">`** 而不是 `<button>` + `window.open()`。
  中鍵開新分頁、長按選單、「複製連結網址」都會是瀏覽器原生行為，也不會被
  彈出視窗封鎖擋掉。樣式沿用 `btn btn-sm`。
- **只在 `report.active === true` 時渲染。**

**為什麼關閉時必須不能按**：`firestore.rules` 的報告讀取規則是
`allow get: if resource.data.active == true || isTaskMember(taskId)`。
owner 是成員，所以**連結關閉後 owner 自己仍然讀得到完整報告**。若關閉狀態下
還能按「開啟」，owner 會看到一個正常的頁面、以為連結還通著，實際上別人打開是
「找不到」。那比沒有按鈕更糟。旁邊那句「目前已關閉，連結打不開」已經把狀態講清楚了。

手機寬度下三個元素若擠，讓 `.row` 換行，網址輸入框佔滿一行、兩顆按鈕落到下一行。

## 六、測試

| 測試 | 涵蓋 |
|---|---|
| `tests/reportMap.test.ts`（新） | URL 組合正確；路徑的 `/` 被編碼成 `%2F`；`reportMapPath` 搬移後行為不變 |
| `tests/staticMap.test.ts`（既有） | 必須維持全綠，確認 re-export 沒有改變既有行為 |

版面、骨架屏與長條樣式不寫測試——那是視覺，靠實際開頁面驗收。

## 驗收標準

1. 報告頁的「每人平均」明顯是版面主角，三個區塊不再視覺等重。
2. 分類與地點都有長條；「未指定地點」那列沒有長條。
3. 地點超過 8 個時只顯示前 8 個，並標示還有幾個。
4. footer 顯示報告產生時間。
5. 地圖載入期間顯示骨架、位置固定，載完淡入，**下方內容不位移**。
6. 報告頁的 network 面板**不出現 `firebase/storage` 相關的 chunk 與 API 請求**。
7. 沒有地圖的報告完全不渲染地圖區塊，也不發出圖片請求。
8. 建置產物中，公開報告頁所屬的 chunk **不含 Google Maps API 金鑰字串**。
9. 分享區在連結開啟時有「開啟」按鈕、按下會開新分頁；連結關閉時該按鈕不存在。
10. `npm test` 全綠、`npm run build` 通過（含 `check-chunks.mjs`）。
