# 平台管理者後台

設計稿：`docs/design/admin-console/`（畫布形式，七張畫面）

## 為什麼要做

現在沒有任何地方看得到「有多少人在用這個系統、他們建了多少任務」。要查只能開
Firebase Console 一筆一筆點，而 Console 看得到的是文件不是問題 —— 它答得出
「這個 uid 的暱稱是什麼」，答不出「這個月有幾個人真的在記帳」。

順帶解決兩件目前無處可去的事：公開報告被檢舉時沒有下架的路，以及 `perf`
集合寫了三個月但沒有人讀得到（規則是 `allow read: if false`）。

**只有網頁版做。** Flutter App 不加這段路由，也不加呼叫這些函式的程式碼。

## 兩條決定其他一切的線

這兩條先定，後面的函式簽章跟畫面都是它們的結果。

### 一、看得到錢的總量，看不到單筆的內容

| 看得到 | 看不到 |
|---|---|
| 任務的支出**筆數**、**總額**、幣別、分類佔比 | 單筆支出的名稱、地點、備註、時間 |
| 成員組成、角色、每人記了幾筆 | 收據照片（連縮圖都不給） |
| 每人平均分攤 | 結算明細、誰欠誰多少 |
| 帳號的暱稱、Email、登入方式、活動時間 | 這個人在任務裡說了什麼 |

金額全部由後端算好才回傳，**單筆支出文件不離開伺服器**。所以不是「前端不顯示」
而是「callable 根本不回」——前者只要有人開 DevTools 就破功了。

畫面上每一頁都有一塊虛線區塊寫明看不到什麼。那不是裝飾，是這條線的介面。

### 二、預設唯讀，只有三個按鈕會改資料

撤下公開報告、停用帳號、強制封存任務。就這三個，全部必填理由，全部寫日誌。

沒有「以使用者身分登入」，沒有代改暱稱，沒有代加支出，沒有刪除。真的需要動
資料的時候走 Firebase Console 加一筆手寫紀錄 —— 那件事一年發生不了幾次，
為它在系統裡開一條繞過所有規則的路不划算。

## 管理者身分放在 token 上，不放 Firestore

```
npm run set-admin -- someone@example.com     # scripts/set-admin.mjs
```

用 Admin SDK 寫 custom claim `{ admin: true }`。三個理由：

1. **沒有「在網頁上把自己升成管理者」這條路。** 如果身分是 `admins/{uid}` 這種
   文件，那就得有一組規則決定誰能寫它，而那組規則本身就是攻擊面。claim 只能
   從有 service account 的地方設定。
2. **規則層完全不用開洞。** `match /users/{uid}` 維持 `allow read: if isSelf(uid)`。
   後台的資料全部走 callable，Admin SDK 繞過規則，所以不需要一條
   `|| isAdmin()` —— 那條一旦加下去就永遠在那裡，而且它保護的是**全部**使用者
   資料。
3. claim 進 token，每支 callable 自己驗，不用多讀一次 Firestore。

**要注意的時間差：** claim 設定後不會立刻出現在已登入的 token 裡，要等下一次
更新（最長 1 小時）或呼叫 `getIdToken(true)`。設定腳本印出來的最後一行要提醒
這件事，不然會以為沒生效。

## 為什麼全部走 callable，不用規則開放讀取

後台要的東西規則層做不到：跨使用者的列表查詢、count 聚合、把單筆支出擋在
伺服器內只回加總、把每一次檢視寫進日誌。這四件事沒有一件是 `allow read` 表達
得出來的。

所有函式在 `asia-east1`，跟 Firestore 同區（見 `functions/src/index.ts` 的
`REGION` 註解）。

## 函式清單

新開 `functions/src/admin.ts`，由 `index.ts` re-export。共用兩個包裝：

```ts
requireAdmin(request)   // 驗 claim，不符丟 HttpsError("not-found")
withAudit(action, fn)   // 跑完寫日誌；日誌寫不進去就整支失敗
```

`not-found` 不是 `permission-denied`：後者等於告訴對方這支函式是真的、只是他
不夠格。

### 讀

| 函式 | 參數 | 回什麼 | 記日誌 |
|---|---|---|---|
| `adminOverview` | `range: "7d"｜"30d"｜"90d"` | 儀表板全部數字，讀每日彙總 | 否 |
| `adminUsers` | `query?, filter, cursor?, limit` | 使用者列表一頁 | 否 |
| `adminUser` | `uid` | 單一使用者 + 他參與的任務 | **是** |
| `adminTasks` | `query?, status, cursor?, limit` | 任務列表一頁 | 否 |
| `adminTask` | `taskId` | 任務統計 + 成員 + 分類佔比 | **是** |
| `adminReports` | `filter` | 公開報告 + 檢舉數 | 否 |
| `adminReport` | `taskId, reportId` | 單篇報告與檢舉內容 | **是** |
| `adminHealth` | `range` | perf 彙總 + functions 指標 | 否 |
| `adminAudit` | `filter, cursor?` | 日誌一頁 | 否 |

**為什麼列表不記、詳情記：** 列表是瀏覽，詳情是「看了某個人的資料」。全部都記
的話，日誌會被翻頁塞滿，而真正該被看見的那幾筆會沉下去 —— 一份沒人讀得完的
日誌等於沒有日誌。

**日誌寫失敗就不回資料。** 順序是先寫日誌再回傳，不是背景寫。允許「看得到但
沒紀錄」等於承認這份日誌可以有缺口。

### 寫

三支，共用同一個 `adminAction()` 包裝（驗 claim → 檢查理由非空 → 執行 →
寫日誌 → 通知當事人）。

| 函式 | 做什麼 | 當事人能不能自己復原 |
|---|---|---|
| `adminRevokeReport` | `report.active = false`、`listed = false` | 能，修好後重新分享 |
| `adminDisableUser` | Auth `updateUser(uid, { disabled: true })` + `revokeRefreshTokens` | 不能，要找管理者 |
| `adminArchiveTask` | `task.status = "archived"` | 能，擁有者自己解除封存 |

三支都不刪資料。停用帳號不刪 `users/{uid}`，也不動他記過的支出 —— 那些是同行
者共同的帳，理由跟帳號刪除那份規格裡「帳目留下」是同一個。

### 使用者列表被資料形狀改小了（2026-09-06）

設計稿上的列表有「參與幾個任務、記過幾筆支出」兩欄，篩選有「未建立任務」
與「已停用」。實作時四個都拿掉了，而且都不是「先做簡單版」：

| 拿掉的 | 為什麼 |
|---|---|
| 列表的任務數／支出數 | 不在 `users` 文件裡。每一列要各發兩趟查詢，一頁 25 人就是 50 趟。搬到詳情面板，那裡一次只看一個人。 |
| 「未建立任務」篩選 | 同上。要先知道每個人的任務數才篩得出來。 |
| 「已停用」篩選 | `disabled` 旗標在 Firebase Auth 不在 Firestore，Firestore 查詢看不到它。詳情面板多讀一次 Auth 就有，但列表沒辦法。等停用功能做的時候在 users 文件鏡射一份才能篩。 |

換上的兩個篩選是「近 7 日活躍」與「30 天沒來」，都是 `lastSeenAt` 的範圍查詢。

**這兩個篩選有一個看不到的角落**，而它剛好是最該被看到的一群：Firestore 的
範圍查詢只掃**有那個欄位**的文件，所以戳記上線之前註冊、之後沒再開過的帳號
不會出現在任何一個篩選裡，包含「30 天沒來」。callable 回傳一個 `blindSpot`
字串，畫面在篩選啟用時顯示它。

### 搜尋只有前綴，這件事要寫在畫面上

Firestore 沒有全文搜尋。三種比對：UID 精確（28 字元英數）、Email 精確、
暱稱**前綴**。

搜「小美」找不到「陳小美」。不寫出來的話，那會被當成「這個人不存在」——
一個會讓人做出錯誤結論的沉默失敗。

### 翻頁的游標帶兩個值

排序欄位的值**加上文件 ID**。只帶時間的話，同一毫秒註冊的兩個人會在翻頁
邊界互相蓋掉，其中一個永遠出不來 —— 而批次匯入與種子資料很容易造出同一
毫秒的一批人。

游標解不開時報錯，不要默默從頭開始：那會讓使用者按下一頁看到第一頁，
然後以為那就是全部。

### 任務詳情的金額：兩個會安靜出錯的地方

**總額少算舊資料。** `baseAmount` 是後來才加的欄位，之前的支出是 null，而
`sum` 聚合會直接跳過非數值 —— 總額會少算，而且沒有任何症狀。所以另外數一次
`baseAmount == null` 的筆數，畫面上寫「總額不含這 N 筆」。

**百分比加起來不是 100。** 三等分四捨五入之後是 99。這裡刻意不去湊：湊的做法
是把差額塞給最大的那一項，而那會讓最大的那一項顯示一個跟它的金額對不上的
百分比 —— 用一個看不見的錯換掉一個看得見的，不划算。佔比條的長度用的是金額
比例不是這個整數，所以條本身是對的。有一條測試把「它不會等於 100」寫下來，
免得下一個人看到 99 以為是 bug。

另外，金額全部由後端加總完才回傳，**單筆支出的文件不離開伺服器**。`sum` 與
`count` 聚合都是伺服器算完只回一個數字 —— 隱私邊界靠的就是這件事，不是前端
不顯示。收據只給張數：我們數得出來，但不給看。

### 公開報告：沒有「被檢舉」

設計稿原本有一個檢舉分頁，卡片上有檢舉數與檢舉理由。做不出來 ——
**app 裡沒有任何地方讓使用者檢舉報告**。要有那個分頁得先做一個面向使用者的
功能：按鈕放哪、填什麼、寫進哪個集合、誰讀得到、規則怎麼寫。那是一個獨立
的功能，不是後台加一個查詢。

換成資料答得出來的四個分頁：探索頁上的、只給連結、已撤下、全部。
`active` 與 `listed` 本來就是兩件事 —— 前者是「拿到連結的人看不看得到」，
後者是「陌生人找不找得到」，而這個區分在後台比「有沒有被檢舉」有用。

畫面上留了一句話說明為什麼沒有那個分頁。不寫的話，下一個看設計稿的人會
以為它被漏掉了。

### 系統健康：只有效能那一半

`perf` 集合從六月就在寫，規則是 `allow read: if false` —— 三個月的資料
沒有人讀得到。現在讀得到了：每頁的 p50/p75/p95、冷熱啟動分開的中位數、
以及「最慢的那一段」各出現幾次。

**百分位數用最近排名不用內插。** 這些是毫秒，而使用者體驗過的是某一次真實
的載入，不是兩次載入的加權平均 —— p95 應該是一個真的發生過的數字。

**樣本少於 5 筆不給中位數**，回 null 讓畫面說「樣本不足」。三筆算出來的
中位數不是統計是巧合，而畫面上的數字看起來一樣確定。

**只讀 `mode == "prod"`。** dev 的樣本跑在開發者筆電上、vite 不打包，混進來
會讓中位數變好看而且是假的。

**~~固定七天，而且不收 range 參數。~~**（2026-09-07 改掉）當初的理由是「一天約
一千筆，七天是一支 callable 的極限」—— 那個限制是真的，但解法不是不給選，
是先把每天的分佈壓成直方圖。現在 7/30/90 天都收，見下面「效能的長區間」。

設計稿上那張 **Cloud Functions 呼叫數與失敗率的表沒有做**。那份資料在
Cloud Monitoring 不在 Firestore，兩條路都不便宜（接 Monitoring API 要多一組
權限與相依；每支函式自己累加要動六支正在服役、而且發送路徑沒有測試的函式）。
畫一張沒有資料的表比沒有更糟。

這件事由 **callable 回傳一個 `missing` 陣列**告訴畫面，不是前端寫死。寫死的
話，等它做好了那句話會留在畫面上沒人記得拿掉。

### 停用不是立刻生效，而這句話必須留在畫面上

`disabled` 擋的是換發 token。他手上那張 ID token 最長還能用 1 小時，這段時間
他仍然讀得到、也寫得進他已加入的任務。`revokeRefreshTokens` 救不了這一小時 ——
它作廢的是 refresh token，不是已經發出去的 ID token。

要真的立刻斷，得在規則層檢查 `auth.token.auth_time`，那會讓**每一條**規則都多
一次判斷。為了一個一年用不到幾次的功能不值得，所以接受這個延遲。

接受歸接受，**這個限制不能只活在這份文件裡**。文件會被忘記，對話框不會 ——
所以確認停用的對話框裡有一塊紅框，文案照這樣寫，不要簡化成「可能有延遲」：

> **不是立刻生效，最長還有 1 小時**
>
> 停用擋的是換發新憑證。他手上那張最長還能用 1 小時，這段時間仍然讀得到、
> 也寫得進他已加入的任務。這是 Firebase 換發 token 的機制，關不掉。真的緊急
> 就先撤下他的公開報告、封存出問題的任務。

使用者頁面的危險區也要有一句短的（「最長 1 小時後才會真的擋住」），因為那是
按下按鈕之前唯一會看到的地方。

`adminDisableUser` 的回傳值帶 `effectiveAt: at + 1 小時`，讓畫面說得出確切
時間而不是照抄「1 小時」。

## 每日彙總

### 為什麼不即時算

儀表板上那幾個數字是全表 count。使用者 1,284、支出 47,930 的時候還好，再大
一個數量級，「打開儀表板」就變成一次全表掃描，而且是每次打開都掃。

排程每天 04:00（`Asia/Taipei`）算一次寫成一份文件，儀表板讀 30 份文件。代價是
數字不是即時的，畫面上寫「最後彙總 09-06 04:02」把這件事講明。

```ts
export const aggregateDaily = onSchedule(
  { schedule: "0 4 * * *", timeZone: "Asia/Taipei", region: REGION },
  ...
);
```

### `stats/daily/days/{YYYY-MM-DD}`

```
date        "2026-09-06"
users       { total, new }
tasks       { active, archived, deleted, new }
expenses    { total, new }
dau         402                                  // 見下一節
platforms   { web, android, ios }                  // 沒有 multi，見下
cohort      { matured, retained }                // 當天滿 7 天的任務 / 其中有 3 筆以上支出的
computedAt  Timestamp
version     1                                     // AGGREGATE_VERSION，改定義就加一
```

`total` 用 Firestore 的 `count()` 聚合查詢，不是把文件讀回來數 —— 前者每 1000
筆索引項目才算一次讀取。`new` 是 `count(where createdAt >= 當天 00:00 < 隔天)`。

### 為什麼沒有「兩者都用」

設計稿原本有這一格。做不出來，而且不是難做是**資料形狀決定的**：`lastPlatform`
只記最後一次，同一個人同一天先開網頁再開 App，第二次就把第一次蓋掉了。

要算得出來得改成每天記一個平台集合，那是為了一個沒有人在等的數字多一份寫入。
所以拿掉那一格，並且在畫面上寫明白這條線算的是「當天**最後一次**開啟在哪」——
不寫的話，看的人會自己把它讀成「有多少人用網頁」，而那是另一個數字。

設計稿已經跟著改掉。

**`version` 不能省。** 彙總的定義一定會改（「活躍」的門檻、「留存」算幾天），
改完之後舊的那幾天是用舊定義算的。沒有這個欄位就分不出來，而折線圖會若無其事
地把兩種定義畫成同一條線。

### 留存怎麼算

「建立任務後 7 天內記了 3 筆以上支出」不能用 `task.expenseCount` —— 那是累計
值，不是前七天的。排程每天挑出**當天剛好滿 7 天**的任務，對每個做一次
`count(expenses where createdAt <= 建立時間 + 7 天)`，結果進 `cohort`。

一天大概 2–3 個任務到期，成本可以忽略。

## 活躍人數的來源（2026-09-06 已完成）

`UserProfile` 只有 `createdAt` 與 `updatedAt`，**沒有任何欄位記錄「這個人今天
有來」**。`perf` 集合有 uid 跟時間，但它只追兩個頁面而且是抽樣的，拿它當 DAU
會系統性低估。

所以儀表板的折線圖與「使用裝置」那塊，要先有這個：

```
users/{uid}
  lastSeenAt   Timestamp
  lastPlatform "web" | "android" | "ios"
```

用戶端在啟動時寫，**一天最多一次**（用 localStorage / SharedPreferences 記
上次寫的日期擋掉其餘的）。1,284 個使用者一天 1,284 次寫入，成本可以忽略；
不擋的話就是每次開 App 都寫一次。

這是整份規格唯一要動 `firestore.rules` 的地方：

```
allow update: if isSelf(uid)
  && request.resource.data.uid == resource.data.uid
  && request.resource.data.diff(resource.data).changedKeys()
       .hasOnly(["nickname", "email", "photoURL", "provider", "updatedAt",
                 "lastSeenAt", "lastPlatform"])
  && (!("lastSeenAt" in request.resource.data.diff(resource.data).changedKeys())
      || request.resource.data.lastSeenAt == request.time);
```

最後那條是必要的：少了它，任何人都能把自己的 `lastSeenAt` 寫成任意時間，
而那個欄位是儀表板上唯一一條會被拿來做決定的線。

### 回填的實話

`users.new`、`tasks.new`、`expenses.new`、各種 `total` 可以用 `createdAt` 回填 ——
那些是歷史事實，過去發生了就在那裡。

**DAU 與平台分佈回填不了**，因為 `lastSeenAt` 在部署之前不存在。折線圖上線後
前 30 天會是空的。不要用註冊數或支出數去「估」一條看起來像 DAU 的線 —— 那條
線唯一的用途就是被拿來做決定，而它會是假的。畫面上留一句「累積中」。

### 順手挖出來的：六條 hasOnly 守衛本來全部形同虛設

實作這條規則時，新寫的測試有五條「該擋沒擋」。查下去發現不是新規則的問題，
是 `changedKeys()` 的語義跟大家以為的不一樣：

> `changedKeys()` 只回**兩邊都有、而值不同**的欄位。新增的欄位屬於
> `addedKeys()`，不在裡面。

所以 `changedKeys().hasOnly([...])` 實際表達的是「不准改這幾個以外的**既有**
欄位」，而不是它看起來的「這次寫入只能碰這幾個欄位」。用 emulator 的
`debug()` 量到的實情：

```
request.resource.data.keys()  →  [admin, createdAt, email, nickname, ...]
resource.data.keys()          →  [createdAt, email, nickname, ...]
diff().changedKeys()          →  {}          ← 空的
```

`updateDoc(users/自己, { admin: true })` 會成功，欄位真的落到後端。

`firestore.rules` 裡有六個位置是同一種寫法，所以六個一起破：任務的
`updatesExpenseCountOnly` 與 `changesStatusAsOwner`、個人檔案的 update、
成員的 `renamesSelf`、付款的確認收款。全部改成 `affectedKeys()`（新增 + 刪除
+ 變更的聯集），既有的 190 條規則測試沒有一條被弄壞。

嚴重程度不一：多數只是能往文件塞垃圾欄位（角色、狀態這些既有欄位本來就
擋著），但個人檔案那條等於一塊沒有上限的免費私人儲存空間，而那正是收藏與
推播 token 兩個集合特地加欄位數上限要防的事。

`tests/firestore.rules.test.mjs` 加了一組回歸測試，六個位置各挑一個代表，
確認「多塞一個新欄位」會被擋。改回 `changedKeys()` 的話那組會紅。

## 效能的長區間（2026-09-07）

**每天存直方圖，不存每天的百分位數。**

百分位數不能跨天相加，所以「每天算好 p50/p75/p95」這條路走不通 —— 要在任意
區間算出正確的答案，唯一的辦法是保留分佈本身。排程一天寫一份
`stats/perf/days/{YYYY-MM-DD}`，裡面是每頁的稀疏直方圖（冷、熱各一份，
加上「最慢的那一段」的計數）。要看 30 天就把 30 份的桶相加再算百分位。

**桶寬 100 毫秒，等寬不等比，上限 60 秒。** 等比給的是固定的相對誤差，等寬
給的是固定的絕對誤差 —— 而人對載入時間的感受是絕對的：沒有人在乎 300 還是
350 毫秒，但 1.9 秒跟 2.4 秒是兩種體感。誤差該固定在對的那個維度上。

**桶回上界不回下界。** 桶化一定有誤差，方向要選：高估自己的載入時間是安全的，
低估會讓一個真的在變慢的頁面看起來還好。畫面上會標出「最多高估 100 毫秒」——
兩位小數的秒數看起來精確到 10 毫秒，而它不是，那個精確度會被當真。

**60 秒以上進溢位桶。** 分辨 61 秒跟 400 秒沒有意義，但把它們算進樣本數有：
它們得留在分母裡，不然 p95 會因為丟掉了最慢的那幾筆而變好看。

**`percentileOf` 跟 `percentile` 用同一個排名公式**，所以桶算出來的答案跟拿
原始樣本算出來的只差一個桶寬。`histogram.test.ts` 裡那條等價性測試就是在證明
這件事 —— 它是「用直方圖換取更長的區間」唯一的正當性來源，而 `perf.ts` 的
`percentile` 已經沒有 callable 在用了，留著就是為了當那條測試的對照組。

**`PERF_VERSION`：桶寬或桶數改了就要加一。** 桶號的意思會跟著桶寬變 —— 沒有
這個欄位，一份用 100 毫秒算的文件跟一份用 50 毫秒算的會被若無其事地加在一起，
而結果不會噴錯，只是錯的。

**缺哪幾天要講出來。** 排程會失敗，而少一天的後果是「近 30 天的 p95」默默變成
「近 29 天的」—— 一個看起來完全正常、只是不是你以為的那個區間的數字。callable
回 `missingDays`，畫面把它印在最上面。

**`adminBackfill` 一起補。** perf 樣本從 2026-06 就一直在寫，所以歷史補得回來
而且是真的 —— 這一份跟 dau 不一樣（見 `DAU_SINCE`），不需要任何警語。

## 系統健康的資料從哪來

**perf**：全部走 `stats/perf/days/{date}`，由每日排程順便算。

原本這裡寫的是「排程順便算好 p50/p75/p95」。**那是錯的** —— 百分位數不能
跨天相加。七天的 p95 既不是七個 p95 的平均，也不是它們的最大值，那兩個數字
都不對應任何一次真實的載入。實際做的是存**直方圖**：見下面「效能的長區間」。

**Cloud Functions 的呼叫數與失敗率**：Firestore 裡沒有這個東西，那是 Cloud
Monitoring 的資料。兩條路：接 Monitoring API（多一個相依與一組權限），或每支
函式自己 `FieldValue.increment` 累加到 `stats/functions/{YYYY-MM-DD}`。

選後者。最忙的 `onExpenseCreated` 一天 2,190 次，換算下來遠低於單一文件每秒
一次寫入的上限，而且不用新權限。代價是每次呼叫多一次寫入，以及**計數自己失敗
時會少算** —— 所以這張表是趨勢不是帳，畫面上不要拿它當精確值用。

**2026-09-07 補記：這個選擇要重新想。** 「計數自己失敗時會少算」這句話當時被
當成一個可接受的代價，但它其實推翻了整個方案：函式 crash 或逾時的時候，那行
`increment` 根本跑不到，而**那正是失敗率最該抓到的那一類失敗**。自己數只數得到
「有回應、但回了錯誤」的那種，數不到「根本沒回應」的那種。一個永遠漏掉最嚴重
那類失敗的失敗率，比沒有更容易讓人做出錯誤結論 —— 它會在真的出事的那天顯示
一切正常。Monitoring API 的相依與權限是實打實的成本，但它數的是對的東西。

## 稽核日誌

### `adminLogs/{autoId}`

```
at          Timestamp
adminUid    string
adminEmail  string
action      "view.user" | "view.task" | "view.report" | "export.stats"
            | "act.revokeReport" | "act.disableUser" | "act.archiveTask"
            | "denied.access"
kind        "view" | "act" | "denied"    // 從 action 推出來，但要存，見下
targetType  "user" | "task" | "report" | "route"
targetId    string
targetLabel string        // 當下的暱稱／任務名，之後改名了也查得到當時看的是誰
reason      string | null // 三個處置必填，檢視是 null
ip          string
userAgent   string
result      "ok" | "error"
expireAt    Timestamp     // at + 400 天，交給 Firestore TTL 政策
```

規則：`allow read, write: if false`。**管理者本人也不能讀寫**，讀要走
`adminAudit`，寫只有 Admin SDK 進得去。這條的意思是：沒有任何一個登入身分
可以修掉自己的紀錄。

`targetLabel` 存的是當下的名字，不是指標。理由跟結算快照存 `memberNames` 一樣 ——
之後改名了，日誌要說得出「當時看的是誰」。

`denied.access` 是非管理者打 `/admin` 或呼叫這些函式時記的。這是唯一一種不是
管理者做的動作，但它正是最該留下來的那種。

### 為什麼 `kind` 要存，不在查詢時從 action 推

「只看處置」直覺上是 `action` 的前綴過濾（`>= "act."`）。做不到：Firestore
要求**範圍欄位必須是第一個排序欄位**，所以那樣就得照 `action` 排序 —— 而這份
日誌唯一有意義的排序是時間由新到舊。

多存一個等值欄位，才換得回「只看處置、而且照時間排」。它是從 `action` 推
出來的（`kindOf`，有測試），存進去只是為了讓 Firestore 查得動。

讀的時候要當成可能不存在：`kind` 是後來才加的，在那之前寫進去的幾筆沒有它。
同一個坑 `virtual` 與 `listed` 都踩過。

### 讀日誌不寫日誌

`adminAudit` 自己不留紀錄。除了「列表是瀏覽」這條通則之外還多一個理由：
讀日誌會寫日誌的話，翻幾頁就把真正該被看見的那幾筆推到後面去了。

## 索引

**先分清楚哪些不用宣告。** Firestore 會自動替每個欄位建單欄位索引，所以
`users.lastSeenAt`、`users.createdAt`、`tasks.createdAt`、`adminLogs.at` 這些
單欄位排序與範圍查詢**不需要進 `firestore.indexes.json`**。寫進去只是多幾行
沒有作用的設定，然後讓下一個讀的人以為它們有作用。

真正要宣告的只有三種：

| 集合 | 索引 | 給誰用 |
|---|---|---|
| `tasks` | `status ASC, updatedAt DESC`（複合） | 任務列表的四個分頁 |
| `adminLogs` | `action ASC, at DESC`（複合） | 「只看處置」「只看檢視」 |
| `expenses` | `createdAt` + **COLLECTION_GROUP 範圍**（`fieldOverrides`） | 每日新增支出的 count |

最後那條是最容易漏的：自動建立的單欄位索引只有 collection 範圍，跨所有任務數
支出需要 collection group 範圍，那個要自己開。現有的 `reports` 那條 collection
group 索引就是同一件事。

排程用到的兩個已經加進 `firestore.indexes.json`（2026-09-06）：`users` 的
複合索引，以及 `expenses.createdAt` 的 collection group 範圍。`tasks` 與
`adminLogs` 那兩個等列表頁真的寫出來再加 —— 替一個還不存在的查詢先建索引，
只會得到一個沒人知道還需不需要的索引。

## 索引：本機測不到，只有正式站會說話

**Firestore emulator 不檢查索引。** 所以 205 條規則測試、160 條函式測試、
`vue-tsc`、build 全綠，卻有兩個查詢一上正式站就 500。這不是測試寫得不夠，
是那一類問題本機看不到 —— 每加一個查詢都要自己回頭對一次索引。

上線後被打臉的兩個：

| 查詢 | 我以為 | 實際 |
|---|---|---|
| `expenses.where(category==).aggregate(sum(baseAmount))` | 只要 category 的自動索引 | **sum() 要求被加總的欄位也在索引裡**，需要 `(category, baseAmount)` |
| `adminLogs.where(kind==).where(at>=)` | `(kind, at DESC)` 兩邊通吃 | 沒有明寫 orderBy 時，範圍欄位的隱含排序是**遞增** —— 要另一個 `(kind, at ASC)` |

第二個特別值得記：同樣兩個欄位、只差排序方向，就是兩個索引。「有一個
`(kind, at)` 索引了」不代表任何 `(kind, at)` 的查詢都跑得動。

### 全部查詢的索引對照

一個一個對過，不是等 500 再修：

| 位置 | 查詢 | 靠什麼 |
|---|---|---|
| `adminOverview` | `tasks.where(status==)` count | 自動單欄位 |
| | `collectionGroup(expenses)` count | 無篩選，靠 `__name__` |
| | `stats/daily/days` 日期範圍 | 自動單欄位 |
| `adminUsers` | `users` 照 createdAt / lastSeenAt 排 | 自動（含 `__name__` 同向） |
| | email 等值、nickname 前綴 | 自動單欄位 |
| `adminUser` | `tasks.where(memberIds contains).orderBy(updatedAt)` | 複合 |
| | `collectionGroup(expenses).where(createdBy==)` | fieldOverride（CG 範圍） |
| `adminTasks` | `tasks.where(status==).orderBy(updatedAt desc)` | 複合 |
| `adminTask` | `expenses.where(category==)` + `sum(baseAmount)` | 複合 ← **漏過** |
| | `expenses.where(baseAmount==null)` / `where(receipt!=null)` count | 自動單欄位 |
| `adminReports` | `reports` CG，active/listed + updatedAt | 複合 ×2 + fieldOverride |
| `adminHealth` | `perf.where(mode==).where(day in)` | 複合 |
| `adminAudit` | `adminLogs.where(kind in).orderBy(at desc)` | 複合（at DESC） |
| | `adminLogs.where(kind==).where(at>=)` count | 複合（at **ASC**）← **漏過** |
| `aggregateDaily` | `users.where(lastPlatform==).where(lastSeenAt 範圍)` | 複合 |
| | `collectionGroup(expenses).where(createdAt 範圍)` | fieldOverride（CG 範圍） |

還沒被證實的兩個：無篩選的 collection group count，以及 `receipt != null` 的
count。前者在總覽（那頁進得去，所以應該沒事），後者在任務詳情 —— 詳情是在
分類加總那一步就爆了，所以還沒輪到它。索引補上之後要再確認一次。

## 用戶端

路由掛在 `/admin` 底下，`meta: { requiresAdmin: true }`。守衛讀
`getIdTokenResult()` 的 `claims.admin`，不符就導到找不到頁面 —— **網址不變**，
回 404 而不是「權限不足」。

整個後台是一個獨立的 lazy chunk。非管理者不只是看不到，是**連那包 JS 都不會
下載**。這跟 `stores/user.ts` 裡把 `memberService` 改成動態 import 是同一個
考量：不要為了一個幾乎沒人會用到的東西，讓每個人的每次開啟都多下載一份。

多一包就多一個成環的機會，所以 build 之後照樣要跑 `scripts/check-chunks.mjs`——
它查的是 chunk 之間的循環相依，而那種錯 build 不會報、dev 也正常，只有正式站
會噴 `Cannot access 'x' before initialization`。

## 不做的事

- **不做以使用者身分檢視。** 那是這份規格裡最想要也最不能有的功能：它會讓上面
  第一條線整條失效。
- **不做管理者分級。** 只有一種 admin。兩個人以下的團隊做角色矩陣，維護成本
  全部落在沒有第二個使用者的抽象上。
- **不做申訴流程。** 被停用的人寄信，人工處理。
- **手機 App 不做。**

## 測試

沿用現在 `functions/src/*.test.ts` 的做法：把可以純函式化的部分抽出來測，不去
測 Firestore 本身。

- `admin/range.ts` —— `"30d"` 解析成起訖時間，跨月、跨年、時區邊界
- `admin/aggregate.ts` —— 給定 count 結果組出每日文件，含 `version`
- `admin/audit.ts` —— 組日誌 payload：理由空字串要被擋下、`expireAt` 是
  `at + 400 天`
- `admin/guard.ts` —— 沒有 claim、claim 是 `"true"` 字串、claim 是 `false`

## 部署順序

1. ~~`lastSeenAt` / `lastPlatform` 的規則與用戶端寫入~~（2026-09-06 完成）
2. ~~`adminOverview` 與 `/admin` 骨架~~（2026-09-06 完成）——
   累計的四塊磚是即時 count，不等排程；折線圖顯示「累積中」
3. ~~排程與每日彙總，加上索引~~（2026-09-06 完成）
4. ~~使用者列表與詳情~~（2026-09-06 完成，第一個真的會寫檢視日誌的地方）
5. ~~稽核日誌~~（2026-09-06 完成）
6. ~~任務列表與詳情、三個處置~~（2026-09-06 完成）
7. ~~公開報告審核、系統健康~~（2026-09-06 完成）

設計稿上的六頁到齊了。

順序調過。原本把 callable 排在最後，但那樣在資料累積的這幾週裡完全進不去
後台 —— 而累計數字（使用者、任務、支出）根本不需要等排程，count 聚合當場
就算得出來。先讓它進得去、看得到那幾個數字，折線圖等資料長出來再接。

### 已經在跑的部分

- `adminOverview`：累計四個數字用即時 count 聚合，時間序列讀
  `stats/daily/days`（現在是空的，回傳 `coverage: { expected, present: 0 }`）。
- `/admin` 是一道**門**（`AdminGate.vue`）而不是後台本身：門確認過 claim
  才動態載入後台那包 JS。實測分包 —— 門 1.78 KB、後台 4.82 KB，不是管理者
  的人只下載前者，而前者渲染的是找不到頁面。
- 那一頁刻意沒有側邊導覽。只有一個項目的選單不是導覽，是裝飾。

### 排程

`aggregateDaily` 每天 04:00（台北）算**前一天**。前一天而不是今天，因為今天
還沒過完 —— 算一個進行中的日子會得到一個每小時都在變的數字，而它會被畫在
折線圖的最後一點上，看起來像「今天掉了」。

文件 ID 就是日期，所以重跑同一天是覆蓋不是長出第二筆。排程重試與手動補算
都靠這個性質。

`adminBackfill` 補算一段日期（一次最多 31 天）。`users`、`tasks`、`expenses`
的數字補得回來（`createdAt` 是歷史事實），**但 dau 與平台分佈補不回來** ——
`lastSeenAt` 在部署之前不存在，補出來的那幾天一律是 0。那個 0 是假的，
所以回傳值帶著一句警告，呼叫端要把它講給使用者聽。

日界線是量出來的不是寫死的。台北的一天在 UTC 是前一天 16:00 到當天 16:00，
直接拿 `new Date("2026-09-05")` 當起點會每天少算八小時 —— 而且少算的方向
永遠一樣，看起來只是「數字比預期低一點」，不會有任何症狀。有一條測試連續
檢查 60 天的邊界不漏也不疊。

### 還沒接上的

六頁都在了，三個處置也都有畫面呼叫得到。剩下的不是頁面，是兩個**設計稿
承諾過但資料答不出來**的東西，見下面兩節。

### 三個處置的骨架

`adminAction()` 把「驗身分 → 檢查理由 → 做事 → 寫日誌 → 通知當事人」包成
一個順序。抽出來不是為了少打字，是為了讓其中一步**不可能被漏掉** —— 三支
各寫一份的話，漏掉的那一份不會噴錯，只會安靜地留下一個沒有紀錄的處置。

理由是**先驗再動手**。`auditEntry` 是純函式，所以可以先跑一次拿它的判斷；
不先驗的話，理由沒填的情況會變成「事情做完了、日誌寫不進去」，那正是最不該
發生的組合。

通知另外寫了一支 `notifyUser`，沒有跟 `onExpenseCreated` 共用發送邏輯。那一段
是多人、要分批、還要清死 token，而且**沒有測試** —— 為了省下二十幾行去動它，
換來的是使用者每天在用的那個通知有可能壞掉。這裡只送給一個人，簡單得多。

跟那邊同一個原則：寧可不推播，也不要讓例外冒出去。處置已經做完也寫進日誌了，
通知沒送到不該讓整支函式失敗 —— 那會讓管理者以為處置沒生效而再按一次。
