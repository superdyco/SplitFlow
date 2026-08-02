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

- owner/admin 可重新複製邀請連結。
- owner/admin 可停用 invite，也可以重新產生新連結（舊連結立刻失效）。
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

## 之後階段功能

- Google Places nearby，依目前定位列出附近地點，需要瀏覽器定位權限。
- Facebook 登入（需先建 Facebook App）。
- 桌面版專用介面。

## Firebase / 部署

- 部署 Hosting：`npm run build` 後 `firebase deploy --only hosting`。
- Firebase Authentication Authorized domains 加入正式網域。
- **`.env` 與 `.env.example` 目前都被 git 追蹤，且 `.env.example` 存的是真實值。**
  `.gitignore` 裡雖然有 `.env`，但檔案先被 commit 了所以沒生效。
  要 `git rm --cached .env` 才會真正停止追蹤，歷史紀錄裡的值仍需視為已公開。
- Google Maps key 一定要設 HTTP referrer 限制，它沒有 Firestore rules 那種第二道防線。
- 評估把 Firebase config 改回只透過部署環境變數管理。

## 已完成：bundle 拆分

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
