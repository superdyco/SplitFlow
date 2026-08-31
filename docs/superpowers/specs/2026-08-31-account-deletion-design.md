# 帳號刪除

## 為什麼要做

App Store 指引 5.1.1(v)：支援建立帳號的 App 必須提供**在 App 內就能發起**的
帳號刪除。目前完全沒有 —— 個人設定頁只有暱稱、Email、登入方式、資料匯出、
登出，而 `firestore.rules` 裡 `match /users/{uid}` 明寫 `allow delete: if false`。

這是 iOS 上架的硬性條款，會被機械式檢查抓到。資料匯出不能替代刪除：Apple
明確區分過這兩件事。

## 核心取捨：刪什麼、留什麼

**帳目留下，身分標記為已刪除。**

一個人的支出與付款不只是他自己的資料，也是同行者的共同紀錄。單方面抽掉會讓
其他人已經算好的帳突然對不上，而且他付過的錢別人可能還沒還。Apple 與 GDPR
都接受「刪除帳號」不等於「刪除交易對手的交易紀錄」。

具體來說：

| 資料 | 處置 |
|---|---|
| Auth 帳號 | 刪除 |
| `users/{uid}` | 刪除 |
| `users/{uid}/tokens` | 刪除 |
| `users/{uid}/favorites` | 刪除 |
| 各任務的 `members/{uid}` | **保留**，加上 `deleted: true` |
| 支出、付款、結算快照 | **保留**，完全不動 |
| 收據照片（Storage） | **保留** |

### 為什麼成員文件不刪

支出的 `splits` 以 uid 當 key。刪掉成員文件之後，成員列與結算畫面只剩一串裸
uid，其他人看不懂那筆帳是誰的。留一份標記為已刪除的文件，畫面才說得出名字。

### 為什麼暱稱不覆寫

成員文件加 `deleted: true` 旗標，**暱稱原封不動**，由畫面組成「小美（已刪除）」。
資料記錄事實，畫面負責呈現。

覆寫暱稱在隱私上並不會真的抹掉什麼 —— 結算快照的 `memberNames` 本來就永久
保存了當時的暱稱。覆寫只會讓其他人的帳變難讀。

### 為什麼收據留著

收據附在留下來的支出上，是那趟旅程的共同憑證，跟支出本身同進退。

### 誰負責顯示

旗標沒有人讀就是白加的。成員名稱的呈現要在兩邊都改：

- 網頁：成員列、支出的付款人與分攤者、結算畫面
- Flutter：同上

讀取時一律用「取不到就當 false」的預設值。這個功能之前建立的成員文件**沒有
這個欄位**，直接讀會拿到 null —— 同一個坑 `firestore.rules` 裡的 `virtual`
與 `listed` 都踩過，那邊的註解寫得很清楚。

結算快照不用改：它存的是產生當下的 `memberNames`，本來就是歷史值。

## 他擁有的任務

刪掉 owner 會讓任務進入壞掉的狀態：`updatesTaskAsAdmin` 要求 `ownerId` 必須
仍在 `memberIds` 裡，所以沒有 owner 的任務**連 admin 都改不動**，也不能封存、
不能產生報告。

**自動轉移給下一個人：**

1. 先找 `adminIds` 裡除他以外的第一個
2. 沒有 admin，就取成員依 `joinedAt` 排序後的第一位真人（非虛擬、`active` 為真），
   並把他升為 admin
3. **找不到任何人**（只剩他自己，或只剩虛擬成員）→ 整個任務連同子集合刪除。
   沒有別人會受影響

## 為什麼是 Cloud Function

用 callable function 搭 Admin SDK，不在用戶端做。

**規則一行都不用改。** 現行規則下，一般成員無法刪除自己的成員文件
（`allow delete` 要 admin），也沒有任何路徑可以改 `ownerId`。要在用戶端完成
刪除，就得為了一個一輩子用一次的操作，永久開放「成員可以改自己的成員文件」
與「非 owner 可以改 ownerId」這兩個開口，而那些開口每天都在。

**用戶端做還會失去原子性。** 跑到一半沒網路，帳號就停在半刪除狀態 —— 任務
轉移了但 Auth 帳號還在，或帳號刪了但成員文件還掛著。沒有人能收拾。

Firestore 觸發器（client 刪 `users/{uid}`、觸發器善後）比純用戶端好，但 Auth
帳號與 users 文件仍是兩次獨立刪除，任一邊失敗就不一致，而且一樣要開放 users
文件的刪除權限。

## 函式規格

**`deleteAccount`** — `onCall`，region `asia-east1`（與 Firestore 同區，跟
`onExpenseCreated` 一致）。

**沒有參數。** uid 一律取自 `request.auth.uid`。只要 uid 來自參數，任何人就能
刪任何人的帳號。未登入直接拒絕。

### 執行順序

1. 查 `tasks` where `memberIds` array-contains uid
2. 逐一處理每個任務：
   - 他是 owner → 依上述規則轉移，或刪除整個任務
   - 他不是 owner → 從 `memberIds`／`adminIds` 移除，`memberCount` 減一
   - 兩種情況都把 `members/{uid}` 設為 `active: false`、`deleted: true`
3. 刪 `users/{uid}/tokens`、`users/{uid}/favorites`
4. 刪 `users/{uid}`
5. **最後**刪 Auth 帳號

### 為什麼 Auth 放最後

反過來的話，中途失敗使用者已經登不進來，永遠無法重試，資料就卡在半刪除狀態。
放最後的話，任何一步失敗他都還在，再按一次即可。

### 冪等性

整支函式必須可重複執行，因為上一條的重試策略靠它：

- 步驟 2 以「他還在不在 `memberIds` 裡」判斷，已處理過的任務跳過
- 步驟 3、4 刪不存在的文件本來就不會報錯
- 步驟 5 若帳號已不存在（`auth/user-not-found`）視為成功

### 規模

逐筆寫入，不用批次。Firestore 的 500 筆上限只在單一 batch 或 transaction 內
成立，逐筆送就沒有那個限制 —— 而這裡也不需要原子性，整支函式本來就設計成
可以重跑，那才是失敗時的復原手段。

刪整個任務時用 `recursiveDelete()` 清 `members`／`expenses`／`payments`／
`settlements`／`reports` 子集合。

## 用戶端

**位置**：個人設定頁最下方，與「登出」分開，視覺上獨立成危險區。網頁與 Flutter
兩邊都做。

**流程**：確認對話框 → 重新驗證 → 呼叫函式 → 本機清除 FCM token → 登出 → 回登入頁。

### 分級摩擦

沿用 `taskActionPrompt` 已經確立的原則（後果越嚴重、需要越刻意的動作）：

- 沒有任何任務 → 按一次確認即可。剛註冊完就想刪的人風險是零，不該被刁難
- 有任務 → 要打出自己的暱稱，跟刪任務要打任務名稱同一個道理

### 文案

純函式 `deleteAccountPrompt(...)`，回傳 `{title, message, confirmLabel, requireText}`，
與 `removeMemberPrompt`、`taskActionPrompt` 同形狀。TS 與 Dart 各一份。

必須講出三件具體的事：

1. 帳目會留在同行的人那裡
2. 你擁有的任務會轉給別人（或在沒有別人時被刪除）
3. 無法復原

並附一句指向既有的資料匯出，建議先備份。

### 重新驗證

呼叫函式前要求重新登入一次。這個操作不可逆，拿到一支未鎖定手機的人不該能刪掉
別人的帳號。改由伺服器端刪除雖然技術上不受 Firebase `user.delete()` 的
recent-login 限制，但保護的理由沒變。

### 失敗處理

函式失敗時使用者仍登入著，顯示錯誤並允許再試一次。這是冪等性存在的理由。

## 不做的事

**不計算未結清餘額。** 付款確認不是強制流程 —— 人可以在現實裡還完錢卻從不按
「已收到」。App 裡的餘額因此不是事實，只是一個沒人有義務維護的便利功能。拿它
去跟人說「你還欠某某 1,200」，是把內部狀態當成真實債務，那是誤導。

確認畫面講的是「你會失去什麼」，不是替使用者宣告他欠誰錢。

**不通知其他成員。** 成員文件標記為已刪除後畫面上就看得到，不需要推播。

## 測試

- `functions/src/successor.test.ts` — `pickSuccessor(adminIds, members, leavingUid)`
  的純函式測試。那是整支函式裡唯一有分支邏輯的地方。跟既有的 `amount.ts`、
  `message.ts`、`recipients.ts` 同一個做法
- `tests/accountDeletion.test.ts` 與 Flutter 的對應測試 — `deleteAccountPrompt`
  的文案，比照 `removeMemberPrompt` 既有的測法
- callable 的端到端行為**不寫自動測試**。既有的 functions 測試也只涵蓋純函式，
  跟隨這個模式，不另外搭一套 emulator 測試架構

Flutter 的部分由 `.github/workflows/ios-build.yml` 在 push 到 main 時驗證
（`dart analyze` + `dart test` + `flutter build ios`）。

## 部署

函式要另外部署（`npm run deploy:functions`），與 hosting 是兩條獨立的路。用戶端
上線前函式必須先在雲端就位，否則按鈕會出現但呼叫失敗。
