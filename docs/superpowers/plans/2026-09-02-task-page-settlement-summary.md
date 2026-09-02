# 任務頁改版：結算上頂、導覽進網址 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「我還要付誰多少」從第三個頁籤搬到 `TaskPage` 頂部的摘要卡，完整結算面板降成 `?view=settlement` 次頁，頂層頁籤收成兩個，並把頁籤狀態從本地 `ref` 搬進網址。

**Architecture:** 由下而上：先把兩塊規則（網址解析、摘要的轉帳篩選）抽成 `utils` 純函式並用 TDD 寫出來，再補導覽守衛與 `styles.css`，最後才動 `TaskPage` 的 template。結算次頁用同一路由的 query 而不是新路由，因為四個 composable 都沒有快取，新路由會重查四趟。

**Tech Stack:** Vue 3 + TypeScript + Vite + vue-router 4 + Pinia，測試用 vitest（純函式，無 DOM），型別檢查 `vue-tsc --noEmit`。

**Spec:** `docs/superpowers/specs/2026-09-02-task-page-settlement-summary-design.md`

## Global Constraints

- **只動 `src/`。** `flutter_app/` 完全不碰。
- **不改 `SettlementPanel.vue` 的內部。** 570 行，含付款記錄與確認流程。這次只搬位置。
- **不改 `settleExpenses` 與任何金額計算。**
- **不改 `TaskPage.load()` 的 `Promise.all`。** 它跟先前在 `loadCosts` 修掉的是同一個模式，但不在這次範圍。
- **不加快取或共用 store。** 用 `?view=` 正是為了不必做這件事。
- **每個任務結束時 `npm run check` 必須通過。**
- **中文註解，寫「為什麼」不寫「做了什麼」。** 跟著既有風格。
- **測試套件看不到版面。** 只有 Task 1 與 Task 2 的純函式測得到，其餘靠 `vue-tsc`、build 與人工走查。不要用「`npm test` 全綠」當作版面改對了的證據。

### 既有型別（全計畫共用，不要重新定義）

```ts
// src/types/settlement.ts
export interface MemberBalance {
  uid: string;
  paid: number;   // 先付出去的總額
  owed: number;   // 該分攤的總額
  balance: number; // paid - owed，正數應收、負數應付
}

export interface Transfer {
  from: string;
  to: string;
  amount: number;
}

export interface Settlement {
  currency: string;
  total: number;
  expenseCount: number; // 只數算得出金額的，跟 task.expenseCount 不同
  paidTotal: number;    // 成員之間已確認還款的總額 —— 不上摘要卡
  balances: MemberBalance[];
  transfers: Transfer[];
  unconverted: Expense[];
}
```

`TripReport` 有 `active: boolean` 與 `listed: boolean`（`src/types/report.ts`）。

`TaskPage.vue` 已經有 `memberNames`，型別是 `Record<string, string>`（uid → 顯示名稱）。

---

## File Structure

**新增**

- `src/utils/taskView.ts` — 網址 query 解析成檢視狀態。純函式，不 import vue。
- `src/utils/settlementSummary.ts` — 摘要卡要顯示哪幾筆轉帳、我的分攤是多少。純函式。
- `src/components/settlement/SettlementSummary.vue` — 摘要卡。只負責畫，規則走上面兩個 utils。
- `tests/taskView.test.ts`
- `tests/settlementSummary.test.ts`

**修改**

- `src/router/index.ts` — query-only 導航跳過追蹤
- `src/assets/styles.css` — 六個顏色 token、巢狀圓角規則、`.tabs.two` 收攏、`.seg` 分段控制
- `src/pages/TaskPage.vue` — 導覽改 query、摘要卡、結算次頁、分享區塊收摺
- `src/pages/ExpenseFormPage.vue` — 移除重複的 `.tabs.two`

---

## Task 1: `taskView` 網址解析（TDD）

網址是使用者可以亂打的，也可能是別人貼過來的。解析規則放 `utils` 才測得到。

**Files:**
- Create: `src/utils/taskView.ts`
- Create: `tests/taskView.test.ts`

**Interfaces:**
- Consumes: 無
- Produces:
  - `type TaskView = "expenses" | "members" | "settlement"`
  - `parseTaskView(raw: unknown): TaskView`
  - `parseMapMode(raw: unknown, view: TaskView): boolean`

- [ ] **Step 1: 寫會失敗的測試**

建立 `tests/taskView.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { parseMapMode, parseTaskView } from "@/utils/taskView";

describe("parseTaskView", () => {
  it("認得成員與結算", () => {
    expect(parseTaskView("members")).toBe("members");
    expect(parseTaskView("settlement")).toBe("settlement");
  });

  it("明寫 expenses 也認得 —— 那是人會手打或別人貼過來的", () => {
    expect(parseTaskView("expenses")).toBe("expenses");
  });

  it("缺值、空字串、不認得的值一律回支出", () => {
    // 網址是使用者可以亂打的，不能因為打錯就給一個空畫面。
    expect(parseTaskView(undefined)).toBe("expenses");
    expect(parseTaskView(null)).toBe("expenses");
    expect(parseTaskView("")).toBe("expenses");
    expect(parseTaskView("settlements")).toBe("expenses");
    expect(parseTaskView("SETTLEMENT")).toBe("expenses");
  });

  it("重複參數會拿到陣列，一樣回支出", () => {
    // ?view=members&view=settlement 在 vue-router 會是 ["members", "settlement"]。
    expect(parseTaskView(["members", "settlement"])).toBe("expenses");
  });
});

describe("parseMapMode", () => {
  it("只有支出檢視看得到地圖", () => {
    expect(parseMapMode("1", "expenses")).toBe(true);
    expect(parseMapMode("1", "members")).toBe(false);
    expect(parseMapMode("1", "settlement")).toBe(false);
  });

  it("沒帶 map 或值不是 1 就是清單", () => {
    expect(parseMapMode(undefined, "expenses")).toBe(false);
    expect(parseMapMode(null, "expenses")).toBe(false);
    expect(parseMapMode("0", "expenses")).toBe(false);
    expect(parseMapMode("true", "expenses")).toBe(false);
  });

  it("重複參數的陣列不算開啟", () => {
    expect(parseMapMode(["1"], "expenses")).toBe(false);
  });
});
```

- [ ] **Step 2: 跑測試確認會失敗**

```bash
npm test -- taskView
```

Expected: FAIL，訊息是 `Failed to resolve import "@/utils/taskView"`。**如果它直接通過，代表測試沒被收進來，先解決那件事。**

- [ ] **Step 3: 實作**

建立 `src/utils/taskView.ts`：

```ts
/**
 * 任務頁的檢視狀態。放在網址的 query 裡而不是元件的 ref ——
 * 這樣重整活得下來、連結傳得出去、返回鍵也有意義。
 *
 * 純函式，不 import vue 也不 import vue-router。
 */

export type TaskView = "expenses" | "members" | "settlement";

const VIEWS: readonly TaskView[] = ["expenses", "members", "settlement"];

/**
 * 只認得白名單裡的值，其餘一律回支出。
 *
 * 參數型別是 unknown 而不是 string：vue-router 的 query 值在缺值時是
 * undefined，在 `?view=a&view=b` 時是陣列。網址是使用者可以亂打的，
 * 打錯不該給一個空畫面。
 */
export function parseTaskView(raw: unknown): TaskView {
  return VIEWS.includes(raw as TaskView) ? (raw as TaskView) : "expenses";
}

/**
 * 地圖是支出清單的另一種呈現，不是獨立的檢視 —— 成員與結算頁面上
 * 沒有地圖可看，所以 `?view=members&map=1` 不該開出一張地圖。
 */
export function parseMapMode(raw: unknown, view: TaskView): boolean {
  return view === "expenses" && raw === "1";
}
```

- [ ] **Step 4: 跑測試確認通過**

```bash
npm test -- taskView
```

Expected: PASS，10 個案例全綠。

- [ ] **Step 5: 型別檢查**

```bash
npm run check
```

Expected: 通過。

- [ ] **Step 6: Commit**

```bash
git add src/utils/taskView.ts tests/taskView.test.ts
git commit -m "Let the URL say which tab you are on

頁籤狀態現在是 TaskPage 的本地 ref，所以重整一定跳回支出、也沒辦法
把「成員」的連結傳給人。要搬進網址，就得先有一套「網址寫什麼就顯示
什麼」的規則 —— 而網址是使用者可以亂打的。

解析放 utils 才測得到。unknown 而不是 string 是必要的：vue-router 的
query 在缺值時是 undefined，在 ?view=a&view=b 時是陣列。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: `settlementSummary` 摘要規則（TDD）

**Files:**
- Create: `src/utils/settlementSummary.ts`
- Create: `tests/settlementSummary.test.ts`

**Interfaces:**
- Consumes: `MemberBalance`、`Transfer`（`@/types/settlement`）
- Produces:
  - `interface SummaryLine { from: string; to: string; amount: number; outgoing: boolean }`
  - `myTransfers(transfers: Transfer[], uid: string, max?: number): { lines: SummaryLine[]; rest: number }`
  - `myOwed(balances: MemberBalance[], uid: string): number`

- [ ] **Step 1: 寫會失敗的測試**

建立 `tests/settlementSummary.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { myOwed, myTransfers } from "@/utils/settlementSummary";
import type { MemberBalance, Transfer } from "@/types/settlement";

const ME = "u_ming";

function transfer(from: string, to: string, amount: number): Transfer {
  return { from, to, amount };
}

function balance(uid: string, paid: number, owed: number): MemberBalance {
  return { uid, paid, owed, balance: paid - owed };
}

describe("myTransfers", () => {
  it("只挑出跟我有關的那幾筆", () => {
    const all = [
      transfer(ME, "u_hua", 2340),
      transfer("u_hao", "u_jie", 900),
      transfer("u_jie", ME, 1180)
    ];
    expect(myTransfers(all, ME).lines).toHaveLength(2);
    expect(myTransfers(all, ME).lines.map(line => line.amount)).toEqual([2340, 1180]);
  });

  it("方向要分得出來 —— 付出去跟收進來是相反的行動", () => {
    const all = [transfer(ME, "u_hua", 2340), transfer("u_jie", ME, 1180)];
    const [out, into] = myTransfers(all, ME).lines;
    expect(out.outgoing).toBe(true);
    expect(into.outgoing).toBe(false);
  });

  it("超過 max 就只給前幾筆，剩下的筆數另外回", () => {
    const all = [
      transfer(ME, "a", 100),
      transfer(ME, "b", 90),
      transfer(ME, "c", 80),
      transfer(ME, "d", 70),
      transfer(ME, "e", 60)
    ];
    const result = myTransfers(all, ME, 3);
    expect(result.lines).toHaveLength(3);
    expect(result.rest).toBe(2);
  });

  it("沒超過 max 時 rest 是 0，不是負數", () => {
    const all = [transfer(ME, "u_hua", 2340)];
    expect(myTransfers(all, ME, 3).rest).toBe(0);
  });

  it("沒有跟我有關的轉帳就是空的 —— 那代表已經結清", () => {
    const all = [transfer("u_hua", "u_jie", 500)];
    expect(myTransfers(all, ME)).toEqual({ lines: [], rest: 0 });
  });

  it("完全沒有轉帳也不會爆", () => {
    expect(myTransfers([], ME)).toEqual({ lines: [], rest: 0 });
  });
});

describe("myOwed", () => {
  it("回的是 owed 不是 balance", () => {
    // owed 是「我該分攤多少」，balance 是「我多付或少付了多少」。
    // 這兩個很容易寫錯，而寫錯的畫面看起來完全正常。
    const balances = [balance(ME, 50000, 31480), balance("u_hua", 10000, 28520)];
    expect(myOwed(balances, ME)).toBe(31480);
  });

  it("找不到我時回 0 不是 undefined", () => {
    // 沒參與任何一筆支出的人不在 balances 裡。畫面上要顯示 0，不是空白。
    expect(myOwed([balance("u_hua", 10000, 10000)], ME)).toBe(0);
  });

  it("空陣列也回 0", () => {
    expect(myOwed([], ME)).toBe(0);
  });
});
```

- [ ] **Step 2: 跑測試確認會失敗**

```bash
npm test -- settlementSummary
```

Expected: FAIL，訊息是 `Failed to resolve import "@/utils/settlementSummary"`。

- [ ] **Step 3: 實作**

建立 `src/utils/settlementSummary.ts`：

```ts
/**
 * 摘要卡要顯示什麼。規則放這裡而不是元件裡，元件只負責畫。
 *
 * 純函式，不 import vue。
 */
import type { MemberBalance, Transfer } from "@/types/settlement";

export interface SummaryLine {
  from: string;
  to: string;
  amount: number;
  /** true 代表這筆是「我要付出去」。 */
  outgoing: boolean;
}

/**
 * 摘要卡上跟我有關的轉帳。
 *
 * 最少轉帳次數的演算法很少讓一個人牽涉到很多筆，max 實務上幾乎碰不到 ——
 * 但沒有它，畫面可以無限長。
 */
export function myTransfers(
  transfers: Transfer[],
  uid: string,
  max = 3
): { lines: SummaryLine[]; rest: number } {
  const mine = transfers.filter(item => item.from === uid || item.to === uid);

  return {
    lines: mine.slice(0, max).map(item => ({
      from: item.from,
      to: item.to,
      amount: item.amount,
      outgoing: item.from === uid
    })),
    rest: Math.max(mine.length - max, 0)
  };
}

/**
 * 我該分攤多少。
 *
 * 是 owed 不是 balance —— balance 是「我多付或少付了多少」，那是另一件事，
 * 而兩者寫錯的畫面看起來完全正常。
 *
 * 找不到我就是 0：沒參與任何一筆支出的人不會出現在 balances 裡，
 * 那時候該顯示 0 而不是空白。
 */
export function myOwed(balances: MemberBalance[], uid: string): number {
  return balances.find(item => item.uid === uid)?.owed ?? 0;
}
```

- [ ] **Step 4: 跑測試確認通過**

```bash
npm test -- settlementSummary
```

Expected: PASS，9 個案例全綠。

- [ ] **Step 5: 全套測試與型別檢查**

```bash
npm test && npm run check
```

Expected: 兩者通過。

- [ ] **Step 6: Commit**

```bash
git add src/utils/settlementSummary.ts tests/settlementSummary.test.ts
git commit -m "Separate what I owe from what I over-paid

摘要卡的主數字是 owed（我該分攤多少），不是 balance（我多付或少付了
多少）。這兩個很容易寫錯，而寫錯的畫面看起來完全正常 —— 所以用測試
釘住，不靠讀程式碼的人自己記得。

找不到自己時回 0 不是 undefined：沒參與任何一筆支出的人不在 balances
裡，那時候該顯示 0 而不是空白。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: 導覽守衛跳過 query-only 導航

頁籤搬進網址之後，每切一次頁籤都會觸發 `beforeEach`。不擋的話會弄髒效能數據。

**Files:**
- Modify: `src/router/index.ts`（`router.beforeEach` 開頭）

**Interfaces:**
- Consumes: 無
- Produces: 無

- [ ] **Step 1: 改 `beforeEach` 的追蹤判斷**

找到：

```ts
  const traceName = traceNameFor(to.path);
  if (traceName) {
```

改成：

```ts
  /*
    query 變了但路徑沒變 —— 那是頁內切換（任務頁的頁籤），不是一次頁面載入。

    不擋的話每切一次頁籤都會 startTrace 開一筆新的 trace，而元件沒有重新
    掛載、onMounted 不會再跑，finishTrace 永遠不會被呼叫。除了讓 tracedCounts
    灌水，更糟的是使用者在頁面還在載的時候切頁籤，正在進行的那一筆會被蓋掉。
  */
  const samePage = to.path === from.path;
  const traceName = samePage ? null : traceNameFor(to.path);
  if (traceName) {
```

`from` 已經是 `beforeEach` 的第二個參數，不用另外取。初次載入時 `from` 是
vue-router 的起始位置（path 為 `/`），不會誤判成同一頁。

- [ ] **Step 2: 型別檢查**

```bash
npm run check
```

Expected: 通過。如果報 `from is declared but never read` 之類的，代表原本的
簽章把 `from` 省略了——把它加回 `router.beforeEach(async (to, from) => {`。

- [ ] **Step 3: 確認 `navigationCount` 仍然每次都加**

`navigationCount += 1` 與 `firstPath` 那兩行**不要**放進 `samePage` 的判斷裡。
它們記的是「這個文件總共導航過幾次」，頁籤切換也是導航，照算。只有「開一筆
頁面載入的 trace」這件事要跳過。

- [ ] **Step 4: Commit**

```bash
git add src/router/index.ts
git commit -m "Don't call a tab switch a page load

頁籤要搬進網址，而 beforeEach 對 query-only 導航照樣會跑、traceNameFor
只看 path 看不到 query。所以每切一次頁籤都會 startTrace 開一筆新的，
而元件沒有重新掛載、onMounted 不會再跑，finishTrace 永遠不會被呼叫。

除了灌水 tracedCounts，更糟的是使用者在頁面還在載的時候切頁籤，正在
進行的那一筆會被蓋掉 —— 而那正是這個專案花了好幾輪在量的東西。

navigationCount 與 firstPath 照樣每次都加：頁籤切換確實是一次導航，
要跳過的只有「開一筆頁面載入的 trace」。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: `styles.css` — token、巢狀圓角、分段控制

**Files:**
- Modify: `src/assets/styles.css`（`:root`、`.tabs`、`.tab`、`.btn-danger`、`.btn-quiet.danger`、`.error`，並新增 `.tabs.two` 與 `.seg`）
- Modify: `src/pages/TaskPage.vue`（刪掉 scoped 的 `.tabs.two`）
- Modify: `src/pages/ExpenseFormPage.vue`（刪掉 scoped 的 `.tabs.two`）
- Modify: `src/pages/TaskListPage.vue`（骨架漸層改用 token）

**Interfaces:**
- Consumes: 既有的 `--radius-*`、`--space-*`
- Produces: CSS 變數 `--color-track`、`--color-danger-line`、`--color-danger-soft`、`--color-danger-quiet`、`--color-skeleton`、`--color-skeleton-hi`；CSS 類別 `.seg`、`.seg-item`

- [ ] **Step 1: 加六個顏色 token**

在 `:root` 的 `--color-success-soft` 那一行後面加：

```css
  /*
    上一輪稽核硬寫顏色時只掃了 .vue，沒掃這個檔案本身，所以這六個漏網。
  */
  --color-track: #f0ebe4; /* 頁籤與分段控制的底槽，比頁面底色再深一階 */
  --color-danger-line: #f3d2ce;
  --color-danger-soft: #fff5f5;
  --color-danger-quiet: #b8837c; /* 平時的刪除鈕。正紅留給 hover。 */
  --color-skeleton: #efeae3;
  --color-skeleton-hi: #f7f3ee;
```

- [ ] **Step 2: 把四處硬寫值換成 token**

| 位置 | 現在 | 改成 |
|---|---|---|
| `.btn-danger` 的 `border-color` | `#f3d2ce` | `var(--color-danger-line)` |
| `.btn-quiet.danger` 的 `color` | `#b8837c` | `var(--color-danger-quiet)` |
| `.error` 的 `border` | `1px solid #f3d2ce` | `1px solid var(--color-danger-line)` |
| `.error` 的 `background` | `#fff5f5` | `var(--color-danger-soft)` |
| `.tabs` 的 `background` | `#f0ebe4` | `var(--color-track)` |

`TaskListPage.vue` 的 `.skel` 漸層：

```css
  background: linear-gradient(
    90deg,
    var(--color-skeleton) 25%,
    var(--color-skeleton-hi) 50%,
    var(--color-skeleton) 75%
  );
```

`#fff` 留著不動——那是填色按鈕上的白字，是對比的另一半，不是可以換主題的表面。

- [ ] **Step 3: 修掉巢狀圓角回歸**

`.tabs` 與 `.tab` 改成：

```css
/*
  巢狀圓角：內層 = 外層 − padding。差一點點就會看到內外的弧線互相撞到。

  這一組被機械替換弄壞過一次 —— 原本是 16/12/padding 4（16 − 4 = 12，
  精確嵌套），收 token 時兩個都被塞進 --radius-md 變成 14/14。規則寫在
  這裡，下次才不會再被收掉。
*/
.tabs {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-2);
  padding: var(--space-1); /* 4 */
  border-radius: var(--radius-md); /* 14 */
  background: var(--color-track);
}

/* 兩個頁籤的變體。原本 TaskPage 與 ExpenseFormPage 各自寫了一份。 */
.tabs.two {
  grid-template-columns: repeat(2, 1fr);
}

.tab {
  border: 0;
  border-radius: var(--radius-sm); /* 14 − 4 = 10 ✓ */
  background: transparent;
  min-height: 38px;
  color: var(--color-muted);
  font-weight: 700;
  transition:
    background var(--dur-base) var(--ease),
    color var(--dur-base) var(--ease);
}

.tab.active {
  background: var(--color-ink);
  color: #fff;
}
```

- [ ] **Step 4: 新增分段控制**

接在 `.tab.active` 後面：

```css
/*
  次層級的切換（清單／地圖）。跟 .tabs 同一組 token、同一條巢狀規則，
  但選中態是白底而不是 .tab.active 的墨黑底。

  次層級不該跟頂層搶同一個視覺重量 —— 如果這裡也用墨黑，就只是把兩排
  膠囊換成一排加一組膠囊，兩層相疊的問題沒有解掉。
*/
.seg {
  display: inline-flex;
  flex: none;
  gap: var(--space-1);
  padding: var(--space-1);
  border-radius: var(--radius-md);
  background: var(--color-track);
}

.seg-item {
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  padding: 6px 12px;
  color: var(--color-muted);
  font-size: var(--text-tiny);
  font-weight: 700;
  transition:
    background var(--dur-base) var(--ease),
    color var(--dur-base) var(--ease);
}

.seg-item.active {
  background: var(--color-card);
  color: var(--color-ink);
  box-shadow: var(--shadow-rest);
}
```

- [ ] **Step 5: 刪掉兩個檔案裡重複的 `.tabs.two`**

`src/pages/TaskPage.vue` 與 `src/pages/ExpenseFormPage.vue` 的 `<style scoped>`
各有一份：

```css
.tabs.two {
  grid-template-columns: repeat(2, 1fr);
}
```

兩份都刪掉——現在由 `styles.css` 提供。

- [ ] **Step 6: 驗證**

```bash
grep -rn "#f0ebe4\|#f3d2ce\|#fff5f5\|#b8837c\|#efeae3\|#f7f3ee" src/
```

Expected: 只有 `styles.css` 的 `:root` 那六行定義。

```bash
grep -rn "tabs.two" src/
```

Expected: 只有 `styles.css` 一處。

- [ ] **Step 7: check 與 build**

```bash
npm run check && npm run build
```

Expected: 兩者通過。

- [ ] **Step 8: 目視確認圓角**

```bash
npm run dev
```

打開任何一個任務頁，放大看頁籤：**外框的圓角與內層選中膠囊的圓角應該是同心的**，
不會在角落看到兩條弧線互相擠壓。

- [ ] **Step 9: Commit**

```bash
git add src/
git commit -m "Restore the radius nesting a blanket replace broke

.tabs 原本 16px、.tab 12px、padding 4px —— 16 − 4 = 12，內外精確嵌套。
上一輪收 token 時兩個都被塞進 --radius-md，變成 14/14，內層的圓角比它
的內縮量多出 4px，角落會互相撞到。

規則（內層 = 外層 − padding）直接寫在那兩條規則上面，下次才不會再被
一起收掉。

順帶補上六個漏網的顏色 token：上一輪稽核只掃了 .vue，沒掃 styles.css
本身。其中三個還是上一輪自己加進去的硬寫值。

.tabs.two 在 TaskPage 與 ExpenseFormPage 各寫了一份，收攏到 styles.css。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: `SettlementSummary.vue` 摘要卡

只負責畫。規則走 Task 2 的兩個純函式。

**Files:**
- Create: `src/components/settlement/SettlementSummary.vue`

**Interfaces:**
- Consumes: Task 2 的 `myOwed`、`myTransfers`、`SummaryLine`
- Produces: 元件 `<SettlementSummary :settlement :uid :member-names :settlement-to />`

- [ ] **Step 1: 建立元件**

```vue
<script setup lang="ts">
import { computed } from "vue";
import { RouterLink, type RouteLocationRaw } from "vue-router";
import type { Settlement } from "@/types/settlement";
import { myOwed, myTransfers } from "@/utils/settlementSummary";
import { formatAmount } from "@/utils/currency";

const props = defineProps<{
  settlement: Settlement;
  uid: string;
  /** uid → 顯示名稱。TaskPage 已經有這個 computed。 */
  memberNames: Record<string, string>;
  settlementTo: RouteLocationRaw;
}>();

const owed = computed(() => myOwed(props.settlement.balances, props.uid));
const mine = computed(() => myTransfers(props.settlement.transfers, props.uid));

function money(amount: number) {
  return formatAmount(amount, props.settlement.currency);
}

function name(uid: string) {
  return props.memberNames[uid] ?? "已移除的成員";
}
</script>

<template>
  <section class="card summary">
    <p class="label">我的分攤</p>
    <p class="figure">{{ money(owed) }}</p>
    <!--
      筆數用 settlement.expenseCount（只數算得出金額的）而不是 task.expenseCount
      （全部）。兩者的差額正是未換算的那幾筆，而那條警告就在下面 —— 用全部的
      筆數會讓「總額」跟「筆數」對不起來，而且對不起來的方向剛好是讓數字看起來
      比較完整。
    -->
    <p class="tiny context">
      這趟總額 {{ money(settlement.total) }} · {{ settlement.expenseCount }} 筆
    </p>

    <div class="lines">
      <!--
        方向不能只靠顏色。文案本身就是「你付給 X」與「X 付給你」，
        色覺障礙的人讀文字就分得出來 —— 跟 .btn-saved 的雙重編碼同一個原則。
      -->
      <p v-for="line in mine.lines" :key="`${line.from}-${line.to}`" class="line">
        <span v-if="line.outgoing">你付給 {{ name(line.to) }}</span>
        <span v-else>{{ name(line.from) }} 付給你</span>
        <strong :class="{ incoming: !line.outgoing }">{{ money(line.amount) }}</strong>
      </p>

      <p v-if="mine.rest" class="tiny">還有 {{ mine.rest }} 筆</p>

      <!-- 已結清是好消息，值得一行字。留白會讓人以為是還沒算出來。 -->
      <p v-if="!mine.lines.length" class="line settled">已經結清</p>
    </div>

    <!--
      數字不完整時，話要講在數字旁邊。這個警告本來只存在於 SettlementPanel，
      而結算已經變成次頁 —— 不提上來的話，使用者會更少看到「上面那個數字
      少算了東西」。
    -->
    <p v-if="settlement.unconverted.length" class="warn">
      有 {{ settlement.unconverted.length }} 筆支出還沒有匯率，沒有算進上面的數字。
    </p>

    <RouterLink :to="settlementTo" class="more">完整結算與付款紀錄 →</RouterLink>
  </section>
</template>

<style scoped>
.summary {
  display: flex;
  flex-direction: column;
}

.label {
  margin: 0 0 var(--space-text);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-muted);
}

.figure {
  margin: 0;
  font-size: var(--text-display);
  font-weight: 800;
  letter-spacing: -0.03em;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.context {
  margin: var(--space-2) 0 0;
}

.lines {
  margin-top: var(--space-3);
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-line);
}

.line {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
  margin: 0 0 var(--space-2);
  font-size: var(--text-body);
}

.line:last-child {
  margin-bottom: 0;
}

.line strong {
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

/* 收錢跟付錢是相反方向的行動，不該長一樣。 */
.line strong.incoming {
  color: var(--color-success);
}

.settled {
  color: var(--color-muted);
}

.warn {
  margin: var(--space-3) 0 0;
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-line);
  font-size: var(--text-tiny);
  line-height: 1.65;
  color: var(--color-danger);
}

.more {
  margin-top: var(--space-3);
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-line);
  color: var(--color-primary-dark);
  font-size: var(--text-tiny);
  font-weight: 800;
  transition: color var(--dur-base) var(--ease);
}

.more:hover {
  color: var(--color-primary-deep);
}
</style>
```

- [ ] **Step 2: 型別檢查**

```bash
npm run check
```

Expected: 通過。元件還沒被任何人用，但型別要先對。

- [ ] **Step 3: Commit**

```bash
git add src/components/settlement/SettlementSummary.vue
git commit -m "Put the answer on a card

「我還要付誰多少」是這個 app 存在的理由，現在藏在第三個頁籤裡。
這張卡把結論搬到頂部：我的分攤、跟我有關的轉帳、以及數字不完整時的
警告。

三個刻意的決定。筆數用 settlement.expenseCount 而不是 task.expenseCount
—— 兩者的差額正是未換算的那幾筆，用全部的筆數會讓總額跟筆數對不起來，
而且對不起來的方向剛好是讓數字看起來比較完整。

方向不只靠顏色：文案是「你付給 X」與「X 付給你」，讀文字就分得出來。

已結清時明講而不是留白 —— 那是好消息，留白會讓人以為還沒算出來。

paidTotal 不上這張卡：它是成員之間還款的總額，不是「花掉的錢裡付掉
多少」，放在總額旁邊會被讀成後者。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: `TaskPage` 導覽搬進網址

**Files:**
- Modify: `src/pages/TaskPage.vue`（`activeTab` / `expenseView` 兩個 ref、頁籤 template、地圖切換 template）

**Interfaces:**
- Consumes: Task 1 的 `parseTaskView`、`parseMapMode`、`TaskView`
- Produces: `view`（`ComputedRef<TaskView>`）、`mapMode`（`ComputedRef<boolean>`）、`goView(next)`、`goMap(on)`、`settlementTo`（Task 7 會用）

- [ ] **Step 1: 換掉兩個 ref**

刪掉：

```ts
const activeTab = ref<Tab>("expenses");
```

以及：

```ts
const expenseView = ref<"list" | "map">("list");
```

在 `const taskId = ...` 後面加：

```ts
/*
  檢視狀態住在網址而不是本地 ref。原本重整一定跳回支出、也沒辦法把
  「成員」的連結傳給人。

  route 與 router 這個檔案上面已經取好了。
*/
const view = computed(() => parseTaskView(route.query.view));
const mapMode = computed(() => parseMapMode(route.query.map, view.value));

/**
 * 摘要卡的「完整結算」連到這裡。RouterLink 預設是 push，正合適 ——
 * 次頁就該用返回鍵回得來。
 *
 * 順手丟掉 map：地圖只屬於支出清單，帶到結算的網址上只是雜訊。
 */
const settlementTo = computed(() => {
  const query: Record<string, unknown> = { ...route.query, view: "settlement" };
  delete query.map;
  return { query };
});

/*
  頁籤一律用 replace。

  它是同層級切換，不是「去了別的地方」—— 用 push 的話，逛過三個頁籤
  之後要按四次返回才離得開任務頁。replace 維持今天的返回語意（按返回
  離開任務頁），只是多了可重整、可傳連結。

  進出結算不走這裡：進去是摘要卡的 RouterLink（push，返回鍵才回得來），
  出來是次頁的返回列（replace，見 Task 7）。頁籤在結算次頁是隱藏的，
  所以這個函式永遠不會收到 "settlement"。
*/
function goView(next: TaskView) {
  const query: Record<string, unknown> = { ...route.query };
  // 換檢視就丟掉地圖模式 —— 它只屬於支出清單。
  delete query.map;
  // 預設值不寫進網址：分享出去的連結不該多一段沒有資訊的雜訊。
  if (next === "expenses") delete query.view;
  else query.view = next;
  router.replace({ query });
}

function goMap(on: boolean) {
  const query: Record<string, unknown> = { ...route.query };
  if (on) query.map = "1";
  else delete query.map;
  router.replace({ query });
}
```

`import` 補上：

```ts
import { parseMapMode, parseTaskView, type TaskView } from "@/utils/taskView";
```

如果 `Tab` 這個型別別名只有 `activeTab` 在用，一併刪掉。

- [ ] **Step 2: 頂層頁籤改成兩個**

把三顆頁籤的那一段換成：

```html
        <div class="tabs two">
          <button class="tab" :class="{ active: view === 'expenses' }" @click="goView('expenses')">
            支出
          </button>
          <button class="tab" :class="{ active: view === 'members' }" @click="goView('members')">
            成員
          </button>
        </div>
```

- [ ] **Step 3: 三處 `activeTab` 的條件改成 `view`**

- `<section v-if="activeTab === 'expenses'">` → `v-if="view === 'expenses'"`
- `<section v-if="activeTab === 'members'">` → `v-if="view === 'members'"`
- `<section v-if="activeTab === 'settlement'">` → `v-if="view === 'settlement'"`（Task 7 會再改這一段的版面，這一步只讓它先能動）

- [ ] **Step 4: 地圖切換改成分段控制**

把第二排頁籤那一段：

```html
            <div v-if="mapAvailable && expenseMarkers.length" class="tabs two">
              <button class="tab" :class="{ active: expenseView === 'list' }" @click="expenseView = 'list'">
                清單
              </button>
              <button class="tab" :class="{ active: expenseView === 'map' }" @click="expenseView = 'map'">
                地圖（{{ expenseMarkers.length }}）
              </button>
            </div>
```

換成跟「新增支出」同一列的分段控制：

```html
            <!--
              「新增支出」與檢視切換同一列。原本檢視切換是第二排頁籤，
              跟上面那排長得一模一樣，只能靠位置分辨哪一排是主層級。
            -->
            <div class="actbar">
              <RouterLink
                v-if="!isArchived"
                :to="`/tasks/${taskId}/expenses/new`"
                class="btn btn-primary grow-btn"
              >
                新增支出
              </RouterLink>
              <div v-if="mapAvailable && expenseMarkers.length" class="seg">
                <button class="seg-item" :class="{ active: !mapMode }" @click="goMap(false)">
                  清單
                </button>
                <button class="seg-item" :class="{ active: mapMode }" @click="goMap(true)">
                  地圖 {{ expenseMarkers.length }}
                </button>
              </div>
            </div>
```

原本獨立的那顆「新增支出」`RouterLink` 刪掉——它已經被併進 `.actbar` 了。

- [ ] **Step 5: 兩處 `expenseView` 的條件改成 `mapMode`**

- `<template v-if="expenseView === 'map'">` → `v-if="mapMode"`
- 對應的 `<template v-else>` 不用改

- [ ] **Step 6: 加上 `.actbar` 的樣式**

在 `TaskPage.vue` 的 `<style scoped>` 加：

```css
.actbar {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

/* 主要動作吃掉剩餘寬度，切換靠右且不被壓縮。 */
.grow-btn {
  flex: 1;
}
```

- [ ] **Step 7: 型別檢查與 build**

```bash
npm run check && npm run build
```

Expected: 通過。若報 `Tab` 未使用，把那個型別別名刪掉。

- [ ] **Step 8: 手動驗證導覽**

```bash
npm run dev
```

1. 進任務頁 → 網址是 `/tasks/xxx`，沒有多餘的 query
2. 點「成員」→ 網址變 `?view=members`
3. 按 F5 重整 → **停在成員**，不是跳回支出
4. 點「支出」→ `view` 從網址消失，不是變成 `?view=expenses`
5. 手打 `?view=expenses` → 顯示支出（認得，只是不會自己寫出來）
6. 手打 `?view=nonsense` → 顯示支出，不是空白
7. 支出 → 成員 → 按瀏覽器返回 → **離開任務頁**（維持今天的行為）
8. 切到地圖 → `?map=1`；切到成員 → `map` 消失

- [ ] **Step 9: Commit**

```bash
git add src/pages/TaskPage.vue
git commit -m "Let the URL say which tab you are on, for real

activeTab 與 expenseView 是本地 ref，所以重整一定跳回支出、沒辦法把
「成員」的連結傳給人、返回鍵在任何頁籤上都直接離開任務頁。搬進網址
之後三件事一起解決。

push 與 replace 分開是這一步最重要的決定。頁籤用 replace —— 它是同層級
切換，用 push 的話逛過三個頁籤要按四次返回才離得開。進出結算用 push，
那才是「去了另一個畫面」。

切回支出時把 view 從網址移除而不是寫成 ?view=expenses：預設值不該出現
在分享出去的連結裡。但打進來要認得，因為那是人會手打的東西。

「清單／地圖」從第二排頁籤降級成分段控制，跟新增支出併成一列。原本
兩排膠囊長得一模一樣，只能靠位置分辨哪一排是主層級。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: 摘要卡上頁 + 結算次頁

**Files:**
- Modify: `src/pages/TaskPage.vue`（摘要卡插入、結算區段改版面）

**Interfaces:**
- Consumes: Task 5 的 `SettlementSummary`、Task 6 的 `view` / `settlementTo`
- Produces: 無

- [ ] **Step 1: import 元件**

```ts
import SettlementSummary from "@/components/settlement/SettlementSummary.vue";
```

- [ ] **Step 2: 摘要卡插進標題區底下**

在標題區那個 `<div class="spread">` 的結束標籤之後、封存橫幅之前插入：

```html
        <!--
          資料還沒到時整張卡不出現，不畫骨架 —— 頁面層級已經有 LoadingState，
          再疊一個骨架等於同一件事說兩次。

          結算次頁不顯示它：完整面板已經涵蓋，再放一張摘要只是重複。
        -->
        <SettlementSummary
          v-if="view !== 'settlement' && settlement"
          :settlement="settlement"
          :uid="uid"
          :member-names="memberNames"
          :settlement-to="settlementTo"
        />
```

若 `settlement` 是 `ComputedRef<Settlement>`（非 nullable），把 `&& settlement`
改成 `&& !expenseState.loading.value`——條件的意思是「資料到了才畫」，不是
「有值才畫」。實作時看 `const settlement = computed(...)` 的實際型別決定。

- [ ] **Step 3: 結算區段改成次頁版面**

把 `<section v-if="view === 'settlement'">` 那一段的開頭改成：

```html
        <section v-if="view === 'settlement'" class="stack">
          <!--
            返回用 RouterLink 而不是 button：中鍵開新分頁、長按選單、
            「複製連結網址」都會是瀏覽器原生行為。這個理由這一頁的
            「開啟」按鈕已經寫過一次，沿用同一套判斷。
          -->
          <RouterLink :to="{ query: backQuery }" replace class="btn-quiet back">
            ← 回到支出
          </RouterLink>
```

`replace` 是必要的。進來時是 push，歷史是 `[支出, 結算]`；返回列如果也用
push，會變成 `[支出, 結算, 支出]` —— 使用者按返回會回到結算，跟他剛剛
按「回到支出」的意圖正好相反。用 replace 之後，不管是按返回鍵還是按這個
連結，離開結算後再按一次返回都是離開任務頁，行為一致。

在 script 加：

```ts
/** 結算次頁的返回目的地。保留 denied 之類的其他 query，只拿掉 view。 */
const backQuery = computed(() => {
  const query: Record<string, unknown> = { ...route.query };
  delete query.view;
  delete query.map;
  return query;
});
```

- [ ] **Step 4: 頁籤列在結算次頁隱藏**

頂層頁籤那個 `<div class="tabs two">` 加上條件：

```html
        <div v-if="view !== 'settlement'" class="tabs two">
```

- [ ] **Step 5: 加上返回列的樣式**

`TaskPage.vue` 的 `<style scoped>` 加：

```css
.back {
  align-self: flex-start;
  font-size: var(--text-body);
}
```

- [ ] **Step 6: 型別檢查與 build**

```bash
npm run check && npm run build
```

- [ ] **Step 7: 手動驗證**

```bash
npm run dev
```

1. 進任務頁 → 標題底下出現摘要卡
2. 摘要卡的「我的分攤」跟結算面板裡自己那一列的「分攤」**數字一致**
3. 點「完整結算與付款紀錄 →」→ 網址變 `?view=settlement`，頁籤列與摘要卡都消失，出現「← 回到支出」與完整面板
4. **按瀏覽器返回 → 回到支出**，不是離開任務頁
5. 直接把 `?view=settlement` 貼進網址列 → 直接到結算，資料正常（不用多一次查詢）
6. 找一個有未換算支出的任務 → 摘要卡出現紅字警告，而且「筆數」比標題那行的筆數少
7. 找一個已結清的任務 → 摘要卡顯示「已經結清」，不是空白
8. 開 DevTools 的 Network，切頁籤與進出結算 → **不該有新的 Firestore 請求**

- [ ] **Step 8: Commit**

```bash
git add src/pages/TaskPage.vue
git commit -m "Move the answer out of the third tab

「我還要付誰多少」是這個 app 存在的理由，卻要切到第三個頁籤才看得到。
而任務列表頁的 hero 一眼就給得出總花費 —— 點進去反而什麼數字都沒有。
那個落差是上一輪自己造成的。

結論上頂成摘要卡，完整面板降成 ?view=settlement 次頁。用 query 而不是
新路由是被資料層逼出來的：四個 composable 各持有本地 ref、沒有快取，
真開一個 /settlement 路由會把四趟查詢重跑一次，而這個專案已經為冷啟動
投入了 perfTrace、stallGuard、recoverConnection。

返回列用 RouterLink 而不是 button，沿用這一頁「開啟」按鈕已經寫過的
理由：中鍵開新分頁、長按選單、複製連結網址都會是瀏覽器原生行為。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 8: 分享報告區塊收成一行

**Files:**
- Modify: `src/pages/TaskPage.vue`（分享區段的標頭與收摺）

**Interfaces:**
- Consumes: 無
- Produces: 無

- [ ] **Step 1: 加狀態與文案**

script 加：

```ts
/*
  預設收起。這一塊只在「已封存且是 owner」時出現，本來就是低頻操作，
  而它展開後是輸入框＋四顆按鈕＋checkbox＋兩種警告的一整片。
*/
const shareOpen = ref(false);

/** 收起時最該知道的就是狀態，所以標頭右邊講它。 */
const shareStatus = computed(() => {
  const report = reportState.report.value;
  if (!report) return "尚未產生";
  if (!report.active) return "連結已關閉";
  return report.listed ? "連結開著 · 已列入公開頁" : "連結開著";
});
```

- [ ] **Step 2: 標頭改成可收摺**

把分享區段的開頭：

```html
        <section v-if="isArchived && taskState.isOwner.value" class="card stack">
          <strong class="section-title">分享這趟旅程</strong>
```

換成：

```html
        <section v-if="isArchived && taskState.isOwner.value" class="card stack">
          <!--
            照 ExpenseDayGroup 既有的收摺模式：button + aria-expanded + chevron。
            全專案沒有用過 <details>，不在這裡開先例。
          -->
          <button
            type="button"
            class="share-head"
            :aria-expanded="shareOpen"
            @click="shareOpen = !shareOpen"
          >
            <span class="chevron" aria-hidden="true">{{ shareOpen ? "▾" : "▸" }}</span>
            <strong class="section-title">分享這趟旅程</strong>
            <span class="tiny share-status">{{ shareStatus }}</span>
          </button>
```

- [ ] **Step 3: 把區段其餘內容包進 `v-if`**

從 `<p v-if="!expenseState.expenses.value.length" class="tiny warn">` 到該
`</section>` 之前的所有內容，包在一層：

```html
          <div v-if="shareOpen" class="stack">
            ...原本的內容...
          </div>
```

- [ ] **Step 4: 加樣式**

```css
.share-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  border: 0;
  background: none;
  padding: 0;
  text-align: left;
}

.chevron {
  flex: none;
  color: var(--color-muted);
}

/* 狀態靠右，因為收起時它是這一行唯一新增的資訊。 */
.share-status {
  margin: 0 0 0 auto;
  text-align: right;
}
```

- [ ] **Step 5: 型別檢查與 build**

```bash
npm run check && npm run build
```

- [ ] **Step 6: 手動驗證**

找一個已封存且自己是 owner 的任務（沒有的話先封存一個）：

1. 分享區塊預設**收起**，只有一行
2. 右側狀態文字對得上實際狀態（尚未產生 / 連結開著 / 連結開著 · 已列入公開頁 / 連結已關閉）
3. 點一下展開，原本的內容全在，功能正常
4. 用鍵盤 Tab 到那一行按 Enter 也能展開

- [ ] **Step 7: Commit**

```bash
git add src/pages/TaskPage.vue
git commit -m "Fold the sharing block down to one line

它只在「已封存且是 owner」時出現，是低頻操作 —— 但展開後是輸入框、
四顆按鈕、一個 checkbox 與兩種警告的一整片，就這樣攤在任務頁上。

收起時右邊講狀態，因為那正是收起時唯一該知道的事：連結開著沒、有沒有
列入公開頁。

用 ExpenseDayGroup 既有的 button + aria-expanded + chevron 模式，不用
<details> —— 全專案沒有用過，不在這裡開先例。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 9: 驗收

**Files:** 不改任何檔案。發現問題就回到對應的 task。

- [ ] **Step 1: 自動檢查**

```bash
npm run check && npm run build && npm test
```

Expected: 三者皆通過。測試數應該比動工前多 19（Task 1 的 10 個 + Task 2 的 9 個）。

- [ ] **Step 2: 掃描**

```bash
grep -rn "#f0ebe4\|#f3d2ce\|#fff5f5\|#b8837c\|#efeae3\|#f7f3ee" src/
```

Expected: 只有 `styles.css` 的 `:root` 六行定義。

```bash
grep -rn "tabs.two" src/
```

Expected: 只有 `styles.css` 一處。

```bash
grep -n "activeTab\|expenseView" src/pages/TaskPage.vue
```

Expected: 沒有任何輸出。

- [ ] **Step 3: 網址走查**

四個網址直接貼進網址列，都要到得了對的畫面：

- `/tasks/<id>` → 支出清單
- `/tasks/<id>?map=1` → 支出地圖
- `/tasks/<id>?view=members` → 成員
- `/tasks/<id>?view=settlement` → 結算次頁

再試三個壞網址，都要落回支出而不是空白：`?view=`、`?view=nonsense`、
`?view=members&view=settlement`。

- [ ] **Step 4: 返回鍵走查**

- 支出 → 成員 → 返回：**離開任務頁**（維持今天的行為）
- 支出 → 結算 → 返回：**回到支出**
- 支出 → 地圖 → 返回：離開任務頁（地圖是檢視偏好，用 replace）

- [ ] **Step 5: 數字正確性**

- 摘要卡的「我的分攤」跟結算面板裡自己那一列的「分攤」一致
- 有未換算支出的任務：摘要卡出現警告，且摘要卡的筆數 < 標題那行的筆數
- 已結清的任務：顯示「已經結清」
- 有人要付我錢的任務：那一列的金額是綠色，文案是「X 付給你」

- [ ] **Step 6: 沒有多餘的請求**

開 DevTools 的 Network，切頁籤、切地圖、進出結算——**全程不該有新的
Firestore 請求**。這是選 query 而不是新路由的全部理由，要親眼確認。

- [ ] **Step 7: 圓角與減少動態**

- 放大看頁籤：外框與內層選中膠囊的圓角同心，角落沒有兩條弧線互相擠壓
- 開系統的「減少動態」再走一遍：頁籤與分段控制的切換不該有過場

- [ ] **Step 8: Commit（若有修正）**

若前面步驟發現並修正了東西，各自 commit；沒有的話跳過。

---

## Self-Review

**Spec coverage：**

| Spec 章節 | 對應 Task |
|---|---|
| §1.1 網址對照 | Task 1（解析）+ Task 6（套用） |
| §1.2 為什麼是 query | Task 6 的做法本身 |
| §1.3 push / replace | Task 6 Step 1 |
| §1.4 三個既有毛病 | Task 6 Step 8 的驗證項 |
| §1.5 重複開 trace | Task 3 |
| §2 摘要卡版面 | Task 5 |
| §2.1 數字來源 | Task 2（純函式）+ Task 5（畫） |
| §2.2 方向要看得出來 | Task 5 的 `.incoming` 與文案 |
| §2.3 沒有轉帳時明講 | Task 5 的 `.settled` |
| §2.4 未換算警告提上來 | Task 5 的 `.warn` |
| §3 結算次頁 | Task 7 |
| §4.1 分享區塊收摺 | Task 8 |
| §4.2 巢狀圓角 | Task 4 Step 3 |
| §4.3 顏色 token | Task 4 Step 1-2 |
| §4.4 分段控制 | Task 4 Step 4 + Task 6 Step 4 |
| §5 純函式 | Task 1、Task 2 |
| §5.1 測試 | Task 1 Step 1、Task 2 Step 1 |
| §6 檔案清單 | File Structure |
| §7 驗收 | Task 9 |

沒有未涵蓋的章節。

**已知的計畫層級風險：**

1. **Task 7 Step 2 有一個要現場判斷的地方。** `settlement` 這個 computed
   的實際型別（nullable 與否）決定 `v-if` 怎麼寫。計畫給了兩種寫法與判斷
   依據，但實作時要真的去看一眼，不要照抄。
2. **Task 6 與 Task 7 都在動同一個 template 的相鄰區域。** 分成兩個 commit
   是為了讓「導覽改對了」與「版面改對了」能分開驗；但如果 Task 6 之後畫面
   暫時很醜（摘要卡還沒進來、結算頁籤沒了但次頁也還沒做好），那是預期的，
   不要在 Task 6 就去修版面。
3. **`?view=settlement` 在 Task 6 結束時是可到達但沒有返回路徑的。** Task 7
   Step 3 才補上返回列。中途不要停在那個狀態交付。
