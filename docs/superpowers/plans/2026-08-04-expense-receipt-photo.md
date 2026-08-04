# 支出收據照片 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓每筆支出可以附一張收據照片作為對帳憑證，離線拍的照片存在本機、連線後自動補傳。

**Architecture:** 照片壓縮後先進 IndexedDB 佇列，支出文件以 `receipt.localId` 標記待上傳；三個時機（App 啟動、`online` 事件、剛入列）觸發 flush，成功後把 `receipt` 改寫成 Storage 路徑並清掉佇列項目。所有判斷邏輯抽成 `src/utils/` 的純函式以便測試，`src/services/` 只留 I/O。

**Tech Stack:** Vue 3 + TypeScript、Vite、Firebase Firestore / Cloud Storage、IndexedDB、Vitest、`@firebase/rules-unit-testing`

規格：[docs/superpowers/specs/2026-08-04-expense-receipt-photo-design.md](../specs/2026-08-04-expense-receipt-photo-design.md)

## Global Constraints

- 註解與 UI 文案一律**繁體中文**，比照現有檔案的密度與語氣：解釋「為什麼」而不是複述程式碼在做什麼。
- `src/utils/` 的檔案是純函式，**不 import firebase、不 import vue、不碰瀏覽器儲存**（比照 [src/utils/repeatExpense.ts](../../../src/utils/repeatExpense.ts) 開頭的註解）。
- 每支 `src/utils/*.ts` 對應一支 `tests/*.test.ts`，維持現有的一對一格局。
- 測試檔用 `describe` / `it`，`it` 的敘述是中文完整句子，說明**行為**不是函式名。
- 匯入路徑一律用 `@/` alias。
- 壓縮後長邊上限 **1600px**、JPEG quality **0.8**。
- Storage 物件路徑：`tasks/{taskId}/expenses/{expenseId}/receipt.jpg`
- Storage 單檔上限 **2MB**、contentType 必須是 `image/jpeg`。
- 佇列項目：失敗 **5** 次停止自動重試（保留項目）、超過 **30** 天丟棄。
- 每個 Task 結束時 `npm run check`（vue-tsc）必須通過。

---

### Task 1: 修正離線送出卡住

現況：[src/services/expenseService.ts](../../../src/services/expenseService.ts) 的 `createExpense` 結尾 `await batch.commit()`，而 Firestore 的寫入 promise 要等伺服器確認才 resolve。離線時資料已安全排進本機佇列，但呼叫端的 `await` 永遠不會回來，按鈕卡在「儲存中...」也不跳頁。

本 Task 先做這個修正，因為後面的收據功能依賴「使用者能在離線狀態走完表單」。

**Files:**
- Create: `src/utils/offlineWrite.ts`
- Test: `tests/offlineWrite.test.ts`
- Modify: `src/services/expenseService.ts`（`createExpense` / `updateExpense` / `deleteExpense`）
- Modify: `src/pages/ExpenseFormPage.vue`（`submit` 與 `remove`）

**Interfaces:**
- Produces:
  - `settleWrite(write: Promise<unknown>, timeoutMs?: number): Promise<WriteOutcome>`
  - `type WriteOutcome = "synced" | "queued"`
  - `createExpense(taskId, input, createdBy): { id: string; synced: Promise<void> }` — **注意這是破壞性簽章變更**，從 `Promise<string>` 改成同步回傳物件
  - `updateExpense(taskId, expenseId, input): Promise<void>` — 不變
  - `deleteExpense(taskId, expenseId): Promise<void>` — 不變

- [ ] **Step 1: 寫失敗的測試**

建立 `tests/offlineWrite.test.ts`：

```ts
import { describe, expect, it, vi } from "vitest";
import { settleWrite } from "@/utils/offlineWrite";

describe("settleWrite", () => {
  it("伺服器有回應時回報 synced", async () => {
    await expect(settleWrite(Promise.resolve(), 1000)).resolves.toBe("synced");
  });

  it("逾時代表離線排隊中，不是失敗", async () => {
    vi.useFakeTimers();
    const never = new Promise<void>(() => {});
    const result = settleWrite(never, 2500);
    await vi.advanceTimersByTimeAsync(2500);
    await expect(result).resolves.toBe("queued");
    vi.useRealTimers();
  });

  it("逾時之前就被拒絕的話要往外丟，那是真的錯誤", async () => {
    const denied = Promise.reject(new Error("permission-denied"));
    await expect(settleWrite(denied, 1000)).rejects.toThrow("permission-denied");
  });

  it("逾時之後才被拒絕不會變成 unhandled rejection", async () => {
    vi.useFakeTimers();
    let reject!: (err: Error) => void;
    const late = new Promise<void>((_, r) => { reject = r; });
    const result = settleWrite(late, 100);
    await vi.advanceTimersByTimeAsync(100);
    await expect(result).resolves.toBe("queued");

    reject(new Error("太晚了"));
    // 微任務跑完都沒有 unhandled rejection 就算過。
    await vi.advanceTimersByTimeAsync(0);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run tests/offlineWrite.test.ts`
Expected: FAIL — `Failed to resolve import "@/utils/offlineWrite"`

- [ ] **Step 3: 寫實作**

建立 `src/utils/offlineWrite.ts`：

```ts
/**
 * Firestore 寫入的離線處理。
 *
 * Firestore 的寫入 promise 要等伺服器確認才 resolve —— 離線時它永遠不會回來，
 * 但資料其實已經安全寫進本機佇列、連上網就會自動送出。
 * 直接 await 的話畫面會卡死在「儲存中...」，使用者以為壞了然後重複按。
 *
 * 所以這裡等一小段時間就好：有回應就是 synced，沒回應當作 queued 讓使用者往下走。
 *
 * 純函式，不 import firebase 也不 import vue。
 */

export type WriteOutcome = "synced" | "queued";

/**
 * 逾時之後才發生的拒絕會被這裡吞掉，使用者看不到錯誤訊息。
 * 這是有意的取捨：那個情境幾乎只會是規則違反，而規則違反在送出前的表單驗證
 * 就該擋下來了；為了它把所有離線寫入都卡住並不划算。
 */
export function settleWrite(write: Promise<unknown>, timeoutMs = 2500): Promise<WriteOutcome> {
  return new Promise<WriteOutcome>((resolve, reject) => {
    const timer = setTimeout(() => resolve("queued"), timeoutMs);
    write.then(
      () => {
        clearTimeout(timer);
        resolve("synced");
      },
      (err: unknown) => {
        clearTimeout(timer);
        // 逾時後才走到這裡的話 resolve 已經先發生，這個 reject 是 no-op，
        // 但錯誤有被接住，不會變成 unhandled rejection。
        reject(err);
      }
    );
  });
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npx vitest run tests/offlineWrite.test.ts`
Expected: PASS（4 個）

- [ ] **Step 5: 改 expenseService 讓呼叫端能自己決定要不要等**

修改 [src/services/expenseService.ts](../../../src/services/expenseService.ts)，把 `createExpense` 換成：

```ts
export interface CreateExpenseResult {
  /** Firestore 的文件 id。client 端產生，離線也拿得到。 */
  id: string;
  /** 伺服器確認的 promise。離線時不會 resolve，呼叫端要用 settleWrite 包起來。 */
  synced: Promise<void>;
}

/**
 * 刻意不 await commit：id 是 client 端先產生的，離線時照樣拿得到，
 * 呼叫端可以立刻往下走。等不等伺服器由呼叫端用 `settleWrite` 決定。
 */
export function createExpense(
  taskId: string,
  input: ExpenseInput,
  createdBy: string
): CreateExpenseResult {
  const expenseRef = doc(expensesRef(taskId));
  const batch = writeBatch(db);

  batch.set(expenseRef, {
    ...input,
    createdBy,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  batch.update(doc(db, "tasks", taskId), {
    expenseCount: increment(1),
    updatedAt: serverTimestamp()
  });

  return { id: expenseRef.id, synced: batch.commit() };
}
```

同一支檔案裡，`updateExpense` 與 `deleteExpense` 有一模一樣的問題（`await updateDoc` / `await batch.commit()`）。改成回傳未 await 的 promise，讓呼叫端統一用 `settleWrite` 處理：

```ts
export function updateExpense(taskId: string, expenseId: string, input: ExpenseInput): Promise<void> {
  return updateDoc(doc(db, "tasks", taskId, "expenses", expenseId), {
    ...input,
    // 舊文件改存新格式後就不需要這個欄位了，但 Firestore 的 update 不會自動清掉，
    // 留著也不影響讀取（normalizeExpense 只在缺 splits 時才會看它）。
    updatedAt: serverTimestamp()
  });
}

export function deleteExpense(taskId: string, expenseId: string): Promise<void> {
  const batch = writeBatch(db);
  batch.delete(doc(db, "tasks", taskId, "expenses", expenseId));
  batch.update(doc(db, "tasks", taskId), {
    expenseCount: increment(-1),
    updatedAt: serverTimestamp()
  });
  return batch.commit();
}
```

（兩者移除 `async` / `await`，行為對線上呼叫端完全相同。）

- [ ] **Step 6: 改 ExpenseFormPage 用 settleWrite**

在 [src/pages/ExpenseFormPage.vue](../../../src/pages/ExpenseFormPage.vue) 的 `<script setup>` 加匯入：

```ts
import { settleWrite } from "@/utils/offlineWrite";
```

新增一個提示狀態（放在 `const error = ref<string | null>(null);` 附近）：

```ts
/** 離線排隊時要告訴使用者資料沒有不見，只是還沒送出去。 */
const queuedNotice = ref(false);
```

`submit()` 裡把送出那兩行換成：

```ts
    const outcome = isEdit.value
      ? await settleWrite(updateExpense(taskId, expenseId, input))
      : await settleWrite(createExpense(taskId, input, uid).synced);

    if (outcome === "queued") queuedNotice.value = true;
    await router.push(`/tasks/${taskId}`);
```

`remove()` 裡把 `await deleteExpense(taskId, expenseId);` 換成：

```ts
    await settleWrite(deleteExpense(taskId, expenseId));
```

在 template 的 `<ErrorState :message="error" />` 前面加提示：

```html
        <p v-if="queuedNotice" class="card tiny">
          目前沒有連線，已經先存在這台裝置上，連上網路後會自動同步。
        </p>
```

- [ ] **Step 7: 型別檢查與測試**

Run: `npm run check && npm test`
Expected: 兩者都通過。若 `npm run check` 報 `createExpense` 的呼叫端型別錯誤，表示還有沒改到的地方 —— 全專案只有 `ExpenseFormPage.vue` 呼叫它。

- [ ] **Step 8: 手動驗證**

Run: `npm run dev`，開瀏覽器 DevTools → Network → 切成 Offline，新增一筆支出。
Expected: 約 2.5 秒後跳回任務頁、列表看得到那筆支出、頁面上出現「已經先存在這台裝置上」提示。切回 Online 後重新整理，資料仍在。

- [ ] **Step 9: Commit**

```bash
git add src/utils/offlineWrite.ts tests/offlineWrite.test.ts src/services/expenseService.ts src/pages/ExpenseFormPage.vue
git commit -m "Stop the expense form hanging when saving offline"
```

---

### Task 2: receiptPolicy 純函式

收據佇列的所有「該不該做」判斷集中在這裡，`services/` 那層只剩讀寫。

**Files:**
- Create: `src/utils/receiptPolicy.ts`
- Test: `tests/receiptPolicy.test.ts`

**Interfaces:**
- Produces:
  - `MAX_EDGE = 1600` / `MAX_ATTEMPTS = 5` / `MAX_AGE_MS`（30 天的毫秒數）
  - `receiptPath(taskId: string, expenseId: string): string`
  - `type QueueAction = "upload" | "drop-expired" | "hold-exhausted"`
  - `queueAction(item: { createdAt: number; attempts: number }, now: number): QueueAction`

- [ ] **Step 1: 寫失敗的測試**

建立 `tests/receiptPolicy.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { MAX_AGE_MS, MAX_ATTEMPTS, queueAction, receiptPath } from "@/utils/receiptPolicy";

const NOW = Date.UTC(2026, 7, 4);

function item(overrides: Partial<{ createdAt: number; attempts: number }> = {}) {
  return { createdAt: NOW, attempts: 0, ...overrides };
}

describe("receiptPath", () => {
  it("路徑可以從 taskId 與 expenseId 推導出來，不需要另外記檔名", () => {
    expect(receiptPath("t1", "e1")).toBe("tasks/t1/expenses/e1/receipt.jpg");
  });
});

describe("queueAction", () => {
  it("剛入列的項目要上傳", () => {
    expect(queueAction(item(), NOW)).toBe("upload");
  });

  it("失敗次數還沒到上限就繼續自動重試", () => {
    expect(queueAction(item({ attempts: MAX_ATTEMPTS - 1 }), NOW)).toBe("upload");
  });

  it("失敗到上限就停止自動重試，但項目要保留給使用者手動重試", () => {
    expect(queueAction(item({ attempts: MAX_ATTEMPTS }), NOW)).toBe("hold-exhausted");
  });

  it("超過保存期限就丟棄，免得手機裡永遠躺著傳不出去的圖", () => {
    expect(queueAction(item({ createdAt: NOW - MAX_AGE_MS - 1 }), NOW)).toBe("drop-expired");
  });

  it("剛好在保存期限上還不算過期", () => {
    expect(queueAction(item({ createdAt: NOW - MAX_AGE_MS }), NOW)).toBe("upload");
  });

  it("又過期又試到上限的話以過期為準 —— 留著也沒有意義了", () => {
    expect(queueAction(item({ createdAt: NOW - MAX_AGE_MS - 1, attempts: MAX_ATTEMPTS }), NOW)).toBe(
      "drop-expired"
    );
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run tests/receiptPolicy.test.ts`
Expected: FAIL — `Failed to resolve import "@/utils/receiptPolicy"`

- [ ] **Step 3: 寫實作**

建立 `src/utils/receiptPolicy.ts`：

```ts
/**
 * 收據照片的路徑規則與上傳佇列的判斷。
 *
 * 判斷跟 I/O 分開，是因為 IndexedDB 與 Storage 在測試環境裡都跑不起來，
 * 但真正容易寫錯的是「這個項目現在該怎麼辦」。那部分放在這裡就測得到。
 *
 * 純函式，不 import firebase、不 import vue，也不碰任何瀏覽器儲存。
 */

/** 壓縮後照片的長邊上限（px）。收據小字多，再小就開始糊到讀不出金額。 */
export const MAX_EDGE = 1600;

/** 連續失敗幾次之後停止自動重試，交還給使用者決定。 */
export const MAX_ATTEMPTS = 5;

/** 佇列項目的保存期限。超過就丟掉，不然傳不出去的圖會永遠佔著手機空間。 */
export const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * 一筆支出一張收據，所以路徑可以直接推導、不需要存檔名。
 * 這也讓「換照片」變成單純的覆蓋，不會累積舊檔。
 *
 * 分成獨立的目錄層而不是 `{expenseId}.jpg`，是因為 Storage 規則的路徑萬用字元
 * 只能吃整個 segment，帶字面後綴的寫法比對不到。
 */
export function receiptPath(taskId: string, expenseId: string): string {
  return `tasks/${taskId}/expenses/${expenseId}/receipt.jpg`;
}

export type QueueAction =
  /** 現在就傳。 */
  | "upload"
  /** 太舊了，從佇列刪掉。 */
  | "drop-expired"
  /** 試太多次了，保留項目但停止自動重試，等使用者手動觸發。 */
  | "hold-exhausted";

export interface QueueDecisionInput {
  createdAt: number;
  attempts: number;
}

/** 過期優先於試到上限 —— 都過期了，留著讓使用者手動重試也沒有意義。 */
export function queueAction(item: QueueDecisionInput, now: number): QueueAction {
  if (now - item.createdAt > MAX_AGE_MS) return "drop-expired";
  if (item.attempts >= MAX_ATTEMPTS) return "hold-exhausted";
  return "upload";
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npx vitest run tests/receiptPolicy.test.ts && npm run check`
Expected: PASS（7 個），型別檢查通過

- [ ] **Step 5: Commit**

```bash
git add src/utils/receiptPolicy.ts tests/receiptPolicy.test.ts
git commit -m "Add receipt path and upload queue policy"
```

---

### Task 3: 影像壓縮

**Files:**
- Create: `src/utils/imageCompress.ts`
- Test: `tests/imageCompress.test.ts`

**Interfaces:**
- Consumes: `MAX_EDGE` from `@/utils/receiptPolicy`
- Produces:
  - `scaledSize(width: number, height: number, maxEdge: number): { width: number; height: number }`
  - `compressImage(file: File, maxEdge?: number, quality?: number): Promise<Blob>`

- [ ] **Step 1: 寫失敗的測試**

只測 `scaledSize`。canvas 在 vitest 的 node 環境跑不起來，但 `compressImage` 扣掉尺寸計算之後只剩幾行 API 呼叫，真正容易算錯的是尺寸。

建立 `tests/imageCompress.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { scaledSize } from "@/utils/imageCompress";

describe("scaledSize", () => {
  it("直式收據（最常見）以高度為長邊縮放", () => {
    expect(scaledSize(3024, 4032, 1600)).toEqual({ width: 1200, height: 1600 });
  });

  it("橫式照片以寬度為長邊縮放", () => {
    expect(scaledSize(4032, 3024, 1600)).toEqual({ width: 1600, height: 1200 });
  });

  it("已經比上限小的圖不放大 —— 放大只會變胖不會變清楚", () => {
    expect(scaledSize(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });

  it("長邊剛好等於上限就原樣保留", () => {
    expect(scaledSize(1600, 1200, 1600)).toEqual({ width: 1600, height: 1200 });
  });

  it("正方形兩邊一起縮到上限", () => {
    expect(scaledSize(2000, 2000, 1600)).toEqual({ width: 1600, height: 1600 });
  });

  it("縮放後的邊長是整數，canvas 不吃小數", () => {
    const size = scaledSize(1000, 333, 800);
    expect(Number.isInteger(size.width)).toBe(true);
    expect(Number.isInteger(size.height)).toBe(true);
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run tests/imageCompress.test.ts`
Expected: FAIL — `Failed to resolve import "@/utils/imageCompress"`

- [ ] **Step 3: 寫實作**

建立 `src/utils/imageCompress.ts`：

```ts
/**
 * 收據照片的壓縮。
 *
 * 手機原圖是 3–5MB，直接傳既吃 Storage 額度又拖慢行動網路上傳。
 * 縮到長邊 1600px、JPEG quality 0.8 之後大約 200–400KB，收據上的金額仍然清楚。
 *
 * `scaledSize` 單獨匯出是為了能測 —— canvas 在測試環境跑不起來，
 * 但真正容易算錯的就是尺寸那段。
 */
import { MAX_EDGE } from "@/utils/receiptPolicy";

export interface Size {
  width: number;
  height: number;
}

/** 等比例縮到長邊不超過 maxEdge。本來就比較小的圖原樣回傳，不放大。 */
export function scaledSize(width: number, height: number, maxEdge: number): Size {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };

  const ratio = maxEdge / longest;
  return { width: Math.round(width * ratio), height: Math.round(height * ratio) };
}

export async function compressImage(
  file: File,
  maxEdge = MAX_EDGE,
  quality = 0.8
): Promise<Blob> {
  // imageOrientation 一定要指定 from-image：iPhone 拍的直式照片是橫的畫素
  // 加上一個 EXIF 旋轉旗標，預設的 "none" 會讓收據躺著存進去。
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });

  try {
    const { width, height } = scaledSize(bitmap.width, bitmap.height, maxEdge);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("這個瀏覽器不支援照片壓縮，請換一個瀏覽器再試");
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>(resolve => {
      canvas.toBlob(resolve, "image/jpeg", quality);
    });
    if (!blob) throw new Error("照片轉檔失敗，請再試一次");
    return blob;
  } finally {
    // 不釋放的話這張解碼後的點陣圖會一直佔著記憶體，連拍幾張就會很明顯。
    bitmap.close();
  }
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npx vitest run tests/imageCompress.test.ts && npm run check`
Expected: PASS（6 個），型別檢查通過

- [ ] **Step 5: Commit**

```bash
git add src/utils/imageCompress.ts tests/imageCompress.test.ts
git commit -m "Add receipt image compression"
```

---

### Task 4: 資料模型與 Firestore 規則

**Files:**
- Modify: `src/types/expense.ts`
- Modify: `src/services/expenseService.ts`（`normalizeExpense`）
- Modify: `src/pages/ExpenseFormPage.vue`（`submit` 組 `ExpenseInput` 的地方）
- Modify: `firestore.rules`
- Test: `tests/firestore.rules.test.mjs`（補案例）

**Interfaces:**
- Produces:
  - `interface ExpenseReceipt { path: string | null; localId: string | null }`
  - `Expense.receipt: ExpenseReceipt | null`
  - `ExpenseInput.receipt: ExpenseReceipt | null`

- [ ] **Step 1: 加型別**

在 [src/types/expense.ts](../../../src/types/expense.ts) 的 `ExpensePlace` 之後加：

```ts
/**
 * 支出的收據照片。用兩個欄位表達三種狀態，不另外開 status 欄位，
 * 因為多一個列舉就多一個會跟實際欄位對不上的機會。
 *
 *   path=null, localId="xxx"  待上傳（照片還在拍攝者的手機裡）
 *   path="...", localId=null  已上傳
 *   receipt 整個是 null        這筆支出沒有收據
 */
export interface ExpenseReceipt {
  /** Storage 物件路徑。等上傳時是 null。 */
  path: string | null;
  /** 本機待上傳佇列的 key。上傳成功後設回 null。 */
  localId: string | null;
}
```

在 `Expense` 介面裡，`place` 那個欄位之後加：

```ts
  /** 收據照片，選填。這個功能之前建立的舊資料是 null。 */
  receipt: ExpenseReceipt | null;
```

在 `ExpenseInput` 介面裡，`place` 之後加：

```ts
  receipt: ExpenseReceipt | null;
```

- [ ] **Step 2: 讓舊文件讀得出來**

在 [src/services/expenseService.ts](../../../src/services/expenseService.ts) 的 `normalizeExpense` 回傳物件裡，`place` 那行之後加：

```ts
    receipt: (data.receipt as Expense["receipt"] | undefined) ?? null,
```

- [ ] **Step 3: 補上表單的欄位讓型別檢查過**

`ExpenseInput` 多了必填欄位，[src/pages/ExpenseFormPage.vue](../../../src/pages/ExpenseFormPage.vue) 的 `submit()` 會編譯失敗。先在 `const input: ExpenseInput = {` 裡 `place: currentPlace(),` 之後加：

```ts
      // 收據的實際處理在後面的 Task，這裡先把欄位補上讓型別完整。
      receipt: null,
```

- [ ] **Step 4: 型別檢查**

Run: `npm run check`
Expected: 通過。若還有錯，是有別的地方在組 `ExpenseInput` —— 全專案只有 `ExpenseFormPage.vue`。

- [ ] **Step 5: 加 Firestore 規則**

在 [firestore.rules](../../../firestore.rules) 的 `validPlace()` 函式之後加：

```
        // 收據是選填。有的話兩個欄位都可以是 null（待上傳時 path 是 null，
        // 傳完之後 localId 是 null），但型別不能亂。
        function validReceipt() {
          let receipt = request.resource.data.get("receipt", null);
          return receipt == null
            || (
              receipt is map
              && (receipt.path == null || receipt.path is string)
              && (receipt.localId == null || receipt.localId is string)
            );
        }
```

用 `.get("receipt", null)` 而不是直接取，理由跟同一支檔案裡的 `validEditedParticipants()` 一樣：這功能之前建立的舊支出沒有這個欄位。

然後在 `validExpenseShape()` 的最後一行 `&& validPlace();` 改成：

```
            && validPlace()
            && validReceipt();
```

- [ ] **Step 6: 補規則測試案例**

在 [tests/firestore.rules.test.mjs](../../../tests/firestore.rules.test.mjs) 的 `newExpense()` 工廠裡，`place: null,` 之後加一行 `receipt: null,`；`editedExpense()` 同樣加 `receipt: null,`。

然後在 `main()` 裡既有的 expenses 相關測試附近加這四個案例（`test(...)` 的呼叫方式比照鄰近的既有測試）：

```js
  await seed();
  await test("成員可以建立帶收據的支出", async () => {
    await assertSucceeds(
      setDoc(
        doc(as(MEMBER), "tasks", TASK, "expenses", "withReceipt"),
        newExpense({ receipt: { path: null, localId: "local-1" } })
      )
    );
  });

  await seed();
  await test("收據欄位型別不對要被擋下來", async () => {
    await assertFails(
      setDoc(
        doc(as(MEMBER), "tasks", TASK, "expenses", "badReceipt"),
        newExpense({ receipt: { path: 123, localId: "local-1" } })
      )
    );
  });

  await seed();
  await test("上傳完成後把 receipt 換成 Storage 路徑，只改這一個欄位也要放行", async () => {
    await assertSucceeds(
      updateDoc(doc(as(MEMBER), "tasks", TASK, "expenses", "e1"), {
        receipt: { path: "tasks/task1/expenses/e1/receipt.jpg", localId: null }
      })
    );
  });

  await seed();
  await test("沒有管理權的成員不能動別人支出的收據", async () => {
    await assertFails(
      updateDoc(doc(as(OTHER), "tasks", TASK, "expenses", "e1"), {
        receipt: { path: "tasks/task1/expenses/e1/receipt.jpg", localId: null }
      })
    );
  });
```

第三個案例特別重要：它證明 flush 那次只寫 `receipt` 的部分 update 能通過 `validExpenseShape()`，也就是規則不需要為此放寬。

- [ ] **Step 7: 跑規則測試**

Run: `npm run test:rules`
Expected: 全部 `ok`，`failed` 是 0。需要本機有 Java（Firestore emulator 是 Java 程式）。

- [ ] **Step 8: Commit**

```bash
git add src/types/expense.ts src/services/expenseService.ts src/pages/ExpenseFormPage.vue firestore.rules tests/firestore.rules.test.mjs
git commit -m "Add the receipt field to the expense model and rules"
```

---

### Task 5: Storage 設定與規則

**Files:**
- Create: `storage.rules`
- Create: `tests/storage.rules.test.mjs`
- Modify: `firebase.json`
- Modify: `package.json`（`test:rules`、`deploy` 兩個 script）

**Interfaces:**
- Produces: Storage 路徑 `tasks/{taskId}/expenses/{expenseId}/receipt.jpg` 的讀寫規則

- [ ] **Step 1: 寫規則檔**

建立 `storage.rules`：

```
rules_version = '2';

// 注意：Storage 的規則無法查詢 Firestore，所以寫不出「只有這個任務的成員能看」。
// 實際的防線是路徑裡那兩段 20 字元的隨機 ID —— 要拿到 ID 得先通過 Firestore
// 的成員檢查。對「朋友出國分帳」的威脅模型可以接受；要做到嚴格得上 Cloud
// Functions 發簽名 URL，不值得為此多一個服務。
service firebase.storage {
  match /b/{bucket}/o {
    match /tasks/{taskId}/expenses/{expenseId}/receipt.jpg {
      allow read: if request.auth != null;

      // 2MB 是壓縮後大小的五倍以上，正常照片一定過得了，
      // 但擋掉繞過前端直接上傳大檔把免費額度吃光。
      allow create, update: if request.auth != null
        && request.resource.size <= 2 * 1024 * 1024
        && request.resource.contentType == 'image/jpeg';

      allow delete: if request.auth != null;
    }

    // 其他路徑一律不開。
    match /{allPaths=**} {
      allow read, write: if false;
    }
  }
}
```

- [ ] **Step 2: 接上 firebase.json**

在 [firebase.json](../../../firebase.json) 的 `"firestore"` 那段之後加：

```json
  "storage": {
    "rules": "storage.rules"
  },
```

並在 `"emulators"` 物件裡，`"firestore"` 之後加：

```json
    "storage": {
      "host": "127.0.0.1",
      "port": 9199
    },
```

- [ ] **Step 3: 寫規則測試**

建立 `tests/storage.rules.test.mjs`：

```js
/**
 * Cloud Storage Security Rules 測試。
 *
 * 跑法：npm run test:rules（會連 firestore 與 storage 兩個 emulator）
 * 需要 Java。
 */
import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";

const PROJECT_ID = "demo-splitflow";
const MEMBER = "uid_member";
const PATH = "tasks/task1/expenses/e1/receipt.jpg";

let testEnv;
let passed = 0;
let failed = 0;

function as(uid) {
  return testEnv.authenticatedContext(uid).storage();
}

function anon() {
  return testEnv.unauthenticatedContext().storage();
}

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`ok   ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`FAIL ${name}\n     ${err.message}`);
  }
}

/** 假的 JPEG：內容不重要，規則只看 size 與 contentType。 */
function jpeg(bytes = 1024) {
  return new Uint8Array(bytes);
}

const JPEG = { contentType: "image/jpeg" };

async function main() {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    storage: { rules: readFileSync("storage.rules", "utf8"), host: "127.0.0.1", port: 9199 }
  });

  await test("登入的使用者可以上傳收據", async () => {
    await assertSucceeds(uploadBytes(ref(as(MEMBER), PATH), jpeg(), JPEG));
  });

  await test("沒登入不能上傳", async () => {
    await assertFails(uploadBytes(ref(anon(), PATH), jpeg(), JPEG));
  });

  await test("沒登入不能讀", async () => {
    await assertFails(getDownloadURL(ref(anon(), PATH)));
  });

  await test("超過 2MB 的檔案要被擋 —— 免得有人繞過前端把額度吃光", async () => {
    await assertFails(uploadBytes(ref(as(MEMBER), PATH), jpeg(2 * 1024 * 1024 + 1), JPEG));
  });

  await test("非 JPEG 的檔案要被擋", async () => {
    await assertFails(
      uploadBytes(ref(as(MEMBER), PATH), jpeg(), { contentType: "application/pdf" })
    );
  });

  await test("換照片是覆蓋同一個路徑，要放行", async () => {
    await assertSucceeds(uploadBytes(ref(as(MEMBER), PATH), jpeg(2048), JPEG));
  });

  await test("移除收據時刪得掉", async () => {
    await assertSucceeds(deleteObject(ref(as(MEMBER), PATH)));
  });

  await test("規則沒開的路徑一律擋住", async () => {
    await assertFails(uploadBytes(ref(as(MEMBER), "random/other.jpg"), jpeg(), JPEG));
  });

  await testEnv.cleanup();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main();
```

- [ ] **Step 4: 更新 npm scripts**

在 [package.json](../../../package.json) 裡把 `test:rules` 改成同時跑兩個 emulator 與兩支測試：

```json
    "test:rules": "firebase emulators:exec --only firestore,storage --project demo-splitflow \"node tests/firestore.rules.test.mjs && node tests/storage.rules.test.mjs\"",
```

`deploy` 也要一起部署 storage 規則：

```json
    "deploy": "npm run build && firebase deploy --only hosting,firestore:rules,storage",
```

- [ ] **Step 5: 跑測試**

Run: `npm run test:rules`
Expected: 兩支測試都全部 `ok`，各自的 `failed` 是 0。

- [ ] **Step 6: Commit**

```bash
git add storage.rules tests/storage.rules.test.mjs firebase.json package.json
git commit -m "Add Cloud Storage rules for receipt photos"
```

---

### Task 6: IndexedDB 上傳佇列

只做讀寫，不做判斷 —— 判斷在 Task 2 的 `receiptPolicy` 裡，已經測過了。所以這一層沒有單元測試，驗證靠型別檢查加瀏覽器手動確認。

**Files:**
- Create: `src/services/receiptQueue.ts`

**Interfaces:**
- Consumes: 無（刻意不依賴 firebase）
- Produces:
  - `interface QueuedReceipt { id: string; taskId: string; expenseId: string; blob: Blob; createdAt: number; attempts: number }`
  - `queueAvailable(): Promise<boolean>`
  - `enqueue(item: QueuedReceipt): Promise<void>`
  - `listQueued(): Promise<QueuedReceipt[]>`
  - `removeQueued(id: string): Promise<void>`
  - `setAttempts(id: string, attempts: number): Promise<void>`

- [ ] **Step 1: 寫實作**

建立 `src/services/receiptQueue.ts`：

```ts
/**
 * 待上傳收據的本機佇列。
 *
 * 存在的理由：Firestore 的寫入會排進離線佇列，Storage 的上傳不會。
 * 在餐廳沒訊號時拍的收據如果不先留在本機，等回到有網路的地方收據已經丟了。
 *
 * 用 IndexedDB 而不是 localStorage：後者只能存字串，圖片轉 base64 會膨脹三分之一，
 * 還有 5MB 上限而且同步阻塞主執行緒。IndexedDB 可以直接存 Blob。
 *
 * 這一層只做讀寫，不做判斷 —— 「這個項目該上傳還是該丟掉」在 receiptPolicy 裡。
 */

const DB_NAME = "splitflow-uploads";
const STORE = "receipts";
const VERSION = 1;

export interface QueuedReceipt {
  /** 佇列 key，同時也是 expense.receipt.localId。 */
  id: string;
  /** 存目標位置而不是回頭查 Firestore —— 上傳時可能還在離線。 */
  taskId: string;
  expenseId: string;
  /** 壓縮後的 JPEG。 */
  blob: Blob;
  createdAt: number;
  /** 連續失敗次數。 */
  attempts: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  // 只開一次，之後共用。開失敗的話把 promise 清掉，下次還有機會重試
  // （使用者可能中途退出無痕模式，或把被拒絕的儲存權限打開）。
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("這個瀏覽器不支援本機暫存"));
        return;
      }
      const request = indexedDB.open(DB_NAME, VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("開啟本機暫存失敗"));
    }).catch(err => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    db =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = work(tx.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("本機暫存操作失敗"));
      })
  );
}

/**
 * 無痕模式、儲存權限被拒、或瀏覽器太舊時會是 false。
 * 呼叫端要據此降級成「照片必須當場傳完」，不能靜默吞掉 ——
 * 那會讓使用者以為存好了、其實照片消失。
 */
export async function queueAvailable(): Promise<boolean> {
  try {
    await openDb();
    return true;
  } catch {
    return false;
  }
}

/** 用 put 而不是 add：換照片時是覆寫同一個 id，不該留兩筆搶同一個路徑。 */
export function enqueue(item: QueuedReceipt): Promise<void> {
  return run("readwrite", store => store.put(item)).then(() => undefined);
}

export function listQueued(): Promise<QueuedReceipt[]> {
  return run<QueuedReceipt[]>("readonly", store => store.getAll());
}

export function removeQueued(id: string): Promise<void> {
  return run("readwrite", store => store.delete(id)).then(() => undefined);
}

export async function setAttempts(id: string, attempts: number): Promise<void> {
  const item = await run<QueuedReceipt | undefined>("readonly", store => store.get(id));
  // 項目可能在這之間被刪掉了（例如使用者刪了那筆支出），沒有就算了。
  if (!item) return;
  await run("readwrite", store => store.put({ ...item, attempts }));
}
```

- [ ] **Step 2: 型別檢查**

Run: `npm run check`
Expected: 通過

- [ ] **Step 3: 在瀏覽器裡確認 IndexedDB 真的能用**

Run: `npm run dev`，開 DevTools Console 貼上：

```js
const q = await import("/src/services/receiptQueue.ts");
console.log("available:", await q.queueAvailable());
await q.enqueue({ id: "t1", taskId: "a", expenseId: "b", blob: new Blob(["x"]), createdAt: Date.now(), attempts: 0 });
console.log("listed:", await q.listQueued());
await q.setAttempts("t1", 3);
console.log("bumped:", (await q.listQueued())[0].attempts);
await q.removeQueued("t1");
console.log("after remove:", await q.listQueued());
```

Expected: `available: true`、`listed` 有一筆、`bumped: 3`、`after remove: []`。
DevTools → Application → IndexedDB 也看得到 `splitflow-uploads` 這個資料庫。

- [ ] **Step 4: Commit**

```bash
git add src/services/receiptQueue.ts
git commit -m "Add the IndexedDB queue for pending receipt uploads"
```

---

### Task 7: 上傳服務與 flush 迴圈

**Files:**
- Create: `src/services/receiptService.ts`
- Modify: `src/App.vue`（掛上啟動與 `online` 的 flush）

**Interfaces:**
- Consumes: `receiptPath`, `queueAction`（`@/utils/receiptPolicy`）；`QueuedReceipt`, `enqueue`, `listQueued`, `removeQueued`, `setAttempts`, `queueAvailable`（`@/services/receiptQueue`）
- Produces:
  - `queueReceipt(taskId: string, expenseId: string, blob: Blob, localId: string): Promise<void>`
  - `flushReceipts(): Promise<void>`
  - `retryReceipt(localId: string): Promise<void>`
  - `deleteReceipt(taskId: string, expenseId: string): Promise<void>`
  - `receiptUrl(path: string): Promise<string>`
  - `uploadDirect(taskId, expenseId, blob): Promise<string>` — IndexedDB 不能用時的降級路徑，回傳 Storage 路徑

- [ ] **Step 1: 寫實作**

建立 `src/services/receiptService.ts`：

```ts
/**
 * 收據照片的上傳、刪除與補傳。
 *
 * 流程：拍照 → 壓縮 → 進 IndexedDB 佇列 → 支出文件標成待上傳 →
 * 有網路時把圖傳到 Storage → 回頭把支出的 receipt 改成 Storage 路徑。
 *
 * firebase/storage 用動態 import：沒碰過收據的使用者不必付這段體積。
 */
import { doc, updateDoc } from "firebase/firestore";
import { db } from "@/firebase/config";
import { app } from "@/firebase/config";
import { queueAction, receiptPath } from "@/utils/receiptPolicy";
import {
  enqueue,
  listQueued,
  removeQueued,
  setAttempts,
  type QueuedReceipt
} from "@/services/receiptQueue";

/** 同一個物件的下載 URL 是穩定的，同一次 session 進出編輯頁不該重複問。 */
const urlCache = new Map<string, string>();

/** 擋重入：三個觸發點可能同時到，同一批項目不要被傳兩次。 */
let flushing = false;

async function storage() {
  const { getStorage } = await import("firebase/storage");
  return getStorage(app);
}

export async function receiptUrl(path: string): Promise<string> {
  const cached = urlCache.get(path);
  if (cached) return cached;

  const { getDownloadURL, ref } = await import("firebase/storage");
  const url = await getDownloadURL(ref(await storage(), path));
  urlCache.set(path, url);
  return url;
}

/** 直接傳，不經佇列。給 IndexedDB 不能用時的降級路徑。回傳 Storage 路徑。 */
export async function uploadDirect(taskId: string, expenseId: string, blob: Blob): Promise<string> {
  const { ref, uploadBytes } = await import("firebase/storage");
  const path = receiptPath(taskId, expenseId);
  await uploadBytes(ref(await storage(), path), blob, { contentType: "image/jpeg" });
  urlCache.delete(path);
  return path;
}

/** 排進佇列，然後立刻試一次 —— 線上的話這一次就傳完，使用者不會看到「待上傳」。 */
export async function queueReceipt(
  taskId: string,
  expenseId: string,
  blob: Blob,
  localId: string
): Promise<void> {
  await enqueue({ id: localId, taskId, expenseId, blob, createdAt: Date.now(), attempts: 0 });
  void flushReceipts();
}

/** 使用者手動重試：把失敗次數歸零再跑一次 flush。 */
export async function retryReceipt(localId: string): Promise<void> {
  await setAttempts(localId, 0);
  await flushReceipts();
}

async function uploadOne(item: QueuedReceipt): Promise<void> {
  const { ref, uploadBytes } = await import("firebase/storage");
  const path = receiptPath(item.taskId, item.expenseId);

  await uploadBytes(ref(await storage(), path), item.blob, { contentType: "image/jpeg" });

  // 只寫 receipt 一個欄位。Firestore 在 update 時看到的是合併後的文件，
  // 所以規則的 validExpenseShape() 仍然過得了，不需要為此放寬規則。
  // 也刻意不動 updatedAt —— 這是系統補傳，不是使用者編輯。
  await updateDoc(doc(db, "tasks", item.taskId, "expenses", item.expenseId), {
    receipt: { path, localId: null }
  });

  urlCache.delete(path);
  await removeQueued(item.id);
}

export async function flushReceipts(): Promise<void> {
  if (flushing) return;
  flushing = true;

  try {
    // IndexedDB 開不起來時 listQueued 會丟，那就什麼都不用做。
    const items = await listQueued().catch(() => [] as QueuedReceipt[]);
    const now = Date.now();

    // 序列處理不併發：行動網路上併發傳圖沒有好處，還會讓記憶體同時扛好幾張。
    for (const item of items) {
      const action = queueAction(item, now);
      if (action === "drop-expired") {
        await removeQueued(item.id);
        continue;
      }
      if (action === "hold-exhausted") continue;

      try {
        await uploadOne(item);
      } catch (err) {
        // 支出已經被刪掉了，這個項目永遠不會成功，直接丟棄不要一直重試。
        if ((err as { code?: string }).code === "not-found") {
          await removeQueued(item.id);
          continue;
        }
        await setAttempts(item.id, item.attempts + 1);
      }
    }
  } finally {
    flushing = false;
  }
}

/** 刪除 Storage 上的收據。失敗就算了 —— 留下孤兒檔案是設計上接受的取捨。 */
export async function deleteReceipt(taskId: string, expenseId: string): Promise<void> {
  const path = receiptPath(taskId, expenseId);
  urlCache.delete(path);
  try {
    const { deleteObject, ref } = await import("firebase/storage");
    await deleteObject(ref(await storage(), path));
  } catch {
    // 檔案本來就不存在、或現在離線 —— 都不該讓使用者的編輯因此失敗。
  }
}
```

- [ ] **Step 2: 掛上 flush 的觸發點**

[src/App.vue](../../../src/App.vue) 目前只有四行、沒有 `<script setup>`。整支改寫成：

```vue
<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import { flushReceipts } from "@/services/receiptService";

/**
 * 待上傳的收據有三個補傳時機：App 啟動、重新連上網、以及剛入列的當下
 * （第三個在 receiptService.queueReceipt 裡）。
 *
 * 掛在 App.vue 而不是各個頁面，是因為補傳跟使用者現在看哪一頁無關 ——
 * 在任務列表頁重新連上網，昨天在餐廳拍的收據也該自己傳出去。
 */
function flush() {
  void flushReceipts();
}

onMounted(() => {
  flush();
  window.addEventListener("online", flush);
});

onUnmounted(() => window.removeEventListener("online", flush));
</script>

<template>
  <RouterView />
</template>
```

- [ ] **Step 3: 型別檢查**

Run: `npm run check`
Expected: 通過

- [ ] **Step 4: Commit**

```bash
git add src/services/receiptService.ts src/App.vue
git commit -m "Upload queued receipts in the background"
```

---

### Task 8: 表單裡的收據欄位

**Files:**
- Create: `src/composables/useReceipt.ts`
- Create: `src/components/expense/ReceiptField.vue`
- Modify: `src/pages/ExpenseFormPage.vue`

**Interfaces:**
- Consumes: `compressImage`（`@/utils/imageCompress`）；`queueReceipt`, `uploadDirect`, `receiptUrl`, `deleteReceipt`, `retryReceipt`（`@/services/receiptService`）；`queueAvailable`（`@/services/receiptQueue`）；`ExpenseReceipt`（`@/types/expense`）
- Produces:
  - `useReceipt()` 回傳 `{ receipt, previewUrl, busy, error, pickFile, clear, loadExisting, retry, commit }`
  - `commit(taskId: string, expenseId: string): Promise<ExpenseReceipt | null>` — 表單送出後呼叫，負責入列或直傳
  - `ReceiptField.vue` props：`previewUrl: string | null`、`state: "empty" | "ready" | "pending" | "failed"`、`busy: boolean`、`canManage: boolean`；events：`pick(file: File)`、`clear()`、`retry()`、`view()`

- [ ] **Step 1: 寫 composable**

建立 `src/composables/useReceipt.ts`：

```ts
/**
 * 表單裡收據欄位的狀態。
 *
 * 關鍵決定：**新增與編輯都在按下送出時才入列**，不在選完照片的當下。
 * 新增模式的 expenseId 要等 createExpense 才產生，如果編輯模式提早入列、
 * 新增模式不提早，兩條路徑的狀態機就會分岔 —— 一致比早幾秒重要。
 * 送出之前預覽用記憶體裡的 blob URL，使用者不會覺得慢。
 */
import { onUnmounted, ref } from "vue";
import { compressImage } from "@/utils/imageCompress";
import { queueAvailable } from "@/services/receiptQueue";
import { deleteReceipt, queueReceipt, receiptUrl, retryReceipt, uploadDirect } from "@/services/receiptService";
import type { ExpenseReceipt } from "@/types/expense";

export function useReceipt() {
  /** 已存在文件裡的收據（編輯模式載入時帶進來）。 */
  const receipt = ref<ExpenseReceipt | null>(null);
  /** 使用者這次新選的照片，還沒送出。 */
  const pending = ref<Blob | null>(null);
  const previewUrl = ref<string | null>(null);
  const busy = ref(false);
  const error = ref<string | null>(null);
  /** 使用者按了移除，送出時要把舊檔一起刪掉。 */
  const removed = ref(false);

  let objectUrl: string | null = null;

  function releasePreview() {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }

  onUnmounted(releasePreview);

  async function pickFile(file: File) {
    busy.value = true;
    error.value = null;
    try {
      const blob = await compressImage(file);
      releasePreview();
      objectUrl = URL.createObjectURL(blob);
      previewUrl.value = objectUrl;
      pending.value = blob;
      removed.value = false;
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
    } finally {
      busy.value = false;
    }
  }

  function clear() {
    releasePreview();
    previewUrl.value = null;
    pending.value = null;
    removed.value = true;
  }

  /** 編輯模式載入既有支出時呼叫。抓不到 URL 不是致命錯誤，欄位空著就好。 */
  async function loadExisting(existing: ExpenseReceipt | null) {
    receipt.value = existing;
    removed.value = false;
    if (!existing?.path) return;
    try {
      previewUrl.value = await receiptUrl(existing.path);
    } catch {
      previewUrl.value = null;
    }
  }

  async function retry() {
    if (!receipt.value?.localId) return;
    busy.value = true;
    try {
      await retryReceipt(receipt.value.localId);
    } finally {
      busy.value = false;
    }
  }

  /**
   * 表單送出、拿到 expenseId 之後呼叫，回傳要寫進文件的 receipt 欄位。
   *
   * IndexedDB 不能用（無痕模式、儲存權限被拒）時降級成當場直傳。
   * 傳不掉就往外丟，讓使用者知道照片沒存進去 —— 靜默吞掉會讓人以為存好了。
   */
  async function commit(taskId: string, expenseId: string): Promise<ExpenseReceipt | null> {
    if (pending.value) {
      const blob = pending.value;
      // 重用既有的 localId：換照片時要覆寫佇列裡那一筆，不能留兩筆搶同一個路徑。
      const localId = receipt.value?.localId ?? crypto.randomUUID();

      if (await queueAvailable()) {
        await queueReceipt(taskId, expenseId, blob, localId);
        return { path: null, localId };
      }

      const path = await uploadDirect(taskId, expenseId, blob);
      return { path, localId: null };
    }

    if (removed.value && receipt.value) {
      await deleteReceipt(taskId, expenseId);
      return null;
    }

    return receipt.value;
  }

  return { receipt, previewUrl, busy, error, pickFile, clear, loadExisting, retry, commit };
}
```

- [ ] **Step 2: 寫元件**

建立 `src/components/expense/ReceiptField.vue`：

```vue
<script setup lang="ts">
import { ref } from "vue";

defineProps<{
  previewUrl: string | null;
  /** empty=還沒有照片，ready=已上傳或剛選好，pending=等著補傳，failed=傳太多次失敗了 */
  state: "empty" | "ready" | "pending" | "failed";
  busy: boolean;
  canManage: boolean;
}>();

const emit = defineEmits<{
  (e: "pick", file: File): void;
  (e: "clear"): void;
  (e: "retry"): void;
  (e: "view"): void;
}>();

const input = ref<HTMLInputElement | null>(null);

function onChange(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (file) emit("pick", file);
  // 清掉 value，這樣選同一個檔案第二次也會觸發 change。
  (event.target as HTMLInputElement).value = "";
}
</script>

<template>
  <div class="field">
    <span class="label">收據（選填）</span>

    <!--
      刻意不加 capture="environment"：加了會強制直接開相機、不能從相簿選。
      實際情境是「當場拍」跟「晚上回飯店補進去」各佔一半，
      不加這個屬性 iOS 才會給「拍照／照片圖庫」選單。
    -->
    <input
      ref="input"
      type="file"
      accept="image/*"
      class="hidden-input"
      @change="onChange"
    />

    <button
      v-if="state === 'empty'"
      type="button"
      class="drop"
      :disabled="busy || !canManage"
      @click="input?.click()"
    >
      {{ busy ? "處理中..." : "📷 拍照或選一張收據" }}
    </button>

    <div v-else class="preview">
      <button type="button" class="thumb" @click="emit('view')">
        <img v-if="previewUrl" :src="previewUrl" alt="收據縮圖" />
        <span v-else class="tiny">收據</span>
        <span v-if="state === 'pending'" class="badge">待上傳</span>
        <span v-else-if="state === 'failed'" class="badge failed">上傳失敗</span>
      </button>

      <div class="actions">
        <button v-if="canManage" type="button" class="btn btn-sm" :disabled="busy" @click="input?.click()">
          更換
        </button>
        <button v-if="canManage" type="button" class="btn btn-sm" :disabled="busy" @click="emit('clear')">
          移除
        </button>
        <button v-if="state === 'failed'" type="button" class="btn btn-sm" :disabled="busy" @click="emit('retry')">
          重試
        </button>
      </div>
    </div>

    <span v-if="state === 'pending'" class="tiny">
      照片還在這台裝置上，連上網路後會自動傳出去。
    </span>
  </div>
</template>

<style scoped>
.hidden-input {
  display: none;
}

.drop {
  min-height: 96px;
  border: 1px dashed var(--color-line-strong);
  border-radius: 16px;
  background: none;
  color: var(--color-muted);
  font-weight: 700;
}

.drop:disabled {
  opacity: 0.6;
}

.preview {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.thumb {
  position: relative;
  flex: none;
  width: 96px;
  height: 96px;
  padding: 0;
  border: 1px solid var(--color-line);
  border-radius: 16px;
  overflow: hidden;
  background: var(--color-surface);
}

.thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.badge {
  position: absolute;
  top: 4px;
  right: 4px;
  padding: 2px 6px;
  border-radius: 999px;
  background: var(--color-line-strong);
  color: var(--color-surface);
  font-size: 11px;
  font-weight: 700;
}

.badge.failed {
  background: var(--color-danger);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
</style>
```

- [ ] **Step 3: 接進表單**

在 [src/pages/ExpenseFormPage.vue](../../../src/pages/ExpenseFormPage.vue) 的 `<script setup>` 加匯入與狀態：

```ts
import ReceiptField from "@/components/expense/ReceiptField.vue";
import { useReceipt } from "@/composables/useReceipt";
```

在 `const memberState = useTaskMembers(taskId);` 附近加：

```ts
const receiptState = useReceipt();

/** 有 localId 就是還沒傳完；path 有值就是好了。 */
const receiptFieldState = computed<"empty" | "ready" | "pending" | "failed">(() => {
  if (!receiptState.previewUrl.value && !receiptState.receipt.value) return "empty";
  if (receiptState.receipt.value?.localId) return "pending";
  return "ready";
});

/**
 * 走到這裡的人一定有管理權：load() 對沒權限的人會設 loadError，
 * template 就顯示 ErrorState 而不是表單，根本渲染不到收據欄位。
 *
 * 那為什麼 ReceiptField 還留著 canManage 這個 prop？因為那是元件正確的介面 ——
 * 「能不能改」不該由元件自己猜。之後如果加了唯讀的支出詳情頁，
 * 那一頁傳 false 進來就好，元件不用改。
 */
const canManageReceipt = true;
```

> **注意**：規格 §3 寫「沒權限的成員看得到縮圖、看不到更換／移除」，但這個 App
> **目前沒有唯讀的支出詳情頁** —— 非管理者連編輯頁都進不去。所以在現況下，
> 非管理者能看到的只有列表上的「📎 有收據」，看不到照片本身。
> 這個計畫不新增唯讀詳情頁（那是另一個功能）。規格的驗收標準第 4 條要據此調整。

在 `load()` 裡讀到 expense 之後（`date.value = expenseDate(expense);` 那行附近）加：

```ts
    await receiptState.loadExisting(expense.receipt);
```

把 `submit()` 裡 Task 4 加的 `receipt: null,` 改掉 —— 收據要等拿到 `expenseId` 才處理，所以流程改成先寫文件、再補收據：

```ts
    const input: ExpenseInput = {
      title: required(title.value, "支出名稱"),
      category: category.value,
      amount: parsed,
      currency: currency.value,
      rate: usedRate,
      baseAmount: converted,
      paidBy: paidBy.value,
      splitMode: splitMode.value,
      splits,
      place: currentPlace(),
      date: date.value || todayInput(),
      // 先寫既有的值；新選的照片要等下面拿到 id 之後才處理。
      receipt: receiptState.receipt.value
    };

    let outcome: Awaited<ReturnType<typeof settleWrite>>;
    let savedId = expenseId;

    if (isEdit.value) {
      outcome = await settleWrite(updateExpense(taskId, expenseId, input));
    } else {
      const created = createExpense(taskId, input, uid);
      savedId = created.id;
      outcome = await settleWrite(created.synced);
    }

    // 收據放在文件寫完之後：新增模式要先有 expenseId 才知道要傳到哪個路徑。
    // 這一步失敗不該讓已經存好的支出看起來像沒存，所以錯誤只提示不擋跳轉。
    try {
      const saved = await receiptState.commit(taskId, savedId);
      if (saved !== input.receipt) {
        await settleWrite(updateExpense(taskId, savedId, { ...input, receipt: saved }));
      }
    } catch (err) {
      error.value = `支出已儲存，但收據沒有存成功：${firebaseErrorMessage(err)}`;
      saving.value = false;
      return;
    }

    if (outcome === "queued") queuedNotice.value = true;
    await router.push(`/tasks/${taskId}`);
```

在 template 裡，地點區塊的 `</div>` 之後、「誰先付」的 `<label class="field">` 之前插入：

```html
          <ReceiptField
            :preview-url="receiptState.previewUrl.value"
            :state="receiptFieldState"
            :busy="receiptState.busy.value"
            :can-manage="canManageReceipt"
            @pick="receiptState.pickFile"
            @clear="receiptState.clear"
            @retry="receiptState.retry"
            @view="viewerOpen = true"
          />
```

並在 script 裡加 `const viewerOpen = ref(false);`（檢視元件在 Task 9 接上，這裡先留狀態）。

最後改 `remove()`：刪支出時收據也要一起清掉，否則 Storage 會留下永遠沒人參照的檔案，
佇列裡也會留下一個永遠 `not-found` 的殭屍項目。在 `await settleWrite(deleteExpense(...))`
**之前**加：

```ts
    // 先清收據再刪支出：反過來的話 deleteReceipt 失敗時就沒有東西能告訴我們該刪哪個路徑了。
    // 兩者都是盡力而為，失敗不擋刪除 —— 留下孤兒檔案是設計上接受的取捨。
    const orphan = receiptState.receipt.value;
    if (orphan) {
      await deleteReceipt(taskId, expenseId);
      if (orphan.localId) await removeQueued(orphan.localId).catch(() => {});
    }
```

並補上匯入：

```ts
import { deleteReceipt } from "@/services/receiptService";
import { removeQueued } from "@/services/receiptQueue";
```

- [ ] **Step 4: 型別檢查**

Run: `npm run check`
Expected: 通過

- [ ] **Step 5: 手動驗證（線上）**

Run: `npm run dev`，新增一筆支出並附一張照片。
Expected: 選完照片馬上看到縮圖；送出後回到任務頁；Firebase Console → Storage 看得到 `tasks/<taskId>/expenses/<expenseId>/receipt.jpg`；Firestore 那筆文件的 `receipt.path` 有值、`localId` 是 null。

- [ ] **Step 6: 手動驗證（離線）**

DevTools → Network → Offline，新增一筆帶照片的支出。
Expected: 送出後跳回任務頁；DevTools → Application → IndexedDB → `splitflow-uploads` 有一筆項目。切回 Online（或重新整理），幾秒後該項目消失、Storage 出現檔案、Firestore 的 `receipt.path` 被補上。

- [ ] **Step 7: Commit**

```bash
git add src/composables/useReceipt.ts src/components/expense/ReceiptField.vue src/pages/ExpenseFormPage.vue
git commit -m "Attach a receipt photo when creating or editing an expense"
```

---

### Task 9: 全螢幕檢視與列表標示

**Files:**
- Create: `src/components/expense/ReceiptViewer.vue`
- Modify: `src/pages/ExpenseFormPage.vue`（接上 viewer）
- Modify: `src/components/expense/ExpenseRow.vue`（迴紋針標示）

**Interfaces:**
- Consumes: `viewerOpen` ref（Task 8 建立）
- Produces: `ReceiptViewer.vue` props `{ url: string | null; open: boolean }`，event `close`

- [ ] **Step 1: 寫檢視元件**

建立 `src/components/expense/ReceiptViewer.vue`：

```vue
<script setup lang="ts">
/**
 * 收據大圖。刻意自己畫 overlay 而不用 window.open：
 * PWA 在 standalone 模式下 window.open 會把使用者踢到瀏覽器、回不來原本的頁面；
 * 之後如果包成 Capacitor 更是直接跳出 App。
 */
defineProps<{ url: string | null; open: boolean }>();
const emit = defineEmits<{ (e: "close"): void }>();
</script>

<template>
  <div v-if="open && url" class="overlay" role="dialog" aria-label="收據" @click="emit('close')">
    <img :src="url" alt="收據" @click.stop />
    <button type="button" class="close" @click="emit('close')">關閉</button>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 16px;
  /* 收據常常是白底，深色背景才看得出邊界。 */
  background: rgba(0, 0, 0, 0.85);
}

.overlay img {
  max-width: 100%;
  /* 留空間給關閉鈕，也避免在 iOS 上被瀏覽器列切到。 */
  max-height: 80vh;
  object-fit: contain;
  border-radius: 12px;
}

.close {
  padding: 10px 24px;
  border: 0;
  border-radius: 999px;
  background: var(--color-surface);
  color: var(--color-text);
  font-weight: 700;
}
</style>
```

- [ ] **Step 2: 接上表單**

在 [src/pages/ExpenseFormPage.vue](../../../src/pages/ExpenseFormPage.vue) 加匯入：

```ts
import ReceiptViewer from "@/components/expense/ReceiptViewer.vue";
```

在 template 最外層 `<div class="stack">` 的結尾 `</div>` 之前加：

```html
        <ReceiptViewer
          :url="receiptState.previewUrl.value"
          :open="viewerOpen"
          @close="viewerOpen = false"
        />
```

- [ ] **Step 3: 列表加迴紋針**

在 [src/components/expense/ExpenseRow.vue](../../../src/components/expense/ExpenseRow.vue) 裡，**兩個** `<p v-if="expense.place" class="tiny place">` 之後（`canManage` 與非 `canManage` 兩個分支都要）各加一行：

```html
      <p v-if="expense.receipt" class="tiny">📎 有收據</p>
```

刻意不放縮圖：列表放縮圖的話，`ExpenseDayGroup` 一天十筆就是十個網路請求，漫遊網路下會很難看，而且列表本來就密。想看就點進去。

- [ ] **Step 4: 型別檢查與建置**

Run: `npm run check && npm test`
Expected: 都通過

- [ ] **Step 5: 手動驗證**

Run: `npm run dev`，開一筆有收據的支出 → 點縮圖。
Expected: 全螢幕深色 overlay 顯示大圖；點背景或「關閉」都能關掉；任務頁的支出列表上該筆顯示「📎 有收據」。

- [ ] **Step 6: Commit**

```bash
git add src/components/expense/ReceiptViewer.vue src/pages/ExpenseFormPage.vue src/components/expense/ExpenseRow.vue
git commit -m "View receipts full screen and flag expenses that have one"
```

---

### Task 10: 把 Storage 拆出首屏 chunk

[vite.config.js](../../../vite.config.js) 的註解說「Firebase 一定要整包放同一個 chunk」，但真正的原因是**不能把 umbrella 與實作拆開**。把 `firebase/storage` 與 `@firebase/storage` 一起放進獨立 chunk 是單向依賴、不會成環 —— 跟同一支檔案裡 chart.js 的處理方式一致。

不需要賭：[scripts/check-chunks.mjs](../../../scripts/check-chunks.mjs) 本來就會在 build 時抓循環相依，寫錯了 build 直接紅燈。

**Files:**
- Modify: `vite.config.js`
- Modify: `todo.md`

- [ ] **Step 1: 先量基準**

Run: `npm run build`
記下輸出裡 `firebase` 那個 chunk 的 gzip 大小，等一下要比對。

- [ ] **Step 2: 改 manualChunks**

在 [vite.config.js](../../../vite.config.js) 的 `manualChunks` 裡，**`firebase` 那條之前**插入：

```js
          // storage 只有收據功能用得到，而且是動態載入的。跟 firebase 綁在一起的話
          // 沒碰過收據的人也要在首屏付這個體積。
          //
          // 這不違反下面那條規則：不能拆的是「umbrella 與實作」（firebase/storage
          // 與 @firebase/storage），只要兩者一起搬走就是單向依賴、不會成環。
          // 跟 chart.js 的處理方式一樣，寫錯了 check-chunks 會擋下來。
          if (/\/node_modules\/@?firebase\/storage\//.test(path)) return "firebase-storage";
```

同時把下面那條的註解改成說出真正的理由：

```js
          // Firebase 的 umbrella（firebase/auth）只是 re-export，實作在 @firebase/auth。
          // 把「同一個產品的 umbrella 與實作」分到不同 chunk 會成環，執行時噴
          // "Cannot access 'x' before initialization"。整個產品一起搬則沒問題。
          if (/\/node_modules\/@?firebase\//.test(path)) return "firebase";
```

- [ ] **Step 3: 建置驗證**

Run: `npm run build`
Expected: 出現 `firebase-storage` chunk；原本的 `firebase` chunk 變小；最後一行印出「chunk 檢查通過，N 個 chunk 沒有循環相依」。

- [ ] **Step 4: 正式產物冒煙測試**

Run: `npm run preview`
開瀏覽器：登入 → 開任務 → 新增一筆帶收據的支出 → 送出 → 重新整理 → 開該筆支出看得到收據。
Expected: Console 沒有 "Cannot access 'x' before initialization"。DevTools → Network 確認 `firebase-storage` 那個 chunk 是**開啟收據功能時**才載入，不是首屏。

- [ ] **Step 5: 更新 todo.md**

在 [todo.md](../../../todo.md) 裡把收據照片標成完成（比照該檔案現有的格式），並記下已知取捨：Storage 規則擋不住非成員（防線是隨機 ID）、刪支出可能留下孤兒檔案、佇列不跨裝置。

- [ ] **Step 6: 全套驗證**

Run: `npm run check && npm test && npm run build && npm run test:rules`
Expected: 四個全綠。

- [ ] **Step 7: Commit**

```bash
git add vite.config.js todo.md
git commit -m "Keep Firebase Storage out of the first-load bundle"
```

---

## 驗收清單

全部 Task 完成後逐項確認（對應規格的「驗收標準」）：

- [ ] 線上新增一筆帶收據的支出，照片數秒內出現，Firestore 的 `receipt.path` 有值、`localId` 是 null
- [ ] 飛航模式新增一筆帶收據的支出：表單送出、正常跳頁、列表看得到、收據顯示「待上傳」；恢復連線後自動上傳且標籤消失
- [ ] 離線送出**不帶**收據的支出也不再卡在「儲存中...」
- [ ] 換照片時佇列裡只會有一筆（DevTools → Application → IndexedDB 確認），不會兩筆搶同一個路徑
- [ ] 刪掉一筆有收據的支出後，Storage 的檔案與 IndexedDB 的項目都消失
- [ ] 非管理者在列表看得到「📎 有收據」；點不進編輯頁（維持現況）—— 見 Task 8 關於唯讀詳情頁的註記
- [ ] `npm run build` 通過（含 chunk 循環檢查）、`npm test` 與 `npm run test:rules` 全綠
