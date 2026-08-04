# 支出備註 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 支出可以加一段最多 500 字的備註，記下塞不進支出名稱的來龍去脈，並顯示在支出列表上。

**Architecture:** 一個 `note: string` 欄位（空字串代表沒有），長度靠 `maxlength` 擋在輸入端、靠規則擋在後端。沒有新的純函式，所以沒有新的測試檔。

**Tech Stack:** Vue 3 + TypeScript、Firebase Firestore、Vitest

規格：[docs/superpowers/specs/2026-08-04-expense-note-design.md](../specs/2026-08-04-expense-note-design.md)

## Global Constraints

- 註解與 UI 文案一律**繁體中文**，解釋「為什麼」而不是複述程式碼。
- 備註上限 **500** 字，前端 `maxlength="500"`、規則 `size() <= 500`，兩邊必須一致。
- `note` 是 `string`，空字串代表沒有備註 —— **不要用 `string | null`**。
- 備註**不進**公開旅費報告。
- 「再記一筆」**不帶**備註。
- 規則測試（`npm run test:rules`）在本機跑不起來（JDK 21 取得不到），使用者自行手動驗證。
  測試案例仍要寫，但不要因為跑不了而停下來。
- 每個 Task 結束時 `npm run check` 必須通過。

---

### Task 1: 資料模型與規則

**Files:**
- Modify: `src/types/expense.ts`
- Modify: `src/services/expenseService.ts`（`normalizeExpense`）
- Modify: `src/pages/ExpenseFormPage.vue`（`submit` 組 `ExpenseInput` 的地方）
- Modify: `firestore.rules`
- Test: `tests/firestore.rules.test.mjs`（補案例）

**Interfaces:**
- Produces: `Expense.note: string`、`ExpenseInput.note: string`

- [ ] **Step 1: 加型別**

在 [src/types/expense.ts](../../../src/types/expense.ts) 的 `Expense` 介面裡，
`receipt` 那個欄位之後加：

```ts
  /**
   * 這筆支出的補充說明，最多 500 字。空字串代表沒有備註。
   *
   * 用空字串而不是 null：place 與 receipt 是物件，「沒有」只能用 null 表達；
   * 純字串的空值就是空字串，模板也不用寫 `note ?? ""`。
   */
  note: string;
```

在 `ExpenseInput` 介面裡，`receipt` 之後加：

```ts
  note: string;
```

- [ ] **Step 2: 讓舊文件讀得出來**

在 [src/services/expenseService.ts](../../../src/services/expenseService.ts) 的
`normalizeExpense` 回傳物件裡，`receipt` 那行之後加：

```ts
    note: (data.note as string | undefined) ?? "",
```

- [ ] **Step 3: 補上表單的欄位讓型別檢查過**

`ExpenseInput` 多了必填欄位，[src/pages/ExpenseFormPage.vue](../../../src/pages/ExpenseFormPage.vue)
的 `submit()` 會編譯失敗。在 `const input: ExpenseInput = {` 裡 `receipt: ...` 之後加：

```ts
      note: note.value.trim(),
```

並在表單欄位那一區（`const title = ref("");` 到 `const involvedIds = ref<string[]>([]);`
之間）的最後加狀態：

```ts
/** 這筆支出的補充說明。maxlength 擋在輸入端，所以不需要額外的錯誤訊息。 */
const note = ref("");
```

在 `load()` 的編輯分支裡，`date.value = expenseDate(expense);` 那行附近加：

```ts
    note.value = expense.note;
```

- [ ] **Step 4: 型別檢查**

Run: `npm run check`
Expected: 通過。若還有錯，是有別的地方在組 `ExpenseInput` —— 全專案只有 `ExpenseFormPage.vue`。

- [ ] **Step 5: 加 Firestore 規則**

在 [firestore.rules](../../../firestore.rules) 的 `validReceipt()` 函式之後加：

```
        // 備註是選填，最多 500 字。
        // 用 .get() 是因為這個功能之前建立的舊支出沒有這個欄位。
        function validNote() {
          let note = request.resource.data.get("note", "");
          return note is string && note.size() <= 500;
        }
```

然後把 `validExpenseShape()` 最後那行 `&& validReceipt();` 改成：

```
            && validReceipt()
            && validNote();
```

- [ ] **Step 6: 補規則測試案例**

在 [tests/firestore.rules.test.mjs](../../../tests/firestore.rules.test.mjs) 的
`newExpense()` 工廠裡，`receipt: null,` 之後加一行 `note: "",`；
`editedExpense()` 同樣加 `note: "",`。

然後在既有的支出規則測試附近加（`seed()` 放在 test 回呼**裡面**，比照鄰近的既有測試）：

```js
  await test("備註可以留空", async () => {
    await seed();
    await assertSucceeds(
      setDoc(doc(as(MEMBER), "tasks", TASK, "expenses", "e2"), newExpense({ note: "" }))
    );
  });

  await test("備註可以寫 500 字", async () => {
    await seed();
    await assertSucceeds(
      setDoc(doc(as(MEMBER), "tasks", TASK, "expenses", "e2"), newExpense({ note: "備".repeat(500) }))
    );
  });

  await test("備註超過 500 字要被擋", async () => {
    await seed();
    await assertFails(
      setDoc(doc(as(MEMBER), "tasks", TASK, "expenses", "e2"), newExpense({ note: "備".repeat(501) }))
    );
  });

  await test("備註不是字串要被擋", async () => {
    await seed();
    await assertFails(
      setDoc(doc(as(MEMBER), "tasks", TASK, "expenses", "e2"), newExpense({ note: 123 }))
    );
  });

  // 這個功能之前的支出沒有 note 欄位，validNote 用 .get() 就是為了它們。
  await test("沒有 note 欄位的舊格式支出仍然編輯得動", async () => {
    await seed();
    const withoutNote = editedExpense();
    delete withoutNote.note;
    await assertSucceeds(
      updateDoc(doc(as(MEMBER), "tasks", TASK, "expenses", "legacy"), withoutNote)
    );
  });
```

- [ ] **Step 7: 語法檢查**

Run: `node --check tests/firestore.rules.test.mjs && npm run check && npm test`
Expected: 全部通過。

`npm run test:rules` 在本機跑不起來（JDK 21），使用者自行驗證。**不要停下來。**

- [ ] **Step 8: Commit**

```bash
git add src/types/expense.ts src/services/expenseService.ts src/pages/ExpenseFormPage.vue firestore.rules tests/firestore.rules.test.mjs
git commit -m "Add a note field to expenses"
```

---

### Task 2: 表單欄位

**Files:**
- Modify: `src/pages/ExpenseFormPage.vue`

**Interfaces:**
- Consumes: Task 1 的 `note` ref

- [ ] **Step 1: 加輸入欄位**

在 [src/pages/ExpenseFormPage.vue](../../../src/pages/ExpenseFormPage.vue) 的
`<ReceiptField ... />` 之後、`<label class="field"><span class="label">誰先付</span>` 之前加：

```html
          <label class="field">
            <span class="label">備註（選填）</span>
            <!--
              maxlength 擋在輸入端，所以根本產不出不合法的值，
              不需要再多一個錯誤訊息。比照支出名稱的 maxlength="60"。
            -->
            <textarea
              v-model="note"
              class="input note-input"
              maxlength="500"
              rows="3"
              placeholder="例如：含小費、阿明先付現金、發票在小美那"
            ></textarea>
          </label>
```

- [ ] **Step 2: 加樣式**

專案目前沒有任何 textarea，`.input` 的 `padding: 0 14px`（上下沒有 padding）
與 `min-height: 52px` 是為單行設計的，直接套在 textarea 上文字會貼著上緣。
在 `<style scoped>` 加：

```css
/*
  .input 是為單行輸入設計的（padding 上下是 0、固定 min-height），
  textarea 要自己補上下內距與行高，不然文字會貼著上緣。
*/
.note-input {
  min-height: 0;
  padding: 12px 14px;
  line-height: 1.6;
  font-weight: 600;
  font-family: inherit;
  resize: vertical;
}
```

`font-family: inherit` 是必要的：textarea 預設是等寬字體，不加的話它會跟表單其他欄位
長得不一樣。

- [ ] **Step 3: 型別檢查與建置**

Run: `npm run check && npm run build`
Expected: 都通過

- [ ] **Step 4: 手動確認**

Run: `npm run dev`
Expected: 新增支出頁在收據下方出現「備註（選填）」的多行輸入框，字體與其他欄位一致；
打滿 500 字之後打不進去；存檔後重新編輯看得到內容。

- [ ] **Step 5: Commit**

```bash
git add src/pages/ExpenseFormPage.vue
git commit -m "Add the note field to the expense form"
```

---

### Task 3: 列表顯示與「再記一筆」

**Files:**
- Modify: `src/components/expense/ExpenseRow.vue`
- Test: `tests/repeatExpense.test.ts`（補案例）

**Interfaces:**
- Consumes: `Expense.note`

- [ ] **Step 1: 寫失敗的測試**

在 [tests/repeatExpense.test.ts](../../../tests/repeatExpense.test.ts) 的 `source()`
工廠裡加 `note: "含小費",`（放在 `date` 那行附近），然後加一個案例：

```ts
  it("不帶備註 —— 那是這一次的狀況，下次不一定成立", () => {
    expect("note" in (repeatFieldsOf(source()) as Record<string, unknown>)).toBe(false);
  });
```

- [ ] **Step 2: 執行測試確認通過**

Run: `npx vitest run tests/repeatExpense.test.ts`
Expected: PASS —— `repeatFieldsOf` 本來就沒有回傳 `note`，這個測試是把「刻意不帶」
這個決定釘住，避免之後有人「順手」加進去。

如果 FAIL，代表有人已經把 note 加進 `repeatFieldsOf` 了，要拿掉。

- [ ] **Step 3: 列表顯示備註**

在 [src/components/expense/ExpenseRow.vue](../../../src/components/expense/ExpenseRow.vue)
裡，**兩個** `<p v-if="expense.receipt" class="tiny">📎 有收據</p>` 之後各加一行
（`canManage` 與非 `canManage` 兩個分支都要，只改一邊的話沒有管理權的成員就看不到）：

```html
      <p v-if="expense.note" class="tiny note">📝 {{ expense.note }}</p>
```

在 `<style scoped>` 裡，`.place` 那條規則之後加：

```css
/* 備註可以到 500 字，列表一定要截成一行，不然一筆就佔滿整個畫面。 */
.note {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

- [ ] **Step 4: 型別檢查、測試與建置**

Run: `npm run check && npm test && npm run build`
Expected: 全部通過

- [ ] **Step 5: 手動確認**

Run: `npm run dev`
Expected: 有備註的支出在列表上顯示 `📝 內容`；很長的備註截成一行加省略號、不會撐破卡片；
沒有備註的支出完全看不到那一行；「再記一筆」帶出的表單備註是空的。

- [ ] **Step 6: 更新 todo.md 並 Commit**

在 [todo.md](../../../todo.md) 記下這個功能完成，註明備註不進公開報告、「再記一筆」不帶備註。

```bash
git add src/components/expense/ExpenseRow.vue tests/repeatExpense.test.ts todo.md
git commit -m "Show the expense note in the list"
```

---

## 驗收清單

- [ ] 新增支出可填備註，存得起來，重新載入還在
- [ ] 編輯支出看得到既有備註，改得動
- [ ] 支出列表在有備註時顯示 `📝`，過長時截斷成一行、不會撐破版面
- [ ] **沒有管理權的成員也看得到備註**（ExpenseRow 的兩個分支都要改）
- [ ] 「再記一筆」帶出的表單，備註是空的
- [ ] 這個功能之前建立的舊支出照樣讀得到、編輯得動
- [ ] **公開旅費報告裡沒有備註** —— `useTripReport` 是逐欄位組 `TripReportInput` 的，
      `note` 不在裡面，所以不需要改任何程式碼；但要實際產一份報告確認過
- [ ] `npm test`、`npm run check`、`npm run build` 全綠
- [ ] 規則測試由使用者手動驗證
