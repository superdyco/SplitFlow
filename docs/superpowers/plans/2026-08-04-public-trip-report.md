# 公開旅費報告 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓已封存任務的擁有者產生一份公開可分享的旅費報告，讓沒去的人知道這樣玩一趟大概要花多少錢。

**Architecture:** 報告是一份獨立的快照文件，公開讀取的只有它，絕不觸碰即時資料。彙總全部由純函式算出並寫死進文件；地圖在產生當下用 Static Maps API 拍成一張 PNG 存進 Storage，公開頁面只是 `<img>`，不帶任何金鑰。

**Tech Stack:** Vue 3 + TypeScript、Vite、Firebase Firestore / Cloud Storage、Google Maps Static API、Vitest

規格：[docs/superpowers/specs/2026-08-04-public-trip-report-design.md](../specs/2026-08-04-public-trip-report-design.md)

## Global Constraints

- 註解與 UI 文案一律**繁體中文**，解釋「為什麼」而不是複述程式碼。
- `src/utils/` 是純函式，**不 import firebase、不 import vue**。
- 每支 `src/utils/*.ts` 對應一支 `tests/*.test.ts`。
- 測試用 `describe` / `it`，`it` 的敘述是中文完整句子，說明**行為**。
- 匯入路徑一律用 `@/`。
- 報告文件裡**絕對不放**：任何 uid、成員暱稱、支出名稱、誰欠誰。
- 金額一律是主要幣別的最小單位整數，用 `baseAmountOf` 取值 —— 缺匯率的支出一律排除，
  總額、分類、地點、筆數四者必須對得起來。
- 公開頁面**不得**載入 Maps JS SDK，也不得出現任何 API 金鑰。
- Firestore 寫入回傳未 await 的 promise，呼叫端用 `settleWrite` 包。
- 每個 Task 結束時 `npm run check` 必須通過。
- 規則測試（`npm run test:rules`）在本機跑不起來（JDK 21 取得不到），**使用者會自行手動驗證**。
  規則測試案例仍要寫，但不要因為跑不了而卡住。

---

### Task 1: 地點彙總

**Files:**
- Create: `src/utils/placeTotals.ts`
- Test: `tests/placeTotals.test.ts`

**Interfaces:**
- Consumes: `baseAmountOf`（`@/utils/settlement`）
- Produces:
  - `interface PlaceTotal { name: string; placeId: string | null; lat: number | null; lng: number | null; total: number; expenseCount: number }`
  - `NO_PLACE_LABEL = "未指定地點"`
  - `placeTotals(expenses: Expense[], baseCurrency: string): PlaceTotal[]`

- [ ] **Step 1: 寫失敗的測試**

建立 `tests/placeTotals.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { NO_PLACE_LABEL, placeTotals } from "@/utils/placeTotals";
import type { Expense, ExpensePlace } from "@/types/expense";

function place(overrides: Partial<ExpensePlace> = {}): ExpensePlace {
  return { name: "大皇宮", address: null, lat: 13.75, lng: 100.49, placeId: "p_palace", ...overrides };
}

function expense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: "e1",
    title: "門票",
    category: "ticket",
    amount: 10000,
    currency: "TWD",
    rate: 1,
    baseAmount: 10000,
    paidBy: "u1",
    splitMode: "even",
    splits: { u1: 10000 },
    place: place(),
    receipt: null,
    date: "2026-03-01",
    ...overrides
  } as Expense;
}

describe("placeTotals", () => {
  it("同一個地點的多筆支出合併成一列", () => {
    const result = placeTotals(
      [expense({ id: "a", baseAmount: 10000 }), expense({ id: "b", baseAmount: 5000 })],
      "TWD"
    );
    expect(result).toHaveLength(1);
    expect(result[0].total).toBe(15000);
    expect(result[0].expenseCount).toBe(2);
  });

  it("依金額由大到小排序", () => {
    const result = placeTotals(
      [
        expense({ id: "a", baseAmount: 3000, place: place({ name: "小的", placeId: "p_small" }) }),
        expense({ id: "b", baseAmount: 9000, place: place({ name: "大的", placeId: "p_big" }) })
      ],
      "TWD"
    );
    expect(result.map(item => item.name)).toEqual(["大的", "小的"]);
  });

  it("沒有地點的支出歸到「未指定地點」", () => {
    const result = placeTotals([expense({ place: null, baseAmount: 8000 })], "TWD");
    expect(result[0].name).toBe(NO_PLACE_LABEL);
    expect(result[0].total).toBe(8000);
    expect(result[0].placeId).toBeNull();
  });

  // 「未指定地點」不是一個目的地，是把剩下的錢交代清楚的那一列。
  // 讀者會自己加總來驗證數字，所以它必須存在，但排在最後才讀得順。
  it("「未指定地點」永遠排在最後，就算金額最大", () => {
    const result = placeTotals(
      [
        expense({ id: "a", place: null, baseAmount: 90000 }),
        expense({ id: "b", baseAmount: 1000 })
      ],
      "TWD"
    );
    expect(result[result.length - 1].name).toBe(NO_PLACE_LABEL);
  });

  it("只打名字沒選建議的地點也算一個地點，但沒有座標", () => {
    const textOnly = place({ name: "路邊攤", placeId: null, lat: null, lng: null });
    const result = placeTotals([expense({ place: textOnly })], "TWD");
    expect(result[0].name).toBe("路邊攤");
    expect(result[0].lat).toBeNull();
  });

  it("同名的純文字地點會合併 —— 使用者打一樣的名字就是指同一個地方", () => {
    const textOnly = place({ name: "7-11", placeId: null, lat: null, lng: null });
    const result = placeTotals(
      [expense({ id: "a", place: textOnly, baseAmount: 100 }), expense({ id: "b", place: textOnly, baseAmount: 200 })],
      "TWD"
    );
    expect(result).toHaveLength(1);
    expect(result[0].total).toBe(300);
  });

  it("缺匯率換算不出來的支出要排除，否則總額會跟結算對不起來", () => {
    const noRate = expense({ id: "x", currency: "THB", baseAmount: null, rate: null });
    const result = placeTotals([noRate], "TWD");
    expect(result).toEqual([]);
  });

  it("空清單回傳空陣列", () => {
    expect(placeTotals([], "TWD")).toEqual([]);
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run tests/placeTotals.test.ts`
Expected: FAIL — `Failed to resolve import "@/utils/placeTotals"`

- [ ] **Step 3: 寫實作**

建立 `src/utils/placeTotals.ts`：

```ts
/**
 * 依地點彙總金額與筆數，給公開的旅費報告用。
 *
 * 報告的目的是「這樣玩一趟要花多少錢」，所以金額掛在地點上才有價值 ——
 * 讀者要知道的是「去大皇宮要準備多少」，地點名稱本身 Google 查得到。
 *
 * 用 `baseAmountOf` 取金額，跟 `categoryTotals` 與 `settleExpenses` 同一套規則：
 * 缺匯率的支出三邊都排除。不一致的話報告裡的數字會互相矛盾，那比沒有報告更糟。
 *
 * 純函式，不 import firebase 也不 import vue。
 */
import type { Expense } from "@/types/expense";
import { baseAmountOf } from "@/utils/settlement";

export const NO_PLACE_LABEL = "未指定地點";

export interface PlaceTotal {
  name: string;
  /** 從 Google 搜尋選出來的才有。純文字地點與「未指定地點」都是 null。 */
  placeId: string | null;
  lat: number | null;
  lng: number | null;
  /** 主要幣別最小單位整數。 */
  total: number;
  expenseCount: number;
}

/**
 * 分組的鍵：有 placeId 就用它（同一間店不同打法會合併），
 * 否則用名稱（使用者打一樣的名字就是指同一個地方）。
 */
function groupKey(expense: Expense): string {
  const place = expense.place;
  if (!place) return NO_PLACE_LABEL;
  return place.placeId ?? `name:${place.name}`;
}

export function placeTotals(expenses: Expense[], baseCurrency: string): PlaceTotal[] {
  const groups = new Map<string, PlaceTotal>();

  for (const expense of expenses) {
    const amount = baseAmountOf(expense, baseCurrency);
    if (amount === null) continue;

    const key = groupKey(expense);
    const existing = groups.get(key);
    if (existing) {
      existing.total += amount;
      existing.expenseCount += 1;
      continue;
    }

    const place = expense.place;
    groups.set(key, {
      name: place?.name ?? NO_PLACE_LABEL,
      placeId: place?.placeId ?? null,
      lat: place?.lat ?? null,
      lng: place?.lng ?? null,
      total: amount,
      expenseCount: 1
    });
  }

  const rows = [...groups.values()];
  // 「未指定地點」不是目的地，是把剩下的錢交代清楚的那一列，所以固定排最後。
  // 名稱當次要排序依據，金額相同時結果才不會隨輸入順序跳動。
  return rows.sort((a, b) => {
    if (a.name === NO_PLACE_LABEL) return 1;
    if (b.name === NO_PLACE_LABEL) return -1;
    return b.total - a.total || a.name.localeCompare(b.name);
  });
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npx vitest run tests/placeTotals.test.ts && npm run check`
Expected: PASS（8 個），型別檢查通過

- [ ] **Step 5: Commit**

```bash
git add src/utils/placeTotals.ts tests/placeTotals.test.ts
git commit -m "Total spending by place for the trip report"
```

---

### Task 2: 旅程彙總

**Files:**
- Create: `src/utils/tripSummary.ts`
- Test: `tests/tripSummary.test.ts`

**Interfaces:**
- Consumes: `baseAmountOf`（`@/utils/settlement`）、`expenseDate`（`@/utils/expenseDate`）
- Produces:
  - `interface TripSummary { days: number | null; total: number; perPerson: number; expenseCount: number }`
  - `tripSummary(input: { expenses: Expense[]; baseCurrency: string; memberCount: number; startDate: string | null; endDate: string | null }): TripSummary`

- [ ] **Step 1: 寫失敗的測試**

建立 `tests/tripSummary.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { tripSummary } from "@/utils/tripSummary";
import type { Expense } from "@/types/expense";

function expense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: "e1",
    title: "晚餐",
    category: "food",
    amount: 10000,
    currency: "TWD",
    rate: 1,
    baseAmount: 10000,
    paidBy: "u1",
    splitMode: "even",
    splits: { u1: 10000 },
    place: null,
    receipt: null,
    date: "2026-03-01",
    ...overrides
  } as Expense;
}

function run(overrides: Partial<Parameters<typeof tripSummary>[0]> = {}) {
  return tripSummary({
    expenses: [expense()],
    baseCurrency: "TWD",
    memberCount: 2,
    startDate: null,
    endDate: null,
    ...overrides
  });
}

describe("tripSummary", () => {
  it("天數優先用任務的起迄日期，而且含頭尾", () => {
    expect(run({ startDate: "2026-03-01", endDate: "2026-03-05" }).days).toBe(5);
  });

  it("同一天出發與結束算一天，不是零天", () => {
    expect(run({ startDate: "2026-03-01", endDate: "2026-03-01" }).days).toBe(1);
  });

  it("沒設起迄日期就用支出日期的頭尾", () => {
    const result = run({
      expenses: [expense({ id: "a", date: "2026-03-02" }), expense({ id: "b", date: "2026-03-04" })]
    });
    expect(result.days).toBe(3);
  });

  it("沒有起迄也沒有支出時天數是 null，不要顯示假的數字", () => {
    expect(run({ expenses: [] }).days).toBeNull();
  });

  it("每人平均是總額除以人數", () => {
    const result = run({
      expenses: [expense({ baseAmount: 30000 })],
      memberCount: 3
    });
    expect(result.total).toBe(30000);
    expect(result.perPerson).toBe(10000);
  });

  it("除不盡就四捨五入到最小單位 —— 這是參考值，不需要分毫不差", () => {
    const result = run({ expenses: [expense({ baseAmount: 10000 })], memberCount: 3 });
    expect(result.perPerson).toBe(3333);
  });

  it("人數是 0 時不會除以零，回傳 0", () => {
    expect(run({ memberCount: 0 }).perPerson).toBe(0);
  });

  it("缺匯率的支出不算進總額與筆數，跟地點與分類保持一致", () => {
    const result = run({
      expenses: [
        expense({ id: "a", baseAmount: 10000 }),
        expense({ id: "x", currency: "THB", baseAmount: null, rate: null })
      ]
    });
    expect(result.total).toBe(10000);
    expect(result.expenseCount).toBe(1);
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run tests/tripSummary.test.ts`
Expected: FAIL — `Failed to resolve import "@/utils/tripSummary"`

- [ ] **Step 3: 寫實作**

建立 `src/utils/tripSummary.ts`：

```ts
/**
 * 旅程的整體數字：天數、總額、每人平均。
 *
 * 每人平均是「總額 ÷ 人數」，不是每個人的實際分攤 ——
 * 實際分攤會洩漏誰花得多，而且對報告的讀者沒有用，他要的是
 * 「這種玩法一個人大概多少」。簡單平均同時滿足隱私與用途。
 *
 * 純函式，不 import firebase 也不 import vue。
 */
import type { Expense } from "@/types/expense";
import { baseAmountOf } from "@/utils/settlement";
import { expenseDate } from "@/utils/expenseDate";

export interface TripSummary {
  /** 旅程天數，含頭尾。算不出來是 null。 */
  days: number | null;
  /** 主要幣別最小單位整數。 */
  total: number;
  perPerson: number;
  /** 列入計算的筆數（缺匯率的已排除）。 */
  expenseCount: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 用 UTC 解析 `"YYYY-MM-DD"`，不要走 `new Date(str)` 的本地時區解讀 ——
 * 那會在某些時區把日期偏移一天，天數就會少算或多算。
 */
function parseDay(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/** 含頭尾，所以同一天是 1 天不是 0 天。 */
function daysBetween(start: string, end: string): number | null {
  const from = parseDay(start);
  const to = parseDay(end);
  if (from === null || to === null) return null;
  return Math.floor((to - from) / DAY_MS) + 1;
}

export interface TripSummaryInput {
  expenses: Expense[];
  baseCurrency: string;
  memberCount: number;
  startDate: string | null;
  endDate: string | null;
}

export function tripSummary(input: TripSummaryInput): TripSummary {
  let total = 0;
  let expenseCount = 0;
  const dates: string[] = [];

  for (const expense of input.expenses) {
    const amount = baseAmountOf(expense, input.baseCurrency);
    if (amount === null) continue;
    total += amount;
    expenseCount += 1;
    dates.push(expenseDate(expense));
  }

  // 任務有設起迄就用那個，那是使用者自己宣告的旅程範圍，比支出日期準。
  let days: number | null = null;
  if (input.startDate && input.endDate) {
    days = daysBetween(input.startDate, input.endDate);
  } else if (dates.length) {
    const sorted = [...dates].sort();
    days = daysBetween(sorted[0], sorted[sorted.length - 1]);
  }

  return {
    days,
    total,
    perPerson: input.memberCount > 0 ? Math.round(total / input.memberCount) : 0,
    expenseCount
  };
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npx vitest run tests/tripSummary.test.ts && npm run check`
Expected: PASS（8 個），型別檢查通過

- [ ] **Step 5: Commit**

```bash
git add src/utils/tripSummary.ts tests/tripSummary.test.ts
git commit -m "Summarise a trip's days, total, and per-person cost"
```

---

### Task 3: 報告型別、服務與 Firestore 規則

**Files:**
- Create: `src/types/report.ts`
- Create: `src/services/reportService.ts`
- Modify: `firestore.rules`
- Test: `tests/firestore.rules.test.mjs`（補案例）

**Interfaces:**
- Consumes: `PlaceTotal`（`@/utils/placeTotals`）、`CategoryTotal`（`@/utils/categoryTotals`）
- Produces:
  - `interface TripReport`（見下）與 `TripReportInput = Omit<TripReport, "id" | "createdAt" | "updatedAt">`
  - `findReport(taskId: string): Promise<TripReport | null>`
  - `createReport(taskId: string, reportId: string, input: TripReportInput): Promise<void>`
  - `updateReport(taskId: string, reportId: string, input: TripReportInput): Promise<void>`
  - `setReportActive(taskId: string, reportId: string, active: boolean): Promise<void>`
  - `getPublicReport(taskId: string, reportId: string): Promise<TripReport | null>`
  - `newReportId(): string`

- [ ] **Step 1: 加型別**

建立 `src/types/report.ts`：

```ts
import type { Timestamp } from "firebase/firestore";
import type { CategoryTotal } from "@/utils/categoryTotals";
import type { PlaceTotal } from "@/utils/placeTotals";

/**
 * 公開的旅費報告快照。
 *
 * **這份文件任何人拿到連結都讀得到**，所以裡面絕對不能有 uid、成員暱稱、
 * 支出名稱或誰欠誰。只放算好的彙總數字。
 */
export interface TripReport {
  id: string;
  taskName: string;
  currency: string;
  startDate: string | null;
  endDate: string | null;
  /** 旅程天數，含頭尾。算不出來是 null。 */
  days: number | null;
  memberCount: number;
  /** 列入計算的支出筆數（缺匯率的已排除）。 */
  expenseCount: number;
  total: number;
  perPerson: number;
  categories: CategoryTotal[];
  places: PlaceTotal[];
  /** Storage 物件路徑。沒有地圖時是 null。 */
  mapPath: string | null;
  /** 撤銷就是這個變 false。 */
  active: boolean;
  /** 第一次產生的時間，重新產生時保留不動。 */
  createdAt: Timestamp;
  /** 最後一次重新產生的時間，報告上顯示這個。 */
  updatedAt: Timestamp;
}

export type TripReportInput = Omit<TripReport, "id" | "createdAt" | "updatedAt">;
```

- [ ] **Step 2: 寫服務**

建立 `src/services/reportService.ts`：

```ts
/**
 * 公開旅費報告的讀寫。
 *
 * 報告是快照，不是即時查詢 —— 公開讀取絕對不能碰既有資料，那等於把整個
 * 權限模型打開。所以產生時把該公開的數字算好寫成一份新文件，公開的只有那一份。
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  updateDoc
} from "firebase/firestore";
import { db } from "@/firebase/config";
import type { TripReport, TripReportInput } from "@/types/report";

function reportsRef(taskId: string) {
  return collection(db, "tasks", taskId, "reports");
}

export function newReportId(): string {
  return doc(reportsRef("placeholder")).id;
}

/**
 * 找這個任務既有的報告。一個任務只有一份，所以 limit(1)。
 *
 * 重新產生時一定要沿用既有的 id —— 每次產生新 id 的話，已經傳出去的
 * 舊網址會全部變成死連結，而「連結永遠不變」正是這個功能的承諾。
 */
export async function findReport(taskId: string): Promise<TripReport | null> {
  const snap = await getDocs(query(reportsRef(taskId), limit(1)));
  const first = snap.docs[0];
  return first ? ({ id: first.id, ...first.data() } as TripReport) : null;
}

/**
 * 第一次產生用 create，重新產生用 update。
 *
 * 分成兩支是為了保住 `createdAt`：如果統一用 setDoc 全量覆寫，重新產生會把
 * 第一次的時間洗掉；而 `setDoc` 的 `mergeFields` 只會寫清單裡的欄位，
 * 沒列進去的 `createdAt` 連第一次都不會被寫入。用 updateDoc 就乾淨了 ——
 * 它不碰沒提到的欄位。呼叫端本來就知道有沒有既有報告（`findReport` 的結果）。
 */
export function createReport(taskId: string, reportId: string, input: TripReportInput): Promise<void> {
  return setDoc(doc(db, "tasks", taskId, "reports", reportId), {
    ...input,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

export function updateReport(taskId: string, reportId: string, input: TripReportInput): Promise<void> {
  return updateDoc(doc(db, "tasks", taskId, "reports", reportId), {
    ...input,
    updatedAt: serverTimestamp()
  });
}

export function setReportActive(taskId: string, reportId: string, active: boolean): Promise<void> {
  return updateDoc(doc(db, "tasks", taskId, "reports", reportId), {
    active,
    updatedAt: serverTimestamp()
  });
}

/** 公開頁面用。讀不到就是連結錯了或報告已關閉，兩者都回傳 null。 */
export async function getPublicReport(taskId: string, reportId: string): Promise<TripReport | null> {
  const snap = await getDoc(doc(db, "tasks", taskId, "reports", reportId));
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as TripReport) : null;
}
```

匯入清單要有 `setDoc` 與 `updateDoc` 兩個。

- [ ] **Step 3: 加 Firestore 規則**

在 [firestore.rules](../../../firestore.rules) 的 `match /settlements/{settlementId}` 區塊
之後、`match /tasks/{taskId}` 的結束大括號之前加：

```
      // 公開的旅費報告。這是整份規則裡唯一開放未登入讀取的地方。
      match /reports/{reportId} {
        // 撤銷就是 active 改成 false，讀取直接失敗，頁面顯示「這份報告已關閉」。
        // 跟 invites 是同一個模式。成員仍讀得到已關閉的，才能重新開啟。
        allow get: if resource.data.active == true || isTaskMember(taskId);
        // 成員才列得出來 —— owner 的介面靠這個找到既有報告來沿用 id。
        allow list: if isTaskMember(taskId);
        // 只有 owner 能產生與撤銷。不加 taskIsActive：報告本來就只在封存後產生，
        // 而封存的任務仍要能重新產生與撤銷報告。
        allow create, update: if taskData(taskId).ownerId == request.auth.uid;
        allow delete: if false;
      }
```

- [ ] **Step 4: 補規則測試案例**

在 [tests/firestore.rules.test.mjs](../../../tests/firestore.rules.test.mjs) 的 `archiveTask()`
旁邊加一個建立報告的輔助函式：

```js
const REPORT = "report1";

/** 直接塞一份報告進資料庫，不經過 rules。 */
async function seedReport(active = true) {
  await testEnv.withSecurityRulesDisabled(async ctx => {
    await setDoc(doc(ctx.firestore(), "tasks", TASK, "reports", REPORT), {
      taskName: "曼谷旅行",
      currency: "TWD",
      startDate: null,
      endDate: null,
      days: 5,
      memberCount: 4,
      expenseCount: 1,
      total: 10000,
      perPerson: 2500,
      categories: [],
      places: [],
      mapPath: null,
      active,
      createdAt: new Date(),
      updatedAt: new Date()
    });
  });
}
```

然後在 `main()` 的結算測試附近加：

```js
  await test("未登入的人可以讀公開的報告 —— 這就是這個功能的重點", async () => {
    await seed();
    await seedReport(true);
    await assertSucceeds(getDoc(doc(anon(), "tasks", TASK, "reports", REPORT)));
  });

  // 這條是「可撤銷」的唯一證明。沒有它，撤銷就只是介面上的錯覺。
  await test("撤銷之後未登入的人就讀不到了", async () => {
    await seed();
    await seedReport(false);
    await assertFails(getDoc(doc(anon(), "tasks", TASK, "reports", REPORT)));
  });

  await test("成員讀得到已撤銷的報告，才能重新開啟", async () => {
    await seed();
    await seedReport(false);
    await assertSucceeds(getDoc(doc(as(OWNER), "tasks", TASK, "reports", REPORT)));
  });

  await test("owner 可以產生報告", async () => {
    await seed();
    await assertSucceeds(
      setDoc(doc(as(OWNER), "tasks", TASK, "reports", REPORT), {
        taskName: "曼谷旅行",
        currency: "TWD",
        startDate: null,
        endDate: null,
        days: 5,
        memberCount: 4,
        expenseCount: 1,
        total: 10000,
        perPerson: 2500,
        categories: [],
        places: [],
        mapPath: null,
        active: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      })
    );
  });

  await test("admin 不能產生報告 —— 公開別人的資料只有 owner 能決定", async () => {
    await seed();
    await assertFails(
      setDoc(doc(as(ADMIN), "tasks", TASK, "reports", REPORT), {
        taskName: "偷發布",
        currency: "TWD",
        startDate: null,
        endDate: null,
        days: null,
        memberCount: 4,
        expenseCount: 0,
        total: 0,
        perPerson: 0,
        categories: [],
        places: [],
        mapPath: null,
        active: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      })
    );
  });

  await test("owner 可以撤銷報告", async () => {
    await seed();
    await seedReport(true);
    await assertSucceeds(
      updateDoc(doc(as(OWNER), "tasks", TASK, "reports", REPORT), { active: false })
    );
  });

  await test("一般成員不能撤銷報告", async () => {
    await seed();
    await seedReport(true);
    await assertFails(
      updateDoc(doc(as(MEMBER), "tasks", TASK, "reports", REPORT), { active: false })
    );
  });

  await test("未登入的人不能列出報告集合", async () => {
    await seed();
    await seedReport(true);
    await assertFails(getDocs(collection(anon(), "tasks", TASK, "reports")));
  });
```

- [ ] **Step 5: 型別檢查**

Run: `npm run check`
Expected: 通過

規則測試（`npm run test:rules`）在本機跑不起來，使用者會自行手動驗證。
**不要因為這一步跑不了而停下來。**

- [ ] **Step 6: Commit**

```bash
git add src/types/report.ts src/services/reportService.ts firestore.rules tests/firestore.rules.test.mjs
git commit -m "Store trip reports as public snapshot documents"
```

---

### Task 4: 靜態地圖

**Files:**
- Create: `src/services/staticMap.ts`
- Modify: `storage.rules`
- Test: `tests/storage.rules.test.mjs`（補案例）

**Interfaces:**
- Consumes: `PlaceTotal`（`@/utils/placeTotals`）
- Produces:
  - `staticMapEnabled(): boolean`
  - `fetchStaticMap(places: PlaceTotal[]): Promise<Blob | null>`
  - `reportMapPath(taskId: string, reportId: string): string`

- [ ] **Step 1: 寫服務**

建立 `src/services/staticMap.ts`：

```ts
/**
 * 旅費報告的靜態地圖。
 *
 * **刻意不用 Maps JS SDK。** 報告是公開連結，在那個頁面載 SDK 的話：
 * 每次有人開啟都算一次 API 呼叫（連結被轉傳＝帳單失控，而且你擋不住），
 * 而且金鑰會出現在一個設計上就是要到處轉傳的頁面裡。
 *
 * 改成產生報告時呼叫 Static Maps **一次**、把 PNG 存進 Storage，
 * 之後永遠是 0 次呼叫，公開頁面也完全不帶金鑰。代價是不能縮放拖曳。
 */
import type { PlaceTotal } from "@/utils/placeTotals";

const STATIC_MAP_URL = "https://maps.googleapis.com/maps/api/staticmap";
const LANGUAGE = "zh-TW";
/** 標記太多會讓 URL 超過長度上限，取金額最大的前幾個就夠表達「去了哪一帶」。 */
const MAX_MARKERS = 20;
/** scale=2 是為了高解析度螢幕，實際輸出是 1280x800。 */
const SIZE = "640x400";

export function staticMapEnabled(): boolean {
  return !!import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
}

export function reportMapPath(taskId: string, reportId: string): string {
  return `tasks/${taskId}/reports/${reportId}/map.png`;
}

/**
 * 有座標的地點才畫得上去。回傳 null 代表沒有地圖可畫或抓失敗 ——
 * 呼叫端要把它當成「這份報告沒有地圖」，不是錯誤。
 */
export async function fetchStaticMap(places: PlaceTotal[]): Promise<Blob | null> {
  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  if (!key) return null;

  const located = places.filter(place => place.lat != null && place.lng != null).slice(0, MAX_MARKERS);
  if (!located.length) return null;

  const params = new URLSearchParams({
    size: SIZE,
    scale: "2",
    maptype: "roadmap",
    language: LANGUAGE,
    key
  });
  // 不指定 center 與 zoom，Google 會自動框住所有標記。
  params.append(
    "markers",
    `color:0xe8590c|${located.map(place => `${place.lat},${place.lng}`).join("|")}`
  );

  try {
    const response = await fetch(`${STATIC_MAP_URL}?${params}`);
    if (!response.ok) return null;
    return await response.blob();
  } catch {
    // 地圖是加分不是必要。抓不到就沒有地圖，不能讓整份報告產不出來。
    return null;
  }
}
```

- [ ] **Step 2: 加 Storage 規則**

在 [storage.rules](../../../storage.rules) 的收據那個 match 之後、`match /{allPaths=**}`
之前加：

```
    // 旅費報告的地圖。這是整份規則裡唯一公開讀取的路徑 ——
    // 報告連結任何人都能開，看的人沒有登入，所以圖必須讀得到。
    match /tasks/{taskId}/reports/{reportId}/map.png {
      allow read: if true;

      // 跟收據一樣的限制：Storage 規則查不到 Firestore，所以擋不住
      // 「任何登入者往別人的報告路徑寫圖」。防線是路徑裡兩段隨機 ID。
      allow create, update: if request.auth != null
        && request.resource.size <= 1 * 1024 * 1024
        && request.resource.contentType == 'image/png';

      allow delete: if false;
    }
```

- [ ] **Step 3: 補 Storage 規則測試**

在 [tests/storage.rules.test.mjs](../../../tests/storage.rules.test.mjs) 的 `PATH` 常數
旁邊加：

```js
const MAP_PATH = "tasks/task1/reports/report1/map.png";
const PNG = { contentType: "image/png" };
```

然後在既有測試之後、`testEnv.cleanup()` 之前加：

```js
  await test("報告地圖登入後傳得上去", async () => {
    await assertSucceeds(uploadBytes(ref(as(MEMBER), MAP_PATH), jpeg(2048), PNG));
  });

  // 這條是整個公開報告功能的前提 —— 讀不到圖，報告頁就是壞的。
  await test("報告地圖未登入也讀得到 —— 公開報告的前提", async () => {
    await assertSucceeds(getDownloadURL(ref(anon(), MAP_PATH)));
  });

  await test("報告地圖不接受非 PNG", async () => {
    await assertFails(uploadBytes(ref(as(MEMBER), MAP_PATH), jpeg(2048), JPEG));
  });

  await test("報告地圖超過 1MB 要被擋", async () => {
    await assertFails(uploadBytes(ref(as(MEMBER), MAP_PATH), jpeg(1024 * 1024 + 1), PNG));
  });

  await test("未登入不能上傳報告地圖", async () => {
    await assertFails(uploadBytes(ref(anon(), MAP_PATH), jpeg(2048), PNG));
  });
```

- [ ] **Step 4: 型別檢查**

Run: `npm run check`
Expected: 通過

規則測試在本機跑不起來，使用者自行驗證。不要停下來。

- [ ] **Step 5: Commit**

```bash
git add src/services/staticMap.ts storage.rules tests/storage.rules.test.mjs
git commit -m "Capture the trip map once as a static image"
```

---

### Task 5: 產生與撤銷的入口

**Files:**
- Modify: `src/pages/TaskPage.vue`
- Create: `src/composables/useTripReport.ts`

**Interfaces:**
- Consumes: `placeTotals`、`tripSummary`、`categoryTotals`、`reportService` 全部、`fetchStaticMap`、`reportMapPath`、`staticMapEnabled`、`settleWrite`
- Produces: `useTripReport(taskId: string)` 回傳 `{ report, loading, busy, error, shareUrl, load, generate, setActive }`

- [ ] **Step 1: 寫 composable**

建立 `src/composables/useTripReport.ts`：

```ts
/**
 * 旅費報告的產生、撤銷與狀態。
 *
 * 產生的順序刻意是「先算數字、再拍地圖、最後寫文件」，而且**地圖失敗不擋流程** ——
 * 地圖是加分不是必要，反過來設計的話 Static Maps 一出問題（配額、金鑰、網路）
 * 整個功能就掛了。
 */
import { computed, ref } from "vue";
import type { Expense } from "@/types/expense";
import type { Task } from "@/types/task";
import type { TripReport } from "@/types/report";
import { categoryTotals } from "@/utils/categoryTotals";
import { placeTotals } from "@/utils/placeTotals";
import { tripSummary } from "@/utils/tripSummary";
import { settleWrite } from "@/utils/offlineWrite";
import { firebaseErrorMessage } from "@/utils/firestore";
import {
  createReport,
  findReport,
  newReportId,
  setReportActive,
  updateReport
} from "@/services/reportService";
import { fetchStaticMap, reportMapPath } from "@/services/staticMap";

export function useTripReport(taskId: string) {
  const report = ref<TripReport | null>(null);
  const loading = ref(false);
  const busy = ref(false);
  const error = ref<string | null>(null);

  const shareUrl = computed(() =>
    report.value ? `${window.location.origin}/r/${taskId}/${report.value.id}` : ""
  );

  async function load() {
    loading.value = true;
    try {
      report.value = await findReport(taskId);
    } catch {
      // 找不到既有報告不是錯誤，就是還沒產生過。
      report.value = null;
    } finally {
      loading.value = false;
    }
  }

  async function generate(task: Task, expenses: Expense[]) {
    busy.value = true;
    error.value = null;
    try {
      // 沿用既有 id，連結才不會變。已經傳出去的網址得繼續有效。
      const existing = report.value;
      const reportId = existing?.id ?? newReportId();
      const currency = task.defaultCurrency;
      const places = placeTotals(expenses, currency);
      const summary = tripSummary({
        expenses,
        baseCurrency: currency,
        memberCount: task.memberCount,
        startDate: task.startDate,
        endDate: task.endDate
      });

      // 地圖失敗回傳 null，報告照樣產得出來。
      const blob = await fetchStaticMap(places);
      let mapPath: string | null = null;
      if (blob) {
        const { getStorage, ref: storageRef, uploadBytes } = await import("firebase/storage");
        const { app } = await import("@/firebase/config");
        const path = reportMapPath(taskId, reportId);
        try {
          await uploadBytes(storageRef(getStorage(app), path), blob, { contentType: "image/png" });
          mapPath = path;
        } catch {
          // 上傳失敗一樣只是沒有地圖。
        }
      }

      // 既有的用 update 才不會把第一次產生的 createdAt 洗掉。
      const write = existing ? updateReport : createReport;
      await settleWrite(
        write(taskId, reportId, {
          taskName: task.name,
          currency,
          startDate: task.startDate,
          endDate: task.endDate,
          days: summary.days,
          memberCount: task.memberCount,
          expenseCount: summary.expenseCount,
          total: summary.total,
          perPerson: summary.perPerson,
          categories: categoryTotals(expenses, currency),
          places,
          mapPath,
          active: true
        })
      );

      await load();
    } catch (err) {
      error.value = firebaseErrorMessage(err);
    } finally {
      busy.value = false;
    }
  }

  async function setActive(active: boolean) {
    if (!report.value) return;
    busy.value = true;
    error.value = null;
    try {
      await settleWrite(setReportActive(taskId, report.value.id, active));
      await load();
    } catch (err) {
      error.value = firebaseErrorMessage(err);
    } finally {
      busy.value = false;
    }
  }

  return { report, loading, busy, error, shareUrl, load, generate, setActive };
}
```

- [ ] **Step 2: 接進 TaskPage**

在 [src/pages/TaskPage.vue](../../../src/pages/TaskPage.vue) 的 `<script setup>` 加匯入與狀態：

```ts
import { useTripReport } from "@/composables/useTripReport";

const reportState = useTripReport(taskId.value);
const reportCopied = ref(false);

/** 沒有支出就沒有東西可報告。 */
const canGenerateReport = computed(
  () => isArchived.value && taskState.isOwner.value && expenseState.expenses.value.length > 0
);

async function copyShareUrl() {
  await navigator.clipboard.writeText(reportState.shareUrl.value);
  reportCopied.value = true;
  window.setTimeout(() => (reportCopied.value = false), 1500);
}

function generateReport() {
  const task = taskState.task.value;
  if (!task) return;
  return reportState.generate(task, expenseState.expenses.value);
}
```

`useTask` 已經有 `isOwner`（依 member 的 role 判斷），**不用另外加**。

在 `load()` 裡，其他四個 `load()` 之後加 `reportState.load()`。

- [ ] **Step 3: 加 template**

在封存橫幅之後加：

```html
        <section v-if="isArchived && taskState.isOwner.value" class="card stack">
          <strong class="section-title">分享這趟旅程</strong>
          <p class="tiny">
            產生一份公開報告，讓沒去的人知道這樣玩一趟大概要花多少錢。
            只會顯示總花費、每人平均、分類與去過的地點 ——
            <strong>不會有任何人名、支出名稱或誰欠誰</strong>。
          </p>

          <p v-if="!expenseState.expenses.value.length" class="tiny warn">
            這個任務還沒有支出，沒有東西可以報告。
          </p>

          <template v-else-if="reportState.report.value">
            <p class="tiny warn">
              這個連結任何人都打開得了，不需要帳號。傳出去之前想清楚要給誰。
            </p>
            <div class="row">
              <input :value="reportState.shareUrl.value" class="input grow" readonly />
              <button class="btn btn-sm" @click="copyShareUrl">
                {{ reportCopied ? "已複製" : "複製" }}
              </button>
            </div>
            <p v-if="!reportState.report.value.active" class="tiny warn">
              目前已關閉，連結打不開。
            </p>
            <div class="row">
              <button class="btn btn-sm" :disabled="reportState.busy.value" @click="generateReport">
                重新產生
              </button>
              <button
                class="btn btn-sm"
                :disabled="reportState.busy.value"
                @click="reportState.setActive(!reportState.report.value.active)"
              >
                {{ reportState.report.value.active ? "關閉連結" : "重新開啟" }}
              </button>
            </div>
          </template>

          <button
            v-else
            class="btn btn-primary btn-block"
            :disabled="!canGenerateReport || reportState.busy.value"
            @click="generateReport"
          >
            {{ reportState.busy.value ? "產生中..." : "產生分享報告" }}
          </button>

          <p v-if="reportState.error.value" class="tiny warn">{{ reportState.error.value }}</p>
        </section>
```

`.grow` 若該檔案沒有就加：

```css
.grow {
  flex: 1;
  min-width: 0;
}
```

- [ ] **Step 4: 型別檢查與建置**

Run: `npm run check && npm run build`
Expected: 都通過

- [ ] **Step 5: Commit**

```bash
git add src/composables/useTripReport.ts src/composables/useTask.ts src/pages/TaskPage.vue
git commit -m "Generate and revoke a trip report from the archived task"
```

---

### Task 6: 公開報告頁

**Files:**
- Create: `src/pages/ReportPage.vue`
- Modify: `src/router/index.ts`

**Interfaces:**
- Consumes: `getPublicReport`（`@/services/reportService`）、`TripReport`

> **與規格的一處刻意不同**：規格說公開頁要分「找不到」與「已關閉」兩種訊息。
> 實際上做不到 —— `allow get: if resource.data.active == true || isTaskMember(taskId)`
> 會讓未登入者讀已撤銷的報告直接失敗，client 拿到的就是一個讀取錯誤，
> **分辨不出是連結錯了還是被關了**。
>
> 而且就算做得到也不該做：回「這份報告已關閉」等於告訴陌生人「這個 ID 是真的，
> 只是被關起來」，那是不必要的資訊洩漏。兩種情況合併成同一句話。

- [ ] **Step 1: 加路由**

在 [src/router/index.ts](../../../src/router/index.ts) 的其他 lazy import 旁加：

```ts
const ReportPage = () => import("@/pages/ReportPage.vue");
```

在 `routes` 陣列的 `/join/:inviteCode` 那條之後加：

```ts
    { path: "/r/:taskId/:reportId", component: ReportPage, meta: { public: true } },
```

守衛邏輯不用改 —— `beforeEach` 對沒有 `requiresAuth` 的路由在 `if (!user) return true`
就放行了。

- [ ] **Step 2: 寫頁面**

建立 `src/pages/ReportPage.vue`：

```vue
<script setup lang="ts">
/**
 * 公開的旅費報告。**任何人都能開，不需要帳號。**
 *
 * 刻意不套 AppLayout：那會顯示「我的分帳」導覽列，對沒有帳號的訪客沒有意義，
 * 還會誘導他去點。地圖是一張存在 Storage 的靜態圖片，這個頁面不載 Maps SDK、
 * 也不帶任何 API 金鑰 —— 連結會被到處轉傳，不能把金鑰跟著送出去。
 */
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import type { TripReport } from "@/types/report";
import { getPublicReport } from "@/services/reportService";
import { categoryMeta } from "@/types/expense";
import { formatAmount } from "@/utils/currency";

const route = useRoute();
const taskId = String(route.params.taskId || "");
const reportId = String(route.params.reportId || "");

const report = ref<TripReport | null>(null);
const loading = ref(true);
/**
 * 讀失敗與「不存在」在這裡是同一件事：規則會讓已撤銷的報告讀取失敗，
 * 所以我們分不出「連結錯了」與「已關閉」—— 兩者都用同一句話帶過，
 * 免得洩漏「這個任務存在但報告被關了」這種資訊。
 */
const notFound = computed(() => !loading.value && !report.value);

const dateRange = computed(() => {
  const value = report.value;
  if (!value?.startDate || !value.endDate) return "";
  return `${value.startDate} – ${value.endDate}`;
});

const mapUrl = ref<string | null>(null);

async function load() {
  loading.value = true;
  try {
    report.value = await getPublicReport(taskId, reportId);
  } catch {
    report.value = null;
  } finally {
    loading.value = false;
  }

  const path = report.value?.mapPath;
  if (!path) return;
  try {
    const { getDownloadURL, getStorage, ref: storageRef } = await import("firebase/storage");
    const { app } = await import("@/firebase/config");
    mapUrl.value = await getDownloadURL(storageRef(getStorage(app), path));
  } catch {
    // 沒有地圖不影響其他內容。
    mapUrl.value = null;
  }
}

onMounted(load);
</script>

<template>
  <div class="page">
    <p v-if="loading" class="tiny center">讀取中...</p>

    <p v-else-if="notFound" class="center">
      找不到這份報告。連結可能不完整，或發起人已經把它關閉了。
    </p>

    <template v-else-if="report">
      <h1 class="title center">{{ report.taskName }}</h1>
      <p class="tiny center">
        <template v-if="dateRange">{{ dateRange }} · </template>
        <template v-if="report.days">{{ report.days }} 天 · </template>
        {{ report.memberCount }} 人
      </p>

      <section class="card headline">
        <p class="tiny">每人平均</p>
        <strong class="figure">{{ report.currency }} {{ formatAmount(report.perPerson, report.currency) }}</strong>
        <p class="tiny">
          總花費 {{ report.currency }} {{ formatAmount(report.total, report.currency) }} ·
          {{ report.expenseCount }} 筆
        </p>
      </section>

      <img v-if="mapUrl" :src="mapUrl" alt="去過的地方" class="map" />

      <section v-if="report.places.length" class="card stack">
        <strong class="section-title">去過的地方</strong>
        <div v-for="place in report.places" :key="place.name" class="line">
          <span class="name">{{ place.name }}</span>
          <span class="amount">{{ formatAmount(place.total, report.currency) }}</span>
          <span class="tiny count">{{ place.expenseCount }} 筆</span>
        </div>
      </section>

      <section v-if="report.categories.length" class="card stack">
        <strong class="section-title">花在哪</strong>
        <div v-for="item in report.categories" :key="item.category" class="line">
          <span class="name">
            {{ categoryMeta(item.category).icon }} {{ categoryMeta(item.category).label }}
          </span>
          <span class="tiny count">{{ Math.round(item.share) }}%</span>
          <span class="amount">{{ formatAmount(item.total, report.currency) }}</span>
        </div>
      </section>

      <p class="tiny center footer">
        由 <a href="/">SplitFlow</a> 產生
      </p>
    </template>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 560px;
  margin: 0 auto;
  padding: 24px 16px 48px;
}

.center {
  text-align: center;
}

.headline {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  text-align: center;
}

.figure {
  font-size: 34px;
  font-variant-numeric: tabular-nums;
}

.map {
  width: 100%;
  border-radius: 16px;
  border: 1px solid var(--color-line);
}

.line {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.amount {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.count {
  flex: none;
}

.footer a {
  color: var(--color-primary);
}
</style>
```

- [ ] **Step 3: 型別檢查、測試與建置**

Run: `npm run check && npm test && npm run build`
Expected: 全部通過

- [ ] **Step 4: 手動確認**

Run: `npm run dev`

1. 封存一個有支出的任務 → 產生報告 → 複製連結
2. **開無痕視窗**貼上連結 → 看得到報告，而且**沒有被導去登入頁**
3. 檢查報告裡沒有任何人名、支出名稱、誰欠誰
4. 地點金額加總（含「未指定地點」）等於總額
5. 關閉連結 → 無痕視窗重新整理 → 顯示找不到
6. 重新開啟 → 又看得到
7. 重新產生 → 連結沒變，數字更新

- [ ] **Step 5: 更新 todo.md 並 Commit**

在 [todo.md](../../../todo.md) 記下這個功能完成，並註明：報告與地圖的規則是整個專案
唯一開放公開讀取的地方，防線是兩段隨機 ID；規則測試待手動驗證。

```bash
git add src/pages/ReportPage.vue src/router/index.ts todo.md
git commit -m "Add the public trip report page"
```

---

## 驗收清單

- [ ] 已封存且有支出的任務，owner 看得到「產生分享報告」；未封存或非 owner 看不到
- [ ] **無痕視窗（未登入）開得了連結，而且不會被導去登入頁**
- [ ] 報告裡沒有任何人名、支出名稱、誰欠誰
- [ ] 地點金額加總（含「未指定地點」）等於總額
- [ ] 關閉連結後無痕視窗看不到；重新開啟後又看得到
- [ ] 重新產生後連結不變、數字更新
- [ ] 沒有任何地點有座標時，報告仍產得出來，只是沒有地圖
- [ ] 公開頁面的 Network 面板裡**沒有任何 maps.googleapis.com 的請求**
- [ ] `npm test`、`npm run check`、`npm run build` 全綠
- [ ] 規則測試（`npm run test:rules`）由使用者手動驗證 —— 本機 JDK 取得不到
