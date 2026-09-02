# 任務頁改版：結算上頂、導覽進網址

日期：2026-09-02

## 目標

`TaskPage` 是使用者花最多時間的一頁，但它有兩個結構性問題。

**第一，答案藏在第三個頁籤裡。** 「我還要付誰多少」是這個 app 存在的理由，
卻要切到「結算」才看得到。同一時間，任務列表頁剛做完的 hero 一眼就給得出
總花費——點進去反而什麼數字都沒有。那個落差是 `2026-09-02-web-visual-system`
那一輪造成的。

**第二，兩層頁籤上下相疊。** 「支出／成員／結算」底下又是「清單／地圖」，
兩排長得一模一樣的膠囊，只能靠位置分辨哪一排是主層級。

這份規格把結算的**結論**搬到頂部的摘要卡，完整的結算面板降成次頁，頂層頁籤
收成兩個，並把頁籤狀態從本地 `ref` 搬進網址。

## 範圍

**要做的**

- `TaskPage` 頂部新增摘要卡：我的分攤、跟我有關的轉帳、未換算警告
- 頂層頁籤從三個收成兩個（支出／成員）
- 結算改為 `?view=settlement` 次頁，從摘要卡進入
- 頁籤與檢視狀態搬進網址 query，並區分 `push` 與 `replace`
- 「清單／地圖」從第二排頁籤降級為分段控制
- 修掉導覽守衛對 query-only 導航重複開 trace 的問題
- 分享報告區塊收成一行可展開
- 修掉 `.tabs` / `.tab` 的巢狀圓角回歸
- 補上 `styles.css` 漏掉的六個顏色 token

**明確不做的**

- **不改 `SettlementPanel` 的內部。** 570 行，含付款記錄與確認流程。這次只搬位置。
- **不改 `settleExpenses` 與任何金額計算。**
- **不改 `load()` 的 `Promise.all`。** 它跟剛在 `loadCosts` 修掉的是同一個模式
  （任一失敗就整批失敗），但那是另一件事，這次只記下來。
- **不動 `flutter_app/`。**
- **不加快取或共用 store。** 選用 `?view=` 而不是新路由，正是為了不必做這件事。

## 一、導覽與網址

### 1.1 網址對照

| 網址 | 顯示 |
|---|---|
| `/tasks/:id` | 支出（清單）——預設 |
| `/tasks/:id?map=1` | 支出（地圖） |
| `/tasks/:id?view=members` | 成員 |
| `/tasks/:id?view=settlement` | 結算次頁 |

`view` 的合法值是 `members` 與 `settlement`；缺值或不認得的值一律當成支出。
`map=1` 只在支出檢視下有意義，其餘檢視忽略它。

**切回支出時把 `view` 從網址移除，不寫成 `?view=expenses`。** 預設值不該
出現在網址裡——寫進去只會讓分享出來的連結多一段沒有資訊的雜訊。但
`?view=expenses` 打進來要能認得，因為那是人會手打或別人貼過來的東西。

### 1.2 為什麼是 query 而不是新路由

四個 composable（`useTask`、`useTaskMembers`、`useExpenses`、`usePayments`）
各自持有本地 `ref`，沒有任何快取或共用 store。真的開一個
`/tasks/:taskId/settlement` 路由的話，每次進去都會把 task、members、expenses、
payments 重查一次——而 `router/index.ts` 的註解寫著「內頁一次六趟」，
這個專案已經為冷啟動投入了 `perfTrace`、`stallGuard`、`recoverConnection`。
在一個常按的連結後面放一次完整重查，是直接跟那些工作對著幹。

只改 query 的導航，Vue Router 不會重新掛載元件，所以**零重查**，而且返回鍵、
重整、傳連結全都能用。

### 1.3 push 與 replace 要分開

| 動作 | 方法 | 為什麼 |
|---|---|---|
| 支出 ↔ 成員 | `replace` | 同層級切換，不是「去了別的地方」。用 `push` 的話要按五次返回才離得開任務頁 |
| 清單 ↔ 地圖 | `replace` | 同上，而且它只是檢視偏好 |
| 進入／離開結算 | `push` | 次頁就該用返回鍵回得來 |

用 `replace` 也讓頁籤維持今天的返回語意（按返回離開任務頁），只是多了可重整、
可傳連結、可深連結。

### 1.4 順帶解掉的三個既有毛病

- 今天重整頁面一定跳回支出，因為 `activeTab` 是 `TaskPage.vue` 的本地 `ref`。
- 今天沒辦法把「成員」或「結算」的連結傳給人。
- 今天手機返回鍵在任何頁籤上都直接離開任務頁。

### 1.5 必須一併修的副作用：重複開 trace

`router/index.ts` 的 `beforeEach` 對 query-only 導航照樣會跑，而
`traceNameFor(to.path)` 只看 `path`、看不到 query。所以每切一次頁籤都會
`startTrace("task")`——而元件沒有重新掛載，`TaskPage` 的 `onMounted` 不會再跑，
`finishTrace` 永遠不會被呼叫。

兩個後果：`tracedCounts` 被灌水；更糟的是**使用者在頁面還在載的時候切頁籤，
真正那一筆 trace 會被蓋掉**。

修法：在 `traceNameFor` 之前判斷 `to.path === from.path` 就跳過整段追蹤。

```ts
// query 變了但路徑沒變 —— 那是頁內切換，不是一次頁面載入。
// 不擋的話每切一次頁籤都會開一筆永遠不會結束的 trace，還會蓋掉正在進行的那筆。
const samePage = to.path === from.path;
const traceName = samePage ? null : traceNameFor(to.path);
```

## 二、摘要卡

位置在標題區底下、頁籤列上方；封存橫幅與分享區塊排在摘要卡之後、頁籤之前。

只在支出與成員檢視顯示，結算次頁不顯示（完整面板已經涵蓋）。在兩個頁籤之間
維持不動是刻意的——它是這一頁的錨點，切頁籤時消失會讓版面上下跳；而進結算
次頁本來就是換一個畫面，那時候的變動是預期中的。

**資料還沒到時整張卡不出現**，不畫骨架。頁面層級已經有 `LoadingState`，
再疊一個骨架等於同一件事說兩次。

```
┌─────────────────────────────────────┐
│ 我的分攤                             │
│ 31,480                              │  ← --text-display 34px, tabular-nums
│ 這趟總額 125,920 · 25 筆             │  ← --text-tiny, muted
│ ─────────────────────────────────── │
│ 你付給 小華                  2,340   │  ← ink
│ 阿哲付給 你                  1,180   │  ← success 綠
│ ─────────────────────────────────── │
│ 有 2 筆支出還沒有匯率，沒有算進上面   │  ← danger，只在 unconverted 有東西時
│ ─────────────────────────────────── │
│ 完整結算與付款紀錄 →                 │
└─────────────────────────────────────┘
```

### 2.1 每個數字的來源

| 畫面 | 來源 |
|---|---|
| 我的分攤 | `settlement.balances.find(b => b.uid === uid)?.owed ?? 0` |
| 這趟總額 | `settlement.total` |
| 筆數 | `settlement.expenseCount` |
| 轉帳列 | `settlement.transfers.filter(t => t.from === uid \|\| t.to === uid)` |
| 未換算警告 | `settlement.unconverted.length` |

**筆數用 `settlement.expenseCount` 不是 `task.expenseCount`。** 前者是
`settleExpenses` 裡的 `counted`，只數算得出金額的；後者是全部。兩者的差額
正是未換算的那幾筆，而那條警告就在下面兩行。用 `task.expenseCount` 會讓
「總額」與「筆數」對不起來，而且對不起來的方向剛好是讓數字看起來比較完整。

**`settlement.paidTotal` 不上摘要卡。** 它累加的是 `payments` 裡
`status === "confirmed"` 的金額，也就是**成員之間還款的總額**，不是
「這趟花掉的錢裡已經付掉多少」。放在總額旁邊會被讀成後者，那是假資訊。
它留在 `SettlementPanel` 裡，那裡有上下文。

### 2.2 轉帳列的方向要看得出來

`from === uid`（我要付出去）用 `--color-ink`；`to === uid`（別人要付我）用
`--color-success`。收錢跟付錢是相反方向的行動，不該長一樣。

顏色不是唯一的編碼：文案本身就是「你付給 X」與「X 付給你」，色覺障礙的人
讀文字就分得出來。這跟 `.btn-saved` 的雙重編碼是同一個原則。

超過三筆時只列前三筆，第四行寫「還有 N 筆」。最少轉帳次數的演算法很少讓
一個人牽涉到很多筆，這個上限實務上幾乎碰不到，但沒有它畫面可以無限長。

### 2.3 沒有轉帳時要明講

`transfers` 裡沒有跟我有關的時，顯示「已經結清」。那是好消息，值得一行字，
留白會讓人以為是還沒算出來。

### 2.4 未換算警告為什麼要提到摘要卡

今天這個警告只存在於 `SettlementPanel` 裡。C 之後結算變成次頁，使用者會
更少看到它——而它說的是「上面那個數字不完整」。

這跟 `TaskListPage` 的 hero 在部分失敗時的處理是同一個問題的同一種解：
**數字不完整時，話要講在數字旁邊。** 印在別的地方，上面那個數字看起來
仍然像是完整的。

## 三、結算次頁

```
東京 2024 春
TWD · 4 位成員 · 27 筆支出

← 回到支出
─────────────────────────────
[ SettlementPanel 原封不動 ]
```

- 標題區保留，維持方向感
- 摘要卡與頁籤列都隱藏
- 返回列用 `RouterLink` 而不是 `button`：中鍵開新分頁、長按選單、
  「複製連結網址」都會是瀏覽器原生行為。這個理由 `TaskPage` 的「開啟」
  按鈕已經寫過一次，沿用同一套判斷。
- 資料還沒到時顯示既有的 `LoadingState`，不是空白面板

深連結不需要額外處理：`load()` 把 task、members、expenses、payments、
settlements、reports 全部在同一個 `Promise.all` 裡載完，直接開
`?view=settlement` 也會拿到資料。

## 四、一併處理的三件事

### 4.1 分享報告區塊收成一行

照 `ExpenseDayGroup` 既有的模式：`<button type="button" :aria-expanded>`
當標頭，chevron 用 `▾` / `▸`，內容用 `v-if`。全專案沒有用過 `<details>`，
不在這裡開先例。

收起時標頭右邊講狀態，因為那正是收起時最該知道的事：

| 條件 | 右側文字 |
|---|---|
| `report.active && report.listed` | 連結開著 · 已列入公開頁 |
| `report.active` | 連結開著 |
| `report && !report.active` | 連結已關閉 |
| `!report` | 尚未產生 |

預設收起。這一塊只在「已封存且是 owner」時出現，本來就是低頻操作。

### 4.2 修掉巢狀圓角回歸

`.tabs` 原本 16px、`.tab` 12px、padding 4px——`16 − 4 = 12`，內外是精確嵌套的。
`2026-09-02-web-visual-system` 的機械替換把兩個都收進 `--radius-md`(14)，
內層圓角比它的內縮量多出 4px，角落會互相撞到。

```css
/*
  巢狀圓角：內層 = 外層 − padding。差一點點就會看到內外的弧線互相撞到。
  這一組被機械替換弄壞過一次（16/12 被一起收進 14），所以規則寫在這裡。
*/
.tabs {
  border-radius: var(--radius-md); /* 14 */
  padding: var(--space-1); /* 4 */
}

.tab {
  border-radius: var(--radius-sm); /* 14 − 4 = 10 ✓ */
}
```

順帶把重複定義的 `.tabs.two` 從 `TaskPage.vue` 與 `ExpenseFormPage.vue`
提到 `styles.css`——同一段 CSS 在兩個檔案裡各寫了一次。

### 4.3 補上漏掉的顏色 token

`2026-09-02-web-visual-system` 稽核硬寫顏色時只掃了 `.vue`，沒掃
`styles.css` 本身。

| 現在 | token | 用途 |
|---|---|---|
| `#f0ebe4` | `--color-track` | 頁籤與分段控制的底槽 |
| `#f3d2ce`（兩處） | `--color-danger-line` | 危險色邊框 |
| `#fff5f5` | `--color-danger-soft` | 錯誤訊息底色 |
| `#b8837c` | `--color-danger-quiet` | 低飽和刪除鈕 |
| `#efeae3` | `--color-skeleton` | 骨架底 |
| `#f7f3ee` | `--color-skeleton-hi` | 骨架高光 |

後三個是上一輪自己加進去的硬寫值。

`#fff` 留著不動：那是填色按鈕上的白字，是對比的另一半，不是一個可以換主題
的表面。把它 token 化只會多一層轉譯。

### 4.4 分段控制

「清單／地圖」從第二排頁籤降級成分段控制，放在「新增支出」旁邊同一列。

用同一組 token 與同一條巢狀規則（外 `--radius-md`、padding `--space-1`、
內 `--radius-sm`），但選中態是**白底**而不是 `.tab.active` 的墨黑底。

次層級不該跟頂層搶同一個視覺重量——那正是這份規格在解的兩層頁籤問題。
如果分段控制的選中態也是墨黑，就只是把兩排膠囊換成一排加一組膠囊。

## 五、可測的部分

這一輪跟上一輪一樣，測試套件看不到版面。但有兩塊是規則不是畫面，抽成純函式
放進 `utils` 才測得到：

**`src/utils/taskView.ts`（新增）**

```ts
export type TaskView = "expenses" | "members" | "settlement";

/** 認得的才算數，其餘一律回支出 —— 網址是使用者可以亂打的。 */
export function parseTaskView(raw: unknown): TaskView;

/** 只有支出檢視看得到地圖。 */
export function parseMapMode(raw: unknown, view: TaskView): boolean;
```

**`src/utils/settlementSummary.ts`（新增）**

```ts
export interface SummaryLine {
  from: string;
  to: string;
  amount: number;
  /** true 代表這筆是「我要付出去」。 */
  outgoing: boolean;
}

/**
 * 摘要卡上跟我有關的轉帳。最多 max 筆，超過的筆數另外回傳。
 */
export function myTransfers(
  transfers: Transfer[],
  uid: string,
  max?: number
): { lines: SummaryLine[]; rest: number };

/** 我的分攤。找不到我就是 0，不是 undefined。 */
export function myOwed(balances: MemberBalance[], uid: string): number;
```

### 5.1 要補的測試

`tests/taskView.test.ts`（新增）

- `parseTaskView` 認得 `members` 與 `settlement`
- 缺值、空字串、不認得的值、陣列（`?view=a&view=b` 會給陣列）都回 `expenses`
- `parseMapMode` 只在支出檢視回 `true`，在成員與結算一律 `false`

`tests/settlementSummary.test.ts`（新增）

- `myTransfers` 只挑出 `from` 或 `to` 是我的那幾筆
- `outgoing` 在 `from === uid` 時為 `true`、`to === uid` 時為 `false`
- 超過 `max` 時只回前 `max` 筆，`rest` 是剩下的筆數
- 沒有跟我有關的轉帳時回空陣列且 `rest` 為 0
- `myOwed` 找不到我時回 0 不是 `undefined`
- `myOwed` 找得到時回 `owed` 而不是 `balance`——這兩個很容易寫錯，
  `owed` 是「我該分攤多少」，`balance` 是「我多付或少付了多少」

## 六、會動到的檔案

**新增**

- `src/utils/taskView.ts`
- `src/utils/settlementSummary.ts`
- `tests/taskView.test.ts`
- `tests/settlementSummary.test.ts`
- `src/components/settlement/SettlementSummary.vue` — 摘要卡

**修改**

- `src/pages/TaskPage.vue` — 導覽改 query、摘要卡、結算次頁、分享區塊收摺、分段控制
- `src/router/index.ts` — query-only 導航跳過追蹤
- `src/assets/styles.css` — 六個顏色 token、巢狀圓角規則、`.tabs.two` 收攏、分段控制
- `src/pages/ExpenseFormPage.vue` — 移除重複的 `.tabs.two`

## 七、驗收

### 7.1 自動

- `npm run check` 通過
- `npm run build` 通過，含 `check-chunks.mjs`
- `npm test` 通過，且**新增的 `taskView` 與 `settlementSummary` 案例確實存在
  並會失敗於錯誤實作**——先確認測試會紅，再讓它綠

### 7.2 掃描

- `styles.css` 裡除了 `#fff` 之外沒有硬寫顏色
- `.tabs.two` 只定義一次
- `TaskPage.vue` 裡沒有 `activeTab` 與 `expenseView` 這兩個 `ref`

### 7.3 人工

- 四個網址直接貼進網址列都到得了對的畫面
- 在成員檢視按重整，停在成員而不是跳回支出
- 支出 → 成員 → 按返回：離開任務頁（維持今天的行為）
- 支出 → 結算 → 按返回：回到支出，不是離開任務頁
- 摘要卡的「我的分攤」跟結算面板裡自己那一列的「分攤」數字一致
- 有未換算支出的任務：摘要卡出現警告，且「筆數」比任務標題那行的筆數少
- 已結清的任務：摘要卡顯示「已經結清」而不是空白
- 已封存且是 owner 的任務：分享區塊預設收起，右側狀態文字正確
- 頁籤的內外圓角沒有互相撞到
- 切頁籤時 Network 面板不該有新的 Firestore 請求
