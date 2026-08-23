# SplitFlow

SplitFlow 第一個可驗收版本已從 Prototype 重新實作為標準 Vue 3 專案。

## 技術

- Vue 3 + Vite + TypeScript
- Composition API + `<script setup>`
- Vue Router
- Pinia
- Firebase Authentication: Google 登入
- Cloud Firestore
- Firebase Hosting
- 手機優先 RWD

Prototype 的 `<x-dc>`、`<sc-if>`、`<sc-for>`、`DCLogic` 沒有留在正式 Vue component 內。

## 啟動

```bash
npm install
npm run dev
```

Build：

```bash
npm run build
```

`vite.config.js` 的 `manualChunks` 把第三方套件拆成 `firebase`（448 kB）、`vendor-vue`（96 kB）
與 `vendor`（3 kB），自己的程式碼只剩 8 kB 的 entry。這樣改功能時使用者只會重抓那 8 kB，
不會連 550 kB 的 vendor 一起重新下載。

注意這**不會減少首次載入的總量** —— vendor chunk 都在 entry 的 modulepreload 清單裡，
第一次進站還是要下載全部。真正的效益是快取粒度與平行下載。

### Firebase 一定要整包同一個 chunk

不要為了再切小而把 Firebase 依 firestore / auth 分開。umbrella 的 `firebase/auth` 只是
re-export，實作在 `@firebase/auth`，分到不同 chunk 就會形成循環相依 —— **build 會成功、
dev server 也正常，但正式站一載入就噴 `Cannot access 'x' before initialization`**。
而且 firebase 各套件本來就同版號一起更新，再細分也拿不到額外的快取好處。

`npm run build` 最後會跑 `scripts/check-chunks.mjs` 檢查 chunk 之間有沒有循環相依，
就是為了擋這個。dev server 不套用 `manualChunks`，所以改過打包設定一定要用
`npm run preview` 在真的瀏覽器上點一輪。

## 環境變數

複製 `.env.example` 成 `.env`：

```text
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_GOOGLE_PLACES_API_KEY=
VITE_GOOGLE_MAPS_API_KEY=
```

不要把正式 Firebase 設定寫死在程式碼裡。

### Google API 金鑰

兩把都是選填，而且刻意分開，可以各自設限制、各自更換：

| 變數 | 用途 | 沒設會怎樣 |
|---|---|---|
| `VITE_GOOGLE_PLACES_API_KEY` | Places API (New)，地點搜尋 | 地點欄位退回純文字輸入 |
| `VITE_GOOGLE_MAPS_API_KEY` | Maps JavaScript API + Maps Static API，地圖顯示 | 不顯示地圖，其餘不受影響 |

只設 `VITE_GOOGLE_MAPS_API_KEY` 一把也能動，地點搜尋會沿用它。

地圖那把要**開通兩個 API**，它們在 Google Cloud 是分開的：`Maps JavaScript API`
給支出頁的互動地圖，`Maps Static API` 給公開報告裡那張圖。只開一個的話，
另一邊會變成「沒有地圖」—— 這個失敗以前是無聲的，現在產生報告時會把
Google 的錯誤原文顯示出來。金鑰的「API 限制」清單也要同時勾這兩個，
啟用（activation）跟限制（restriction）是兩件事，少任何一邊都會被擋。

兩把都會被打包進前端原始碼，**一定要在 Google Cloud Console 設 HTTP referrer 限制**
（只允許 localhost 與正式網域）並各自只啟用需要的 API。Firebase 的 Web API key 靠
Firestore rules 擋，但 Google API key 沒有對應的防線，外流等於直接讓別人花你的錢。

## Firestore 資料結構

`users/{uid}`

```ts
{
  uid: string,
  nickname: string,
  email: string,
  photoURL: string | null,
  provider: string,
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

`tasks/{taskId}`

```ts
{
  name: string,
  ownerId: string,
  adminIds: string[],
  memberIds: string[],
  defaultCurrency: string,
  startDate: string | null,
  endDate: string | null,
  status: "active",
  inviteCode: string,
  memberCount: number,
  expenseCount: number,
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

`tasks/{taskId}/members/{uid}`

```ts
{
  uid: string,
  nickname: string,
  role: "owner" | "admin" | "member",
  joinedAt: Timestamp,
  active: boolean
}
```

移除成員是 soft delete：member 文件留著並標成 `active: false`，同時從 task 的 `memberIds`
拿掉。文件留著是為了讓舊支出還查得到暱稱，`memberIds` 拿掉是為了讓 Security Rules
立刻擋住他讀取任務。被移除的人再打開邀請連結會沿用原本的 member 文件重新啟用。

`tasks/{taskId}/expenses/{expenseId}`

```ts
{
  title: string,
  category: "food" | "transport" | "stay" | "ticket" | "shopping" | "other",
  amount: number,          // 原幣別最小單位整數，TWD 450.00 存成 45000
  currency: string,
  rate: number,            // 記帳當下的匯率，1 currency 等於多少 defaultCurrency
  baseAmount: number,      // amount 換算成 defaultCurrency 後的最小單位整數
  paidBy: string,          // uid
  splitMode: "even" | "custom",
  splits: { [uid: string]: number },  // 原幣別金額，總和等於 amount
  place: {                 // 選填，沒填是 null
    name: string,
    address: string | null,
    lat: number | null,
    lng: number | null,
    placeId: string | null
  } | null,
  createdBy: string,
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

`perf/{sampleId}`（效能樣本，只寫不讀，見「效能量測」）

```ts
{
  uid: string,
  page: string,            // "tasks" 或 "tasks-costs"
  total: number,           // ms
  sinceStart: number,      // 開始量測之前就花掉的時間（bundle + firebase 初始化）
  phases: { [name: string]: number },   // auth / profile / chunk / mount / query / render
  slowest: string,         // 最慢的那一段，直接拿來 group by
  detail: { cold: boolean, fromCache: boolean, taskCount: number, ... },
  boot: { ttfb: number, dom: number } | null,
  version: string,
  mode: "dev" | "prod",
  online: boolean,
  network: { effectiveType, downlink, rtt },  // 只有 Chromium 系有
  installed: boolean,
  userAgent: string,
  day: string,             // "2026-08-23"，查詢用；精確時間在 createdAt
  createdAt: Timestamp,
  expiresAt: Timestamp     // 30 天後，配合 Console 的 TTL 政策自動清掉
}
```

金額一律存最小單位整數，避免 JavaScript 浮點誤差。各幣別小數位數在 `src/utils/currency.ts`，TWD/THB/USD/CNY/EGP/EUR/HKD 是 2 位，VND/KRW 是 0 位。

### 匯率

匯率在**記帳當下**抓一次（open.er-api.com，免費不需 key），換算結果寫進 `rate` 與 `baseAmount`，
之後結算不再重抓。分帳記的是已經發生的事，金額不該因為今天匯率變了就跟著變。
使用者可以手動改匯率，填實際刷卡成交的數字，API 掛掉時也還能記帳。

### 地點搜尋

支出可以標一個地點。用 **Places API (New) 的 REST 端點**（`places:autocomplete` 與
`places/{id}`），不載 Maps JavaScript SDK — 只為了 autocomplete 多背一整包 SDK 不划算，
目前這個做法對 bundle 的影響不到 0.1 kB。

輸入停下 350ms 才送查詢，autocomplete 與後續的 details 共用同一個 `sessionToken`，
Google 才會算成一次計費而不是兩次。

沒有設金鑰時欄位會退回純文字輸入，只存名稱不存座標，功能不會壞掉。
使用者也可以不從清單選、直接打自己的名字，一樣存得起來。

### 地圖

Maps JavaScript API 用 `src/services/mapsLoader.ts` **動態插 script 標籤載入**，
不是 npm 套件 —— 地圖程式碼因此不會進主 bundle，沒開地圖的人不用付這個成本
（實測對主 chunk 的影響是 +0.54 kB）。只會載入一次，之後共用同一個 promise。

兩個地方會用到：支出表單選完有座標的地點後出現預覽小地圖，以及支出頁籤的
「清單 / 地圖」切換，把整趟旅行有座標的支出標在同一張圖上並自動框住全部標記。
純文字地點沒有座標，不會出現在地圖上。

公開報告裡的地圖走另一條路：`src/services/staticMap.ts` 在**產生報告時**呼叫
Maps Static API 一次，把 PNG 存進 Storage，之後不管連結被轉傳幾次都是 0 次
API 呼叫，公開頁面也完全不帶金鑰。代價是不能縮放拖曳。地圖失敗不擋報告，
但會把原因顯示給產生報告的人 —— 這些失敗全都長得一樣（沒有地圖），
不講原因就沒辦法查。

### 分攤

`splits` 記每個人分攤的原幣別金額，只包含有參與的人。`splitMode` 是 `even` 時金額由
`allocate()` 均分產生，`custom` 時由使用者自己填，合計必須等於 `amount`。

`allocate(total, weights)` 把整數依權重拆開，用最大餘數法補除不盡的部分，**結果總和一定等於
total**。均分、自訂比例、換算成主要幣別三種情況都用同一個函式，所以不會有四捨五入之後
多出或少掉幾分錢的問題。

`tasks/{taskId}/payments/{paymentId}`

```ts
{
  from: string,            // uid，付錢的人
  to: string,              // uid，收錢的人
  amount: number,          // defaultCurrency 最小單位整數
  currency: string,
  status: "pending" | "confirmed",
  createdBy: string,
  createdAt: Timestamp,
  confirmedAt: Timestamp | null,
  updatedAt: Timestamp
}
```

只有**收款人**能把 `status` 改成 `confirmed`，因為只有收錢的人能證明錢真的到了。
收款人自己記錄的付款一開始就是 `confirmed`。**只有已確認的付款會折抵結算餘額**。

`tasks/{taskId}/settlements/{settlementId}`

```ts
{
  currency: string,
  total: number,
  paidTotal: number,
  expenseCount: number,
  balances: { uid, paid, owed, balance }[],
  transfers: { from, to, amount }[],
  memberNames: { [uid: string]: string },  // 存快照當下的暱稱
  note: string,
  createdBy: string,
  createdAt: Timestamp
}
```

結算紀錄是歷史快照。Rules 只允許 owner/admin **新增與刪除，不允許修改** —— 能改的話就不叫紀錄了。
`memberNames` 一起存進去，之後有人改暱稱或被移出任務，歷史紀錄仍顯示當時的名字。

### 結算

即時結算不寫進 Firestore，`src/utils/settlement.ts` 直接從最新 expenses 與 payments 算出來，
所以改完支出或確認了付款，結算就跟著變。全部換算成 `defaultCurrency` 之後合併計算，
再用貪婪配對算出最少轉帳筆數。

付款在數學上就是一筆「付款人先付、收款人獨自分攤」的支出，所以直接併進同一組帳裡算，
建議轉帳會自動扣掉已經付掉的部分，不需要另外一套折抵邏輯。

存快照不會改變即時結算的行為：帳目仍然隨時可以改，改完結算就重算。快照只是多留一份
「當時算出來是這樣」。`matchesSnapshot()` 比對目前帳目與最新快照，不一致時畫面會提示
「上次結算之後帳目又變動了」。

`rate` / `baseAmount` / `splits` 是後來才加的欄位。之前建立的支出讀取時會由
`normalizeExpense()` 就地補成新格式；外幣舊支出因為沒有當時的匯率無法換算，會被排除在
結算之外並在畫面上提示重新編輯補匯率。

`invites/{inviteCode}` 保留邀請預覽所需欄位：taskId、taskName、defaultCurrency、日期與狀態。這樣未登入者可以看到邀請預覽，但不能讀取完整 task 文件。

## Firestore Rules

規則在 `firestore.rules`。為了讓 Security Rules 可以安全判斷任務成員，task 文件保留 `memberIds`。加入任務時使用 transaction 同時建立自己的 member 文件與更新 task 的 `memberIds/memberCount`，避免重複加入。

部署 rules：

```bash
npm run deploy:rules
```

## 部署到 Firebase Hosting

第一次要先登入（每台機器一次）：

```bash
npx firebase login
```

之後每次部署就一行：

```bash
npm run deploy
```

這個指令會依序做：型別檢查 → 打包 → chunk 循環檢查 → 部署 Hosting **與 Firestore rules**。

**rules 跟 Hosting 綁在一起部署是刻意的。** 之前手動分開部署過，結果程式碼上線了但
`settlements` 的規則沒跟上，畫面出現看不出原因的 permission denied，花了不少時間才找到。
綁在一起就不會有「哪一邊比較新」的問題。

網址會是 `https://splitflow-e39c0.web.app`。這個網域預設就在 Firebase Authentication 的
Authorized domains 清單裡，不用另外加。

`/join/:code` 這種路徑能直接開啟，是靠 `firebase.json` 的 rewrites 把所有路徑導到
`index.html`。純靜態的 GitHub Pages 沒有這個能力，邀請連結會 404。

### 快取設定

`firebase.json` 的 headers 讓 `/assets/**` 永久快取（檔名帶 hash，內容變檔名就變），
`index.html` 則是 `no-cache`。少了這組設定，`manualChunks` 拆分出來的快取效益拿不到，
而且部署後使用者可能還會拿到舊版的 index。

## 效能量測

使用者回報「手機上進『我的任務』會卡」。卡在哪一段用猜的沒有意義，所以那一頁
（含進入它的那次導航）會量下面這幾段，每次進頁面寫一筆到 `perf` 集合：

| 分段 | 量的是什麼 | 慢的話代表 |
| --- | --- | --- |
| `auth` | 等 Firebase 從 IndexedDB 還原登入狀態 | 幾乎只有冷啟動會有值 |
| `profile` | 讀 `users/{uid}` | 第一次才會有值，之後 store 有快取 |
| `chunk` | 下載並解析 `TaskListPage` 的 JS | 打包的問題，不是查詢的問題 |
| `mount` | Vue 建版面 | 跟網路無關 |
| `query` | `listUserTasks` 那一趟 Firestore | 網路或資料量 |
| `render` | 清單真的長到 DOM 上 | 任務太多 |

另外還存 `sinceStart`（開始量測之前就花掉的時間：HTML + JS bundle + firebase
初始化）與 `boot.ttfb` / `boot.dom`。**冷啟動時使用者感受到的慢有可能整段都在
這裡，而上面六個分段一個都不會顯示異常** —— 所以這兩個數字要一起看。

情境值：`detail.cold`（冷啟動還是站內導航）、`detail.fromCache`（查詢是命中離線
快取還是真的連了伺服器）、`detail.taskCount`、`network.effectiveType`、`installed`、
`version`、`mode`。同樣是 900ms，命中快取代表慢在我們自己的程式碼，連伺服器才
代表慢在網路 —— 少了這個布林值，那一筆讀不出結論。

按「計算我的花費」另外記一筆 `page: "tasks-costs"`，因為那是「任務數 × 2 趟查詢」
的扇出，混進列表的數字裡會讓列表本身看不出乾不乾淨。

量測本身不能拖慢被量的頁面：不 await、排在 `requestIdleCallback`、失敗就算了
（只記第一次到錯誤清單）。一次開啟最多 30 筆，取樣率在 `services/perfService.ts`
的 `SAMPLE_RATE`，人變多的時候調小。

`perf` 誰都讀不到（規則寫死 `read: if false`），也不能改不能刪 —— 裡面有 uid 與
userAgent，而且被事後動過的量測資料沒有價值。要看的人是開發者，走 Admin SDK：

```bash
node scripts/perf-report.mjs --key <service-account.json> --days 7
node scripts/perf-report.mjs --key <service-account.json> --page tasks-costs
```

它印的是分布（p50 / p95 / 最慢）而不是平均 —— 一筆 3 秒可能只是那個人在電梯裡，
要看的是「p50 跟 p95 差多少」（差很多 = 只有某些情境慢）、最慢的是哪一段、
以及冷啟動與站內導航的落差。預設只看 `mode=prod`：dev 跑在筆電上而且 vite 不打包。

### 卡住就重連

量測的結論：進「我的任務」有 44% 的機率卡 **30 秒**，而且卡的時候一定是 30 秒
（29.6 / 30.08 / 30.15 / 30.17，四筆聚在 0.5 秒內），健康時同一個查詢是 49～99ms。
那是逾時的形狀，不是慢的形狀。

原因不是快取 —— 換成 `memoryLocalCache` 實測過，照樣中。是 PWA 從背景回來之後
Firestore 的連線已經死了但**沒有報錯**，SDK 以為自己還在線上，於是等一個永遠不會
來的回應。而 `getDocs` 內部是「開一個暫時的監聽器等伺服器同步」，它帶著
`waitForSyncWhenOnline: true`，只要 SDK 認為在線上就壓著本機快取不發：

```js
if (this.options.waitForSyncWhenOnline && maybeOnline) {
    return false;   // 有答案也不給
}
```

所以那 30 秒是**偵測成本**（發現自己該重連），不是重連成本。判斷「死了」的唯一
方法就是等，SDK 等 30 秒，我們等 2.5 秒：

- `utils/stallGuard.ts` —— 純函式，只管「多久算卡住」
- `services/networkRecovery.ts` —— 卡住時 `disableNetwork()` + `enableNetwork()`

`disableNetwork()` 會把線上狀態設成 Offline，SDK 自己的註解是
`// Set the OnlineState to Offline so get()s return from cache, etc.` ——
所以一個動作同時做了兩件事：卡住的讀取立刻從快取回來（畫面有東西了），連線也重建。

門檻選 2.5 秒是因為健康時是 49～99ms（25 倍餘裕，慢網路不會誤判），而所有失敗
樣本都落在 30 秒那一群，中間完全沒有樣本。補救是全域的（整個 app 的 Firestore
一起切離線再接回來），所以只在真的卡住時才跑，而且同一時間只跑一輪。

驗收看報告的「卡住補救 × query」與觸發率。

## 測試

單元測試（vitest，不需要任何外部服務）：

```bash
npm test
```

`tests/stallGuard.test.ts` 釘住卡住補救的行為：正常回來不驚動任何人、超過門檻叫一次、
補救之後交出去的仍是原本那個讀取的結果而不是替代品、錯誤原樣往外丟。

`tests/currency.test.ts` 與 `tests/settlement.test.ts` 蓋掉金額解析與格式化、`allocate`
的餘數分配、幣別換算、均分與自訂分攤的結算、多幣別合併，以及「每種情境 balance 加總都是 0」
「轉帳金額加總等於應付總額」這兩個不變條件（含已付款折抵後的情境）。

Rules 測試（Firestore emulator，實際跑過每一條權限）：

```bash
npm run test:rules
```

涵蓋角色升降、移除成員、被移除後的讀取權限、重新加入、支出的建立與編輯權限、
舊格式支出的相容性、付款記錄與確認、邀請連結停用，以及效能樣本只能建立、
誰都讀不到、寫進去就不能改。
需要 Java：`winget install Microsoft.OpenJDK.21`。

## Firebase Console 需手動設定

- Authentication 啟用 Google provider。
- Authentication 的 Authorized domains 加入 `localhost` 與正式部署網域。
- 建立 Firestore Database。
- Firestore → TTL，對 `perf` 集合的 `expiresAt` 欄位建 TTL 政策。沒設的話效能樣本
  會一直累積；程式已經在每一筆寫了 30 天後的 `expiresAt`，只差這個開關。
- 若要部署 Hosting，建立專案並確認 `.firebaserc` 指到正確 project。

### 登入供應商

登入頁顯示哪些供應商由 `src/utils/authError.ts` 的 `ENABLED_PROVIDERS` 決定。

| 供應商 | 狀態 | Firebase Console 以外還需要 |
|---|---|---|
| Google | 啟用中 | 不用，開啟即可 |
| Facebook | **關閉** | Meta 要求 App 上線前連結商業檔案、填隱私政策與資料刪除網址 |
| Apple | **關閉** | Apple Developer Program（年費 US$99）才建得出 Services ID 與私密金鑰 |

Facebook 是評估後拿掉的：Meta 從 2023 年起要求 App 必須連結商業檔案才能切到上線，
還要通過隱私政策與資料使用審查。對一個朋友之間用的分帳工具來說，這些流程的成本
遠大於「多一種登入方式」的價值，而 Google 登入完全沒有這類關卡。

兩者的程式碼路徑都留著（`buildProvider` 的 apple 與 facebook 分支），
之後要開哪個就把名字加回 `ENABLED_PROVIDERS`，其餘不用改。

沒啟用的供應商按下去會顯示「還沒有在 Firebase Console 啟用」，不會是看不懂的錯誤碼。

**同一個 email 用不同供應商登入會是兩個不同的帳號**，Firebase 預設一個 email 對一個帳號，
第二種方式登入時會擋下來。程式碼會抓 `auth/account-exists-with-different-credential`
並告訴使用者原本是用哪個供應商註冊的（若專案開了 Email enumeration protection，
`fetchSignInMethodsForEmail` 會回空陣列，這時只給通用訊息，不亂猜）。
個人設定頁也會顯示目前的登入方式。

之後要開 Apple 時記得兩件事：使用者可以選「隱藏我的電子郵件」，這時拿到的是 privaterelay
轉寄信箱；另外 Apple **只在第一次授權時回傳姓名**，之後登入都拿不到。暱稱本來就是在
onboarding 讓使用者自己填，所以不受影響。

## 第一版已完成

- Google 登入與登出（Apple 與 Facebook 的程式碼備妥，需要時開啟即可）。
- Router guard 等待 Firebase 初始化後判斷登入狀態。
- 第一次登入建立暱稱並寫入 Firestore。
- 個人設定頁可查看 email、修改暱稱、登出。
- 建立分帳任務並建立 owner member。
- 建立不可輕易猜測的 inviteCode 與 invite 文件。
- 任務列表從 Firestore 讀取，不依賴 localStorage。
- 邀請連結 `/join/:inviteCode` 可預覽、登入、建立暱稱後加入。
- 加入任務使用 Firestore transaction，重複開啟不會重複增加成員。
- 任務內頁包含支出、成員、結算三頁籤。
- 成員頁籤讀取 Firestore 真實成員。
- owner/admin 與 member 看到的介面不同。
- 無權限 taskId 會顯示無權限/Firestore 錯誤狀態。
- 新增、編輯、刪除支出，含分類、幣別、誰先付、分攤成員。
- 支出頁籤讀取 Firestore 真實支出。
- 結算頁籤從真實支出算出每人應收應付與最少轉帳筆數。
- owner/admin 可升降成員角色、移除一般成員。
- 記帳當下抓即時匯率，外幣支出換算成主要幣別後合併結算。
- 自訂金額分攤，每人可以填不同金額。
- 記錄已付款並由收款人確認，已確認的付款會折抵結算餘額。
- 支出可以用 Google Places autocomplete 標地點，存名稱、地址與座標。
- 支出表單的地圖預覽，以及支出頁籤的「清單 / 地圖」總覽切換。
- 結算紀錄：把某個時間點的結算存成不可修改的歷史快照。

## 下一階段 TODO

- Google Places nearby，依目前定位列出附近地點。
- 桌面版專用介面。

## 兩個帳號驗收

帳號 A：

1. 開啟網站並 Google 登入。
2. 第一次登入建立暱稱。
3. 建立分帳任務。
4. 確認 Firestore 有 task、owner member、invite。
5. 複製邀請連結並進入任務頁。
6. 應看到 owner/admin 管理區與邀請按鈕。

帳號 B：

1. 無痕視窗開啟邀請連結。
2. 看到邀請預覽。
3. 用另一個 Google 帳號登入。
4. 第一次登入建立暱稱。
5. 按加入任務。
6. 確認 Firestore 出現第二位 member，task.memberCount +1。
7. 帳號 B 可看到任務與成員，但看不到 owner/admin 管理區。
