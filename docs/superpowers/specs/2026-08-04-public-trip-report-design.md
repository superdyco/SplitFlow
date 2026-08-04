# 公開旅費報告

日期：2026-08-04

## 目標

讓任務的擁有者把一趟已封存的旅行，產生成一份可以公開分享的旅費報告，
**讓沒去的人知道這樣玩一趟大概要花多少錢**。

這個定位決定了所有取捨：報告不是回憶錄，是**旅費參考**。所以主角是每人平均花費，
地點與金額的對應是重點，而「誰欠誰」完全不重要。

## 範圍

**要做的**

- 已封存的任務可產生一份公開報告，取得可分享的連結
- 內容只有彙總：總額、人數、天數、每人平均、分類佔比、地點與金額
- 一張標好點的**靜態**地圖圖片
- 一個任務一份報告，可重新產生（更新同一個連結）、可撤銷
- 公開讀取，看的人不需要帳號

**明確不做的**

- **不放逐筆明細。** 想看明細的人本來就是成員，點進任務就好。
- **不放任何人名或 uid。** 報告是 owner 單方面公開，其他成員沒有逐一同意；
  放上真實暱稱等於替他們決定。
- **不放支出名稱。** `title` 上限 60 字，可能有「藥局」「送 XX 的禮物」這類私事。
- **不放誰欠誰、也不放每個人的實際分攤。** 那會洩漏個人消費差異，而且對讀者無用。
- **不做互動地圖。** 見下面「為什麼地圖是靜態的」。
- **未封存的任務不能產生報告。** 旅費參考的前提是數字定案；旅程進行到一半分享出去，
  別人拿到的是不完整的預算，反而誤導。想更新就解除封存、改完再封存、重新產生。

## 為什麼地圖是靜態的

在公開頁面載 Maps JS SDK 的話：

| | 公開頁載 SDK | 產生時拍一張圖 |
|---|---|---|
| API 呼叫次數 | **每次有人開啟**都算一次 | **每份報告一次**，之後永遠是 0 |
| 金鑰暴露 | 公開頁面帶著金鑰 | 公開頁面**完全沒有金鑰** |
| 連結被瘋傳 | 帳單跟著漲，擋不住 | 完全沒影響 |
| 載入速度 | 要下載整包 SDK | 一張圖 |
| 代價 | — | 不能縮放拖曳 |

失去的只有互動性，而對「看看他們去了哪一帶」這個用途，靜態圖就夠了 ——
在手機上內嵌的互動地圖還常常搶走頁面捲動。

決定性的理由是**公開頁面不帶金鑰**：專案的兩把 Google key 已經在公開的 git 歷史裡
（見 todo.md），再把它放進一個設計上就是要到處轉傳的頁面，等於主動送出去。

Static Maps 是獨立的 SKU，單價比 SDK 便宜，一份報告一次呼叫的成本可以忽略。
部署前確認一次當前定價。

## 資料存放

### 路徑

```
tasks/{taskId}/reports/{reportId}
```

`reportId` 是隨機 ID，公開網址是 `/r/{taskId}/{reportId}` —— **兩段各 20 字元的
隨機 ID**，比單一 ID 更猜不到。

放在任務子集合而不是頂層集合，是因為規則可以直接用既有的 `taskData(taskId).ownerId`
驗證擁有者，**不用動任務文件、也不用在公開文件裡存 uid**。頂層集合就得把 `ownerId`
存進公開文件才驗得了身分，那是不必要的洩漏。

刻意不在任務文件上存 `reportId`：上一個功能才剛在 `changesStatusAsOwner` 的
`hasOnly(["status", "updatedAt"])` 上花過工夫，不要為了一個欄位又去鬆動它。
擁有者的介面用 `list` 找既有報告即可。

### 安全規則

```
match /tasks/{taskId}/reports/{reportId} {
  // 撤銷就是 active 改成 false，讀取直接失敗，頁面顯示「這份報告已關閉」。
  // 跟既有的 invites 是同一個模式。
  allow get: if resource.data.active == true || isTaskMember(taskId);
  // 成員才列得出來 —— 擁有者的介面靠這個找到既有的報告。
  allow list: if isTaskMember(taskId);
  allow create, update: if taskData(taskId).ownerId == request.auth.uid;
  allow delete: if false;
}
```

不需要 `taskIsActive` —— 報告本來就只在封存後產生，而且封存的任務仍要能重新產生
與撤銷報告。

### 文件內容

**絕對不放**：任何 uid、成員暱稱、支出名稱、誰欠誰。

**放算好的數字**：

```ts
export interface TripReport {
  id: string;
  taskName: string;
  currency: string;
  /** 起迄日期，沒設就是 null。 */
  startDate: string | null;
  endDate: string | null;
  /** 旅程天數。算不出來就是 null。 */
  days: number | null;
  memberCount: number;
  /** 列入計算的支出筆數（缺匯率的已排除）。 */
  expenseCount: number;
  /** 主要幣別最小單位整數。 */
  total: number;
  /** total ÷ memberCount，四捨五入到最小單位。 */
  perPerson: number;
  categories: CategoryTotal[];
  places: PlaceTotal[];

  /** Storage 物件路徑。沒有地圖時是 null。 */
  mapPath: string | null;
  /** 撤銷就是這個變 false。 */
  active: boolean;
  /** 第一次產生的時間，重新產生時保留不動。 */
  createdAt: Timestamp;
  /** 最後一次重新產生的時間。報告上顯示這個。 */
  updatedAt: Timestamp;
}

/** 地點彙總。`placeId` 是 null 代表使用者只打了名字、或這是「未指定地點」那一列。 */
export interface PlaceTotal {
  name: string;
  placeId: string | null;
  lat: number | null;
  lng: number | null;
  /** 主要幣別最小單位整數。 */
  total: number;
  expenseCount: number;
}
```

**`perPerson` 用的是任務目前的 `memberCount`。** 有人中途離開的話這個平均會偏高
（分母變小）。對「大概要花多少」這個用途可以接受，而且用實際分攤人數反而會因為
每筆支出的參與者不同而難以定義。

**`taskName` 會出現在報告上。** 擁有者按下產生之前看得到自己取的名字，如果那個名字
本身有私事（例如「阿明求婚旅行」），改名再產生即可。這是擁有者自己就能控制的，
不另外處理。

## 報告內容

```
曼谷五日
2026/03/01 – 03/05 · 5 天 · 3 人

        每人平均
      NT$ 16,067
   總花費 NT$ 48,200 · 47 筆

┌────────────────────────┐
│    [靜態地圖，標點]      │
└────────────────────────┘

去過的地方
洽圖洽週末市集      NT$ 3,200   4 筆
大皇宮              NT$ 1,800   1 筆
Terminal 21         NT$ 1,450   3 筆
⋯
未指定地點          NT$ 8,400   12 筆

花在哪
🍽 餐飲   42%   NT$ 20,244
🏨 住宿   31%   NT$ 14,942
🚗 交通   15%   NT$  7,230
🛍 購物   12%   NT$  5,784

由 SplitFlow 產生 · 2026/08/04
```

**主角是每人平均，不是總額。** 看報告的人在算「我去要準備多少」。

**每人平均 = 總額 ÷ 人數，不是每個人的實際分攤。** 實際分攤會洩漏個人消費差異，
而且對讀者沒用 —— 他要的是「這種玩法一個人大概多少」。簡單平均同時滿足隱私與用途。

**「未指定地點」要誠實列出來。** 很多支出沒選地點（便利商店、計程車）。只列有地點的，
讀者會自己加總、發現對不上總額，然後不信任整份報告。列出來反而讓數字可驗證。

**筆數是「算進去的筆數」。** 缺匯率的外幣支出在 `categoryTotals` 與 `settleExpenses`
裡本來就被排除。報告沿用同一套規則，總額、分類、地點、筆數四者一定對得起來。

**天數**優先用任務起迄日期；沒設就用支出日期的頭尾；兩者都沒有就不顯示。

## 元件劃分

| 檔案 | 職責 | 依賴 |
|---|---|---|
| `src/utils/placeTotals.ts` | 依地點彙總金額與筆數，純函式 | `baseAmountOf` |
| `src/utils/tripSummary.ts` | 天數與每人平均，純函式 | 無 |
| `src/services/reportService.ts` | 讀寫報告文件、上傳地圖 | firebase |
| `src/services/staticMap.ts` | 組 Static Maps URL、抓圖 | 無 firebase |
| `src/pages/ReportPage.vue` | 公開報告頁 | reportService |

`categoryTotals` 直接重用，已經有測試，而且與結算共用 `baseAmountOf`，
保證跟總額同一套規則。

## 產生流程

入口在 TaskPage 的封存橫幅底下 —— 那裡是「這趟旅行的頁面」，而且支出與成員都已載好，
不用為了產生報告再讀一次。

0. 先用 `list` 找這個任務有沒有既有報告。**有就沿用它的 `reportId`**，沒有才產生新的。
   這是「一個任務一份報告、連結永遠不變」的實作方式 —— 每次產生新 ID 的話，
   已經傳出去的舊網址會變成死連結。
1. 用純函式算出彙總
2. 有座標的地點才呼叫 Static Maps API **一次**，拿到 PNG
3. PNG 上傳到 `tasks/{taskId}/reports/{reportId}/map.png`
4. 寫入報告文件（既有的用覆寫，`createdAt` 保留原值、另存 `updatedAt`）

**第 2、3 步失敗不能擋住報告產生。** 地圖是加分不是必要；抓不到就存 `mapPath: null`，
報告照樣出得來。反過來設計的話，Static Maps 一出問題（配額、金鑰、網路）整個功能就掛了。

**沒有任何地點有座標時直接跳過**，連 API 都不呼叫。純文字地點沒有座標，這在實際資料裡不少。

地圖標記數量要設上限（取金額最大的前 20 個），否則地點多的時候 URL 會超長。

### Storage 規則

```
match /tasks/{taskId}/reports/{reportId}/map.png {
  // 報告是公開連結，讀的人沒有登入，所以地圖必須公開讀。
  allow read: if true;
  allow create, update: if request.auth != null
    && request.resource.size <= 1 * 1024 * 1024
    && request.resource.contentType == 'image/png';
  allow delete: if false;
}
```

跟收據一樣的老限制：Storage 規則查不到 Firestore，所以擋不住「任何登入者往別人的
報告路徑寫圖」。防線仍是兩段隨機 ID。這個取捨在收據那次已經記錄過，這裡是同一個。

## 公開頁面

路由 `/r/:taskId/:reportId`，`meta: { public: true }` —— router 已經有這個模式
（`/login`、`/join` 在用），守衛邏輯不用改。

**不套 `AppLayout`**：那會顯示「我的分帳」導覽列，對沒帳號的訪客沒有意義，還會誘導
他去點。頁面底部放一句「用 SplitFlow 記帳」的連結就夠了。

三種狀態各自處理，都要講人話而不是吐 Firebase 的權限錯誤：

| 狀態 | 顯示 |
|---|---|
| 讀不到（連結錯誤或報告不存在） | 「找不到這份報告，連結可能不完整。」 |
| `active === false` | 「這份報告已關閉。」 |
| 正常 | 報告內容 |

## 邊界情況

| 情況 | 處理 |
|---|---|
| 任務沒有任何支出 | 不能產生報告，按鈕停用並說明原因 |
| 沒有任何地點有座標 | 不呼叫 Static Maps，`mapPath` 是 null，頁面不顯示地圖區塊 |
| Static Maps 失敗 | 報告照常產生，`mapPath` 是 null，不擋流程 |
| 重新產生 | 覆寫同一份文件與同一個地圖路徑，連結不變 |
| 撤銷後又想開啟 | `active` 改回 true 即可，同一個連結復活 |
| 訪客沒有登入 | Firestore 允許未登入讀 `active` 的報告；頁面不可觸發登入導向 |

## 測試

| 測試 | 涵蓋 |
|---|---|
| `tests/placeTotals.test.ts` | 依金額由大到小；同一地點多筆合併；沒有地點的歸「未指定地點」；缺匯率的排除；全部沒地點時只有一列；空清單 |
| `tests/tripSummary.test.ts` | 天數用起迄日期（含頭尾）；沒設起迄時用支出日期頭尾；都沒有時 null；每人平均的除法與進位；人數為 0 不會除以零 |
| `tests/firestore.rules.test.mjs`（補） | 未登入可讀 `active` 的報告；**未登入讀不到 `active=false` 的**；非擁有者不能建立或更新；成員可以 list；非成員不能 list |
| `tests/storage.rules.test.mjs`（補） | 未登入可讀地圖；非 PNG 被擋；超過 1MB 被擋 |

「未登入讀不到已關閉的報告」是撤銷功能的**唯一**證明 —— 沒有它，「可撤銷」就只是
介面上的錯覺。

## 驗收標準

1. 已封存的任務，擁有者看得到「產生分享報告」；未封存的看不到。
2. 產生後取得連結，**用無痕視窗（未登入）打開看得到報告**。
3. 報告裡沒有任何人名、支出名稱、誰欠誰。
4. 地點清單的金額加總等於總額（含「未指定地點」那一列）。
5. 撤銷後，同一個連結在無痕視窗顯示「這份報告已關閉」。
6. 重新產生後，同一個連結顯示更新後的數字。
7. 沒有任何地點有座標時，報告仍然產得出來，只是沒有地圖。
8. `npm test` 與 `npm run test:rules` 全綠。
