# 任務封存與刪除

日期：2026-08-04

## 目標

讓任務的擁有者能結束一趟旅程（封存）或移除建錯的任務（刪除）。

## 起點：目前什麼都沒有

- **起迄日期是純裝飾。** `startDate` / `endDate` 只被存下來、顯示在 TaskCard 與
  JoinTaskPage，並由 `dateRangeError` 檢查結束不早於開始。**沒有任何程式碼比對
  「今天」與 `endDate`** —— 日期過了照樣能記帳、結算、邀人。
- **`TaskStatus` 是只有一個值的聯集**（`"active"`），所以任務永遠是進行中。
  `TaskCard` 還直接把英文 `active` 印在畫面上給使用者看。
- **擁有者不能刪除任務。** `firestore.rules` 允許擁有者 delete，但全專案沒有任何
  程式碼呼叫它 —— 規則開了門，沒人走。

## 範圍

**要做的**

- 封存：任務變唯讀，資料留著可查，隨時可解除
- 刪除：軟刪除，所有成員都看不到，介面上不可復原
- 兩者都要確認對話框，刪除依「有沒有支出」給不同摩擦力
- **只有擁有者**能操作，且必須在規則層強制，不能只藏按鈕
- 順手修掉 `TaskStatus` 只有一個值、以及 `TaskCard` 顯示英文 `status` 與 `role`

**明確不做的**

- **不做復原介面。** 軟刪除是為了資料完整性，不是垃圾桶。防護已經做在前面：
  封存給了「不想看到它」正確的出口，有支出的任務要打字才刪得掉。
- **不做「30 天後真的刪除」。** 那需要排程加遞迴刪除子集合，也就是 Cloud
  Functions。做不到卻這樣寫，等於給一個假承諾 —— 資料會永遠躺著。
- **不讓日期自動觸發封存。** 旅程延期、事後補帳都很常見，時間到就鎖住會擋到人。
  封存是明確的人為動作。
- **不改既有的 `window.confirm`。** `ExpenseFormPage` 的刪除確認在新對話框出現後
  會不一致，但全站替換是另一件事，會讓這次失焦。記進 todo.md。

## 為什麼是軟刪除

**Firestore 沒有 cascade delete。** 刪掉任務文件之後，底下的 `members`、
`expenses`、`payments`、`settlements` 四個子集合會全部變成孤兒 —— 永遠留在資料庫
裡，誰也讀不到、誰也刪不掉。加上收據功能之後還多了 Storage 檔案。

真刪除需要遞迴刪除或 Cloud Functions。軟刪除完全繞過這個問題，代價只是那些文件
繼續佔著空間，而它們本來就會佔著。

## 狀態模型

```ts
export type TaskStatus = "active" | "archived" | "deleted";
```

| 狀態 | 列表 | 讀取 | 寫入 | 誰能改成這個 |
|---|---|---|---|---|
| `active` | 進行中區 | 可以 | 可以 | 擁有者（從 archived 解除） |
| `archived` | 已封存區 | 可以 | **不行** | 擁有者 |
| `deleted` | 不出現 | 規則仍允許，但前端一律濾掉 | 不行 | 擁有者 |

### 列表過濾在前端做

`listUserTasks` 目前是 `where("memberIds", "array-contains", uid)`。再加狀態過濾
就要建複合索引，而 `!=` 還會帶來 orderBy 限制。

一個使用者的任務是幾十個等級，全部載回來在前端分堆比維護索引划算。這跟
`expenseService.listExpenses` 選擇前端排序的理由一致（見該處註解）。

純函式 `partitionTasks(rows)` 回傳 `{ active, archived }`，已刪除的一律不出現在
任何一邊。把規則放在一個測得到的函式裡，而不是散在頁面的 `v-if`。

輸入是 `TaskListPage` 既有的 `Array<{ task: Task; role: TaskRole }>`，不是裸的
`Task[]` —— 那一頁本來就帶著角色，拆開再組回去只會讓呼叫端變麻煩。為了不綁死在
那個形狀上，型別寫成 `<T extends { task: { status?: TaskStatus } }>`，函式只看
`status`，其餘欄位原樣帶過。

沒有 `status` 欄位的舊資料當成 `active`。（`createsOwnTask` 一直要求要有，但防禦
不花成本。）

## 安全規則

規則要做兩件事，缺一不可。

### ① 只有擁有者能改狀態

```
function changesStatusAsOwner() {
  let changed = request.resource.data.diff(resource.data).changedKeys();
  return signedIn()
    && resource.data.ownerId == request.auth.uid
    && changed.hasOnly(["status", "updatedAt"])
    && request.resource.data.status in ["active", "archived", "deleted"];
}
```

**同時要堵住既有的後門**：`updatesTaskAsAdmin` 讓任何 admin 改任務欄位，其中包含
`status`。必須加上：

```
&& request.resource.data.status == resource.data.status
```

只加新規則卻不堵舊的，「限擁有者」就是假的。

新函式還要真的接進 `allow update`，否則寫了也不會被評估：

```
allow update: if updatesTaskAsAdmin(taskId)
  || updatesSelfMembershipOnly()
  || updatesExpenseCountOnly()
  || changesStatusAsOwner();
```

`updatesExpenseCountOnly` 也要補上 `taskIsActive(taskId)`。它平常是跟著支出的寫入
一起發生的，而支出寫入在封存後已經被擋住；但它是獨立的一條規則，不補的話成員仍可
單獨對封存的任務改 `expenseCount`。危害很小，但留著一條「封存後還能寫」的路徑會讓
唯讀這件事說不清楚。

### ② 封存的唯讀必須在規則層強制

前端藏按鈕只是禮貌，打開 DevTools 就能繞過。

```
function taskIsActive(taskId) {
  return taskData(taskId).status == "active";
}
```

掛到 `expenses`、`payments`、`settlements` 的 create / update / delete，以及
`members` 的 create（封存的任務不該還能被加入）。

**不掛在 read 上** —— 封存的重點就是還看得到。

**不增加讀取費用**：`taskData()` 已被 `isTaskMember()` 使用，Firestore 規則在同一次
評估內會快取 `get()`。

## 介面

### 動作在「我的分帳」列表頁

管理清單的動作屬於清單頁。TaskPage 不放這些按鈕。

`TaskCard` 目前整張是 `<RouterLink>`，按鈕放進去會變成 `<a>` 內包互動元素（不合法
的 HTML）。照 `ExpenseRow` 已經解過的方式改成 stretched link：外層改 `<div
class="card">`，`RouterLink` 只包標題，再用 `::after` 撐滿整張卡；按鈕用
`position: relative; z-index: 1` 疊在上面。

```
┌────────────────────────────────────┐
│ 曼谷五日                    擁有者  │
│ 2026-03-01 - 2026-03-05            │
│                                    │
│ 3 位成員   47 筆支出                │
│ ─────────────────────────────────  │
│ 我的花費            TWD 12,480     │
│                                    │
│              [封存]  [刪除]         │  ← 只有擁有者
└────────────────────────────────────┘
```

已封存的卡片：按鈕變成 `[解除封存] [刪除]`，並掛灰色「已封存」標籤。

### 對話框只有一個，住在頁面

`TaskCard` 只 `emit("archive" | "unarchive" | "delete", task)`；`TaskListPage`
收到後決定開哪種對話框、呼叫哪個服務。這跟 `ExpenseRow` emit `repeat` 交給
`TaskPage` 處理是同一個分工。

好處是 DOM 裡永遠只有一個對話框，而且「刪除的規則」集中在一處而不是散在每張卡。

### `ConfirmDialog.vue`

```ts
props: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  /** 有值時要求使用者打出這串字才能按下確認。 */
  requireText?: string | null;
}
emits: confirm, cancel
```

`requireText` 就是分級摩擦，同一個元件涵蓋三種情況：

| 動作 | `requireText` |
|---|---|
| 封存 / 解除封存 | `null` |
| 刪除**沒有**支出的任務 | `null` |
| 刪除**有**支出的任務 | 任務名稱 |

摩擦力跟後果成正比。建錯的空任務刪掉風險是零，不該被懲罰；47 筆支出被誤刪是不可
逆的災難，值得用「打字」這種需要刻意為之的動作擋一下。

不用 `window.confirm`：它無法要求輸入文字，而且在手機上是系統對話框、按鈕位置不受
控，「確定」常常就在拇指下面 —— 那正是我們要避免的手滑。

有支出時的訊息要講出實際規模：

> 這個任務有 **3 位成員、47 筆支出**。刪除之後所有人都看不到，而且無法復原。
> 請輸入任務名稱「曼谷五日」以確認。

### 封存後的唯讀呈現

TaskPage 頂端一條橫幅「這個任務已封存，目前唯讀。解除封存後才能繼續記帳。」，並
隱藏：新增支出、再記一筆、支出列的編輯連結、邀請按鈕、結算的建立與付款確認。

規則層已經擋死，這些只是不要讓人按了才失敗。

### 標籤中文化

`TaskCard` 目前直接印英文的 `status` 與 `role`，畫面上會出現 `active`、`owner`。
兩者一起改成中文 —— 只修一個的話兩個標籤並排會一中一英，更難看。

進行中不顯示狀態標籤（沒消息就是好消息），封存顯示灰色「已封存」。

## 服務層

```ts
export function setTaskStatus(taskId: string, status: TaskStatus): Promise<void>
```

封存、解除封存、刪除是同一個動作的三個值，不需要三支函式。

回傳未 await 的 promise，由呼叫端用 `settleWrite` 包起來 —— 這裡跟支出一樣會遇到
「離線時 Firestore 的寫入 promise 永遠不 resolve」的問題，剛修過的坑不要再踩。

## 邊界情況

| 情況 | 處理 |
|---|---|
| 刪除後列表要更新 | 直接重新 `load()`，不做樂觀更新。失敗時要把卡片放回去，多一組狀態換一點點速度，而這個操作一輩子按不到幾次 |
| 已刪除的任務被直接開啟（存了網址） | 規則仍允許成員讀取，所以 TaskPage 要自己判斷 `status === "deleted"` 並顯示「這個任務已被刪除」，不要讓人看到幽靈任務 |
| 封存任務的邀請連結 | `members` create 被 `taskIsActive` 擋住。JoinTaskPage 要認得並說「這個任務已封存，請聯絡發起人」，不要吐看不懂的權限錯誤 |
| 擁有者離開任務 | 不在本次範圍。現有規則已保證 owner 不會被踢出 |

## 測試

| 測試 | 涵蓋 |
|---|---|
| `tests/taskStatus.test.ts` | `partitionTasks`：分成進行中與已封存兩堆；已刪除不出現在任何一邊；沒有 `status` 的舊資料當作進行中；空清單 |
| `tests/firestore.rules.test.mjs`（補案例） | 擁有者可封存／解除／刪除；**admin 不行**；一般成員不行；改狀態時不能順便改別的欄位；封存後不能新增支出、不能加入成員、不能單獨改 `expenseCount`；解除封存後又可以 |

「admin 不能改狀態」是重點案例。現有的 `updatesTaskAsAdmin` 本來就讓 admin 改得動
任務欄位，只加新規則卻沒堵住舊的，限擁有者就是假的。測試要把這個後門釘住。

## 驗收標準

1. 擁有者在「我的分帳」看得到自己任務的封存與刪除按鈕；非擁有者看不到。
2. 封存後任務移到「已封存」區，進去是唯讀，新增支出的入口消失。
3. 直接用 API 對封存任務新增支出會被規則拒絕（不只是介面擋住）。
4. 解除封存後恢復正常。
5. 刪除沒有支出的任務：一次確認即可。
6. 刪除有支出的任務：必須輸入任務名稱，訊息顯示正確的成員數與支出數。
7. 刪除後任務從所有成員的列表消失。
8. admin（非擁有者）無法透過任何路徑改變任務狀態。
9. `npm test` 與 `npm run test:rules` 全綠。
