# 任務封存與刪除 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓任務的擁有者能封存（唯讀、可解除）或刪除（軟刪除、所有成員都看不到）自己的任務。

**Architecture:** `TaskStatus` 從只有一個值擴成三值聯集，列表過濾在前端用純函式做（避免 Firestore 複合索引）。唯讀與「限擁有者」都在安全規則層強制，前端只負責不要讓人按了才失敗。確認對話框是一個元件，用 `requireText` 這個 prop 表達分級摩擦。

**Tech Stack:** Vue 3 + TypeScript、Vite、Firebase Firestore、Vitest、`@firebase/rules-unit-testing`

規格：[docs/superpowers/specs/2026-08-04-task-archive-delete-design.md](../specs/2026-08-04-task-archive-delete-design.md)

## Global Constraints

- 註解與 UI 文案一律**繁體中文**，比照現有檔案：解釋「為什麼」而不是複述程式碼在做什麼。
- `src/utils/` 的檔案是純函式，**不 import firebase、不 import vue**。
- 每支 `src/utils/*.ts` 對應一支 `tests/*.test.ts`，維持現有一對一格局。
- 測試用 `describe` / `it`，`it` 的敘述是中文完整句子，說明**行為**不是函式名。
- 匯入路徑一律用 `@/` alias。
- 狀態值只有三個：`"active" | "archived" | "deleted"`。
- **只有擁有者**能改狀態，且必須在 `firestore.rules` 強制。
- 封存 = 唯讀但可讀取；刪除 = 前端一律濾掉，介面上不可復原。
- Firestore 寫入一律回傳未 await 的 promise，由呼叫端用 `settleWrite` 包 —— 直接 await 會在離線時永遠卡住。
- 每個 Task 結束時 `npm run check` 必須通過。

---

### Task 1: 狀態型別與列表分堆

**Files:**
- Modify: `src/types/task.ts`
- Create: `src/utils/taskStatus.ts`
- Test: `tests/taskStatus.test.ts`

**Interfaces:**
- Produces:
  - `type TaskStatus = "active" | "archived" | "deleted"`
  - `STATUS_LABELS: Record<TaskStatus, string>`
  - `partitionTasks<T extends { task: { status?: TaskStatus } }>(rows: T[]): { active: T[]; archived: T[] }`

- [ ] **Step 1: 擴充型別**

在 [src/types/task.ts](../../../src/types/task.ts) 把第 3 行換掉：

```ts
/**
 * active   進行中，可讀可寫
 * archived 封存，唯讀。旅程結束了，帳留著查，但不能再改。
 * deleted  軟刪除。前端一律濾掉，使用者看不到。
 *
 * 用軟刪除是因為 Firestore 沒有 cascade delete —— 刪掉任務文件會讓底下的
 * members / expenses / payments / settlements 四個子集合變成永遠的孤兒。
 */
export type TaskStatus = "active" | "archived" | "deleted";
```

- [ ] **Step 2: 寫失敗的測試**

建立 `tests/taskStatus.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { STATUS_LABELS, partitionTasks } from "@/utils/taskStatus";
import type { TaskStatus } from "@/types/task";

function row(id: string, status?: TaskStatus) {
  return { task: { id, status }, role: "owner" as const };
}

describe("partitionTasks", () => {
  it("分成進行中與已封存兩堆", () => {
    const result = partitionTasks([row("a", "active"), row("b", "archived"), row("c", "active")]);
    expect(result.active.map(item => item.task.id)).toEqual(["a", "c"]);
    expect(result.archived.map(item => item.task.id)).toEqual(["b"]);
  });

  it("已刪除的不出現在任何一堆 —— 使用者不該再看到它", () => {
    const result = partitionTasks([row("a", "active"), row("gone", "deleted")]);
    expect(result.active.map(item => item.task.id)).toEqual(["a"]);
    expect(result.archived).toEqual([]);
  });

  it("沒有 status 的舊資料當成進行中，不會憑空消失", () => {
    const result = partitionTasks([row("legacy", undefined)]);
    expect(result.active.map(item => item.task.id)).toEqual(["legacy"]);
  });

  it("空清單回傳兩個空陣列，不是 undefined", () => {
    expect(partitionTasks([])).toEqual({ active: [], archived: [] });
  });

  it("保留原本的順序", () => {
    const result = partitionTasks([row("c", "active"), row("a", "active"), row("b", "active")]);
    expect(result.active.map(item => item.task.id)).toEqual(["c", "a", "b"]);
  });

  it("原樣帶過呼叫端自己的欄位，不只回傳 task", () => {
    const result = partitionTasks([row("a", "active")]);
    expect(result.active[0].role).toBe("owner");
  });
});

describe("STATUS_LABELS", () => {
  it("三個狀態都有中文標籤 —— 畫面上不該出現英文的 active", () => {
    expect(STATUS_LABELS.active).toBe("進行中");
    expect(STATUS_LABELS.archived).toBe("已封存");
    expect(STATUS_LABELS.deleted).toBe("已刪除");
  });
});
```

- [ ] **Step 3: 執行測試確認失敗**

Run: `npx vitest run tests/taskStatus.test.ts`
Expected: FAIL — `Failed to resolve import "@/utils/taskStatus"`

- [ ] **Step 4: 寫實作**

建立 `src/utils/taskStatus.ts`：

```ts
/**
 * 任務狀態的顯示與分堆。
 *
 * 分堆放在這裡而不是散在頁面的 v-if，是因為「已刪除的絕對不能出現」是一條
 * 需要被測試釘住的規則 —— 漏在任何一個地方，使用者就會看到本來刪掉的東西。
 *
 * 純函式，不 import firebase 也不 import vue。
 */
import type { TaskStatus } from "@/types/task";

export const STATUS_LABELS: Record<TaskStatus, string> = {
  active: "進行中",
  archived: "已封存",
  deleted: "已刪除"
};

/**
 * 泛型而不是寫死 `Task[]`：呼叫端手上是 `{ task, role }`，
 * 拆開再組回去只會讓它變麻煩。這裡只看 status，其餘欄位原樣帶過。
 *
 * 這個功能之前建立的舊資料可能沒有 status 欄位，當成進行中 ——
 * 預設值選錯的話那些任務會整個從列表消失。
 */
export function partitionTasks<T extends { task: { status?: TaskStatus } }>(
  rows: T[]
): { active: T[]; archived: T[] } {
  const active: T[] = [];
  const archived: T[] = [];

  for (const row of rows) {
    const status = row.task.status ?? "active";
    if (status === "deleted") continue;
    if (status === "archived") archived.push(row);
    else active.push(row);
  }

  return { active, archived };
}
```

- [ ] **Step 5: 執行測試確認通過**

Run: `npx vitest run tests/taskStatus.test.ts && npm run check`
Expected: PASS（7 個），型別檢查通過

- [ ] **Step 6: Commit**

```bash
git add src/types/task.ts src/utils/taskStatus.ts tests/taskStatus.test.ts
git commit -m "Add archived and deleted task states"
```

---

### Task 2: 安全規則

這是整個功能的骨幹。前端藏按鈕只是禮貌，規則才是真的擋得住。

**Files:**
- Modify: `firestore.rules`
- Test: `tests/firestore.rules.test.mjs`（補案例）

**Interfaces:**
- Produces: 規則函式 `changesStatusAsOwner()`、`taskIsActive(taskId)`

- [ ] **Step 1: 加兩個規則函式**

在 [firestore.rules](../../../firestore.rules) 的 `updatesTaskAsAdmin` 函式之後、`match /users/{uid}` 之前加：

```
    // 只有擁有者能封存、解除封存、刪除，而且這次寫入只能動 status。
    // 沒有 hasOnly 的話，擁有者可以藉著改狀態的名義順便改掉別的欄位。
    function changesStatusAsOwner() {
      let changed = request.resource.data.diff(resource.data).changedKeys();
      return signedIn()
        && resource.data.ownerId == request.auth.uid
        && changed.hasOnly(["status", "updatedAt"])
        && request.resource.data.status in ["active", "archived", "deleted"];
    }

    // 封存的任務唯讀。這個 get 不會多花錢 —— isTaskMember 已經讀過同一份文件，
    // Firestore 規則在同一次評估內會快取 get()。
    function taskIsActive(taskId) {
      return taskData(taskId).status == "active";
    }
```

- [ ] **Step 2: 堵住 admin 改狀態的後門**

`updatesTaskAsAdmin` 目前讓任何 admin 改任務欄位，其中包含 `status`。只加新規則卻不堵這條，「限擁有者」就是假的。在該函式的條件串最後加一行：

```
        && request.resource.data.status == resource.data.status;
```

（原本結尾的 `&& resource.data.ownerId in request.resource.data.adminIds;` 的分號要移到新的一行。）

- [ ] **Step 3: 把新規則接進 allow update，並補上 expenseCount 的唯讀限制**

把 [firestore.rules:81-83](../../../firestore.rules#L81-L83) 換成：

```
      allow update: if updatesTaskAsAdmin(taskId)
        || updatesSelfMembershipOnly()
        || (updatesExpenseCountOnly() && taskIsActive(taskId))
        || changesStatusAsOwner();
```

`updatesExpenseCountOnly` 要加上 `taskIsActive`：它平常跟著支出寫入一起發生，而支出寫入在封存後已被擋住；但它是獨立的一條規則，不補的話成員仍可單獨對封存的任務改 `expenseCount`。危害很小，但留著一條「封存後還能寫」的路徑會讓唯讀說不清楚。

`changesStatusAsOwner` **不能**加 `taskIsActive` —— 那樣就解除不了封存。

- [ ] **Step 4: 把唯讀掛到四個子集合**

`expenses`（[firestore.rules](../../../firestore.rules) 裡 `match /expenses/{expenseId}` 的三條）：

```
        allow create: if isTaskMember(taskId)
          && taskIsActive(taskId)
          && request.resource.data.createdBy == request.auth.uid
          && validExpenseShape()
          && validNewParticipants();
        allow update: if isTaskMember(taskId)
          && taskIsActive(taskId)
          && canManageExpense()
          && request.resource.data.createdBy == resource.data.createdBy
          && validExpenseShape()
          && validEditedParticipants();
        allow delete: if isTaskMember(taskId) && taskIsActive(taskId) && canManageExpense();
```

`get, list` **不動** —— 封存的重點就是還看得到。

`payments`、`settlements` 的每一條 create / update / delete 同樣加上 `&& taskIsActive(taskId)`，`get, list` 一樣不動。

`members` 只加在 create（封存的任務不該還能被加入）：

```
        allow create: if isSelf(uid)
          && taskIsActive(taskId)
          ...（其餘條件不變）
```

`members` 的 update **不加** —— 那條是既有成員改自己的暱稱或重新加入，封存後擋掉沒有意義。

- [ ] **Step 5: 補規則測試案例**

在 [tests/firestore.rules.test.mjs](../../../tests/firestore.rules.test.mjs) 的 `main()` 裡，既有的 tasks 相關測試附近加。注意 `seed()` 要放在每個 test 回呼**裡面**，比照鄰近的既有測試。

先加一個把任務改成封存的輔助函式，放在 `removeFromTask` 旁邊：

```js
/** 直接改資料庫做出「已封存」的狀態，不經過 rules。 */
async function archiveTask() {
  await testEnv.withSecurityRulesDisabled(async ctx => {
    await updateDoc(doc(ctx.firestore(), "tasks", TASK), { status: "archived" });
  });
}
```

然後加這些案例：

```js
  await test("擁有者可以封存任務", async () => {
    await seed();
    await assertSucceeds(updateDoc(doc(as(OWNER), "tasks", TASK), { status: "archived" }));
  });

  await test("擁有者可以解除封存", async () => {
    await seed();
    await archiveTask();
    await assertSucceeds(updateDoc(doc(as(OWNER), "tasks", TASK), { status: "active" }));
  });

  await test("擁有者可以刪除（軟刪除）", async () => {
    await seed();
    await assertSucceeds(updateDoc(doc(as(OWNER), "tasks", TASK), { status: "deleted" }));
  });

  // 這條最重要：updatesTaskAsAdmin 本來就讓 admin 改得動任務欄位，
  // 不堵住那個後門的話「只有擁有者」就是假的。
  await test("admin 不能封存或刪除任務 —— 那是擁有者專屬", async () => {
    await seed();
    await assertFails(updateDoc(doc(as(ADMIN), "tasks", TASK), { status: "archived" }));
    await assertFails(updateDoc(doc(as(ADMIN), "tasks", TASK), { status: "deleted" }));
  });

  await test("一般成員不能改任務狀態", async () => {
    await seed();
    await assertFails(updateDoc(doc(as(MEMBER), "tasks", TASK), { status: "archived" }));
  });

  await test("改狀態時不能順便改別的欄位", async () => {
    await seed();
    await assertFails(
      updateDoc(doc(as(OWNER), "tasks", TASK), { status: "archived", name: "偷改" })
    );
  });

  await test("狀態只能是那三個值", async () => {
    await seed();
    await assertFails(updateDoc(doc(as(OWNER), "tasks", TASK), { status: "zombie" }));
  });

  await test("封存後不能新增支出 —— 唯讀要在規則層擋住，不是只藏按鈕", async () => {
    await seed();
    await archiveTask();
    await assertFails(
      setDoc(doc(as(MEMBER), "tasks", TASK, "expenses", "e2"), newExpense())
    );
  });

  await test("封存後不能修改既有支出", async () => {
    await seed();
    await archiveTask();
    await assertFails(updateDoc(doc(as(MEMBER), "tasks", TASK, "expenses", "e1"), editedExpense()));
  });

  await test("封存後不能刪除支出", async () => {
    await seed();
    await archiveTask();
    await assertFails(deleteDoc(doc(as(MEMBER), "tasks", TASK, "expenses", "e1")));
  });

  await test("封存後仍然看得到支出 —— 封存的重點就是留著查", async () => {
    await seed();
    await archiveTask();
    await assertSucceeds(getDoc(doc(as(MEMBER), "tasks", TASK, "expenses", "e1")));
  });

  await test("封存後不能單獨改 expenseCount", async () => {
    await seed();
    await archiveTask();
    await assertFails(
      updateDoc(doc(as(MEMBER), "tasks", TASK), { expenseCount: increment(1) })
    );
  });

  await test("封存後不能有人加入這個任務", async () => {
    await seed();
    await archiveTask();
    await assertFails(
      setDoc(doc(as(OUTSIDER), "tasks", TASK, "members", OUTSIDER), {
        uid: OUTSIDER,
        nickname: OUTSIDER,
        role: "member",
        joinedAt: serverTimestamp(),
        active: true
      })
    );
  });

  await test("解除封存之後又可以記帳了", async () => {
    await seed();
    await archiveTask();
    await assertSucceeds(updateDoc(doc(as(OWNER), "tasks", TASK), { status: "active" }));
    await assertSucceeds(setDoc(doc(as(MEMBER), "tasks", TASK, "expenses", "e2"), newExpense()));
  });
```

- [ ] **Step 6: 跑規則測試**

Run: `npm run test:rules`
Expected: 全部 `ok`，`failed` 是 0。

**需要 JDK 21 以上** —— firebase-tools 不再支援更舊的版本。如果環境是 Java 11 會看到 `firebase-tools no longer supports Java version before 21`，那時**停下來告訴使用者**，不要假裝這一步過了。這是整個功能唯一能驗證「該擋的有沒有擋住」的地方。

- [ ] **Step 7: Commit**

```bash
git add firestore.rules tests/firestore.rules.test.mjs
git commit -m "Enforce archive read-only and owner-only status changes in rules"
```

---

### Task 3: 服務層與列表分區

**Files:**
- Modify: `src/services/taskService.ts`
- Modify: `src/pages/TaskListPage.vue`

**Interfaces:**
- Consumes: `partitionTasks`（`@/utils/taskStatus`）、`settleWrite`（`@/utils/offlineWrite`）
- Produces: `setTaskStatus(taskId: string, status: TaskStatus): Promise<void>`

- [ ] **Step 1: 加服務函式**

在 [src/services/taskService.ts](../../../src/services/taskService.ts) 檔案結尾加，並把 `updateDoc`、`serverTimestamp` 加進第一行的匯入（`serverTimestamp` 已經有了）：

```ts
/**
 * 封存、解除封存、刪除是同一個動作的三個值，不需要三支函式。
 *
 * 刻意不 await：Firestore 的寫入 promise 要等伺服器確認才 resolve，離線時
 * 永遠不會回來。呼叫端用 settleWrite 決定要等多久。
 */
export function setTaskStatus(taskId: string, status: TaskStatus): Promise<void> {
  return updateDoc(doc(db, "tasks", taskId), { status, updatedAt: serverTimestamp() });
}
```

匯入補上 `updateDoc`，型別補上 `TaskStatus`：

```ts
import { collection, doc, getDoc, getDocs, query, serverTimestamp, updateDoc, where, writeBatch } from "firebase/firestore";
import type { CreateTaskInput, Task, TaskStatus } from "@/types/task";
```

- [ ] **Step 2: 列表分成兩區**

在 [src/pages/TaskListPage.vue](../../../src/pages/TaskListPage.vue) 的 `<script setup>` 加匯入：

```ts
import { partitionTasks } from "@/utils/taskStatus";
```

在 `const totals = computed(...)` 之前加：

```ts
/** 已刪除的一律不出現在任何一區 —— 規則在 partitionTasks 裡，有測試釘住。 */
const partitioned = computed(() => partitionTasks(rows.value));
```

把 `totals` 的來源從 `rows.value` 改成只算進行中的，已封存的旅程不該算進「我的花費」：

```ts
const totals = computed(() =>
  sumByCurrency(
    partitioned.value.active.map(row => ({
      currency: row.task.defaultCurrency,
      amount: costs.value.get(row.task.id) ?? 0
    }))
  )
);
```

`loadCosts()` 裡的 `rows.value.map(...)` 同樣改成 `partitioned.value.active.map(...)` —— 已封存的任務不需要為了算花費而把支出全部載下來。

在 template 裡，把原本那段任務卡片列表換成兩區：

```html
      <div v-if="!loading && partitioned.active.length" class="stack">
        <TaskCard
          v-for="row in partitioned.active"
          :key="row.task.id"
          :task="row.task"
          :role="row.role"
          :my-cost="costsLoaded ? costs.get(row.task.id) ?? 0 : null"
        />
      </div>

      <div v-if="!loading && partitioned.archived.length" class="stack">
        <strong class="section-title">已封存</strong>
        <TaskCard
          v-for="row in partitioned.archived"
          :key="row.task.id"
          :task="row.task"
          :role="row.role"
          :my-cost="null"
        />
      </div>
```

已封存的卡片一律傳 `:my-cost="null"` —— 那些任務沒有被計算，傳 0 會顯示成「花了 0 元」，是錯的。

同時把「計算我的花費」按鈕與空狀態的條件從 `rows.length` 改成 `partitioned.active.length`，否則一個只剩封存任務的使用者會看到一顆算不出東西的按鈕。

- [ ] **Step 3: 型別檢查**

Run: `npm run check`
Expected: 通過

- [ ] **Step 4: 手動確認**

Run: `npm run dev`
在 Firebase Console 手動把某個任務的 `status` 改成 `archived`，重新整理列表。
Expected: 該任務移到「已封存」區；改成 `deleted` 則整個消失；「計算我的花費」不含封存的任務。

- [ ] **Step 5: Commit**

```bash
git add src/services/taskService.ts src/pages/TaskListPage.vue
git commit -m "Split the task list into active and archived"
```

---

### Task 4: 確認對話框元件

**Files:**
- Create: `src/components/common/ConfirmDialog.vue`

**Interfaces:**
- Produces: `ConfirmDialog.vue`
  - props：`open: boolean`、`title: string`、`message: string`、`confirmLabel: string`、`danger?: boolean`、`requireText?: string | null`
  - emits：`confirm`、`cancel`

- [ ] **Step 1: 寫元件**

建立 `src/components/common/ConfirmDialog.vue`：

```vue
<script setup lang="ts">
/**
 * 確認對話框。
 *
 * 不用 window.confirm 的兩個理由：它無法要求輸入文字，而且在手機上是系統
 * 對話框、按鈕位置不受控，「確定」常常就落在拇指下面 —— 那正是我們要避免的手滑。
 *
 * requireText 就是分級摩擦：後果越嚴重、需要越刻意的動作。
 * 沒有它時是單純的確認，有值時要打對那串字才按得下去。
 */
import { computed, ref, watch } from "vue";

const props = defineProps<{
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  /** 有值時要求使用者打出這串字才能確認。 */
  requireText?: string | null;
}>();

const emit = defineEmits<{ (e: "confirm"): void; (e: "cancel"): void }>();

const typed = ref("");

// 每次重新開啟都要清空，不然上一次打的字會讓按鈕一開始就是啟用的。
watch(
  () => props.open,
  isOpen => {
    if (isOpen) typed.value = "";
  }
);

const canConfirm = computed(() => !props.requireText || typed.value.trim() === props.requireText);
</script>

<template>
  <div v-if="open" class="overlay" role="dialog" aria-modal="true" @click.self="emit('cancel')">
    <div class="card dialog stack">
      <strong class="section-title">{{ title }}</strong>
      <p class="tiny message">{{ message }}</p>

      <label v-if="requireText" class="field">
        <span class="label">請輸入「{{ requireText }}」以確認</span>
        <input v-model="typed" class="input" autocomplete="off" />
      </label>

      <button
        class="btn btn-block"
        :class="danger ? 'btn-danger' : 'btn-primary'"
        :disabled="!canConfirm"
        @click="emit('confirm')"
      >
        {{ confirmLabel }}
      </button>
      <button class="btn btn-block" @click="emit('cancel')">取消</button>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(0, 0, 0, 0.5);
}

.dialog {
  width: 100%;
  max-width: 420px;
  /* 訊息很長時（列出成員數與支出數）在小螢幕上要能捲。 */
  max-height: 90vh;
  overflow-y: auto;
}

.message {
  /* 這裡會講出刪掉之後會發生什麼，是使用者唯一會讀的地方，不要壓得太扁。 */
  line-height: 1.7;
  white-space: pre-line;
}
</style>
```

- [ ] **Step 2: 型別檢查**

Run: `npm run check`
Expected: 通過

- [ ] **Step 3: Commit**

```bash
git add src/components/common/ConfirmDialog.vue
git commit -m "Add a confirm dialog that can require typing to proceed"
```

---

### Task 5: TaskCard 加動作按鈕與中文標籤

**Files:**
- Modify: `src/components/task/TaskCard.vue`

**Interfaces:**
- Consumes: `STATUS_LABELS`（`@/utils/taskStatus`）、`ROLE_LABELS`（`@/types/member`）
- Produces: `TaskCard` 新增 emits `archive` / `unarchive` / `delete`，各帶 `task: Task`

- [ ] **Step 1: 改成 stretched link 並加按鈕**

[src/components/task/TaskCard.vue](../../../src/components/task/TaskCard.vue) 整張卡目前是 `<RouterLink>`。按鈕放進去會變成 `<a>` 內包互動元素（不合法的 HTML），所以照 [ExpenseRow.vue](../../../src/components/expense/ExpenseRow.vue) 已經解過的方式改。

整支 `<script setup>` 換成：

```ts
import { computed } from "vue";
import { RouterLink } from "vue-router";
import type { Task } from "@/types/task";
import { type TaskRole, ROLE_LABELS } from "@/types/member";
import { STATUS_LABELS } from "@/utils/taskStatus";
import { formatDate } from "@/utils/firestore";
import { formatAmount } from "@/utils/currency";

const props = defineProps<{
  task: Task;
  role: TaskRole;
  /** 我在這趟旅程分攤的金額。null 代表還沒計算（列表預設不算）。 */
  myCost: number | null;
}>();

const emit = defineEmits<{
  (e: "archive", task: Task): void;
  (e: "unarchive", task: Task): void;
  (e: "delete", task: Task): void;
}>();

/** 只有擁有者能封存與刪除，這在 firestore.rules 也擋著，這裡只是不要讓人按了才失敗。 */
const isOwner = computed(() => props.role === "owner");
const isArchived = computed(() => props.task.status === "archived");

/** 整列是連結，按鈕在裡面要擋掉導航，不然會跳去任務頁。 */
function act(event: Event, kind: "archive" | "unarchive" | "delete") {
  event.preventDefault();
  event.stopPropagation();
  emit(kind, props.task);
}
```

`<template>` 換成：

```html
<template>
  <!--
    整張卡片可點是既有的操作方式，但 <a> 依規範不能包互動元素，
    所以用 stretched link：連結本身只放在標題上，再用 ::after 覆蓋整張卡，
    動作按鈕則疊在它上面。這樣兩個動作都能點，HTML 也是合法的。
  -->
  <div class="card task-card">
    <div class="spread">
      <div>
        <h2 class="section-title">
          <RouterLink :to="`/tasks/${task.id}`" class="stretch">{{ task.name }}</RouterLink>
        </h2>
        <p class="tiny">{{ task.startDate || "未設定" }} - {{ task.endDate || "未設定" }}</p>
      </div>
      <span class="role-pill">{{ ROLE_LABELS[role] }}</span>
    </div>

    <div class="task-meta">
      <span>{{ task.memberCount }} 位成員</span>
      <span>{{ task.expenseCount }} 筆支出</span>
      <!-- 進行中不掛標籤 —— 沒消息就是好消息，每張卡都貼一個「進行中」只是噪音。 -->
      <span v-if="isArchived" class="archived-pill">{{ STATUS_LABELS.archived }}</span>
    </div>

    <p v-if="myCost !== null" class="my-cost">
      <span class="tiny">我的花費</span>
      <strong>{{ task.defaultCurrency }} {{ formatAmount(myCost, task.defaultCurrency) }}</strong>
    </p>

    <p class="tiny">建立日期 {{ formatDate(task.createdAt) || "剛剛" }}</p>

    <div v-if="isOwner" class="actions">
      <button v-if="isArchived" type="button" class="action" @click="act($event, 'unarchive')">
        解除封存
      </button>
      <button v-else type="button" class="action" @click="act($event, 'archive')">封存</button>
      <button type="button" class="action danger" @click="act($event, 'delete')">刪除</button>
    </div>
  </div>
</template>
```

`<style scoped>` 裡把 `.task-card` 的 `display: block` 換掉，並加上新的樣式：

```css
.task-card {
  /* stretch 的 ::after 要靠這個定位，少了它覆蓋層會跑去對齊 viewport。 */
  position: relative;
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
  gap: 8px;
  margin-top: 10px;
}

.action {
  padding: 5px 12px;
  border: 1px solid var(--color-line-strong);
  border-radius: 999px;
  background: none;
  color: var(--color-muted);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.action:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.action.danger:hover {
  border-color: var(--color-danger);
  color: var(--color-danger);
}

.archived-pill {
  background: var(--color-line);
  color: var(--color-muted);
}
```

- [ ] **Step 2: 型別檢查與建置**

Run: `npm run check && npm run build`
Expected: 都通過

- [ ] **Step 3: 手動確認**

Run: `npm run dev`
Expected: 卡片上的角色顯示「擁有者／管理員／成員」而不是英文；不再有英文的 `active`；擁有者的卡片右下角有「封存」「刪除」；點按鈕不會導航到任務頁，點卡片其他地方會。

- [ ] **Step 4: Commit**

```bash
git add src/components/task/TaskCard.vue
git commit -m "Put owner actions on the task card and label it in Chinese"
```

---

### Task 6: 接上對話框與服務

**Files:**
- Modify: `src/pages/TaskListPage.vue`

**Interfaces:**
- Consumes: `setTaskStatus`（`@/services/taskService`）、`settleWrite`（`@/utils/offlineWrite`）、`ConfirmDialog.vue`、`TaskCard` 的三個 emits

- [ ] **Step 1: 加狀態與處理函式**

在 [src/pages/TaskListPage.vue](../../../src/pages/TaskListPage.vue) 的 `<script setup>` 加匯入：

```ts
import ConfirmDialog from "@/components/common/ConfirmDialog.vue";
import { setTaskStatus } from "@/services/taskService";
import { settleWrite } from "@/utils/offlineWrite";
import type { Task, TaskStatus } from "@/types/task";
```

（`Task` 可能已經匯入，不要重複。）

在 `onMounted(load)` 之前加：

```ts
/**
 * 對話框只有一個，住在頁面而不是每張卡各一個 —— DOM 裡永遠只有一份，
 * 而且「刪除的規則」集中在這裡而不是散在每張卡。
 */
const pending = ref<{ task: Task; next: TaskStatus } | null>(null);
const actionError = ref<string | null>(null);

const dialogTitle = computed(() => {
  if (!pending.value) return "";
  if (pending.value.next === "archived") return "封存這個任務？";
  if (pending.value.next === "active") return "解除封存？";
  return "刪除這個任務？";
});

const dialogMessage = computed(() => {
  const entry = pending.value;
  if (!entry) return "";
  if (entry.next === "archived") {
    return "封存之後資料留著可以查，但不能再記帳或修改。隨時可以解除封存。";
  }
  if (entry.next === "active") {
    return "解除之後這個任務就恢復正常，可以繼續記帳。";
  }
  // 刪除：講出實際規模，讓人知道自己在刪什麼。
  return `這個任務有 ${entry.task.memberCount} 位成員、${entry.task.expenseCount} 筆支出。刪除之後所有成員都會看不到，而且無法復原。`;
});

const dialogConfirmLabel = computed(() => {
  if (!pending.value) return "";
  if (pending.value.next === "archived") return "封存";
  if (pending.value.next === "active") return "解除封存";
  return "刪除";
});

/**
 * 分級摩擦：後果越嚴重、需要越刻意的動作。
 * 建錯的空任務刪掉風險是零，不該被懲罰；有支出的任務被誤刪是不可逆的災難。
 */
const dialogRequireText = computed(() => {
  const entry = pending.value;
  if (!entry || entry.next !== "deleted") return null;
  return entry.task.expenseCount > 0 ? entry.task.name : null;
});

function ask(task: Task, next: TaskStatus) {
  actionError.value = null;
  pending.value = { task, next };
}

async function confirmAction() {
  const entry = pending.value;
  if (!entry) return;
  pending.value = null;
  actionError.value = null;
  try {
    await settleWrite(setTaskStatus(entry.task.id, entry.next));
    // 不做樂觀更新：失敗時要把卡片放回去，多一組狀態換一點點速度，
    // 而這個操作一輩子按不到幾次。
    await load();
  } catch (err) {
    actionError.value = firebaseErrorMessage(err);
  }
}
```

- [ ] **Step 2: 接上 template**

兩個 `<TaskCard>` 都加上三個事件：

```html
          @archive="ask($event, 'archived')"
          @unarchive="ask($event, 'active')"
          @delete="ask($event, 'deleted')"
```

在最外層 `<div class="stack">` 結尾之前加錯誤訊息與對話框：

```html
      <ErrorState :message="actionError" />

      <ConfirmDialog
        :open="pending !== null"
        :title="dialogTitle"
        :message="dialogMessage"
        :confirm-label="dialogConfirmLabel"
        :danger="pending?.next === 'deleted'"
        :require-text="dialogRequireText"
        @confirm="confirmAction"
        @cancel="pending = null"
      />
```

- [ ] **Step 3: 型別檢查與測試**

Run: `npm run check && npm test`
Expected: 都通過

- [ ] **Step 4: 手動確認**

Run: `npm run dev`

依序驗證：

1. 建一個新任務（沒有支出）→ 按「刪除」→ 對話框**不要求**輸入名稱 → 確認 → 任務從列表消失
2. 在有支出的任務按「刪除」→ 對話框**要求**輸入任務名稱，且訊息顯示正確的成員數與支出數 → 名稱打錯時確認鈕是停用的
3. 按「封存」→ 確認 → 任務移到「已封存」區
4. 在已封存的卡片按「解除封存」→ 回到進行中
5. 用非擁有者的帳號登入 → 看不到這些按鈕

- [ ] **Step 5: Commit**

```bash
git add src/pages/TaskListPage.vue
git commit -m "Wire up archive and delete with confirmation"
```

---

### Task 7: 封存後的唯讀呈現

規則層已經擋死了，這一步是不要讓使用者按了才失敗。

**Files:**
- Modify: `src/pages/TaskPage.vue`
- Modify: `src/pages/JoinTaskPage.vue`

**Interfaces:**
- Consumes: `TaskStatus`（`@/types/task`）

- [ ] **Step 1: TaskPage 加唯讀判斷**

在 [src/pages/TaskPage.vue](../../../src/pages/TaskPage.vue) 的 `<script setup>` 加：

```ts
/** 封存的任務唯讀。規則層已經擋死，這裡只是不要讓人按了才失敗。 */
const isArchived = computed(() => taskState.task.value?.status === "archived");
/** 有人存了網址、任務後來被刪掉的情況。 */
const isDeleted = computed(() => taskState.task.value?.status === "deleted");
```

- [ ] **Step 2: 已刪除的任務不要顯示成幽靈任務**

規則仍允許成員讀取已刪除的任務（軟刪除只是一個欄位），所以要自己判斷。

TaskPage 的 template 已經有一串 `v-if` / `v-else-if` 分支（LoadingState → AccessDenied
→ 讀取錯誤 → 任務內容）。不要動既有結構，只要在 `<template v-else-if="taskState.task.value">`
**之前**插入一個新分支：

```html
        <ErrorState v-else-if="isDeleted" message="這個任務已被刪除。" />

```

順序很重要 —— 放在 `taskState.task.value` 那條之後就永遠不會命中，因為已刪除的任務
`task.value` 也是有值的。

- [ ] **Step 3: 封存橫幅與隱藏寫入入口**

在標題那個 `<div class="spread">` 之後加：

```html
        <p v-if="isArchived" class="card tiny archived-banner">
          這個任務已封存，目前唯讀。到「我的分帳」解除封存後才能繼續記帳。
        </p>
```

然後把這些寫入入口加上 `v-if="!isArchived"`：

- 標題列的「邀請」按鈕（原本是 `v-if="taskState.isAdmin.value"` → 改成 `v-if="taskState.isAdmin.value && !isArchived"`）
- 支出分頁的「新增支出」`<RouterLink>`
- `<ExpenseRow>` 的 `:can-manage`（改成 `taskState.isAdmin.value && !isArchived`，這樣編輯連結與「再記一筆」都會收起來）
- 結算分頁 `<SettlementPanel>` 的 `:can-manage` 與 `:is-admin`（同樣併上 `&& !isArchived`）

在 `<style scoped>` 加：

```css
.archived-banner {
  border-left: 3px solid var(--color-muted);
  color: var(--color-muted);
}
```

- [ ] **Step 4: JoinTaskPage 認得封存**

封存的任務其 `members` create 被規則擋住，所以加入會失敗成一句看不懂的權限錯誤。

在 [src/pages/JoinTaskPage.vue](../../../src/pages/JoinTaskPage.vue) 的 `join()` 函式裡，
把 catch 區塊：

```ts
  } catch (err) {
    error.value = firebaseErrorMessage(err);
  } finally {
    joining.value = false;
  }
```

換成：

```ts
  } catch (err) {
    // 封存的任務規則會擋掉 members 的 create，錯誤碼跟一般權限不足一樣，
    // 但使用者需要知道的是「這個任務結束了」而不是「你沒有權限」。
    error.value =
      (err as { code?: string }).code === "permission-denied"
        ? "這個任務已封存或已結束，無法加入。請聯絡發起人。"
        : firebaseErrorMessage(err);
  } finally {
    joining.value = false;
  }
```

只改 `join()` 那一個 catch。同一支檔案的 `load()` 與 `login()` 也有 catch，但那兩個
跟封存無關，不要一起改。

- [ ] **Step 5: 型別檢查與建置**

Run: `npm run check && npm test && npm run build`
Expected: 全部通過

- [ ] **Step 6: 手動確認**

Run: `npm run dev`

1. 封存一個任務 → 進去看：頂端有橫幅、沒有「新增支出」、沒有「邀請」、支出列沒有編輯連結與「再記一筆」、結算分頁不能建立結算
2. 解除封存 → 上述全部回來
3. 把某個任務改成 `deleted`（Firebase Console）→ 直接開它的網址 → 顯示「這個任務已被刪除」
4. 用封存任務的邀請連結加入 → 顯示「這個任務已封存或已結束，無法加入」

- [ ] **Step 7: 更新 todo.md 並 Commit**

在 [todo.md](../../../todo.md) 記下這個功能完成，並補一條後續項目：`ExpenseFormPage` 的刪除確認仍是 `window.confirm`，跟新的 `ConfirmDialog` 不一致，之後統一。

```bash
git add src/pages/TaskPage.vue src/pages/JoinTaskPage.vue todo.md
git commit -m "Make archived tasks read-only in the UI"
```

---

## 驗收清單

對應規格的「驗收標準」：

- [ ] 擁有者在「我的分帳」看得到自己任務的封存與刪除按鈕；非擁有者看不到
- [ ] 封存後任務移到「已封存」區，進去是唯讀，新增支出的入口消失
- [ ] 直接對封存任務寫入會被**規則**拒絕（不只是介面擋住）—— 由 `npm run test:rules` 證明
- [ ] 解除封存後恢復正常
- [ ] 刪除沒有支出的任務：一次確認即可
- [ ] 刪除有支出的任務：必須輸入任務名稱，訊息顯示正確的成員數與支出數
- [ ] 刪除後任務從所有成員的列表消失
- [ ] **admin（非擁有者）無法透過任何路徑改變任務狀態**
- [ ] 卡片上不再出現英文的 `active` / `owner`
- [ ] `npm test`、`npm run check`、`npm run build`、`npm run test:rules` 全綠
