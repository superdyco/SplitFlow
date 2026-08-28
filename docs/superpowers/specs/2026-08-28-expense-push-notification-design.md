# 新增支出時推播通知（Android）

日期：2026-08-28

## 目標

有人記了一筆帳，同任務的其他人手機會跳通知。

現在要知道別人記了什麼，只能自己打開 App 看。Firestore 的 listener 讓
**App 開著的時候**畫面會自己更新，但那不是通知 —— App 關著就什麼都不會發生。

## 範圍

**要做的**

- 新增支出時，通知同任務的其他成員（不含記帳的人本人）
- 通知內容包含任務名稱、記帳的人、支出項目與金額
- 點通知打開 App 並導到那個任務
- Android

**明確不做的**

- **iOS 這一輪不做。** 現在連建置都做不到：沒有 Mac（iOS 只能在 macOS 編譯）、
  `ios/` 只是 `flutter create` 的預設骨架（沒有 `Podfile`、沒跑過 `pod install`）、
  沒有 `GoogleService-Info.plist`。推播還要 Apple Developer Program（年費
  US$99）才產得出 APNs 憑證。**但資料模型與 Cloud Function 從第一天就不綁死
  平台**，之後補 iOS 不用改函式那半。
- **網頁版不做。** 使用者明確指定只要 App。
- **只推「新增支出」。** 編輯、刪除、付款確認、被加入任務都不推。
- **不做通知偏好設定。** 一趟旅行的記帳頻率不高，不需要開關或摘要合併。
  真的太吵再說 —— 系統層級本來就關得掉。
- **不改結算、記帳、成員的任何既有流程。**

## 架構

```
新增支出（client 直接寫 Firestore）
  → onDocumentCreated 觸發 tasks/{taskId}/expenses/{expenseId}
  → 讀 tasks/{taskId}（任務名稱、memberIds）
  → 讀 tasks/{taskId}/members/{createdBy}（記帳者暱稱）
  → 收件人 = memberIds − createdBy
  → 讀每個收件人的 users/{uid}/tokens/*
  → sendEachForMulticast
  → 回報 token 失效的，刪掉那份 token 文件
```

### 為什麼是 Firestore 觸發器

評估過另外兩種，都不行：

- **Client 寫完支出後呼叫 callable function**：client 可以說謊（沒記帳也能叫
  別人的手機響），而且**離線記帳根本不會觸發** —— 排隊中的寫入是 Firestore
  SDK 之後自己送出的，那時 client 的程式碼早就沒在跑了。
- **觸發器先寫進佇列集合，第二個函式負責送**：佇列的價值在重試與流量削峰，
  對一天幾筆的規模是過度設計。

### 收件人是 memberIds 減掉 createdBy

**排除的是 `createdBy` 不是 `paidBy`。** 如果小明幫阿華記一筆阿華付的錢，
阿華**應該**收到通知 —— 有人替他登了一筆帳，那正是他需要知道的。

兩種人自動被排除，不需要特別寫判斷：

- **虛擬成員**：沒有帳號就沒有 token 文件
- **已被移除的成員**：觸發當下他已經不在 `memberIds` 裡

## 資料模型

Token 存在 `users/{uid}/tokens/{token}` 子集合。

```
users/{uid}/tokens/{token}
  platform: "android" | "ios"
  updatedAt: Timestamp
```

**文件 ID 就是 token 本身。** 重新註冊時自動覆蓋（冪等），而 FCM 回報某個
token 失效時函式手上正好有那串 token，直接刪那份文件就好。

**為什麼是子集合而不是 `users/{uid}` 的陣列欄位**：

1. `users/{uid}` 的 update 規則有 `hasOnly(["nickname", "email", "photoURL",
   "provider", "updatedAt"])` 白名單，加欄位就得改那條
2. 一個人會有多台裝置、token 會過期輪替，刪單筆文件比 `arrayRemove` 乾淨
3. 子集合放得下 `platform` 這種 metadata，iOS 之後直接沿用
4. **repo 裡已經有這個模式** —— `users/{uid}/favorites/{favoriteId}`，
   隱私屬性一樣（純私人、別人完全不該讀得到）

## 安全規則

只加一段，照抄 favorites 的形狀：

```
match /users/{uid}/tokens/{token} {
  allow read, write: if isSelf(uid);
}
```

Cloud Function 用 Admin SDK 讀，**繞過規則**，所以這裡可以鎖死成只有本人能碰。
別人讀不到你的 token，也寫不進你的名下。

其餘規則一行都不用改。

## Token 的生命週期 —— 這裡最容易出事

**1. 登出必須刪掉這台裝置的 token。**

不刪的話，下一個在同一支手機登入的人會收到**前一個人的旅程通知**。這是真的
隱私外洩，不是潔癖。登出流程要在清掉 Firebase Auth 之前先刪 token 文件 ——
順序不能反，清掉之後 `isSelf(uid)` 就不成立，規則會擋下刪除。

**2. token 會自己輪替。**

要掛 `onTokenRefresh`，換新的就寫進去。舊的那份留著沒關係 —— 下一次送失敗時
會被清掉。

**3. 送失敗要清掉死 token。**

`sendEachForMulticast` 逐一回報結果，錯誤碼是
`messaging/registration-token-not-registered` 的就刪掉那份文件。不清的話死
token 會一直累積，每次推播都白送一次。

## 通知權限

Android 13（API 33）之後通知是 runtime permission。

**不在開 App 當下問。** 那時使用者還不知道這 App 要幹嘛，直接按拒絕的機率很高，
而 Android 拒絕兩次之後就再也不會跳系統對話框了 —— 一旦踩到，只能叫使用者
自己去系統設定開，實務上等於這個人永遠收不到通知。

**改成第一次進到某個任務時才問。** 那時他已經知道自己在跟人分帳，
「有人記帳要不要通知你」是個看得懂的問題。

被拒絕就安靜地不推播，App 其他功能完全不受影響。

## 通知內容

```
曼谷旅行
小明新增「晚餐」TWD 1,200.00
```

金額的寫法跟 App 內一致（`幣別 + 金額`，見 `expense_row.dart`），
不要為了通知另外發明一種格式。

**金額與項目會顯示在鎖定畫面上**，旁邊的人瞄一眼就看得到。2026-08-28 定案：
使用者選擇完整顯示，接受這個取捨。之後想收斂的話只要改函式裡組字串那一段，
不影響其他部分。

`data` 夾帶 `taskId` 給點擊導頁用。

## 點通知之後

導到那個任務的頁面。

**這件事比想像中麻煩，因為這個 App 沒有路由表** —— 導航是
`Navigator.push` + `MaterialPageRoute`（`task_list_page.dart:43`），
`go_router` 雖然在 `pubspec.yaml` 裡但**完全沒有在用**。

三種 App 狀態要各自處理：

| 狀態 | 機制 |
| --- | --- |
| 前景 | `onMessage` —— 系統不會自動顯示通知，要自己決定要不要顯示 |
| 背景（App 還活著） | `onMessageOpenedApp` |
| 完全關閉 | `getInitialMessage()` —— 開 App 時檢查有沒有「因為點通知而啟動」 |

**而且不能立刻導頁。** `_Root` 有三段狀態判斷（沒登入 → 登入頁；登入但沒暱稱
→ 取暱稱頁；都有了 → 任務列表），要等它確定落在「任務列表」那一段之後才能
push。太早導的話會疊在登入頁上面，而那時使用者根本還沒登入、讀任務會被規則擋下。

作法：把待處理的 `taskId` 存在一個 provider 裡，任務列表掛載後才消費它並
push。**不重構成 go_router** —— 那是另一件事，會拖長這個功能。

## 新的 `functions/` 目錄

這是這個 repo 第一次出現第二個 npm 專案。

```
functions/
  package.json        Node 20、firebase-functions v6、firebase-admin
  src/index.ts        onExpenseCreated
  src/amount.ts       金額格式化（見下面的已知負債）
  src/amount.test.ts
```

`firebase.json` 要加 `functions` 區塊。部署指令另外加 `deploy:functions`，
**不要併進現有的 `deploy`** —— 那條現在是 hosting + rules + indexes + storage，
每次部署網頁版都順便重佈函式沒有必要，也讓失敗的原因變模糊。

Blaze 方案已經開通。Cloud Functions 免費額度是每月 200 萬次呼叫，以熟人小群組
的記帳頻率永遠用不完。

## 已知負債：金額格式化的第三份副本

通知要顯示 `TWD 1,200.00`，而 Firestore 存的是最小單位整數（`120000`）。函式必須
自己算，於是 `src/utils/currency.ts` 的 `minorUnits` 與 `formatAmount` 會出現
**第三份實作**（網頁版 TS、Flutter Dart、現在再加 Cloud Function）。

沒有更好的辦法：函式部署時只上傳 `functions/` 目錄，import 上層的 `src/`
會在部署後找不到檔案。讓 client 先算好寫進文件更糟 —— 那是可以被竄改的顯示
字串，而且污染資料模型。

**緩解**：只搬需要的那兩個函式，並且測試裡放幾組跟網頁版對齊的案例
（TWD 整數、JPY 零小數、USD 兩位小數），格式跑掉時會被抓到。

## 測試

**純函式**（`functions/src/amount.test.ts`）：

- TWD `120000` → `1,200.00`（與網頁版 `formatAmount` 對齊）
- JPY `1200` → `1,200`（零小數幣別）
- USD `45050` → `450.50`
- 輸出必須與網頁版 `formatAmount` **逐字相同**（含千分位的出現時機）

**收件人計算**（抽成純函式才測得到，不要寫在觸發器裡）：

- 排除 `createdBy`
- 保留 `paidBy`（就算他不是記帳的人）
- 虛擬成員沒有 token 就不會出現在結果裡
- 沒有其他成員時回傳空陣列，函式直接結束不呼叫 FCM

**規則測試**（`npm run test:rules`）：

- 自己能讀寫自己的 token
- 別人不能讀我的 token
- 別人不能寫進我的 token 子集合
- 未登入完全不能碰

**手動驗證**（需要兩台裝置或一台裝置＋一個模擬器）：

1. A 記一筆 → B 收到通知，內容有任務名、A 的暱稱、項目、金額
2. A 記一筆 → **A 自己不會收到**
3. B 點通知 → 開到那個任務
4. App 完全關閉時點通知 → 一樣開到那個任務
5. B 登出 → A 再記一筆 → B 這台**不該再收到**
6. 拒絕通知權限 → App 其他功能完全正常

## 前置條件

規則測試在開發機上跑不起來 —— `firebase-tools` 要 JDK 21，實測這台是
JDK 11.0.16。這次的規則改動很小（一段全新的子集合，不碰任何既有規則），
風險比前兩次低，但仍建議裝 JDK 21 之後再部署。

Firestore 與 Cloud Functions 的區域要一致，部署前先確認現有 Firestore 的區域，
函式指定同一個 —— 跨區會讓每次觸發多一段延遲。
