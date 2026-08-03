# SplitFlow TODO

## 已完成：支出功能

- 新增支出頁 `/tasks/:taskId/expenses/new`。
- 編輯支出頁 `/tasks/:taskId/expenses/:expenseId/edit`。
- 支出資料寫入 `tasks/{taskId}/expenses/{expenseId}`。
- 支出欄位：title、category、amount、currency、paidBy、splitMemberIds、createdBy、createdAt、updatedAt。
- amount 存幣別最小單位整數，避免浮點誤差。
- category 固定六類：food、transport、stay、ticket、shopping、other。
- 任務內「支出」頁籤讀取 Firestore 真實支出資料。
- 一般成員只能新增、修改、刪除自己建立或自己先付的支出。
- owner/admin 可以修改所有支出。
- 更新 task 的 `expenseCount`（writeBatch + increment）。
- 補 Firestore rules 限制 expenses 權限。

## 已完成：結算功能

- 簡單均分結算，餘數依成員順序分配，分攤總和一定等於原金額。
- 結算頁從真實 expenses 計算每人應收應付。
- task 的 defaultCurrency 排在最前面顯示。
- 貪婪配對算出最少轉帳筆數。
- 結算結果是即時 computed，改支出後自動以最新支出重新計算。
- 不同幣別各自結算，不合併成假數字。

## 已完成：匯率與自訂分攤

- 匯率來源 open.er-api.com，免費不需 API key，快取 12 小時。
- 匯率在記帳當下抓一次寫進支出（`rate` 與 `baseAmount`），之後結算不重抓。
- 匯率欄位可手動覆寫，填實際成交匯率，API 掛掉也還能記帳。
- 外幣支出換算成 defaultCurrency 後合併成單一結算。
- 分攤方式分 `even` 與 `custom`，自訂時每人可填不同金額，合計必須等於支出金額。
- `allocate()` 用最大餘數法分配整數，均分、自訂比例、幣別換算共用同一個函式，
  結果總和一定等於原金額。
- 舊支出讀取時就地補成新格式；外幣舊支出缺匯率會被排除在結算外並提示補上。

## 已完成：邀請與成員管理

- owner/admin 可重新複製邀請連結（標題列右上角的「邀請」按鈕）。
- ~~owner/admin 可停用 invite，也可以重新產生新連結~~
  **已移除。** 實際使用上用不到，那一整塊還把頁籤與支出擠到畫面下方。
  邀請文件現在建立後就固定，rules 的 update 與 delete 都是 `if false`。
  代價是**邀請連結永久有效，外流沒有補救手段**，以熟人小群組為前提可以接受。
- owner/admin 可將 member 升級為 admin。
- owner/admin 可將 admin 降級為 member。
- admin 不可移除 owner，也不可改 owner 的角色。
- admin 不可透過 task update 把 ownerId 換成自己。
- owner/admin 可移除一般 member；要移除 admin 要先降級。
- 移除採 soft delete：member 文件留著標成 `active: false` 並從 task.memberIds 拿掉，
  舊支出仍查得到暱稱，但 Security Rules 不再讓他讀取任務。
- 被移除的人重新用邀請連結加入時會沿用原本的 member 文件。
- 編輯舊支出時，已被移除但原本就在該筆支出裡的成員仍可保留。

## 已完成：使用者體驗

- 讀取失敗的 ErrorState 可以按「重試」，不用重整整頁。
- 無權限做成正式的 `AccessDenied` 卡片，有說明與「回我的分帳」，
  任務頁與支出表單頁共用。
- `useTask` 分開「沒有權限」與「真的出錯」：permission-denied 走無權限頁，
  網路異常走可重試的錯誤狀態，不會把斷線誤判成被踢出任務。
- Join 頁登入後會查是不是已經是成員，是的話直接顯示「進入任務」。
  被移除過的人仍走加入流程重新啟用。
- 建立任務、暱稱、個人設定都補了即時驗證：必填、長度上限、
  結束日期不能早於開始日期，不合格時送出鍵是 disabled。
- 個人設定沒有變動時不能按儲存，儲存成功會顯示「已儲存」。
- 建立任務成功頁補了「回我的分帳」入口。

任務列表本來就會刷新（`App.vue` 沒有 KeepAlive，回到 `/tasks` 會重新 mount 並重讀），
原本 todo 上那條其實已經成立。

## 使用者體驗待辦

- 手機版操作細節再貼近 prototype。
  prototype 不在這個 repo 裡，沒有可以對照的來源，需要你提供畫面或規格才能做。

## 已完成：已付款確認

- 付款寫入 `tasks/{taskId}/payments/{paymentId}`。
- 付款人可以在建議轉帳旁邊記錄已付款，金額可改成只付一部分。
- 只有收款人（或 admin）能確認收到；收款人自己記的直接算已確認。
- 只有已確認的付款會折抵結算餘額，待確認的會另外列出來並標明還沒算進去。
- 付款在計算上就是一筆「付款人先付、收款人獨自分攤」的支出，共用同一套結算邏輯。
- 付款人與收款人都可以刪掉付款紀錄，餘額會跟著變回去。

## 已完成：地點搜尋

- 支出可選填地點，存 name / address / lat / lng / placeId。
- 用 Places API (New) 的 REST 端點，不載 Maps JS SDK，bundle 幾乎沒變大。
- 輸入停 350ms 才查詢；autocomplete 與 details 共用 sessionToken，一次計費。
- 沒設 `VITE_GOOGLE_MAPS_API_KEY` 時退回純文字輸入，不會壞掉。
- 使用者可以不選建議、直接打名字，一樣存得起來。

## 已完成：地圖顯示

- Maps JavaScript API 用動態 script 載入，不進主 bundle（主 chunk 只多 0.54 kB）。
- 支出表單選完有座標的地點後顯示預覽小地圖。
- 支出頁籤加「清單 / 地圖」切換，把有座標的支出標在同一張圖並自動框住全部標記。
- Places 與 Maps 分成兩把獨立的 key，可以各自設限制、各自更換；
  只設 Maps 那把的話地點搜尋會沿用它。
- 標記目前用 `google.maps.Marker`（已 deprecated 但可用且免建 Map ID）。
  之後要換 `AdvancedMarkerElement` 需先在 Console 開一個 Map ID。

## 已完成：歷史結算版本

- 結算快照寫入 `tasks/{taskId}/settlements/{settlementId}`。
- owner/admin 可以把目前的結算存成紀錄，可加備註。
- **快照存下來不能修改**，rules 的 update 直接 `if false`，只能整份刪掉。
- `memberNames` 一起存進快照，之後改暱稱或成員被移除都不會改寫歷史紀錄。
- `matchesSnapshot()` 比對目前帳目與最新快照，不同時提示「上次結算之後帳目又變動了」。
  待確認的付款不算變動，因為它本來就還沒進餘額。
- 存快照不影響即時結算：帳目仍可隨時修改，改完就重算，快照只是多留一份當時的樣子。
- 結算型別從 `utils/settlement.ts` 移到 `types/settlement.ts`，
  即時結算與快照共用同一組 `MemberBalance` / `Transfer`。
- TaskPage 只算一次結算後傳給結算面板與結算紀錄，避免兩邊算出不同數字。

## 已完成：多供應商登入

- `signIn(provider)` 統一處理 Google / Apple / Facebook，登入頁與 Join 頁共用
  `ProviderButtons` 元件。
- 登入頁顯示哪幾個由 `ENABLED_PROVIDERS` 決定，目前只有 Google。
- **Apple 關掉**：要 Apple Developer Program（年費 US$99）才建得出 Services ID
  與私密金鑰。程式碼路徑留著，付費後把 `"apple"` 加回 `ENABLED_PROVIDERS` 即可。
- **Facebook 關掉**：見下面那一節。
- 只 disable 正在跑的那顆按鈕。之前是全部一起 disable，結果某個供應商卡住時整頁按不動。
- 錯誤訊息對應成人看得懂的話：供應商未啟用、網域未授權、彈窗被擋、憑證無效、網路失敗。
- **使用者自己關掉彈窗不再跳紅字**，用 `SignInCancelled` 區分取消與真的出錯。
- 同 email 不同供應商會被 Firebase 擋下，程式碼抓 `account-exists-with-different-credential`
  並告知原本註冊用的供應商；查不到時給通用訊息不亂猜。
- 個人設定頁顯示目前的登入方式，並提醒換供應商等於換帳號。
- 錯誤對應抽到 `utils/authError.ts`，不 import firebase，所以測得到（15 個測試）。

## 已放棄：Facebook 登入

Meta 端的設定做到一半後決定不做了。卡點是 Meta 從 2023 年起要求 App 必須
連結「商業檔案」才能從開發模式切到上線，還要通過隱私政策與資料使用審查。
對一個朋友之間用的分帳工具，這些流程的成本遠大於多一種登入方式的價值，
而 Google 登入完全沒有這些關卡。

- 程式碼路徑全部留著（`buildProvider` 的 facebook 分支、`PROVIDER_LABELS`、
  `facebook.com` 的 providerId 對應），只是從 `ENABLED_PROVIDERS` 拿掉。
  之後想開回來就是加一個字串的事。
- `facebook.com` 的對應**刻意留著**：萬一 Firebase 裡已經有人用 Facebook 註冊過，
  他們撞到「同 email 不同供應商」時才會看到正確的供應商名稱。
- 順帶產出的資產留著沒刪：`public/privacy.html` 是實際可用的隱私政策頁，
  `brand/meta-app-icon-1024.png` 與 `public/` 底下的圖示都跟 Meta 無關，照常在用。
- **收尾已完成**：Firebase Console 的 Facebook provider 已停用（App Secret 一併移除），
  Meta for Developers 上的 App 已刪除。順序是先停 Firebase 再刪 Meta App，
  反過來的話 Firebase 會停在「啟用中但設定已失效」的狀態。
  商業檔案與 passkey 的提醒也跟著消失了。
- 這件事的嚴重性一直不高：App Secret 存在 Firebase 後端不會外流到前端，
  跟 `.env` 那兩把 key 的性質不同。真正處理掉的是「Facebook 這條登入路徑
  技術上仍然通」—— 之前就算 UI 沒有按鈕，手動呼叫 `signInWithPopup` 仍建得了帳號。

## 已完成：PWA（離線持久化與 manifest）

- **離線持久化已做**：`persistentLocalCache` + `persistentMultipleTabManager`。
  斷線時已載入的資料照樣看得到，新增與修改會排隊等連線。
  代價是 firebase chunk 從 450 kB 漲到 545 kB。
- **manifest 已做**：`display: standalone`、192／512／maskable 三張圖示，
  加上 iOS 專用的 `apple-mobile-web-app-*` meta（iOS 幾乎不看 manifest）。
  **但實測後確認：在 iPhone 上幾乎感受不到差別。** 因為 `apple-touch-icon`
  本來就有，圖示早就正確；manifest 只多了名稱（SplitFlow → 分帳小夥伴）
  與啟動底色。真正的差異在 Android —— 變成 WebAPK、進應用程式抽屜、
  maskable 圖示不會被形狀裁壞。
  另外「加到主畫面」本身跟 PWA 無關，任何網站一直都能加。
- **service worker 刻意不做。** 它才能讓「完全沒網路時打開 App」成立，
  但更新策略做錯會讓使用者卡在舊版本，比 index.html 那個一小時快取嚴重得多
  ——後者會自己過去，SW 卡住的舊版不清資料就不會更新。
  等確認「完全離線開啟」是真需求再說。
- 因此目前的能力是「網路爛不會壞」，不是「沒網路也能用」。

## 待補：支出 date 欄位的 rules 驗證

`date` 目前沒有寫進 `validExpenseShape()`，其他每個欄位都有驗，只有它沒有。
不影響運作 —— rules 是逐欄位驗證不是 `hasOnly()` 白名單，所以新欄位本來就寫得進去。

沒有一起改是因為**這台機器跑不了 rules 測試**：firebase-tools 要 JDK 21，
目前裝的是 11（`winget install Microsoft.OpenJDK.21`）。加一條沒驗證過的規則
萬一寫錯，線上所有支出都會存不進去，比少驗一個欄位嚴重得多。

裝好 JDK 21、`npm run test:rules` 能跑之後，補進 `validExpenseShape()`：

```
&& data.date is string
&& data.date.matches('^\\d{4}-\\d{2}-\\d{2}$')
```

補之前要先確認：表單一律會送 date（`date.value || todayInput()`），
所以編輯舊支出也不會少這個欄位。

## 之後階段功能

- 桌面版專用介面。

## 已放棄：Places nearby

依目前定位列出附近地點，評估後不做，理由是計費。

- `searchNearby` 跟現在的 Autocomplete 是同一個 API、同一把金鑰，Cloud Console
  不用多設什麼，所以擋下它的不是設定成本。
- 但 **nearby 沒有 session token 折扣**。Autocomplete 與 Details 靠共用 token
  算成一次計費，nearby 是獨立 SKU，每次請求就是一次錢，單價也比較高。
- 而且它的使用模式很容易失控：頁面一開就自動搜尋、或跟著地圖移動連發，
  請求數會長得很快，光是開發時反覆測試就會燒掉不少。
- 維持現況：使用者自己輸入關鍵字，`autocompletePlaces` 帶 350ms debounce。

## Firebase / 部署

- 部署設定已備妥：`.firebaserc`、`firebase.json` 的 rewrites 與快取 headers、
  `npm run deploy`（build + Hosting + rules 一起）。剩下只要 `npx firebase login` 再跑一次。
- Hosting 走 Firebase 而不是 GitHub Pages：後者是純靜態伺服器，沒有 rewrite，
  `/join/:code` 邀請連結會 404，還要處理 base path 與 `buildInviteUrl` 的子路徑問題。
- 兩把 Google API key 的 HTTP referrer 限制已設定（正式網域、`firebaseapp.com`、
  本機 5173／4173）。referrer header 可以偽造，配額上限與預算警示還沒設。
- `.env` 已 `git rm --cached` 停止追蹤，`.env.example` 的真實值換成佔位字串。
  **但兩把 Google key 仍留在 `ed28be9`、`b702a22` 的歷史紀錄裡，而 repo 是 public，
  所以它們必須視為已外洩，得在 Cloud Console 換新的再刪掉舊的。**
- Google Maps／Places key 沒有 Firestore rules 那種第二道防線，它們是用量計費的，
  被撿去用直接算帳單，所以配額上限比 referrer 限制更重要。
- 評估把 Firebase config 改回只透過部署環境變數管理。

## 已完成：bundle 拆分

- **離線快取讓 firebase chunk 從 450 kB 漲到 545 kB（gzip 105 → 128 kB），
  500 kB 的警告因此回來了。** IndexedDB 持久化那層本身就是不少程式碼。
  要壓下去得把 firestore 的持久化拆成動態載入，但那會牽動初始化時序，
  先接受這個體積。
- `manualChunks` 把 556 kB 的單一 chunk 拆成 firebase 448 kB、vendor-vue 96 kB、
  vendor 3 kB、entry 8.4 kB。500 kB 警告消失。
- 效益是快取粒度與平行下載：改自己的程式碼只會讓 8.4 kB 的 entry 失效。
- **總下載量沒有變少**，vendor chunk 都在 entry 的 modulepreload 清單裡。
- 第一版把 firebase 依 firestore / auth / core 三分，造成循環相依，
  正式站噴 `Cannot access 'li' before initialization`。原因是 umbrella 的
  `firebase/auth` 只是 re-export，實作在 `@firebase/auth`，被分到了不同 chunk。
  Firebase 現在整包放同一個 chunk。
- `scripts/check-chunks.mjs` 在每次 build 最後檢查 chunk 循環相依，防止重蹈覆轍。
  這種錯誤 build 不會報、dev server 也正常，只有正式站會壞。

## 技術整理

- 首次載入量還是 ~557 kB。要真的變少得把 firestore 移出 eager 圖：
  `firebase/config.ts` 的 `db` 要延後建立，router 的 `getTaskMember` 與
  `stores/user` 的 service import 要改成動態 import。
  但只有「未登入且停在 /login」的情況省得到，登入後或走 /join 都還是要載 firestore，
  效益有限，先不做。
- 補 ESLint / Prettier。
- 補 Firestore indexes 文件。
