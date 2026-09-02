# 網頁版視覺系統改版 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把網頁版只有一階的設計語彙重建成有階層的 token 系統，修掉兩個對比度不合規，並讓「我的總花費」在部分旅程讀取失敗時仍然給得出可信的數字。

**Architecture:** 由下而上：先換 `styles.css` 的 `:root` token（值一換，所有走 `var()` 的地方自動生效），再逐層處理角色遷移、元件類別、尺度對齊，最後才動 `TaskListPage` 的 hero 與 `TaskCard`。邏輯部分抽成 `utils` 純函式先寫測試，元件只負責畫。

**Tech Stack:** Vue 3 + TypeScript + Vite + Pinia，測試用 vitest（純函式，無 DOM），型別檢查 `vue-tsc --noEmit`。

**Spec:** `docs/superpowers/specs/2026-09-02-web-visual-system-design.md`

## Global Constraints

- **只動 `src/`。** `flutter_app/` 這次完全不碰，兩版顏色會不一致一段時間，這是已知且接受的。
- **不改 Firestore 查詢的內容與次數。** `loadCosts` 的錯誤處理會改，讀什麼、讀幾次不變。
- **不改 `myTripCost` 與 `settleExpenses`。**
- **不拆檔。** `ReportPage.vue`、`ExpenseFormPage.vue` 的 scoped style 很長，這次只對齊 token。
- **`ProviderButtons.vue` 的 8 個硬寫 hex 不動**——那是 Google／Facebook 的品牌色。
- **每個任務結束時 `npm run check` 必須通過。**
- **測試套件看不到樣式改動。** 35 個測試沒有一個 import `.vue`，沒有 test-utils 也沒有 jsdom。唯一真的被測到的是 Task 6 的純函式。不要用「`npm test` 全綠」當作樣式改對了的證據。
- **中文註解。** 這個 repo 的註解全部是中文，寫「為什麼」不寫「做了什麼」。跟著既有風格。

### Token 對照表（全計畫共用）

顏色：

| token | 舊值 | 新值 |
|---|---|---|
| `--color-ink` | `#1a1613` | 不變 |
| `--color-muted` | `#8a8078` | `#6f665e` |
| `--color-soft` | `#a39a90` | `#8a8078` |
| `--color-primary` | `#e8590c` | 不變（只當裝飾底，上面不放文字） |
| `--color-primary-dark` | `#c2410c` | 不變（角色升格：按鈕底色與橘色文字） |
| `--color-primary-deep` | — | `#9a3412`（新增，按鈕 hover） |
| `--color-primary-b1/b2/b3` | — | `#e8590c` / `#f0a072` / `#f7d3bd`（新增，佔比條） |

尺度：

| 類 | token | 值 |
|---|---|---|
| 字級 | `--text-hero` / `--text-display` / `--text-title` / `--text-section` / `--text-card` / `--text-body` / `--text-tiny` | 46 / 34 / 30 / 20 / 17 / 14 / 12 |
| 控制項文字 | `--text-control` / `--text-control-sm` | 15 / 13 |
| 間距 | `--space-1/2/3/4/6/8` | 4 / 8 / 12 / 16 / 24 / 32 |
| 間距（例外）| `--space-text` | 2（**只給同一組文字的上下兩行**） |
| 圓角 | `--radius-sm/md/lg/xl/pill` | 10 / 14 / 18 / 22 / 999 |
| 陰影 | `--shadow-flat/rest/raise/pop` | `none` / `0 1px 2px rgba(26,22,19,.045)` / `0 10px 24px -14px rgba(26,22,19,.42)` / `0 18px 44px -30px rgba(26,22,19,.5)` |
| 動態 | `--ease` / `--dur-press` / `--dur-base` / `--dur-lift` / `--dur-count` | `cubic-bezier(.2,.7,.3,1)` / 90ms / 140ms / 190ms / 620ms |

**不在任何尺度上的三個例外**（碰到不要「修正」它們）：

- `ExpenseRow.vue:111`（20px）、`ExpenseDetailPage.vue:238`（26px）、`AccessDenied.vue:43`（26px）是 **emoji 字符大小**，綁的是圖示方塊尺寸不是排版尺度。
- `ProfilePage.vue:305`（11px）是 monospace 除錯區塊。等寬字型的視覺大小本來就比同尺寸的中文小。

---

## File Structure

**核心（邏輯與版面都會動）**

- `src/assets/styles.css` — token 定義、`.card` 三身分、`.btn-quiet`、reduced-motion
- `src/utils/myCost.ts` — 新增 `TripCost`、`totalsOf`、`sharesOf` 兩個純函式
- `tests/myCost.test.ts` — 新增上述兩個函式的案例
- `src/pages/TaskListPage.vue` — `loadCosts` 改 allSettled、hero 五狀態、滾動計數
- `src/components/task/TaskCard.vue` — 藥丸→文字、動作→quiet、hover 浮起

**只改樣式值（15 檔）**

`ExpenseDayGroup` · `ExpenseRow` · `ReceiptField` · `ReceiptViewer` · `PlaceMap` · `MemberRow` · `ReportCard` · `CategoryChart` · `SettlementHistory` · `SettlementPanel` · `ExpenseFormPage` · `ProfilePage` · `ReportPage` · `TaskPage` · `CreateTaskPage` · `ErrorState` · `AccessDenied` · `OnboardingPage` · `ExpenseDetailPage` · `ProviderButtons`

**完全不用動**：只使用 `var(--color-muted)`、`.tiny`、`.card`、`.btn` 等既有類別而沒有自己硬寫值的檔案。token 換值就自動生效，這是這次改版成本比看起來低的原因。

---

## Task 1: token 基座

把新 token 全部放進 `:root`，並加上 reduced-motion 的全域保護。這一步做完畫面顏色就會變（灰階變深），但不會壞——所有既有的 `var()` 引用都還在。

**Files:**
- Modify: `src/assets/styles.css:1-20`（`:root` 區塊）、檔案結尾（新增 media query）

**Interfaces:**
- Consumes: 無
- Produces: 上面「Token 對照表」的所有 CSS 變數名，後續每個 task 都靠它們

- [ ] **Step 1: 改寫 `:root`**

把 `src/assets/styles.css` 開頭的 `:root` 換成：

```css
:root {
  --color-bg: #f2f0ec;
  --color-surface: #fbfaf8;
  --color-card: #ffffff;
  --color-ink: #1a1613;

  /*
    灰階整條往下移一階。舊的 --color-soft (#a39a90) 對頁面底色只有 2.4:1，
    而 .tiny 正是用它印日期與成員數 —— 那是內文，不是裝飾。

    做法不是加新顏色，是把每一階都調深：舊的 muted 變成新的 soft，
    舊的 soft 退役。階數與色相都不變，只是每一階都看得見。
  */
  --color-muted: #6f665e; /* 4.9:1 on --color-bg。所有次要文字。 */
  --color-soft: #8a8078; /* 3.4:1。過得了非文字 UI 的 3:1，過不了文字的 4.5:1。 */

  /*
    橘色按「上面有沒有要讀的東西」拆開，而不是整條換深 ——
    整條換深會把品牌色從畫面上抹掉。

    --color-primary 白字在上只有 3.6:1，所以它只當裝飾底（佔比條、tint、
    .brand-mark）。標誌依 WCAG 免除對比要求，那是這個亮橘唯一純粹是身分的地方。
  */
  --color-primary: #e8590c;
  --color-primary-dark: #c2410c; /* 白字 5.2:1、當文字 4.6:1。按鈕底與所有橘色文字。 */
  --color-primary-deep: #9a3412; /* 白字 7.3:1。primary-dark 升格成靜止色之後空出來的 hover。 */
  --color-primary-soft: #fff0e4;

  /* 佔比條的三階明度。同色相分段，不引入新色相。條子上不放文字。 */
  --color-primary-b1: #e8590c;
  --color-primary-b2: #f0a072;
  --color-primary-b3: #f7d3bd;

  --color-line: #ede7e0;
  --color-line-strong: #e2dcd4;
  --color-danger: #d63939;
  --color-success: #0e9f6e;
  --color-success-soft: #e6f6ef;

  /*
    陰影四階。原本只有一個又大又軟的 --shadow-card，所有卡片一律套用，
    結果四個元件必須寫 box-shadow: none 把它關掉 —— 要靠取消來做層次，
    就是沒有層次的證據。現在「不浮起」是一個正常的值。
  */
  --shadow-flat: none;
  --shadow-rest: 0 1px 2px rgba(26, 22, 19, 0.045);
  --shadow-raise: 0 10px 24px -14px rgba(26, 22, 19, 0.42);
  --shadow-pop: 0 18px 44px -30px rgba(26, 22, 19, 0.5);

  /* 字級。20 與 14 之間本來是空的，卡片標題只能在「太大」與「跟內文一樣」之間二選一。 */
  --text-hero: 46px; /* 只有公開報告頁的主數字。見 2026-08-05 的規格。 */
  --text-display: 34px;
  --text-title: 30px;
  --text-section: 20px;
  --text-card: 17px;
  --text-body: 14px;
  --text-tiny: 12px;

  /* 控制項有自己的兩個尺寸，不吃上面的排版尺度。 */
  --text-control: 15px;
  --text-control-sm: 13px;

  /* 4px 網格。原本有 6 與 10，不在任何網格上。 */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --space-8: 32px;
  /*
    不屬於網格。只給同一組文字的上下兩行（標籤在上、數值在下）——
    那是行距微調不是版面間距，硬拉到 4px 會讓標籤跟它描述的數字看起來像兩件事。
  */
  --space-text: 2px;

  /* 圓角。原本有 8/10/12/14/16/18/20/22 八種。 */
  --radius-sm: 10px;
  --radius-md: 14px;
  --radius-lg: 18px;
  --radius-xl: 22px;
  --radius-pill: 999px;

  --ease: cubic-bezier(0.2, 0.7, 0.3, 1);
  --dur-press: 90ms;
  --dur-base: 140ms;
  --dur-lift: 190ms;
  --dur-count: 620ms;

  font-family: "Noto Sans TC", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: var(--color-ink);
  background: var(--color-bg);
}
```

注意 `--shadow-card` 被刪掉了。它還有兩處引用（`styles.css` 的 `.card`、`ExpenseFormPage.vue:1080`），下一步處理。

- [ ] **Step 2: 補上 `--shadow-card` 的兩個引用**

`styles.css` 的 `.card` 規則裡：

```css
  box-shadow: var(--shadow-rest);
```

`src/pages/ExpenseFormPage.vue:1080`：

```css
  box-shadow: var(--shadow-pop);
```

（那一處是浮在輸入框上的建議清單，屬於「選單」，用 pop 是對的。）

- [ ] **Step 3: 加上 reduced-motion 保護**

在 `src/assets/styles.css` 最末尾、`@media (min-width: 760px)` 之後加上：

```css
/*
  系統設定「減少動態」的人（前庭障礙、暈動症）看到完全靜止的版本。
  這不是選配 —— 動畫對他們可能造成實際的生理不適。

  不用 animation: none：那會讓靠動畫結束事件推進的邏輯永遠等不到。
  改成把時間壓到幾乎為零，事件照樣觸發。
*/
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

- [ ] **Step 4: 確認沒有殘留引用**

```bash
# 只找真正的使用。註解裡會提到舊值，那是刻意留著的說明，不該讓檢查誤報。
grep -rnF "var(--shadow-card" src/
grep -rnE ": *#a39a90" src/
# 只找真正的使用。註解裡會提到舊值，那是刻意留著的說明，不該讓檢查誤報。
grep -rnF "var(--shadow-card" src/
grep -rnE ": *#a39a90" src/
```

Expected: 沒有任何輸出。

- [ ] **Step 5: 型別檢查與 build**

```bash
npm run check && npm run build
```

Expected: 兩者都通過。

- [ ] **Step 6: 目視確認**

```bash
npm run dev
```

打開任務列表。**預期畫面已經有變化**：所有灰字變深、卡片陰影從一大片柔光變成幾乎看不見的一線。這是對的。如果哪裡整塊變透明或消失，代表某個 `var()` 名字打錯了。

- [ ] **Step 7: Commit**

```bash
git add src/assets/styles.css src/pages/ExpenseFormPage.vue
git commit -m "Give the design language more than one step

原本 :root 只有一種陰影、四個字級、沒有間距網格。所以需要「比較不
重要」的元件只能靠取消來達成 —— 有四個地方寫 box-shadow: none 把
唯一的陰影關掉。那不是層次，是沒有層次的證據。

順帶修掉兩個量出來的對比度：--color-soft 在頁面底色上只有 2.4:1，
而 .tiny 正是用它印日期。灰階整條下移一階，色相與階數都不變。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: 文字顏色的角色遷移

`--color-soft` 的新值 3.4:1 過得了非文字 UI 的 3:1，過不了文字的 4.5:1。所以現在所有把它當文字色用的地方都必須改成 `--color-muted`，並把規則寫死在 CSS 註解裡——否則下一個人又會拿它去印日期。

**Files:**
- Modify: `src/assets/styles.css:137`（`.tiny`）
- Modify: `src/components/expense/ExpenseDayGroup.vue:61`
- Modify: `src/components/settlement/SettlementHistory.vue:204`
- Modify: `src/components/settlement/SettlementPanel.vue:369`
- Modify: `src/components/task/TaskCard.vue:117`

**Interfaces:**
- Consumes: Task 1 的 `--color-muted`、`--color-soft`
- Produces: 無新介面

- [ ] **Step 1: 找出全部五處**

```bash
grep -rn "color: var(--color-soft)" src/
```

Expected: 正好五筆，就是上面 Files 列的那五個。

- [ ] **Step 2: 五處全部改成 `--color-muted`**

每一處把 `color: var(--color-soft);` 改成 `color: var(--color-muted);`。值不變（都是 `#8a8078` → `#6f665e` 的差別由 token 決定），只是換引用。

- [ ] **Step 3: 在 `styles.css` 的 `.tiny` 上寫死規則**

```css
/*
  .tiny 是內文不是裝飾 —— 日期、成員數、支出筆數都印在這裡。
  所以用 --color-muted（4.9:1）而不是 --color-soft（3.4:1）。

  --color-soft 不放「讀得到的文字」。它給的是圖示、邊界、placeholder
  這類非文字 UI 元件（門檻 3:1），以及停用中的控制項 —— WCAG 1.4.3
  明文豁免停用元件的對比要求，那正是「這個現在按不了」該有的樣子。
*/
.tiny {
  color: var(--color-muted);
  font-size: var(--text-tiny);
  line-height: 1.7;
}
```

- [ ] **Step 4: 驗證沒有任何文字用 soft**

```bash
grep -rn "color: var(--color-soft)" src/
```

Expected: 沒有任何輸出。

```bash
grep -rn "color-soft" src/
```

Expected: 只剩 `styles.css` 的定義那一行，以及（如果有的話）`background:` / `border:` 的用法。逐筆確認沒有 `color:`。

- [ ] **Step 5: 型別檢查**

```bash
npm run check
```

Expected: 通過。

- [ ] **Step 6: Commit**

```bash
git add src/
git commit -m "Stop printing dates in a grey nobody can read

--color-soft 現在是 3.4:1。那過得了非文字 UI 元件的 3:1，過不了
文字的 4.5:1。而它有五處被當文字色用，其中一處是 .tiny —— 日期、
成員數、支出筆數全印在上面。

規則直接寫進 .tiny 的註解：soft 永遠不放文字。不寫死的話，下一個
人看到「有一個比較淺的灰」就又會拿去印日期了。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: 橘色的角色遷移

`--color-primary` (#e8590c) 白字在上只有 3.6:1、當文字色只有 3.4:1，兩者都過不了 AA。把這兩種用途換成 `--color-primary-dark`，並讓 hover 用新的 `--color-primary-deep`。

**Files:**
- Modify: `src/assets/styles.css`（`.btn-primary`、`.btn-ghost`、`.input:focus` / `.select:focus`）
- Modify: 所有 `color: var(--color-primary)` 的位置（Step 1 找出）

**Interfaces:**
- Consumes: Task 1 的 `--color-primary`、`--color-primary-dark`、`--color-primary-deep`
- Produces: 無新介面

- [ ] **Step 1: 找出所有把 primary 當文字色的地方**

```bash
grep -rn "color: var(--color-primary)" src/ | grep -v "background\|border\|outline"
```

把輸出記下來——每一筆都要改成 `--color-primary-dark`。

- [ ] **Step 2: 改 `.btn-primary`**

```css
.btn-primary {
  border-color: var(--color-primary-dark);
  background: var(--color-primary-dark);
  color: #fff;
  box-shadow: 0 4px 12px -6px rgba(194, 65, 12, 0.75);
  transition:
    background var(--dur-base) var(--ease),
    box-shadow var(--dur-lift) var(--ease),
    transform var(--dur-press) var(--ease);
}

.btn-primary:hover {
  background: var(--color-primary-deep);
  box-shadow: 0 9px 20px -8px rgba(194, 65, 12, 0.85);
}

.btn-primary:active {
  transform: scale(0.975);
}
```

- [ ] **Step 3: `.btn-ghost` 的文字色改深**

`.btn-ghost` 的底是 `--color-primary-soft` (#fff0e4)，上面的字必須看得清楚：

```css
.btn-ghost {
  background: var(--color-primary-soft);
  border-color: var(--color-primary-soft);
  color: var(--color-primary-dark);
}
```

- [ ] **Step 4: Step 1 找到的每一處文字色改成 `--color-primary-dark`**

逐筆改。**焦點框（`outline: 2px solid var(--color-primary)`）不改**——那是 UI 元件不是文字，3:1 就夠，而且亮橘的焦點框比深橘更醒目。

- [ ] **Step 5: 驗證**

```bash
grep -rn "color: var(--color-primary)" src/ | grep -v "background\|border\|outline\|primary-dark\|primary-deep\|primary-soft\|primary-b"
```

Expected: 沒有任何輸出。

- [ ] **Step 6: 型別檢查與目視**

```bash
npm run check && npm run dev
```

打開任務列表，確認「＋ 建立」按鈕變成較深的橘、滑過會再深一階並且陰影跟著長、按下去會縮一點。

- [ ] **Step 7: Commit**

```bash
git add src/
git commit -m "Split the orange by whether anything is written on it

#e8590c 當按鈕底色時白字只有 3.6:1，當文字色也只有 3.4:1，兩者都
過不了 AA。但整條換深會把品牌色從畫面上抹掉。

所以按「上面有沒有要讀的東西」拆：有文字疊著的用 #c2410c，純粹
是裝飾與身分的（佔比條、tint、brand-mark、焦點框）留亮橘。#c2410c
升格成靜止色之後 hover 就空了，補一階 #9a3412。

順帶把按鈕的 hover 與按下回饋接上 —— 那是「畫面很硬」的直接成因。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: 卡片三身分、`.btn-quiet`、卡片互動回饋

**Files:**
- Modify: `src/assets/styles.css`（`.card` 規則、新增 `.btn-quiet`）
- Modify: `src/components/expense/ExpenseRow.vue:99`
- Modify: `src/components/member/MemberRow.vue:77`
- Modify: `src/components/settlement/SettlementPanel.vue:285`

（`TaskCard.vue:105` 留到 Task 10 一起改，那個檔案整體要動。）

**Interfaces:**
- Consumes: Task 1 的 `--shadow-*`、`--radius-*`、`--dur-*`、`--ease`
- Produces: CSS 類別 `.card.flat`、`.card.raised`、`.btn-quiet`（Task 10 會用到 `.btn-quiet`）

- [ ] **Step 1: 改寫 `.card` 並加上兩個身分**

```css
/*
  卡片有三種身分，不是一種卡片加上例外。

  原本只有一個 .card 配一個大陰影，所以「這東西不該浮起來」只能寫
  box-shadow: none 去取消 —— 有四個檔案這樣做。宣告身分比取消繼承好讀，
  也讓「不浮起」變成一個正常的值。
*/
.card {
  background: var(--color-card);
  border: 1px solid var(--color-line);
  border-radius: var(--radius-lg);
  padding: var(--space-4);
  box-shadow: var(--shadow-rest);
}

/* 巢狀在別的卡裡、或本身是列表的一列。自己不該再浮一層。 */
.card.flat {
  box-shadow: var(--shadow-flat);
}

/* 真的浮在頁面之上的東西：對話框、選單。 */
.card.raised {
  box-shadow: var(--shadow-pop);
}
```

- [ ] **Step 2: 新增 `.btn-quiet`**

放在 `.btn-danger` 後面：

```css
/*
  卡片內的次要動作。原本這種按鈕做成 outline 藥丸，結果一張卡下緣
  多一列灰色藥丸 —— 在一個已經有三顆標籤的卡片上，那是第四、第五個
  搶注意力的東西。

  拿掉外框改用純文字，靠位置（固定在右下角）與間距說明它可按。
*/
.btn-quiet {
  min-height: auto;
  border: 0;
  background: none;
  padding: 0;
  color: var(--color-muted);
  font-size: var(--text-tiny);
  font-weight: 700;
  transition: color var(--dur-base) var(--ease);
}

.btn-quiet:hover {
  color: var(--color-primary-dark);
}

/*
  刪除鈕平時用低飽和的紅棕，hover 才轉正紅。

  平時就用正紅的話，一排卡片上會有一整列紅字在對你喊 —— 而刪除是
  一輩子按不到幾次的操作，不該長期佔用畫面上最強的顏色。
*/
.btn-quiet.danger {
  color: #b8837c;
}

.btn-quiet.danger:hover {
  color: var(--color-danger);
}
```

- [ ] **Step 3: 三個 `box-shadow: none` 改成宣告身分**

`src/components/expense/ExpenseRow.vue:99` — 把 `.expense-row` 裡的 `box-shadow: none;` 刪掉，改在 template 的 class 加上 `flat`：

```html
<div class="card flat expense-row">
```

`src/components/member/MemberRow.vue:77` 與 `src/components/settlement/SettlementPanel.vue:285` 同樣處理：刪掉 scoped style 裡的 `box-shadow: none;`，在對應的 template 元素的 class 補上 `flat`。

若該元素原本沒有 `card` 類別（陰影是從別處繼承的），就直接刪掉那行 `box-shadow: none`，不用加 `flat`。

- [ ] **Step 4: 驗證**

```bash
grep -rn "box-shadow: none" src/
```

Expected: 只剩 `src/components/task/TaskCard.vue`（Task 10 處理）。

- [ ] **Step 5: 型別檢查與目視**

```bash
npm run check && npm run dev
```

走一遍支出列表、成員頁籤、結算頁籤，確認列表的每一列**沒有**各自的陰影，而外層的卡片有一線很淡的陰影。

- [ ] **Step 6: Commit**

```bash
git add src/
git commit -m "Make \"not raised\" a value instead of a cancellation

四個檔案寫 box-shadow: none 把唯一的陰影關掉。要靠取消才能表達
「這東西比較不重要」，就是這套語彙只有一階的證據。

改成三種身分：card 靜止、card.flat 巢狀與列表列、card.raised 對話框
與選單。順帶補上按鈕缺的那一階 —— 卡片內的次要動作原本做成 outline
藥丸，在一張已經有三顆標籤的卡上那是第四第五個搶注意力的東西。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: 尺度對齊（圓角、間距、字級）

機械性的替換，但有三個必須留下的例外。

**Files:** 下表列出的每一處。

**Interfaces:**
- Consumes: Task 1 的 `--radius-*`、`--space-*`、`--text-*`
- Produces: 無新介面

- [ ] **Step 1: 圓角替換**

| 舊值 | 新 token |
|---|---|
| `border-radius: 8px` | `var(--radius-sm)` |
| `border-radius: 12px` | `var(--radius-md)` |
| `border-radius: 16px` | `var(--radius-md)` |
| `border-radius: 20px` | `var(--radius-lg)` |
| `border-radius: 999px` | `var(--radius-pill)` |
| `border-radius: 50%` | 不動（圓形頭像，不是圓角） |
| `border-radius: inherit` | 不動（stretched link 的覆蓋層） |

命中的檔案：`styles.css`、`ReceiptField.vue`、`ReceiptViewer.vue`、`PlaceMap.vue`、`ExpenseFormPage.vue`、`ProfilePage.vue`、`ReportPage.vue`、`ExpenseDetailPage.vue`（`.icon` 的 18px → `var(--radius-lg)`）。

`styles.css` 裡另外三處：`.empty` 的 22px → `var(--radius-xl)`、`.brand-mark` 的 14px → `var(--radius-md)`、`.brand-logo` 的 12px → `var(--radius-md)`。

- [ ] **Step 2: 間距替換**

| 舊值 | 新 token |
|---|---|
| `gap: 6px` | `var(--space-2)`（8px，**值會變**） |
| `gap: 10px` | `var(--space-3)`（12px，**值會變**） |
| `gap: 8px` | `var(--space-2)` |
| `gap: 12px` | `var(--space-3)` |
| `gap: 16px` | `var(--space-4)` |
| `gap: 2px` | `var(--space-text)`（值不變） |

命中的檔案：`ProviderButtons`（10px×2）、`ExpenseDayGroup`（10px×2）、`MemberRow`（6px）、`ReportCard`（2px）、`CategoryChart`（6px）、`SettlementHistory`（2px）、`SettlementPanel`（10px×2、6px）、`ExpenseFormPage`（2px、6px）、`ReportPage`（10px、6px×4）、`TaskListPage`（10px、2px）、`TaskPage`（10px）、`styles.css`（10px、6px）。

6px → 8px 與 10px → 12px 會讓那幾處稍微鬆一點。這是預期的，不要為了「看起來跟以前一樣」而例外。

- [ ] **Step 3: 字級替換**

逐筆照這張表改：

| 位置 | 現在 | 改成 |
|---|---|---|
| `AccessDenied.vue:43` | 26px | **不動**（emoji 字符，綁 56px 圖示方塊） |
| `ExpenseRow.vue:111` | 20px | **不動**（emoji 字符，綁 42px 圖示方塊） |
| `ExpenseDetailPage.vue:238` | 26px | **不動**（emoji 字符，綁 56px 圖示方塊） |
| `ProfilePage.vue:305` | 11px | **不動**（monospace 除錯區塊） |
| `ErrorState.vue:37` | 13px | `var(--text-control-sm)` |
| `ReportPage.vue:331` | 13px | `var(--text-control-sm)` |
| `CreateTaskPage.vue:135` | 13px | `var(--text-tiny)` |
| `ReceiptField.vue:174` | 11px | `var(--text-tiny)` |
| `ReportCard.vue:69` | 16px | `var(--text-card)` |
| `ReportCard.vue:93` | 18px | `var(--text-card)` |
| `TaskCard.vue:149` | 12px | `var(--text-tiny)` |
| `ExpenseFormPage.vue:1025` | 12px | `var(--text-tiny)` |
| `ProfilePage.vue:289` | 12px | `var(--text-tiny)` |
| `OnboardingPage.vue:73` | 21px | `var(--text-section)` |
| `ExpenseDetailPage.vue:242` | 26px | `var(--text-title)` |
| `ReportPage.vue:349` | 46px | `var(--text-hero)` |
| `TaskCard.vue:196` | 12px | **這整段規則 Task 10 會刪掉**，先不動 |
| `TaskListPage.vue:338/353` | 12px / 22px | **這整段 scoped style Task 8 會刪掉**，先不動 |

在三個 emoji 例外的上方各補一行註解，例如：

```css
/* emoji 的字符大小，綁的是這個 56px 方塊而不是排版尺度。不要套字級表。 */
font-size: 26px;
```

- [ ] **Step 4: `styles.css` 內部也要對齊**

`.title` 30px → `var(--text-title)`、`.section-title` 20px → `var(--text-section)`、`.btn` 15px → `var(--text-control)`、`.btn-sm` 13px → `var(--text-control-sm)`、`.error` 13px → `var(--text-control-sm)`、`.label` 12px → `var(--text-tiny)`。

`.page` 的 padding 22px → `var(--space-6)`（24px），`@media (min-width: 760px)` 裡的 36px → `var(--space-8)`（32px）。`.card` 的 padding 已在 Task 4 改成 `var(--space-4)`。

- [ ] **Step 5: 驗證**

```bash
grep -rn "gap: 6px\|gap: 10px" src/
```

Expected: 沒有任何輸出。

```bash
grep -rn "border-radius: \(8\|12\|16\|20\|22\|999\)px" src/
```

Expected: 沒有任何輸出。

- [ ] **Step 6: 型別檢查與 build**

```bash
npm run check && npm run build
```

Expected: 兩者通過。

- [ ] **Step 7: 目視走一遍全站**

```bash
npm run dev
```

任務列表 → 任務頁三個頁籤 → 支出表單 → 支出明細 → 報告頁 → 個人設定。找「明顯變醜」的地方而不是「有點不一樣」——後者是預期的。

- [ ] **Step 8: Commit**

```bash
git add src/
git commit -m "Collapse eight radii and six gaps into a scale

圓角有 8/10/12/14/16/18/20/22 八種值，gap 有 2/6/8/10/12/16，其中
6 與 10 不在任何網格上。沒有人挑得出這些差別是有意義的。

三個 font-size 刻意留著不動：ExpenseRow、ExpenseDetailPage、
AccessDenied 那幾個是 emoji 的字符大小，綁的是圖示方塊尺寸不是排版
尺度，套字級表會做壞。各補一行註解，免得之後有人來「修正」。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: `totalsOf` 與 `sharesOf`（TDD）

hero 要顯示總額與佔比。這兩件事是規則不是畫面，抽成純函式才測得到——沿用這個 repo 既有的規矩（所有測試都在 `@/utils/`，沒有一個 import `.vue`）。

**這是整個計畫唯一有真正測試的任務。**

**Files:**
- Modify: `src/utils/myCost.ts`（新增，不動 `myTripCost` 與 `sumByCurrency`）
- Modify: `tests/myCost.test.ts`（新增兩個 describe 區塊）

**Interfaces:**
- Consumes: 既有的 `sumByCurrency`、`CurrencyAmount`
- Produces:
  - `interface TripCost { taskId: string; name: string; currency: string; amount: number }`
  - `totalsOf(ok: TripCost[]): CurrencyAmount[]`
  - `sharesOf(ok: TripCost[], currency: string, max?: number): CostShare[]`
  - `interface CostShare { name: string; amount: number; ratio: number }`

- [ ] **Step 1: 先寫失敗的測試**

在 `tests/myCost.test.ts` 最後加上。`import` 那一行也要更新成
`import { myTripCost, sharesOf, sumByCurrency, totalsOf } from "@/utils/myCost";`

```ts
function trip(name: string, currency: string, amount: number): TripCost {
  return { taskId: `t_${name}`, name, currency, amount };
}

describe("totalsOf", () => {
  it("只加總傳進來的，沒傳進來的不會變成零", () => {
    // 讀失敗的旅程根本不該出現在輸入裡 —— 補一個 0 進去會讓總額
    // 少一截而畫面看起來完全正常，那正是這次要避免的事。
    const ok = [trip("東京", "TWD", 31480), trip("宜蘭", "TWD", 4260)];
    expect(totalsOf(ok)).toEqual([{ currency: "TWD", amount: 35740 }]);
  });

  it("跨幣別分開列，金額大的在前", () => {
    const ok = [trip("宜蘭", "TWD", 4260), trip("曼谷", "THB", 18900)];
    expect(totalsOf(ok)).toEqual([
      { currency: "THB", amount: 18900 },
      { currency: "TWD", amount: 4260 }
    ]);
  });

  it("沒有任何一趟就是空陣列，不是一個零", () => {
    expect(totalsOf([])).toEqual([]);
  });
});

describe("sharesOf", () => {
  it("只算指定幣別，其他幣別不進分母", () => {
    const ok = [trip("東京", "TWD", 75), trip("曼谷", "THB", 925), trip("宜蘭", "TWD", 25)];
    const shares = sharesOf(ok, "TWD");
    expect(shares.map(s => s.name)).toEqual(["東京", "宜蘭"]);
    expect(shares[0].ratio).toBeCloseTo(0.75);
  });

  it("比例加起來是一", () => {
    const ok = [trip("東京", "TWD", 31480), trip("大阪", "TWD", 12580), trip("宜蘭", "TWD", 4260)];
    const sum = sharesOf(ok, "TWD").reduce((acc, s) => acc + s.ratio, 0);
    expect(sum).toBeCloseTo(1);
  });

  it("金額大的排前面", () => {
    const ok = [trip("宜蘭", "TWD", 4260), trip("東京", "TWD", 31480)];
    expect(sharesOf(ok, "TWD").map(s => s.name)).toEqual(["東京", "宜蘭"]);
  });

  it("超過 max 趟時，多出來的併成一項其他，併完比例總和仍是一", () => {
    const ok = [
      trip("東京", "TWD", 50),
      trip("大阪", "TWD", 30),
      trip("宜蘭", "TWD", 10),
      trip("花蓮", "TWD", 6),
      trip("台南", "TWD", 4)
    ];
    const shares = sharesOf(ok, "TWD", 3);
    expect(shares.map(s => s.name)).toEqual(["東京", "大阪", "宜蘭", "其他"]);
    expect(shares[3].amount).toBe(10);
    expect(shares.reduce((acc, s) => acc + s.ratio, 0)).toBeCloseTo(1);
  });

  it("剛好比 max 多一趟時全部列出，不會把一趟改名叫其他", () => {
    // 併一項進「其他」等於把一個有名字的旅程改名，那比多列一行更糟。
    const ok = [
      trip("東京", "TWD", 50),
      trip("大阪", "TWD", 30),
      trip("宜蘭", "TWD", 15),
      trip("花蓮", "TWD", 5)
    ];
    expect(sharesOf(ok, "TWD", 3).map(s => s.name)).toEqual(["東京", "大阪", "宜蘭", "花蓮"]);
  });

  it("該幣別總額為零時回空陣列，不會除以零", () => {
    expect(sharesOf([trip("東京", "TWD", 0)], "TWD")).toEqual([]);
    expect(sharesOf([], "TWD")).toEqual([]);
  });

  it("金額為零的旅程不佔一段長條", () => {
    const ok = [trip("東京", "TWD", 100), trip("宜蘭", "TWD", 0)];
    expect(sharesOf(ok, "TWD").map(s => s.name)).toEqual(["東京"]);
  });
});
```

同時在檔案頂端補上型別 import：`import type { TripCost } from "@/utils/myCost";`

- [ ] **Step 2: 跑測試確認會失敗**

```bash
npm test -- myCost
```

Expected: FAIL，錯誤訊息是 `totalsOf is not a function` 或 `No "totalsOf" export is defined`。**如果它直接通過了，代表測試沒有真的跑到，先解決那個問題再繼續。**

- [ ] **Step 3: 實作**

加到 `src/utils/myCost.ts` 結尾：

```ts
/** 一趟旅程算出來的成本。只有算成功的才會有這個東西。 */
export interface TripCost {
  taskId: string;
  name: string;
  currency: string;
  amount: number;
}

/** 佔比條的一段。 */
export interface CostShare {
  name: string;
  amount: number;
  ratio: number;
}

/**
 * 總計只包含傳進來的旅程。
 *
 * 讀失敗的旅程不該出現在輸入裡，也不該在別處被補成 0 —— 「算不出來」
 * 跟「花了零元」是兩件事，混在一起會讓總額少一截而畫面看起來完全正常。
 */
export function totalsOf(ok: TripCost[]): CurrencyAmount[] {
  return sumByCurrency(ok.map(item => ({ currency: item.currency, amount: item.amount })));
}

/**
 * 某個幣別底下各趟的佔比。
 *
 * 只算同一個幣別：跨幣別的金額不能相加，分母混進別的幣別會得到一個
 * 沒有意義的數字。這跟 sumByCurrency 不合併幣別是同一個理由。
 */
export function sharesOf(ok: TripCost[], currency: string, max = 3): CostShare[] {
  const rows = ok
    .filter(item => item.currency === currency && item.amount > 0)
    .sort((a, b) => b.amount - a.amount);

  const total = rows.reduce((sum, item) => sum + item.amount, 0);
  // 分母是 0 的長條沒有意義，而且會產生 NaN。
  if (total <= 0) return [];

  /*
    只多一趟就不併。併一項進「其他」等於把一個有名字的旅程改名，
    那比多列一行更糟 —— 使用者會找不到自己認得的那趟去哪了。
  */
  if (rows.length <= max + 1) {
    return rows.map(item => ({
      name: item.name,
      amount: item.amount,
      ratio: item.amount / total
    }));
  }

  const head = rows.slice(0, max);
  const rest = rows.slice(max).reduce((sum, item) => sum + item.amount, 0);

  return [
    ...head.map(item => ({ name: item.name, amount: item.amount, ratio: item.amount / total })),
    { name: "其他", amount: rest, ratio: rest / total }
  ];
}
```

- [ ] **Step 4: 跑測試確認通過**

```bash
npm test -- myCost
```

Expected: PASS，全部案例綠。既有的 `myTripCost` 與 `sumByCurrency` 案例也要維持綠。

- [ ] **Step 5: 全套測試與型別檢查**

```bash
npm test && npm run check
```

Expected: 兩者通過。

- [ ] **Step 6: Commit**

```bash
git add src/utils/myCost.ts tests/myCost.test.ts
git commit -m "Put the totalling rules where a test can reach them

hero 要顯示總額與佔比。那兩件事是規則不是畫面 —— 沿用這個 repo
既有的規矩放進 utils，元件只負責畫。

sharesOf 有兩個刻意的行為。只多一趟就不併成「其他」：併一項等於
把一個有名字的旅程改名，使用者會找不到自己認得的那趟去哪了。總額
為零回空陣列：一條分母是 0 的長條沒有意義，而且會產生 NaN。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: `loadCosts` 改用 `Promise.allSettled`

現在任何一趟讀失敗就整個 reject，使用者等完「任務數 × 2 趟查詢」之後什麼都拿不到。

**Files:**
- Modify: `src/pages/TaskListPage.vue`（`costs` / `totals` / `loadCosts` 那一段，約 60-130 行）

**Interfaces:**
- Consumes: Task 6 的 `TripCost`、`totalsOf`
- Produces: `okCosts: Ref<TripCost[]>`、`failedTasks: Ref<Task[]>`（Task 8 的 template 會用）

- [ ] **Step 1: 換掉狀態宣告**

把原本的

```ts
const costs = ref<Map<string, number>>(new Map());
```

換成

```ts
/*
  算成功的與算失敗的分開存，而不是一個 Map 加上「查不到就當 0」。

  「算不出來」跟「花了零元」是兩件事。用 ?? 0 補的話，讀失敗的那趟
  會被當成零元算進總額與佔比 —— 數字少一截，分母錯掉，而畫面上看
  起來完全正常。那正是這次要解決的問題。
*/
const okCosts = ref<TripCost[]>([]);
const failedTasks = ref<Task[]>([]);
```

`import` 那一行加上：`import { myTripCost, totalsOf, sharesOf, type TripCost } from "@/utils/myCost";`（`sumByCurrency` 若已無其他用途可移除，但先確認 `import` 沒有其他引用點）。

- [ ] **Step 2: `totals` 改走 `totalsOf`**

```ts
const totals = computed(() => totalsOf(okCosts.value));
```

原本那段 `sumByCurrency(costable.value.map(...))` 整個刪掉——它就是 `?? 0` 的來源。

- [ ] **Step 3: `loadCosts` 改用 `allSettled`**

把原本的 `const entries = await Promise.all(...)` 到 `costsLoaded.value = true;` 換成：

```ts
    const settled = await Promise.allSettled(
      costable.value.map(async row => {
        // 成員也要載：餘數分給誰取決於加入順序，少了它數字會跟結算頁差幾分錢。
        const [expenses, members] = await Promise.all([
          listExpenses(row.task.id),
          listTaskMembers(row.task.id)
        ]);
        const cost = myTripCost(
          expenses,
          members.map(member => member.uid),
          uid,
          row.task.defaultCurrency
        );
        return {
          taskId: row.task.id,
          name: row.task.name,
          currency: row.task.defaultCurrency,
          amount: cost
        } satisfies TripCost;
      })
    );

    // 上面這段的 uid 直接用外層取好的那一個，不要在 map 裡再算一次。

    const ok: TripCost[] = [];
    const failed: Task[] = [];
    settled.forEach((result, index) => {
      if (result.status === "fulfilled") ok.push(result.value);
      else failed.push(costable.value[index].task);
    });

    okCosts.value = ok;
    failedTasks.value = failed;
    /*
      一趟都沒成功就不算「載好了」—— 那跟沒按過是一樣的狀態，
      給使用者一顆可以重試的按鈕比給一張空卡片有用。
    */
    costsLoaded.value = ok.length > 0;
    costsError.value = null;

    if (failed.length) traceDetail("failed", failed.length);
```

- [ ] **Step 4: `catch` 區塊只處理「整批都掛了」**

`allSettled` 不會 reject，所以 `catch` 現在只會接到 `uid` 缺失之類的意外。保留它但簡化：

```ts
  } catch (err) {
    // allSettled 不會 reject，走到這裡代表是預期外的錯誤。
    costsError.value = firebaseErrorMessage(err);
    traceDetail("failed", true);
  } finally {
```

- [ ] **Step 5: 型別檢查**

```bash
npm run check
```

Expected: 通過。如果報 `Task` 型別找不到，確認 `import type { Task, TaskStatus } from "@/types/task";` 已經在檔案頂端（原本就有）。

- [ ] **Step 6: 手動驗證部分失敗**

暫時在 `listExpenses` 的呼叫前插入：

```ts
if (row.task.name.includes("大阪")) throw new Error("刻意失敗");
```

跑 `npm run dev`，按「計算我的花費」，確認：其他旅程的數字有出來、`costsLoaded` 為 true。**驗證完把這行刪掉。**

- [ ] **Step 7: Commit**

```bash
git add src/pages/TaskListPage.vue
git commit -m "Give back what we managed to calculate

loadCosts 用 Promise.all，任何一趟讀失敗就整個 reject。使用者按了
計算、等完「任務數 × 2 趟查詢」，然後什麼都拿不到，只有一行紅字。

換成 allSettled，並把成功與失敗分開存 —— 不是存成一個 Map 再用
?? 0 補。「算不出來」跟「花了零元」是兩件事，補 0 會讓總額少一截、
佔比分母錯掉，而畫面上看起來完全正常。

一趟都沒成功時 costsLoaded 維持 false：那跟沒按過是一樣的狀態，
給一顆可以重試的按鈕比給一張空卡片有用。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 8: hero 五狀態

**Files:**
- Modify: `src/pages/TaskListPage.vue`（template 的「計算我的花費」那一段、`<style scoped>` 整段重寫）

**Interfaces:**
- Consumes: Task 6 的 `sharesOf`、Task 7 的 `okCosts` / `failedTasks` / `costsLoaded` / `costsLoading`
- Produces: 無新介面

- [ ] **Step 1: 加上 template 需要的 computed**

```ts
/** 每個幣別一塊，各自一條佔比條。跨幣別不合併 —— 混成一條等於在說 1 TWD = 1 THB。 */
const blocks = computed(() =>
  totals.value.map(item => ({
    currency: item.currency,
    amount: item.amount,
    shares: sharesOf(okCosts.value, item.currency)
  }))
);

const barColors = ["var(--color-primary-b1)", "var(--color-primary-b2)", "var(--color-primary-b3)"];
function barColor(index: number) {
  // 第四段以後（只可能是「其他」）用中性色，不再往下分明度。
  return barColors[index] ?? "var(--color-line-strong)";
}

const failedNote = computed(() => {
  const names = failedTasks.value.map(task => task.name);
  if (!names.length) return null;
  return `有 ${names.length} 趟旅程沒讀到（${names.join("、")}），這個數字少算了那幾趟。`;
});
```

- [ ] **Step 2: 換掉 template**

把原本 `<template v-if="!loading && !error && costable.length">` 到對應 `</template>` 的整段換成：

```html
      <!-- 總花費是按需計算的，所以「還沒算」是每次進頁面的第一眼，不能是一張空卡片。 -->
      <div v-if="!loading && !error && costable.length" class="card hero">
        <div class="hero-head">
          <span class="hero-label">我的總花費</span>
          <button class="btn-quiet hero-action" :disabled="costsLoading" @click="loadCosts">
            {{ costsLoading ? "計算中…" : costsLoaded ? "重新計算" : "計算" }}
          </button>
        </div>

        <p v-if="!costsLoaded && !costsLoading" class="hero-empty">
          跨旅程加總要把每趟的支出全部載下來，點一下才算。
        </p>

        <!-- 骨架的形狀就是結果的形狀，數字進來時不跳版。 -->
        <template v-else-if="costsLoading">
          <div class="skel skel-fig"></div>
          <div class="skel skel-bar"></div>
          <div class="skel skel-leg"></div>
        </template>

        <template v-else>
          <div v-for="(block, bi) in blocks" :key="block.currency" class="hero-block">
            <p class="hero-fig">
              <span class="hero-cur">{{ block.currency }}</span
              >{{ formatAmount(block.amount, block.currency) }}
            </p>
            <div v-if="block.shares.length" class="hero-bar">
              <i
                v-for="(share, si) in block.shares"
                :key="share.name"
                :style="{ flexGrow: share.ratio * countProgress, background: barColor(si) }"
              ></i>
            </div>
            <div v-if="block.shares.length" class="hero-leg">
              <span v-for="(share, si) in block.shares" :key="share.name">
                <em :style="{ background: barColor(si) }"></em>{{ share.name }}
                {{ Math.round(share.ratio * 100) }}%
              </span>
            </div>
            <p v-if="bi === 0 && failedNote" class="hero-warn">{{ failedNote }}</p>
          </div>
          <p v-if="!blocks.length" class="tiny">目前還沒有算得出金額的支出。</p>
        </template>

        <p v-if="costsError" class="hero-warn">{{ costsError }}</p>
      </div>
```

`countProgress` 在 Task 9 才會動起來。這一步先加上並固定為 1，讓 hero 自己就能完整運作：

```ts
/** 0 → 1 的動畫進度。Task 9 會讓它在按下計算時從 0 跑到 1。 */
const countProgress = ref(1);
```

也把金額綁上它，這樣 Task 9 只需要加動畫函式、不用再回來改 template：

```html
            <p class="hero-fig">
              <span class="hero-cur">{{ block.currency }}</span
              >{{ formatAmount(Math.round(block.amount * countProgress), block.currency) }}
            </p>
```

- [ ] **Step 3: 換掉 `<style scoped>`**

把原本的 `.intro` 以外全部刪掉（`.totals-row`、`.totals`、`.link`、`.total`、`.figure`、`.warn`），換成：

```css
.intro {
  margin: calc(var(--space-1) * -1) 0 0;
  line-height: 1.7;
}

.hero-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin-bottom: var(--space-2);
}

.hero-label {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-muted);
}

/*
  這張卡上唯一的橘色。它是這裡唯一可以按的東西。

  hover 也要自己寫一次：全域的 .btn-quiet:hover 跟 scoped 的
  .hero-action[data-v-x] 特異性一樣，誰贏取決於打包順序 —— 不能賭。
*/
.hero-action {
  color: var(--color-primary-dark);
}

.hero-action:hover {
  color: var(--color-primary-deep);
}

.hero-action:disabled {
  color: var(--color-soft);
  cursor: not-allowed;
}

.hero-empty {
  margin: 0;
  color: var(--color-muted);
  line-height: 1.6;
}

.hero-block + .hero-block {
  margin-top: var(--space-4);
  padding-top: var(--space-4);
  border-top: 1px solid var(--color-line);
}

.hero-fig {
  margin: 0;
  font-size: var(--text-display);
  font-weight: 800;
  letter-spacing: -0.03em;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

/* 幣別不分主次：sumByCurrency 已經照金額排序，順序本身就是層次。 */
.hero-cur {
  margin-right: 7px;
  font-size: var(--text-body);
  font-weight: 700;
  color: var(--color-muted);
  letter-spacing: 0;
}

.hero-bar {
  display: flex;
  gap: 2px;
  height: 5px;
  margin: var(--space-3) 0 var(--space-2);
  border-radius: var(--radius-pill);
  overflow: hidden;
}

.hero-bar i {
  display: block;
  flex-basis: 0;
}

.hero-leg {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-3);
  font-size: 11.5px;
  color: var(--color-muted);
}

.hero-leg span {
  display: flex;
  align-items: center;
  gap: 5px;
}

.hero-leg em {
  width: 7px;
  height: 7px;
  border-radius: 2px;
}

/*
  少算了就要在數字旁邊講，而且要講是哪一趟。印在卡片外面的話，
  上面那個數字看起來仍然像是完整的。
*/
.hero-warn {
  margin: var(--space-3) 0 0;
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-line);
  font-size: var(--text-tiny);
  line-height: 1.65;
  color: var(--color-danger);
}

.skel {
  border-radius: 7px;
  background: linear-gradient(90deg, #efeae3 25%, #f7f3ee 50%, #efeae3 75%);
  background-size: 200% 100%;
  animation: shimmer 1.4s linear infinite;
}

.skel-fig {
  height: var(--text-display);
  width: 62%;
  margin-bottom: var(--space-3);
}

.skel-bar {
  height: 5px;
  margin-bottom: var(--space-2);
}

.skel-leg {
  height: 11px;
  width: 76%;
}

@keyframes shimmer {
  to {
    background-position: -200% 0;
  }
}
</style>
```

- [ ] **Step 4: 型別檢查與 build**

```bash
npm run check && npm run build
```

- [ ] **Step 5: 逐一目視五種狀態**

```bash
npm run dev
```

1. 進頁面 → 未計算：一張卡，說明文字，右上角橘色「計算」
2. 按下去 → 骨架，且骨架的高度跟後來的數字一致（不跳版）
3. 單一幣別 → 34px 數字、佔比條、圖例
4. 多幣別（需要有不同 `defaultCurrency` 的任務）→ 兩塊，中間一條分隔線，**兩個數字一樣大**
5. 部分失敗 → 用 Task 7 Step 6 的手法暫時製造，確認紅字在卡片**裡面**、貼在數字下方，並且講出旅程名稱

- [ ] **Step 6: Commit**

```bash
git add src/pages/TaskListPage.vue
git commit -m "Say something useful before the number exists

總花費是按需計算的，所以「還沒算」是每次進頁面的第一眼。原本那裡
是一顆孤零零的按鈕，現在是一張卡，直接講為什麼要按。

骨架的形狀就是結果的形狀，數字進來時不跳版 —— 這一趟的成本是
「任務數 × 2 趟查詢」，不會太快。

多幣別各自一塊、各自一條佔比條，而且字級一樣大。sumByCurrency 已經
照金額排序，順序本身就是層次，再用大小去暗示一個並不存在的主從
關係只會誤導。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 9: 金額滾動與佔比條生長

只在使用者主動觸發計算時跑，不綁 render。

**Files:**
- Modify: `src/pages/TaskListPage.vue`

**Interfaces:**
- Consumes: Task 8 的 `blocks`、`countKey`
- Produces: 無新介面

- [ ] **Step 1: 加上滾動計數**

Task 8 已經有 `const countProgress = ref(1);`，在它旁邊加上動畫函式：

```ts
/*
  滾動計數只在使用者主動按下計算時跑。

  綁在 render 上的話，每次資料更新都會重跑，而且平常進頁面讀金額
  會被硬生生延後 0.6 秒 —— 金額正是這個 app 的重點。按了計算的人
  本來就在等，那 0.6 秒是他自己要求的。

  減少動態要自己判斷：requestAnimationFrame 是 JS，不受 CSS 的
  media query 管，Task 1 那段全域保護對它無效。
*/
const reduceMotion =
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

function playCount() {
  if (reduceMotion) {
    countProgress.value = 1;
    return;
  }
  countProgress.value = 0;
  const start = performance.now();
  const step = (now: number) => {
    const p = Math.min((now - start) / 620, 1);
    // ease-out cubic，跟 --dur-count 與 --ease 同一組手感。
    countProgress.value = 1 - Math.pow(1 - p, 3);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
```

- [ ] **Step 2: 在計算完成時觸發**

在 `loadCosts` 的 `costsLoaded.value = ok.length > 0;` 之後加上：

```ts
    if (ok.length) playCount();
```

- [ ] **Step 3: 佔比條生長**

`countProgress` 已經綁在 `<i>` 的 `flexGrow` 上（Task 8），所以長條會跟著數字一起長，不需要再改 template。只要把過渡補上讓它平滑：

```css
/*
  用 flex-grow 而不是 width —— 每一段的寬度是彼此的比例，改 width
  會讓它們各自算各自的，中途對不齊。
*/
.hero-bar i {
  display: block;
  flex-basis: 0;
  transition: flex-grow var(--dur-base) var(--ease);
}
```

過渡用 `--dur-base` 而不是 `--dur-count`：`countProgress` 每一幀都在變，再疊一個 620ms 的過渡會拖成一團糊。這裡的過渡只是把每幀之間的跳動抹平。

- [ ] **Step 4: 型別檢查與目視**

```bash
npm run check && npm run dev
```

按「計算」→ 數字從 0 滾到終值、長條同時長出來。**重新整理頁面→不會再滾一次**（因為預設是未計算狀態）。多幣別時兩塊同時滾。

- [ ] **Step 5: 開系統的「減少動態」再測一次**

Windows：設定 → 協助工具 → 視覺效果 → 動畫效果 關閉。
確認數字**直接出現終值**、長條直接是最終比例、沒有任何東西在動。

- [ ] **Step 6: Commit**

```bash
git add src/pages/TaskListPage.vue
git commit -m "Roll the number only for the person who asked for it

滾動計數綁在按下計算的那一刻，不綁 render。綁 render 的話每次資料
更新都重跑，而且平常進頁面讀金額會被延後 0.6 秒 —— 金額正是這個
app 的重點。按了計算的人本來就在等，那 0.6 秒是他自己要求的。

長條用 flex-grow 的過渡而不是 width：每一段的寬度是彼此的比例，
改 width 會讓它們各自算各自的，中途對不齊。

減少動態要自己判斷 —— requestAnimationFrame 是 JS，不受 CSS 的
media query 管。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 10: TaskCard 改版

**Files:**
- Modify: `src/components/task/TaskCard.vue`（template 的 meta 區與 actions 區、`<style scoped>`）

**Interfaces:**
- Consumes: Task 4 的 `.card.flat`、`.btn-quiet`；Task 1 的全部 token
- Produces: 無新介面

- [ ] **Step 1: template 的三顆藥丸換成一行文字**

把 `<span class="role-pill">` 與整個 `<div class="task-meta">` 換成：

```html
    <div class="spread">
      <div>
        <h2 class="section-title">
          <RouterLink :to="`/tasks/${task.id}`" class="stretch">{{ task.name }}</RouterLink>
        </h2>
        <p class="tiny">{{ task.startDate || "未設定" }} - {{ task.endDate || "未設定" }}</p>
      </div>
      <!-- 進行中不掛標籤 —— 沒消息就是好消息。狀態是異常，異常才值得一個色塊。 -->
      <span v-if="isArchived" class="archived-pill">{{ STATUS_LABELS.archived }}</span>
    </div>

    <!--
      角色、成員數、支出數是屬性不是狀態，所以是文字不是藥丸。
      三顆橘色藥丸並排會稀釋掉橘色「這個可以按」的意思。
    -->
    <p class="tiny meta">
      {{ ROLE_LABELS[role] }} · {{ task.memberCount }} 位成員 · {{ task.expenseCount }} 筆支出
    </p>
```

- [ ] **Step 2: 動作按鈕改用 `.btn-quiet`**

```html
    <div v-if="isOwner" class="actions">
      <button
        v-if="isArchived"
        type="button"
        class="btn-quiet"
        @click.prevent.stop="emit('unarchive', task)"
      >
        解除封存
      </button>
      <button v-else type="button" class="btn-quiet" @click.prevent.stop="emit('archive', task)">
        封存
      </button>
      <button
        v-if="!isArchived"
        type="button"
        class="btn-quiet danger"
        @click.prevent.stop="emit('delete', task)"
      >
        刪除
      </button>
    </div>
```

- [ ] **Step 3: 封存卡改用 `.card.flat`**

```html
  <div class="card task-card" :class="{ 'flat archived': isArchived }">
```

- [ ] **Step 4: `<style scoped>` 重寫**

```css
.task-card {
  /* stretch 的 ::after 要靠這個定位，少了它覆蓋層會跑去對齊 viewport。 */
  position: relative;
  transition:
    transform var(--dur-lift) var(--ease),
    box-shadow var(--dur-lift) var(--ease),
    border-color var(--dur-lift) var(--ease);
}

.task-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-raise);
  border-color: var(--color-line-strong);
}

/*
  封存的卡片一眼要看得出「沒在用」。退回頁面底色並且不浮起 ——
  浮起代表正在進行，平貼下去就是已經收起來的東西。
*/
.task-card.archived {
  background: var(--color-bg);
  border-color: var(--color-line-strong);
}

.task-card.archived:hover {
  transform: none;
  box-shadow: var(--shadow-flat);
}

.task-card.archived .section-title,
.task-card.archived .my-cost strong {
  color: var(--color-muted);
}

.meta {
  margin: var(--space-3) 0 var(--space-2);
}

/* 連結只包標題，但 ::after 撐滿整張卡片，所以整張卡都可點。 */
.stretch {
  color: inherit;
  text-decoration: none;
}

.stretch::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
}

.actions {
  /* 疊在 stretch 的覆蓋層之上，不然會點到任務頁。 */
  position: relative;
  z-index: 1;
  display: flex;
  justify-content: flex-end;
  gap: var(--space-4);
  margin-top: var(--space-3);
}

.archived-pill {
  border-radius: var(--radius-pill);
  padding: 6px 10px;
  background: var(--color-line-strong);
  color: var(--color-ink);
  font-size: var(--text-tiny);
  font-weight: 700;
}

.my-cost {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
  margin: 0 0 6px;
  padding-top: var(--space-2);
  border-top: 1px solid var(--color-line);
}

.my-cost strong {
  font-size: var(--text-card);
  font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 5: 驗證沒有殘留**

```bash
grep -n "box-shadow: none\|role-pill\|task-meta" src/components/task/TaskCard.vue
```

Expected: 沒有任何輸出。

```bash
grep -rn "box-shadow: none" src/
```

Expected: 全專案沒有任何輸出。

- [ ] **Step 6: 型別檢查與 build**

```bash
npm run check && npm run build
```

- [ ] **Step 7: 目視**

```bash
npm run dev
```

- 進行中的卡：一行灰字「擁有者 · 4 位成員 · 27 筆支出」，**沒有任何橘色藥丸**
- 滑過卡片 → 浮起 2px、陰影變明顯
- 右下角「封存」「刪除」是純文字，刪除是低飽和紅棕，滑過才轉正紅
- 封存卡：平貼、不浮起、只有「已封存」一顆灰藥丸、只有「解除封存」一顆按鈕
- 點卡片任何空白處仍然進得去任務頁；點「封存」不會誤觸導航

- [ ] **Step 8: Commit**

```bash
git add src/components/task/TaskCard.vue
git commit -m "Let the orange mean one thing again

一張卡上三顆橘色藥丸：角色、成員數、支出數。但那三個是屬性不是
狀態，而橘色在這個 app 裡的意思是「這個可以按」。三顆並排等於把
那個意思稀釋掉，然後右下角真正可按的兩顆反而是灰的。

屬性退成一行灰字，藥丸只留給狀態（已封存），而且一張卡最多一顆。
動作改用 btn-quiet，刪除平時是低飽和紅棕 —— 一輩子按不到幾次的
操作不該長期佔用畫面上最強的顏色。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 11: 全站驗收

**Files:** 不改任何檔案。發現問題就回到對應的 task。

- [ ] **Step 1: 自動檢查全跑一次**

```bash
npm run check && npm run build && npm test
```

Expected: 三者皆通過，含 `scripts/check-chunks.mjs`。

- [ ] **Step 2: 殘留掃描**

```bash
# 只找真正的使用。註解裡會提到舊值，那是刻意留著的說明，不該讓檢查誤報。
grep -rnF "var(--shadow-card" src/
grep -rnE ": *#a39a90" src/
grep -rnF "box-shadow: none" src/
grep -rn "gap: 6px\|gap: 10px" src/
grep -rn "border-radius: \(8\|12\|16\|20\|22\|999\)px" src/
grep -rn "color: var(--color-soft)" src/
grep -n "?? 0" src/pages/TaskListPage.vue
```

Expected: 五個指令都沒有輸出。

- [ ] **Step 3: 人工走查**

```bash
npm run dev
```

依序：任務列表 → 任務頁（支出／成員／結算三個頁籤）→ 支出表單 → 支出明細 → 報告頁 → 探索頁 → 收藏頁 → 個人設定。

每一頁看三件事：有沒有東西破版、灰字讀不讀得清楚、有沒有哪裡還剩下一顆孤立的橘色藥丸。

- [ ] **Step 4: hero 五狀態逐一確認**

尤其是**部分失敗**——用 Task 7 Step 6 的手法暫時讓某個 `listExpenses` 丟錯，確認：

- 總額真的少了那一趟（不是把它算成 0）
- 佔比的分母跟著變（三趟變兩趟，百分比會重算）
- 紅字在卡片裡面、貼在數字下方，並且講出是哪一趟

**驗證完把那行刪掉，並確認 `git status` 是乾淨的。**

- [ ] **Step 5: 開「減少動態」再走一遍**

Windows：設定 → 協助工具 → 視覺效果 → 動畫效果 關閉。

確認完全沒有東西在動：卡片不浮起、按鈕不縮、數字直接是終值、長條直接是最終比例、骨架不閃。

- [ ] **Step 6: 對比度抽查**

用瀏覽器 DevTools 的 contrast 檢查器點三個地方：任務卡的日期（`.tiny`）、hero 的「計算」按鈕文字、主按鈕的白字。三者都要 ≥ 4.5:1。

- [ ] **Step 7: Commit（若有修正）**

若前面步驟發現並修正了東西，各自 commit；沒有的話這一步跳過。

---

## Self-Review

**Spec coverage：**

| Spec 章節 | 對應 Task |
|---|---|
| §1.1 灰階 | Task 1（值）+ Task 2（角色遷移） |
| §1.2 橘色 | Task 1（值）+ Task 3（角色遷移） |
| §1.2.1 佔比條明度階 | Task 1（值）+ Task 8（使用） |
| §1.3 字級 | Task 1（值）+ Task 5（套用） |
| §1.4 間距 | Task 1 + Task 5 |
| §1.5 圓角 | Task 1 + Task 5 |
| §1.6 陰影 | Task 1 + Task 4 |
| §1.7 動態 token | Task 1 |
| §2.1 卡片三身分 | Task 4 |
| §2.2 橘色底只給容器 | Task 10（拿掉 TaskCard 的標籤底） |
| §2.3 藥丸規則 | Task 10 |
| §2.4 `.btn-quiet` | Task 4（定義）+ Task 10（使用） |
| §2.5 文字顏色三階 | Task 2 |
| §三 hero 五狀態 | Task 8 |
| §3.2.1 失敗要排除不能歸零 | Task 7 |
| §3.2.2 純函式 | Task 6 |
| §3.2.3 測試 | Task 6 |
| §四 TaskCard | Task 10 |
| §五 動態 | Task 3（按鈕）+ Task 9（滾動）+ Task 10（卡片浮起）+ Task 1（reduced-motion） |
| §七 驗收 | Task 11 |

沒有未涵蓋的章節。

**已知的計畫層級風險：**

1. **Task 5 是唯一沒有自動驗證的大範圍改動。** 18 個檔案的樣式值替換，只有人工目視擋得住。若要降低風險，可以把它拆成「圓角」「間距」「字級」三個 commit 分別走查。
2. **Task 8 的 template 很長。** 若實作時發現 `TaskListPage.vue` 的 template 變得難讀，把 hero 抽成 `src/components/task/CostHero.vue` 是合理的——但那要先確認 props 介面（`blocks`、`failedNote`、`costsLoading`、`costsLoaded`、`countProgress`）不會讓元件變成一個什麼都要傳的殼。
3. **多幣別狀態需要測試資料。** 手邊若沒有不同 `defaultCurrency` 的任務，Task 8 Step 5 的第 4 項驗不到。先建一個。
