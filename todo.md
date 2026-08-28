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

## 已完成：支出收據照片

一筆支出可以附一張收據照片當對帳憑證。純憑證用途，沒有 OCR。
規格與計畫在 `docs/superpowers/specs/` 與 `docs/superpowers/plans/`（2026-08-04）。

- 照片壓縮到長邊 1600px、JPEG 0.8（約 200–400KB）後存進 IndexedDB 佇列，
  支出文件先標成待上傳，有網路時背景補傳，成功後回頭改寫 `receipt` 欄位。
  **這是為了「在餐廳沒訊號時拍的收據」**：Firestore 的寫入會排隊，Storage 的上傳不會。
- 順手修掉一個既有問題：`await batch.commit()` 要等伺服器確認才 resolve，
  離線時新增／編輯／刪除支出都會卡在「儲存中...」。改用 `settleWrite` 等 2.5 秒就放行。
- `firebase/storage` 拆成獨立 chunk，首屏的 firebase chunk 從 gzip 139.96 降到 128.70 kB。

**實作後修掉的四個問題**（都是第一版做完才發現的，記下來免得重蹈）：

- **競態**：`queueReceipt` 原本入列後就 `void flushReceipts()`，線上時會搶在表單
  自己那次 `updateDoc` 之前完成，把文件寫成已上傳、再被蓋回待上傳，而佇列已空。
  改成呼叫端在文件寫完後才觸發 flush。
- **`unsaved` 狀態缺失**：使用者以為選了照片就上傳了。上傳延到按送出才做是對的
  （新增模式要先有 `expenseId`），但選完就顯示縮圖、看起來跟存好一樣。
  現在有「未儲存」標籤，並寫出要按哪顆按鈕。
- **`failed` 狀態算不出來**：型別裡有、卻沒有任何分支回傳它，導致上傳失敗五次
  之後畫面還顯示「待上傳」，而重試鈕只在 `failed` 時渲染 —— 使用者永久卡死。
- **錯誤全部靜默**：`useReceipt.error` 沒有被渲染在任何地方；背景上傳的失敗也沒有
  log。一個靜默失敗的背景上傳器等於無法除錯，這正是當初查不出問題的原因。
  現在失敗會帶 error code 進 console。
- **`uploading` 與 `pending` 混在一起**：使用者明明有網路、照片正在傳，卻看到
  「連上網路後會自動傳出去」，會以為壞了。兩者的文案意思相反，必須分開。
- **傳完畫面不會自己更新**：背景 flush 改了 Firestore，但 App 讀支出用的是一次性的
  `getDocs` 不是 `onSnapshot`，所以沒人通知畫面，使用者得手動重整。
  `receiptService` 現在會發上傳事件，`useReceipt` 訂閱後就地更新。

**已知取捨（都是有意識的決定，不是疏漏）：**

- **Storage 規則擋不住非成員。** Storage rules 無法查詢 Firestore，所以寫不出
  「只有這個任務的成員能看」。防線是路徑裡兩段 20 字元的隨機 ID —— 要拿到 ID
  得先通過 Firestore 的成員檢查。要做到嚴格得上 Cloud Functions 發簽名 URL。
- **可能留下孤兒檔案。** 刪支出時盡力刪 Storage，失敗（離線、權限）就留著。
  要保證清乾淨一樣得上 Cloud Functions，換來的只是幾 KB 額度。
- **佇列不跨裝置。** 換手機的話那筆會一直顯示「待上傳」，使用者可以直接移除收據解決。

## 已完成：任務封存與刪除

只有 owner 能操作，兩者都要確認。規格與計畫在 `docs/superpowers/`（2026-08-04）。

- **封存**：任務變唯讀，資料留著可查，隨時可解除。`TaskStatus` 從只有一個值的聯集
  擴成 `active | archived | deleted`。
- **刪除**：軟刪除。**Firestore 沒有 cascade delete** —— 真刪掉任務文件會讓底下四個
  子集合變成永遠的孤兒，所以只把 status 改掉、前端濾除。介面上不做復原。
- **分級摩擦**：刪除沒有支出的任務按一次確認即可；有支出的要輸入任務名稱，
  訊息會講出實際的成員數與支出數。摩擦力跟後果成正比，而不是均勻灑。
- **封存的卡片沒有刪除鈕**：兩個動作的後果差太多 —— 封存是收起來、隨時能拿回，
  刪除不可逆。並排放在一張已經不常看的卡上就是在等人按錯。要刪先解除封存。
  規則層仍允許 owner 從任一狀態改成 `deleted`，這條是介面的順序，不是權限。
- 順手修掉 TaskCard 直接把英文 `active`、`owner` 印給使用者看的問題
  （`ROLE_LABELS` 早就存在，只是沒被用）。

**唯讀必須在規則層強制，不是藏按鈕。** `taskIsActive()` 掛在 expenses / payments /
settlements 的寫入上，read 不掛（封存的重點就是留著查）。另外 `updatesTaskAsAdmin`
本來就讓任何 admin 改任務欄位（含 status），不堵掉那個後門，「只有 owner」就是假的。

**一個容易踩的坑**：`members` 的 create 不能用 `taskIsActive()`。建立任務時任務文件與
owner 的成員文件在同一個 batch，`get()` 那當下讀不到任務，會把建立任務整個擋掉。
要用 `taskAfterData()`（`getAfter()`），既有規則早就是這樣寫的。

**⚠️ 規則從未在本機驗證過**：14 個新測試案例寫好了，但 emulator 需要 JDK 21，
本機是 Java 11，而公司網路連不到 winget 的來源。見下面的 CI 待辦。

## 已完成：公開旅費報告

已封存的任務可產生一份公開連結，**讓沒去的人知道這樣玩一趟大概要花多少錢**。
規格與計畫在 `docs/superpowers/`（2026-08-04）。

這個定位決定了所有取捨：主角是每人平均花費，地點與金額的對應是重點，
而「誰欠誰」完全不重要。

- **報告是快照文件**（`tasks/{taskId}/reports/{reportId}`），公開讀取的只有它。
  絕不能讓公開頁面讀即時資料 —— 那等於把整個權限模型打開。
- **裡面沒有任何 uid、成員暱稱、支出名稱、誰欠誰。** owner 是單方面替全隊決定公開，
  所以任何可識別的東西都不放。
- **只有 owner 能產生與撤銷**，撤銷是 `active: false`，未登入者立刻讀不到。
- **一個任務一份報告，重新產生沿用同一個 id** —— 每次產生新 id 的話，
  已經傳出去的網址會全部變成死連結。

**地圖是產生當下拍的一張靜態 PNG，不是在公開頁載 SDK。** 理由是計費與金鑰：
公開頁載 SDK 的話每次有人開啟都算一次 API 呼叫（連結被轉傳＝帳單失控，擋不住），
而且金鑰會出現在一個設計上就是要到處轉傳的頁面裡。拍成圖之後永遠是 0 次呼叫，
公開頁完全不帶金鑰。代價是不能縮放拖曳。

**⚠️ 這是整個專案唯一開放公開讀取的地方**（Firestore 的報告文件 + Storage 的地圖）。
防線是網址裡兩段各 20 字元的隨機 ID。規則測試已寫好但待手動驗證。

### 改版與地圖載入優化（2026-08-05）

規格與計畫在 `docs/superpowers/`（2026-08-05）。

- **版面重排**：三個區塊本來視覺等重，等於沒有主角。現在「每人平均」放大到 46px、
  淡橘底獨立成 hero，其餘讀起來是輔助。地圖移到「去過的地方」旁邊 ——
  兩者講同一件事，而且排在下面剛好多爭取幾百毫秒的載入時間。
- **分類與地點加長條**。`share` 早就算好了卻只印數字，那是頁面上唯一一個
  讀者無法自己想像的數字。地點列表上限 8 個。
- **地圖不再走 `getDownloadURL()`。** 地圖物件是公開讀取，網址可以直接組
  （`src/services/reportMap.ts`），省掉一次 `firebase/storage` 的 chunk 下載
  與一次 API 往返，三段串行變兩段。載入期間用 8:5 骨架佔位，圖載完淡入 ——
  本來圖沒好之前那塊不存在，好了才把下面的內容整塊推走。
- **「開啟」在裝成 App 時走站內導航，不開新分頁。** standalone 沒有分頁列也沒有
  上一頁，`target="_blank"` 開出來的報告頁是一條死路 —— 只剩頁尾那行 SplitFlow
  能回首頁。改成 RouterLink 後在瀏覽器裡照舊開新分頁（`target="_blank"` 時
  vue-router 會整個放手），裝起來則留下 history，報告頁自己給一顆返回。
  返回鍵看 `history.state.back`，整頁載入進來是 null，所以訪客不會看到它。
- **`reportMapPath` 搬進 `reportMap.ts`，`staticMap.ts` 不留 re-export。**
  `staticMap.ts` 有 `VITE_GOOGLE_MAPS_API_KEY`，Vite 會在 build 時字面內嵌進 chunk，
  公開頁碰不得。留 re-export 的話這條界線就只是口頭約定。
  已驗證：報告頁的 10 個相依 chunk 沒有一個帶金鑰，也沒有 firebase-storage。
- **分享區加「開啟」**，但**只在連結開著時才渲染**。規則是
  `active == true || isTaskMember(taskId)`，owner 是成員，所以連結關掉後
  owner 自己還是讀得到 —— 這時給按鈕，他會看到正常頁面、以為連結還通著。
- 補上 `updatedAt` 的顯示。型別註解從功能上線就寫著「報告上顯示這個」，
  但從來沒有任何地方渲染它。

### 行程時間軸（2026-08-15）

支出加了時間欄位之後，報告才有辦法講「怎麼過的」，而不只是「花了多少」。

- **時間軸只放時間、分類、地點、金額，沒有支出名稱。** 這是刻意的取捨：
  分類與地點本來就已經公開在「花在哪」與「去過的地方」，時間軸只是把它們
  按當天的順序重排一次；名稱是自己人才看得懂的東西（「阿明的點心」），
  不該跟著連結傳出去。`tests/reportTimeline.test.ts` 有一條測試直接比對
  entry 的欄位名單，多一個欄位就會紅。
- 一天之內：有記時間的照時間由早到晚，**沒記時間的排在最後**，不塞中間 ——
  那等於幫使用者猜它發生在哪兩筆之間，猜錯了讀者也看不出來。
- 金額一樣走 `baseAmountOf`，跟 tripSummary / categoryTotals / placeTotals
  同一套規則。缺匯率的四邊都排除，否則每日小計加起來不等於總額。
- 「第幾天」與旅程天數共用 `daysBetween`，兩邊各寫一份日期數學遲早會對不起來。
  支出早於任務起始日（提前買的機票）就改用那天當原點，不會出現 Day 0。
- **有支出就列，不要求一定有時間**，但整份都沒時間時把時間欄整欄收掉。
  第一版是「沒時間就整區不渲染」，馬上發現那讓時間欄位之前的旅程永遠看不到
  這一區 —— 而封存的任務唯讀（`taskIsActive`），那些支出連補時間都補不了。
  沒有時間的日子照樣看得出「這天去了哪、花了多少」。
- 舊報告沒有 `timeline` 欄位，`reportService` 讀取時補成空陣列，
  比照 `normalizeExpense` 對舊支出的做法。重新產生一次就會真的補上。

## 已完成：支出備註

支出可以加一段最多 500 字的自由文字，記下塞不進支出名稱的來龍去脈
（「含小費」「阿明先付現金」「發票在小美那」）。規格與計畫在 `docs/superpowers/`（2026-08-04）。

- `note: string`，**空字串代表沒有**，不是 `string | null`。`place` 與 `receipt` 是物件才
  需要 null；純字串的空值就是空字串，模板也不用寫 `note ?? ""`。
- 長度靠 `maxlength="500"` 擋在輸入端 —— **根本產不出不合法的值**，所以不需要錯誤訊息。
  規則的 `validNote()` 是防繞過前端的第二道。
- **列表就要顯示**（一行截斷）。備註是對帳當下想看到的資訊，要點進去才看得到的話
  等於每筆都得點一次，備註就失去意義了。
- **「再記一筆」不帶備註**：那是這一次的狀況，下次不一定成立，跟金額與日期同一類。
  帶過去的話使用者容易忘記刪掉，留一句對新支出不成立的說明比沒有更糟。
  `repeatExpense.test.ts` 有一條測試把這個決定釘住。
- **不進公開旅費報告**：報告已經不放支出名稱，備註比支出名稱更私密（會直接點名）。

## 已完成：診斷資訊與錯誤記錄

**使用者說「它壞了」的時候，手上要有東西可看。** 在這之前全 app 只有一行
`console.error`，沒有版本號，也沒有掛任何全域錯誤處理 —— 而手機上打不開 console。

- **版本戳**：`vite.config.js` 的 `define` 內嵌 `__APP_VERSION__`（commit 短碼 +
  建置時間，用本機時區）。這件事在這個專案特別重要：index.html 有一小時快取而且
  刻意不做 service worker，所以「他在跑舊版」是真的會發生、而且從外面看不出來。
  沒有 git 的環境寫 `unknown`，不能讓 build 掛掉。
- **錯誤清單**：`utils/debugLog.ts`，最多 50 筆，**只在記憶體裡**。寫進 localStorage
  要處理配額與清除，而要查的錯誤幾乎都是「剛剛那一下」，重整後本來就重現不了。
  連續重複的同一個錯誤併成一筆記次數 —— 重試迴圈會在幾秒內灌滿 50 格，
  把最舊、也最接近起因的那幾筆擠掉。
- **收在 `firebaseErrorMessage` 裡**。一個格式化函式帶副作用不漂亮，但那是全 app
  唯一收得齊的位置（四十幾個呼叫點）；改成每個 catch 各自呼叫，漏掉的那幾個
  就是之後查不到的那幾個。附帶的好處是使用者看到的訊息與清單裡的那筆一定對得起來。
- **`main.ts` 掛上三個全域入口**（Vue errorHandler、`error`、`unhandledrejection`），
  只寫進清單不彈 UI —— 這裡抓到的照定義就是沒人接住的錯誤，對使用者說不出有用的話。
  覆寫 Vue 的 handler 會連 console 輸出一起蓋掉，所以自己補一次 `console.error`。
- **個人設定頁最下面的診斷資訊**，預設收起，展開才讀 IndexedDB 的收據佇列。
  欄位都對應到真的發生過的故障：卡在待上傳（連失敗次數一起講，0 次是還沒輪到、
  多次是一直傳不上去）、跑的是舊版、金鑰沒設所以地點搜尋悄悄退回純文字輸入。
  **只講金鑰有沒有設定，絕不印出金鑰本身。**
- 排版在 `utils/diagnostics.ts`，純函式所以測得動（比照 `settlementText.ts`）。

**沒有做遠端錯誤回報（Sentry 之類）。** 會在首屏多一個第三方 SDK，而這個 app 的
資料是朋友的消費紀錄，PII 要另外處理。使用者少到「請他按一下複製貼給你」不會比較慢。
等使用者不再是認識的人再說。

**已知缺口**：`firebaseErrorMessage` 目前把 Firebase 的原始英文訊息直接顯示給使用者
（`authError.ts` 對登入錯誤有完整中文對應，Firestore 這條沒有）。該修，但修好之後
畫面上就看不到 code 了 —— 所以錯誤清單要先有，順序是對的。

## 已完成：虛擬成員（沒有帳號的人）

長輩這類連 Gmail 都沒有的人，可以由 owner/admin 代為建立成「虛擬成員」。
規格與計畫在 `docs/superpowers/`（2026-08-28）。

- member 文件 ID 是合成的 `v_` + 20 個小寫英數（固定 22 字元）。
  **Firebase uid 是 28 字元，長度就不可能碰撞** —— 這很重要，因為這個 id 會
  進 `task.memberIds`，而那同時是權限清單。規則用 `^v_[a-z0-9]{20}$` 這條
  pattern 在 `createsVirtualMember()` 裡強制。
- 記帳、分攤、結算、分類圖表全部不用改 —— 那些程式碼只把成員 id 當字串 key。
- 虛擬成員可以當付款人、可以被分攤，但**不能被升成 admin**（規則擋著）。
- 可以改名。真實成員的暱稱來自個人資料、他自己改；虛擬成員的名字是別人替他
  打的，打錯就沒有其他管道能修。
- **付錢給虛擬成員的那筆付款只能由 admin 代為確認** —— 他永遠不會來按確認，
  不代確認的話會永遠卡在 pending，結算頁的警告也永遠掛著。

**刻意不做「認領」。** 虛擬成員永遠不會換成真帳號。認領要把歷史資料裡的合成 id
全部改寫成真 uid（每筆支出的 paidBy 與 splits 的 key、每筆付款的 from/to、
memberIds、加上 member 文件本身），是跨數十份文件的批次改寫，而且要在規則裡開一個
「允許某人改寫他原本無權改的支出」的洞。這專案沒有 Cloud Functions，只能在 client
做，風險與收益不成比例。

⚠️ **後果要知道**：如果虛擬成員本人之後自己用 Google 登入、點邀請連結加入，
他會是帳目上**獨立的第二個人**，舊支出掛在 `v_xxx`、新支出掛在真 uid，
結算會當成兩個人各自算，而且**沒有任何合併手段**。

也評估過匿名登入與手機號碼登入，都沒做：前者在重裝 App／換手機／改用網頁版時
會永久消失且無法還原（而「手機怪怪的重灌一下」正是這個客群最常做的事）；
後者需要升 Blaze 方案與簡訊費用，但它其實是最對症的解法，留作日後選項。

## 已完成：移除成員可以選擇真實刪除

規格與計畫在 `docs/superpowers/`（2026-08-28）。

起因是一個介面上的矛盾：**成員頁他消失了，結算頁他還在**。結算的參與者是從
支出與付款推導的、不看 `memberIds`（`src/utils/settlement.ts`），所以軟刪
（`active: false`）動不到帳。這對真實成員是對的 —— 移除是權限操作不是帳務操作，
把他的分攤抹掉會讓其他人的金額默默改變。但使用者按「移除」時想的是
「這個人從我的旅程裡不見」。

- 移除前先數他有幾筆支出、幾筆付款（`memberFootprint()`，兩邊各一份純函式）
- **完全沒帳 → 直接真實刪除，不跳選擇。** 軟刪存在的唯一理由是「讓舊支出查得到
  暱稱」，沒有舊支出就沒有這個需求。這覆蓋了「加錯人」與「測試資料」。
- 有帳 → 讓使用者選「保留結算資料」（軟刪，行為不變）或「真實移除」
- 真實移除要**照著打出他的名字**才按得下去，比照 `ConfirmDialog` 的分級摩擦
- 分批寫入，**member 文件放到最後才刪** —— 中途失敗時那個人還在成員列表上，
  重按一次就從頭再跑。反過來先刪的話會留下「成員不見了但支出還在」，
  而且再也沒有介面可以重試。
- 規則：`members` 的 `allow delete` 從 `if false` 改成 admin + 任務進行中 +
  **不是 owner**。最後那條不能少 —— 軟刪走 `managesMemberAsAdmin()` 有擋 owner，
  這條不擋的話新路徑能做的事會比舊路徑還多。

⚠️ **兩個刻意接受的不一致**：

1. **結算紀錄快照裡他的名字還在。** 快照是不可竄改的歷史（`allow update: if false`），
   不能局部修改，只能整份留或整份刪。選擇留。
2. **會誤傷別人的帳。** 只要他出現在 `splits` 裡，整筆支出就會被刪 —— 包含別人
   付的那些。小明付的晚餐會連同他實際付出去的錢一起從帳上消失。這是刻意的決定，
   代價全部靠確認框揭露。

## 待辦：用 GitHub Actions 跑規則測試

本機裝不了 JDK 21（公司擋 Microsoft Store，winget 取不到來源），但 GitHub 的 runner
內建 Java。加一個 workflow 在每次 push 跑 `npm run test:rules`，就能繞過本機限制。

這比裝 JDK 更值得做：規則會一直改，而規則出錯的代價是資料外洩或功能整個壞掉 ——
那正是最該有自動化把關的地方，不該依賴某一台機器的環境。

## 待辦：確認框統一

`ExpenseFormPage` 的刪除支出仍用 `window.confirm`，跟新的 `ConfirmDialog` 不一致。
`window.confirm` 在手機上是系統對話框、按鈕位置不受控，容易手滑。

成員移除已經換掉了（改用 `RemoveMemberDialog`，2026-08-28）。剩下兩處：
`ExpenseFormPage` 的刪除支出，以及 `TaskPage` 改虛擬成員名字用的 `window.prompt`
—— 後者是因為 `ConfirmDialog` 是確認框、不收文字輸入，目前沒有現成的輸入對話框元件。

## 待辦：唯讀的支出詳情頁

規格原本寫「沒權限的成員看得到收據、看不到更換／移除」，但目前**沒有唯讀詳情頁** ——
非管理者連編輯頁都進不去（`load()` 會設 loadError）。所以他們實際只看得到列表上的
「📎 有收據」，看不到照片本身。

`ReceiptField` 已經留好 `canManage` prop，加了這一頁之後傳 `false` 進去即可，元件不用改。

## 之後階段功能

- 桌面版專用介面。
- 包成原生 iOS：評估用 Capacitor 包 WKWebView 殼。最大的一塊是
  `signInWithPopup` 在 WKWebView 不能用，要換 `@capacitor-firebase/authentication`
  的原生登入；另外 clipboard、邀請連結的 Universal Links 也要處理。
  需要 Mac 才能打包（本機是 Windows）。

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
- 後來加收據功能時修正了上一條的結論：不能拆的是「**同一個產品**的 umbrella 與實作」，
  不是「firebase 整包」。`firebase/storage` 連同 `@firebase/storage` 一起搬到獨立
  chunk 是單向依賴、不會成環，首屏因此少了 gzip 11 kB。
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
