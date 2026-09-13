# AI 辨識點數儲值（第二階段）

## 為什麼要做

第一階段每個帳號只送 3 點，用完就沒了。這一份讓使用者在手機 App 裡用 Apple／Google 的
應用程式內購買儲值，點數跟著帳號走，App 買的點數在網頁上辨識一樣扣得到。

第一階段的 spec：`docs/superpowers/specs/2026-09-11-ai-receipt-design.md`（點數紀錄當時
已經預留 `purchase` 這個類型）。

## 範圍

- **只在 App 內購買，iOS 與 Android 都做。**
- **網頁版不賣。** 網頁上點數用完時只顯示一行提示，不放任何連結。
- App 裡**只連到 App 自己的儲值頁**，不導去任何外部付款 —— 美國以外的地區蘋果不允許
  在 App 裡導向外部付款，而我們也沒有外部付款。

## 已確認的決定

| 題目 | 決定 |
|---|---|
| 平台 | iOS 與 Android 都做；網頁不賣 |
| 方案 | 三種：NT$30 = 30 點、NT$60 = 66 點（送 6）、NT$100 = 120 點（送 20） |
| 大包加送 | 要。三包單價一樣的話，沒有人有理由買大包 |
| 價格點 | NT$30／60／100 都是 App Store 台灣可選的價格點（見下）；Google Play 可以自訂金額 |
| 商品類型 | 消耗型（consumable），可以重複購買 |
| 加點時機 | **伺服器向 Apple／Google 驗證過之後才加**，不相信 App 說「付過了」 |
| 點數用完（App） | AI 按鈕旁多一顆「去儲值」，連到 App 內的儲值頁 |
| 點數用完（網頁） | 一行提示「點數用完了，可以到手機 App 儲值」，**沒有連結** |

### App Store 台灣的價格點（查證紀錄）

蘋果的價格點不能自訂，只能從它的表挑。依 Apple《App Store Pricing Update》PDF 的
Taiwan (TWD) 表格（這份表的「級距」欄會比價格範圍往上錯開一行，對照美元那一列可確認）：

| 級距 | 最低 | 最高 |
|---|---|---|
| NT$5 | NT$10 | NT$500 |
| NT$10 | NT$10 | NT$2,000 |
| NT$50 | NT$50 | NT$10,000 |

另外支援結尾是 0 的價格慣例（X0，NT$10 起）。所以 NT$30、NT$60、NT$100 都在表上。
網路上流傳的「NT$30／60／90／120…」是 2023 年以前的舊等級制度，已經不適用。
**建立商品時仍以 App Store Connect 實際顯示的為準。**

## 1. 商品

| 商品 ID（兩個商店一樣） | 價格 | 點數 |
|---|---|---|
| `ai_credits_30` | NT$30 | 30 |
| `ai_credits_60` | NT$60 | 66 |
| `ai_credits_100` | NT$100 | 120 |

- **點數對照只存在伺服器**（`functions/` 的一張表）。App 送來的只有商品 ID 與交易憑證，
  點數由伺服器依商品 ID 決定 —— App 說買了幾點都不算數。
- App 上顯示的**價格一律用商店回傳的在地化字串**，不寫死 NT$。其他地區的使用者看到的
  是當地幣別的價格。
- 送的點數寫在儲值頁上（「送 6 點」），不寫在商店的商品名稱裡 —— 之後要改加送數量，
  改伺服器的表就好，不必重送商品審核。

## 2. 購買流程

App 用 Flutter 官方的 `in_app_purchase`。

1. 儲值頁向商店查三個商品（拿價格字串）。查不到就顯示「目前無法儲值」，不顯示假價格。
2. 使用者點一個方案 → 商店的付款畫面。
3. 付款完成，App 收到購買結果：
   - **iOS**：`serverVerificationData` 是 StoreKit 2 簽章過的交易（JWS）。
   - **Android**：`purchaseToken`。購買用 `buyConsumable(autoConsume: false)` ——
     **不讓 App 自己消耗**，由伺服器驗證加點之後才消耗。反過來的話，伺服器驗證失敗時
     使用者錢付了、商品也被消耗掉了，沒有東西可以重送。
4. App 呼叫 callable `purchaseCredits`，送 `{ platform, productId, verificationData }`。
5. 伺服器驗證、加點（見第 3 節），回傳 `{ status, creditsLeft }`。
6. 伺服器回「已加點」或「這筆之前加過了」之後，App 才呼叫 `completePurchase`。
   沒有回來（斷線、函式出錯）就**不** complete —— 商店下次開 App 時會再把這筆交易
   交給 App，App 會重送一次。伺服器是冪等的，重送不會重複加點。

### 等待中的付款（Android）

Google Play 有「待處理」的付款（例如超商繳費）。這種狀態**不加點**，App 顯示「付款處理中，
完成後會自動加點」。付款完成後商店會再通知 App，App 照第 4 步送出。

## 3. 伺服器：`purchaseCredits`

### 檢查

- 必須登入，**不能是訪客**（訪客帳號登出就刪，買的點數會跟著消失）。
- `productId` 必須在點數對照表裡。
- **iOS**：用 App Store Server API 以交易 ID 查這筆交易（不只解 App 送來的 JWS）：
  bundle ID 是 `com.dyco.splitflow`、商品 ID 對得上、沒有被撤銷（`revocationDate` 為空）。
  正式環境查不到時再查 sandbox —— TestFlight 與審核人員用的是 sandbox。
- **Android**：用 Google Play Developer API `purchases.products.get`：套件名稱是
  `com.dyco.splitflow`、`purchaseState` 是已購買、商品 ID 對得上。

### 加點（transaction，冪等）

- 購買紀錄的文件 ID 用商店的交易識別：iOS 是 `ios_{transactionId}`、Android 是
  `android_{orderId}`。
- transaction 裡先讀這份購買紀錄：**已經存在就不再加點**，直接回「之前加過了」和目前餘額。
- 不存在就：建立購買紀錄、`aiCredits/{uid}` 加上點數（文件不存在時照樣建立，
  `freeGranted: true` —— 第一次就用買的，不會再多送 3 點）、寫一筆 `purchase` 到 `aiLedger`。
- **同一筆交易被另一個帳號送來**（例如同一台手機換帳號登入）：拒絕，
  「這筆購買已經加到另一個帳號了」。點數跟著第一次送來的那個帳號。
- **Android**：加點成功之後呼叫 `purchases.products.consume`。消耗失敗不影響已經加的點數，
  下次重送時會再試一次消耗（三天內沒消耗 Google 會自動退款，所以要記得重試）。

### 購買紀錄：`aiPurchases/{id}`

| 欄位 | 說明 |
|---|---|
| `uid` | 加到誰的帳號 |
| `platform` | `ios` 或 `android` |
| `productId`、`credits` | 買了哪個方案、加了幾點（依當時的對照表） |
| `transactionId` / `orderId`、`purchaseToken` | 商店的識別，退款通知靠它對回來 |
| `price`、`currency` | 商店回報的金額與幣別（後台看營收用） |
| `environment` | `production` 或 `sandbox`（測試購買不算營收） |
| `status` | `credited`、`refunded` |
| `creditedAt`、`refundedAt` | |

rules：`allow read, write: if false`。App 不需要讀它；後台走 callable。

### 點數紀錄（`aiLedger`）新增的類型

| `type` | 說明 |
|---|---|
| `purchase` | 儲值加點，`delta` 為正，帶 `purchaseId`、`productId` |
| `revoke` | 商店退款扣點，`delta` 為負，帶 `purchaseId` |

## 4. 退款

使用者向 Apple／Google 申請退款成功之後，要把那筆買的點數扣回來。

- **iOS**：App Store Server Notifications V2 的 `REFUND` 通知，打到一支 HTTPS 函式。
  函式要驗證通知的簽章，用交易 ID 找到購買紀錄。
- **Android**：即時開發者通知（Real-time developer notifications）經 Pub/Sub 送到函式，
  處理「作廢購買」（voided purchase）通知，用 orderId 找到購買紀錄。
- 找到而且狀態是 `credited`：扣點、購買紀錄改成 `refunded`、寫一筆 `revoke`。已經是
  `refunded` 就不再扣（通知可能重送）。
- **扣到 0 為止，不會變成負數。** 買了 120 點、用掉 100 點再退款，只扣得回 20 點。
  紀錄寫實際扣掉的量。這是接受的漏洞 —— 金額小，而且後台看得到誰這樣做。

## 5. 商店的憑證

| 用途 | 需要的東西 |
|---|---|
| App Store Server API | App Store Connect 的 API 金鑰（Issuer ID、Key ID、`.p8` 私鑰） |
| App Store 通知驗證 | Apple 的根憑證（用官方 `app-store-server-library` 處理） |
| Google Play Developer API | 服務帳戶，在 Play Console 授權「查看財務資料、管理訂單」 |

**建議放在 Firebase 的 Secret Manager（functions secrets），不做後台介面。**
理由跟 OpenAI 金鑰不同：OpenAI 的金鑰和模型會常換、而且要能先驗證再存；商店憑證設定一次
幾乎不會動，做一個後台頁面反而多一個能被改壞的地方。Google 那邊甚至可以直接授權 Cloud
Functions 的執行服務帳戶，連金鑰檔都不必有。

## 6. App 畫面

### 儲值頁（新增）

- 入口：個人頁「AI 辨識點數」那一列點下去；AI 按鈕旁的「去儲值」。
- 上方顯示目前點數。
- 三個方案一列一個：點數（大字）、「送 6 點」「送 20 點」的標籤、商店回傳的價格、購買按鈕。
- 購買中整頁的按鈕停用，顯示「處理中…」。
- 成功：「已加 66 點，現在有 N 點」，餘額與個人頁、AI 按鈕一起更新。
- 待處理：「付款處理中，完成後會自動加點」。
- 使用者自己取消付款：不顯示錯誤。
- 訪客：整頁換成「綁定帳號才能儲值」，連到個人頁的綁定區。

### AI 按鈕

- 點數 0 時按鈕停用（第一階段就是這樣），旁邊多一顆「去儲值」。
- 辨識時才發現沒點數（函式回 `resource-exhausted`）也顯示「去儲值」。

### 網頁

- 點數 0 時，AI 按鈕下方一行「點數用完了，可以到手機 App 儲值」。**沒有連結，也不寫商店名稱。**

## 7. 後台

- 使用報告的篩選多「購買」「退款」兩種。
- 用量摘要多一欄：區間內的購買次數、賣出的點數、營收（依幣別分開加總，**只算 production**）。
- 使用者詳情的點數紀錄會出現 `purchase`／`revoke`（標籤「儲值」「退款扣回」）。

## 8. 這次不做

- 網頁購買（決定不做）。
- 訂閱制、每月自動補點數。
- 促銷碼、送點數給別人。
- 購買之外的點數到期（點數不會過期）。

## 9. 測試

- **純函式（functions，vitest）**：
  - 商品 ID 對照點數；不認得的商品 ID 拒絕
  - 冪等判斷：購買紀錄已存在、同一個帳號重送、另一個帳號送來
  - iOS 交易內容檢查（bundle ID、商品 ID、撤銷、環境）
  - Android 購買內容檢查（套件名稱、購買狀態、待處理）
  - 退款扣點：扣到 0 為止、已退款的不重扣
- **rules（emulator）**：`aiPurchases` 誰都讀不到、寫不進去。
- **Flutter（CI）**：儲值頁的狀態判斷（載入、無法儲值、購買中、成功、待處理、訪客）抽成純函式。
- **手動**：
  - iOS：TestFlight + sandbox 測試帳號，三個方案各買一次、中途斷線再開 App 補加點、sandbox 退款。
  - Android：內部測試軌 + 授權測試帳號，三個方案各買一次、測試卡的「待處理」付款、Play Console 退款。
  - 兩邊都確認：重複送同一筆不會重複加點；網頁看得到 App 買的點數。

## 10. 上線前要你手動做的

### Apple

- 加入 **Apple Developer Program**（年費 US$99）。
- App Store Connect 建立 App（bundle ID `com.dyco.splitflow`），簽署**付費 App 協議**、填銀行與稅務資料 —— 沒簽的話 App 內購買完全不能用，連 sandbox 都不行。
- 建立三個消耗型商品，基準國家選台灣，價格 NT$30／60／100。
- 產生 App Store Connect API 金鑰（`.p8`），設定 App Store Server Notifications V2 的網址。
- **iOS 要簽章才能裝到手機、上 TestFlight**：需要 Mac，或雲端的 macOS 建置（例如 GitHub Actions 的 macOS runner 加上憑證與描述檔）。目前 CI 只建不簽章的版本。

### Google

- 註冊 **Play Console 開發者帳號**（一次性 US$25），建立付款資料。
- **建立正式的上傳金鑰**：目前 Android 的 release 版本用的是 debug 簽章（`android/app/build.gradle.kts`），不能上架。
- 建立 App（套件名稱 `com.dyco.splitflow`），上傳簽章過的 AAB 到**內部測試軌** —— Google Play 的付款要求 App 必須從 Play 安裝。
- 建立三個一次性商品，設定授權測試帳號。
- 授權 Cloud Functions 的服務帳戶使用 Google Play Developer API；建立即時開發者通知的 Pub/Sub 主題。
