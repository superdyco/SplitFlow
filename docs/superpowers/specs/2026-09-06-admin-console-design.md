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
platforms   { web, android, ios, multi }
cohort      { matured, retained }                // 當天滿 7 天的任務 / 其中有 3 筆以上支出的
computedAt  Timestamp
version     1                                     // AGGREGATE_VERSION，改定義就加一
```

`total` 用 Firestore 的 `count()` 聚合查詢，不是把文件讀回來數 —— 前者每 1000
筆索引項目才算一次讀取。`new` 是 `count(where createdAt >= 當天 00:00 < 隔天)`。

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

## 系統健康的資料從哪來

**perf**：24 小時那一檔即時讀（約 1,000 筆，可接受）；7 天與 30 天讀
`stats/perf/days/{date}`，由同一支排程順便算好 p50/p75/p95。

**Cloud Functions 的呼叫數與失敗率**：Firestore 裡沒有這個東西，那是 Cloud
Monitoring 的資料。兩條路：接 Monitoring API（多一個相依與一組權限），或每支
函式自己 `FieldValue.increment` 累加到 `stats/functions/{YYYY-MM-DD}`。

選後者。最忙的 `onExpenseCreated` 一天 2,190 次，換算下來遠低於單一文件每秒
一次寫入的上限，而且不用新權限。代價是每次呼叫多一次寫入，以及**計數自己失敗
時會少算** —— 所以這張表是趨勢不是帳，畫面上不要拿它當精確值用。

## 稽核日誌

### `adminLogs/{autoId}`

```
at          Timestamp
adminUid    string
adminEmail  string
action      "view.user" | "view.task" | "view.report" | "export.stats"
            | "act.revokeReport" | "act.disableUser" | "act.archiveTask"
            | "denied.access"
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

這些等到查詢真的寫出來再一起加 —— 替一個還不存在的查詢先建索引，只會得到
一個沒人知道還需不需要的索引。

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

1. `lastSeenAt` / `lastPlatform` 的規則與用戶端寫入先上，讓資料開始累積
2. 索引（等它建完，大集合會跑一陣子）
3. 排程與回填腳本
4. callable 與後台頁面

第 1 步跟第 4 步中間隔越久，折線圖上線時就越有東西可看。
