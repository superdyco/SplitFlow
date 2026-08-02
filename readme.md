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
| `VITE_GOOGLE_MAPS_API_KEY` | Maps JavaScript API，地圖顯示 | 不顯示地圖，其餘不受影響 |

只設 `VITE_GOOGLE_MAPS_API_KEY` 一把也能動，地點搜尋會沿用它。

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
Authorized domains 清單裡，不用另外加。Facebook 的 OAuth redirect URI 指向的是
`firebaseapp.com` 的 auth handler，也不需要改。

`/join/:code` 這種路徑能直接開啟，是靠 `firebase.json` 的 rewrites 把所有路徑導到
`index.html`。純靜態的 GitHub Pages 沒有這個能力，邀請連結會 404。

### 快取設定

`firebase.json` 的 headers 讓 `/assets/**` 永久快取（檔名帶 hash，內容變檔名就變），
`index.html` 則是 `no-cache`。少了這組設定，`manualChunks` 拆分出來的快取效益拿不到，
而且部署後使用者可能還會拿到舊版的 index。

## 測試

單元測試（vitest，不需要任何外部服務）：

```bash
npm test
```

`tests/currency.test.ts` 與 `tests/settlement.test.ts` 蓋掉金額解析與格式化、`allocate`
的餘數分配、幣別換算、均分與自訂分攤的結算、多幣別合併，以及「每種情境 balance 加總都是 0」
「轉帳金額加總等於應付總額」這兩個不變條件（含已付款折抵後的情境）。

Rules 測試（Firestore emulator，實際跑過每一條權限）：

```bash
npm run test:rules
```

涵蓋角色升降、移除成員、被移除後的讀取權限、重新加入、支出的建立與編輯權限、
舊格式支出的相容性、付款記錄與確認、邀請連結停用。
需要 Java：`winget install Microsoft.OpenJDK.21`。

## Firebase Console 需手動設定

- Authentication 啟用 Google 與 Facebook provider。
- Authentication 的 Authorized domains 加入 `localhost` 與正式部署網域。
- 建立 Firestore Database。
- 若要部署 Hosting，建立專案並確認 `.firebaserc` 指到正確 project。

### 登入供應商

登入頁顯示哪些供應商由 `src/utils/authError.ts` 的 `ENABLED_PROVIDERS` 決定。

| 供應商 | 狀態 | Firebase Console 以外還需要 |
|---|---|---|
| Google | 啟用中 | 不用，開啟即可 |
| Facebook | 啟用中 | Meta for Developers 建 App，把 App ID 與密鑰填回 Console，並把 Firebase 的 OAuth redirect URI 填進 Facebook 的 Valid OAuth Redirect URIs |
| Apple | **關閉** | Apple Developer Program（年費 US$99）才建得出 Services ID 與私密金鑰 |

Apple 的程式碼路徑留著（`buildProvider` 的 apple 分支），之後有付費帳號時把 `"apple"`
加回 `ENABLED_PROVIDERS` 就會出現在登入頁，其餘不用改。

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

- Google 與 Facebook 登入與登出（Apple 的程式碼備妥，等付費開發者帳號）。
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
