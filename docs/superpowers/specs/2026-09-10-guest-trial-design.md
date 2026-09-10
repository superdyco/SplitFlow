# 免登入立即試用

## 為什麼要做

現在第一眼就要 Google（iOS 另有 Apple）帳號。被朋友拉進一趟旅程的人，最不想
做的就是先登入 —— 他只是要記一筆晚餐。

App Store 指引 5.1.1 也希望不需要帳號的功能不要強迫登入，這對上架是加分。

## 核心取捨：匿名的真帳號，不是展示模式

用 Firebase 的匿名登入（`signInAnonymously`）。訪客拿到的是一個真的 uid，建任務、
記帳、邀請、結算都跟正式帳號一模一樣。

另一個選項是本機展示模式（看一份假旅程、不寫後端），做起來最安全，但只能「看看」，
被邀請的人也沒辦法真的加入。不選。

匿名帳號之所以划算：`firestore.rules` 的權限全部建立在 `request.auth != null` 與
uid 比對上，對訪客一樣成立，**rules 不用改**。之後綁定 Google/Apple 用
`linkWithCredential`，**uid 不變**，所有任務、`memberIds`、支出的 `paidBy` 原樣
保留，不必搬任何資料。

代價是資料綁在這台裝置：刪 App、清瀏覽器資料就回不來。所以綁定入口必須一直在。

## 範圍

網頁版與 Flutter 一起做，行為一致。Flutter 部分由 CI 驗證。

訪客**可以**用邀請連結加入別人的任務 —— 那正是這個功能最大的價值。`joinTask`
只看 `request.auth.uid` 與暱稱，不用改。

## 1. 入口與訪客身分

入口：

- 登入頁：兩個平台的登入按鈕下方加一顆次要按鈕「免登入立即試用」。
- 網頁版的邀請頁 `JoinTaskPage.vue`：它有自己的一組登入按鈕，也要加。
- Flutter 不必另外處理邀請頁：邀請碼先存在 `pendingInviteCodeProvider`，
  由 `_Root` 顯示登入頁，按登入頁那顆就夠了。

按下去：`signInAnonymously()`，然後走原本的流程 —— 取暱稱，再進任務列表或加入
邀請的任務。取暱稱**保留**：建任務與加入任務都需要暱稱，成員列也要有名字。

個人資料：照樣建立 `users/{uid}`，`provider` 寫 `"anonymous"`，`email` 留空。
這些欄位都在 rules 現有的允許清單裡。

判斷是不是訪客：一律看 `user.isAnonymous`。兩個平台各加一支小工具，畫面透過它
判斷，不去比對 provider 字串。

網頁版附帶的好處：匿名登入沒有彈窗，iOS PWA 上彈窗被擋、跨來源 iframe 暖機的
老問題，訪客不會遇到。

**手動設定**：Firebase Console 要開啟 Anonymous 登入方式。

## 2. 綁定帳號

入口：

- 任務列表頂端：訪客才會看到的提示條「目前是訪客，資料只存在這台裝置。綁定帳號
  才不會遺失」＋「綁定」按鈕。**不能關掉** —— 忘記綁定的後果是資料永久遺失。
- 個人頁：Email 那一列改顯示「訪客」，下面放綁定按鈕（網頁 Google；iOS Google
  與 Apple）。

### 一般情況：這個帳號沒登入過

- 網頁：`linkWithPopup`。
- Flutter Google：用現有的帳號選擇器拿到 credential，`linkWithCredential`。
- Flutter Apple：`linkWithProvider`。

uid 不變。成功後更新 `users/{uid}` 的 `provider`、`email`、`photoURL`（都在允許
清單裡），提示條自然消失。

### 帳號已經有資料：`credential-already-in-use`

1. 從錯誤取出那個帳號的 credential。網頁用 `GoogleAuthProvider.credentialFromError`
   （Apple 用 `OAuthProvider.credentialFromError`）；Flutter 的 Google credential
   本來就在手上，Apple 從錯誤的 `credential` 取。
2. 對話框：「這個 Google 帳號已經有資料。要把訪客的 N 個任務合併進去嗎？」
   只有「合併」與「取消」。取消就維持訪客，什麼都不動。
3. 合併：先拿訪客的 ID token 存在記憶體 → 用那個 credential 登入正式帳號 →
   呼叫 `mergeGuest({ guestToken })`。
4. 成功後重新載入個人資料，回任務列表。

### 合併失敗

這時手機上已經是正式帳號了，但訪客 token 還在記憶體裡、一小時內有效。畫面顯示
「合併沒有完成」＋「重試」，函式本身可以重跑（見第 3 節）。

一小時內都沒成功的話，訪客資料仍完整留在伺服器上，要人工處理。這是可接受的最壞
情況：**沒有任何資料被刪掉**。

### 同 email、不同登入方式

例如綁 Google 時這個 email 已經用 Apple 註冊過。沿用現有的
`existingAccountMessage`，告訴他改用哪種方式綁定。這種情況不做合併。

## 3. 合併函式 `mergeGuest`

放在 `functions/src/`，照 `joinTask` / `deleteAccount` 的慣例：每份文件要怎麼改
抽成純函式 `guestMerge.ts`（配 vitest），`index.ts` 只負責讀資料、照答案寫回。

### 驗證身分

- 呼叫者 A：`request.auth.uid`，而且 **A 自己不能是匿名**
  （`request.auth.token.firebase.sign_in_provider !== "anonymous"`）。
- 訪客 G：`verifyIdToken(guestToken, true)`。登入方式必須是 `anonymous`，
  而且 G ≠ A。

**token 這一步不能省**：只傳 uid 的話，任何人都能宣稱某個訪客是自己，把別人的
任務吞掉。只接受匿名來源，所以正式帳號之間永遠不能互相合併。

### 核心原則：改寫的目標 id 永遠是空的

合併麻煩的根源是「兩個身分疊成一個人」—— 分攤要加總、自己付給自己的付款要刪、
角色要比大小。只要保證**改寫的目標 id 從來沒人用過**，這些邏輯全部不需要：每個
任務都只是「把 X 改名成一個還沒人用的 Y」。

### 逐一處理 G 所在的每個任務

查 `tasks` where `memberIds array-contains G`。

**改寫目標**：

| 情況 | 目標 |
|---|---|
| `members/{A}` 不存在（絕大多數） | A |
| `members/{A}` 存在（兩個身分都在這個任務） | 虛擬成員 |

看的是**成員文件**而不是 `memberIds`：A 可能曾被移出這個任務，成員文件與舊帳目
都還在，把 G 直接改成 A 會撞上。

共同任務的帳照樣是對的：訪客的支出、分攤、付款原封不動轉到虛擬成員名下，結算
把他當成另一個人。A 與訪客之間過去的付款，改寫後就是虛擬成員與 A 之間的付款，
仍然有效。代價只是成員列多一個「小美（訪客）」，本人要結清或留著都看得懂。

**虛擬成員 id 是算出來的**：用 G 與 taskId 算雜湊，產生 `v_` + 20 碼小寫英數，
符合 `VIRTUAL_MEMBER_ID_PATTERN`。重跑會得到同一個 id，改到一半失敗再跑一次
不會分裂成兩個虛擬成員。

**欄位改寫**：

| 位置 | 欄位 | 換成 |
|---|---|---|
| 支出 | `paidBy`、`splits` 的 key、`splitMemberIds` | 目標 |
| 支出 | `createdBy` | **一律 A** |
| 付款 | `from`、`to` | 目標 |
| 付款 | `createdBy` | 一律 A |
| 結算快照 | `balances[].uid`、`transfers[].from/to`、`memberNames` 的 key | 目標 |
| 結算快照 | `createdBy` | 一律 A |
| 任務 | `ownerId`、`adminIds`、`memberIds` | 目標（見下方角色） |
| 任務 | `createdBy` | 一律 A |
| 任務 | `memberCount` | 不變（只是改名） |

`createdBy` 一律給 A，是因為它決定 `canManageExpense`：換成虛擬成員的話，A 以一般
成員身分就改不了自己當訪客時記的帳，而那些帳明明是他本人記的。

**共同任務的角色**：虛擬成員固定是一般成員，所以 G **從 `adminIds` 拿掉**，不是
換成虛擬成員（`adminIds` 裡的合成 id 不會讓任何人拿到權限，只會讓畫面顯示一個永遠
不生效的管理員）。`memberIds` 裡的 G 照樣換成虛擬成員。G 若是 owner → `ownerId`
改成 A、`members/{A}.role` 改成 owner、A 放進 `adminIds`；G 若是 admin → A 升成
admin（A 本來是一般成員的話）。`deleteAccount` 移交 owner 的寫法可參考。

非共同任務沒有這個問題：目標就是 A，三個欄位裡的 G 直接換成 A，角色原樣繼承。

**成員文件**：`members/{G}` 搬到 `members/{目標}`，**保留 `joinedAt`** —— 結算的
餘數是照它分的。暱稱：目標是 A 時用 `users/{A}` 的暱稱；是虛擬成員時用
「G 的暱稱（訪客）」，超過 20 字截短，並加上 `virtual: true`、`role: "member"`。

### 重跑安全靠寫入順序

每個任務：

1. 先改支出、付款、結算快照。這些改寫是冪等的，已經改過的再改一次結果不變。
2. 最後在**同一個 batch** 裡搬成員文件、更新任務文件。

任務文件更新前，下一次查詢還會找到它，沒改完的會補改；更新之後就不會再被找到。
而「`members/{A}` 在不在」只在第 2 步才會改變，所以重跑時判斷出來的目標跟第一次
一樣。

單一 batch 上限 500 筆，第 1 步按 450 筆切批（同 `memberService.ts` 的做法）。

### 任務以外

| 資料 | 處置 |
|---|---|
| `invites` 的 `createdBy == G` | 改成 A |
| `users/{G}/favorites` | 複製到 A 名下，同 id 已存在就略過 |
| `users/{G}/tokens` | 刪除（換帳號後 A 會重新註冊） |
| `users/{G}` | 刪除 |
| G 的 Auth 帳號 | **最後才刪** |

Auth 放最後，理由跟 `deleteAccount` 一樣：中途失敗時 G 還在，還能重試。重試時
`verifyIdToken` 回 `auth/user-not-found` 就代表上一次其實已經完成，回傳成功。

### 刻意不處理

G 曾經加入、後來被移出的任務：`memberIds` 裡已經沒有 G，只剩成員文件與舊帳目。
畫面會跟「已刪除帳號」一樣顯示成已離開的成員，不影響任何人的帳。

Storage（收據、報告地圖）的路徑裡沒有 uid；公開報告的型別明文規定不含 uid。
兩者都不用動。

## 4. 收尾

### 訪客登出＝刪除訪客帳號

訪客沒有任何方式能再登入回來，登出就是永久離開。與其留一個再也不會出現的成員掛在
別人的任務裡，直接走現有的 `deleteAccount`：owner 身分移交、只剩他一個真人的任務
刪掉、別人的任務裡標成「已刪除」。

- 登出確認改成「訪客登出後就回不來了。建議先綁定帳號。」→「綁定帳號」／「仍要登出」。
- Flutter 取暱稱頁的「用別的帳號登入」對訪客也走這條路。
- 附帶效果：匿名帳號不會一直累積。

### 刪除帳號

訪客跳過重新驗證（沒有任何憑證可驗），直接呼叫 `deleteAccount`。確認對話框照舊。
改 `flutter_app/lib/data/auth_repository.dart` 的 `deleteAccount` 與
`src/services/accountService.ts` 的 `deleteOwnAccount`：現在 `providerData` 是空的
時會當成 Google，而訪客的 `providerData` 正是空的。

### 顯示

- `providerLabel` 兩個平台加 `anonymous` →「訪客」。個人頁、診斷資訊、後台使用者
  列表自動跟著變。
- 取暱稱頁把寫死的「已用 Google 登入 · email」改成照實際登入方式顯示，訪客顯示
  「訪客模式」。順手修掉既有的小錯：用 Apple 登入的人現在也看到「已用 Google 登入」。

### 不用改

- Firestore rules：訪客的 `request.auth` 不是 null、有自己的 uid。
- 推播：訪客照樣註冊 token。
- 探索頁：訪客可以瀏覽公開報告，這本來就是試用的一部分。
- 後台：管理員不會是訪客，讀取管理員 email 的地方不受影響。
- `ENABLED_PROVIDERS`：訪客不是一種登入方式，按鈕分開放。

### 這次不做（寫進 todo.md）

- App Check，擋大量產生匿名帳號。這是整個專案都缺的，不是訪客特有的問題。
- 自動清理閒置的匿名帳號，需要升級 Identity Platform。
- 登出即刪除之後，這兩件都不急。

## 5. 測試

### 合併函式：`functions/src/guestMerge.test.ts`

改寫邏輯全是純函式（輸入一份文件的資料、G、目標、A，輸出改寫後的資料）：

- 目標判斷：`members/{A}` 不存在 → A；存在 → 虛擬成員；A 曾被移出、只剩成員文件
  → 也是虛擬成員。
- 虛擬成員 id：同樣的 G 與任務一定算出同一個 id、符合 `^v_[a-z0-9]{20}$`；
  不同任務算出不同 id。
- 支出：`paidBy`、`splits`、`splitMemberIds` 換成目標，`createdBy` 一律 A。
- 付款：共同任務裡 G 付給 A 的紀錄，改寫後是虛擬成員付給 A，仍然有效（from ≠ to）。
- 結算快照：`balances`、`transfers`、`memberNames` 的 key 都換掉。
- 任務與角色：G 是 owner/admin 時交給 A；G 是一般成員時 A 的角色不變；
  `memberCount` 不變。
- 冪等：已改寫的文件再改一次，結果完全相同。
- token 驗證：非匿名 token、G = A、呼叫者自己是匿名，三者都拒絕。

### Firestore rules：`tests/firestore.rules.test.mjs`

rules 沒改，補防回歸：用帶 `sign_in_provider: "anonymous"` 的身分，確認訪客能建立
個人資料（`provider: "anonymous"`）、建立任務、記帳；不是成員的訪客讀不到別人的
任務。要用 JDK 21 跑。

### 網頁版：vitest

`providerLabel("anonymous")` 回「訪客」、判斷訪客的小工具。

### Flutter

`support_test.dart` 補同樣的 `providerLabel` 測試。這台沒有 Dart，推 main 後由 CI
驗證，CI 綠之前不算測過。

### 手動驗證（網頁版，Auth + Firestore + Functions emulator）

1. 按試用 → 建任務 → 記帳 → 綁定一個全新的 Google 帳號，確認 uid 不變。
2. 另一個訪客加入一個「正式帳號也在裡面」的共同任務，然後綁定那個已有資料的帳號並
   合併：共同任務出現「XX（訪客）」、結算金額與合併前相同、非共同任務的 owner 已經
   是正式帳號。
3. 訪客登出，確認他在任務裡被標成已刪除。

### 部署前要手動做

- Firebase Console 開啟 Anonymous 登入方式。
- `npm run deploy:functions`。
