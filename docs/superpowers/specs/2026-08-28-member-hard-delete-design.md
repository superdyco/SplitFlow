# 移除成員時可以選擇真實刪除

日期：2026-08-28

## 目標

讓「加錯人」和「測試資料」有辦法清乾淨。

現在的「移除成員」是軟刪 —— member 文件標成 `active: false` 並移出
`task.memberIds`。它拿掉的是**權限**，帳目完全不動。這對真實成員是對的：
飯已經吃了、錢已經付了，取消存取權不該讓這些事沒發生過。

但它造成一個介面上的矛盾：**成員頁他消失了，結算頁他還在**。使用者按下
「移除」時想的是「這個人從我的旅程裡不見」，得到的卻是「他看不到這個任務了」。
同一個人在兩個頁面上有沒有存在的答案不一樣。

虛擬成員讓這件事更嚴重：他本來就沒有存取權，所以對他而言「移除」的唯一效果
是把他從新支出的付款人選單裡拿掉 —— 確認框那句「他就看不到這個任務了」
對他是假的。

這個規格補上第二種意圖：**「這個人根本不該在這裡」**。

## 範圍

**要做的**

- 移除成員時先數他有幾筆支出、幾筆付款
- 完全沒帳 → 直接真實刪除，不多問
- 有帳 → 讓使用者選「保留結算資料」（現況的軟刪）或「真實移除」
- 真實移除會連他的支出與付款一起刪
- 確認框要把後果講清楚，包含會誤傷別人的部分
- 網頁版與 Flutter 版都做
- Firestore 規則開放 admin 刪除 member 文件

**明確不做的**

- **不改結算的算法。** `participants` 從支出與付款推導、不看 `memberIds`，
  這是對的：移除是權限操作，不是帳務操作。改它會製造真正的財務錯誤。
- **不刪結算紀錄快照。** 2026-08-28 定案：歷史就是歷史。代價寫在下面。
- **不做「把他從分攤裡摘掉、支出留著」。** `allocate()` 保證分攤總和等於支出
  金額，少一個人就必須重新分配，那會改掉其他人的金額。使用者選的是整筆刪。
- **不做 Cloud Function。** 跟砍掉「認領」同一個理由：這專案沒有 Functions，
  要升 Blaze 方案。
- **不清孤兒收據以外的 Storage 檔案。**

## 誰算「有帳」

一筆支出算在他頭上，只要符合任一條：

- `expense.paidBy == uid`
- `uid` 出現在 `expense.splits` 的 key 裡

**不必另外檢查 `splitMemberIds`** —— 那是自訂分攤之前的舊欄位，網頁版的
`normalizeExpense()`（`src/services/expenseService.ts`）與 Flutter 的
`expenseFromMap()`（`lib/data/mappers.dart`）在讀取時就把它推回 `splits` 了。
偵測跑在正規化之後的模型上，舊資料自動涵蓋。

一筆付款算在他頭上：`payment.from == uid` 或 `payment.to == uid`
（不分 pending 或 confirmed）。

這是純函式，兩邊各一份、各自有測試：

```ts
interface MemberFootprint {
  expenseIds: string[];
  paymentIds: string[];
}

function memberFootprint(uid: string, expenses: Expense[], payments: Payment[]): MemberFootprint
```

## 兩條路徑

**沒有帳**（`expenseIds` 與 `paymentIds` 都是空的）→ **直接真實刪除，不跳選擇。**

軟刪存在的唯一理由是「讓舊支出查得到暱稱」（`memberService.ts` 的註解寫明了）。
沒有舊支出就沒有這個需求，留一份 `active: false` 的文件只是垃圾。這條正好
覆蓋「加錯人」與「測試資料」，也是這個規格最主要的使用情境。

真實成員被真刪之後若用邀請連結回來，走的是一般的加入路徑（`rejoinsSelf()`
需要既有文件，找不到就退回 `joinTask()` 的建立分支），行為正確。

**有帳** → 確認框給兩個選擇：

- **保留結算資料**：現況的軟刪，行為完全不變
- **真實移除**：連支出與付款一起刪

## 真實移除刪什麼

| 刪 | 保留 |
| --- | --- |
| `paidBy` 是他的支出 | **結算紀錄快照**（`settlements`）|
| `splits` 含他的支出 —— **包含別人付錢的** | |
| `from` 或 `to` 是他的付款記錄 | |
| member 文件（真刪，不是 `active: false`）| |
| `task.memberIds`、`adminIds` 移除他 | |
| `task.memberCount` -1、`expenseCount` -N | |
| 被刪支出的收據照片（best-effort）| |

**收據沿用既有取捨**：`deleteExpense()` 本來就不刪收據，`deleteReceipt()` 的
註解寫著「留下孤兒檔案是設計上接受的取捨」。這裡照樣 best-effort 呼叫
`deleteReceipt()`，失敗就算了，不為此發明新機制。

## 已知且刻意接受的兩個不一致

**1. 結算紀錄裡他還在。** 快照存的是產生當下的 `memberNames` 與 `balances`
副本，而規則是 `allow update: if false` —— 不能局部修改，只能整份刪或整份留。
使用者選擇留。所以真實移除之後打開「結算紀錄」仍然看得到他的名字。
**確認框必須明講這件事**，否則會重演「我砍掉了為什麼還在」的困惑。

**2. 會誤傷別人的帳。** 小明付晚餐 1000 元、阿嬤與小華分攤，真實移除阿嬤會
把整筆刪掉 —— 小明實際付出去的 1000 元從帳上消失，小華也不再欠那一份。
這是使用者明確選擇的行為（「那是使用者的責任」），**代價全部靠確認框揭露**。

## 確認框

有帳時的文案要數給他看，而且三件事都要講：

```
移除「阿嬤」

他出現在 12 筆支出、2 筆付款記錄裡。

・保留結算資料：他看不到這個任務，但既有支出與結算金額原封不動。
・真實移除：連同那 12 筆支出與 2 筆付款一起刪除，無法復原。
  其中有些支出是別人付的，刪掉之後那些人的帳也會跟著不見。
  結算紀錄裡仍然看得到他的名字。
```

文案組成是純函式，跟現有的 `removeMemberMessage()` 放在一起
（`src/utils/memberRemoval.ts`、`flutter_app/lib/domain/expense_actions.dart`），
理由跟它一樣：這是**規則**不是畫面，要測得到。

## 執行順序與批次安全

Firestore 一個 `writeBatch` 上限 500 筆寫入。一趟 100 筆支出的旅程刪起來會爆，
而那正是最需要清理的情境。所以切批，每批最多 450 筆。

**順序是這個設計的核心** —— 分批就不是原子的，所以要讓中途失敗可以重試：

1. 刪支出（分批，每批同時 `expenseCount` 減掉該批的數量）
2. 刪付款（分批）
3. **最後**才刪 member 文件，並把他移出 `memberIds`／`adminIds`、`memberCount` -1

中途失敗時這個人**還在成員名單上**，使用者重按一次就從頭再跑：已刪的支出
查不到、不會重複刪，剩下的繼續刪。整個操作是冪等的。

反過來把 member 文件先刪的話，失敗會留下「成員不見了但支出還在」的狀態，
而且**再也沒有介面可以重試** —— 那個人已經不在成員列表裡了。

收據在支出刪除成功之後 best-effort 清理，失敗不影響流程。

```ts
function hardDeleteMember(taskId: string, uid: string, footprint: MemberFootprint): Promise<void>
```

## 安全規則

只動一處：

```
match /tasks/{taskId}/members/{uid} {
  // 原本是 allow delete: if false
  allow delete: if isTaskAdmin(taskId)
    && taskIsActive(taskId)
    && resource.data.role != "owner";
}
```

⚠️ **這次開放的是刪除權，比新增虛擬成員那條更該小心。** 加 `taskIsActive` 是因為封存的任務唯讀 —— 封存之後不該還能改帳。

`role != "owner"` 這條**不能少**：既有的軟刪走 `managesMemberAsAdmin()`，那裡面有
`resource.data.role != "owner"` 擋著。新開的刪除路徑如果不擋，就等於「admin 可以
把 owner 從自己的任務裡刪掉」—— 比軟刪能做的事還多。

其餘全部不用改，確認過：

- **支出刪除**：`canManageExpense()` 已含 `isTaskAdmin(taskId)`
- **付款刪除**：`allow delete` 已含 `isTaskAdmin(taskId)`
- **task 更新**：`updatesTaskAsAdmin()` 沒有 `hasOnly`，本來就能改
  `memberIds`、`adminIds`、`memberCount`、`expenseCount`

**放寬的只有 admin 這一格。** 一般成員與外人仍然完全刪不了 member 文件 ——
從「誰都不能刪」變成「只有 admin、只在任務進行中、且不是 owner 才能刪」。

## 介面

- 成員列的「移除」按鈕行為不變，差別在按下去之後
- 沒帳 → 一般的確認框，文案講明「會完全刪除」
- 有帳 → 兩個選擇的對話框（見上面的文案）
- 刪除過程要有進度或忙碌狀態：100 筆支出會跑好幾個批次，不能讓畫面像當掉
- 網頁版：`src/components/member/MemberRow.vue`、`src/pages/TaskPage.vue`
- Flutter：`flutter_app/lib/ui/members_tab.dart`

## 測試

**純函式**（兩邊都有）：

- `memberFootprint()` 認得 `paidBy`
- `memberFootprint()` 認得 `splits` 的 key
- `memberFootprint()` 認得舊格式（正規化之後的 `splits`）
- `memberFootprint()` 認得 `from` 與 `to` 的付款，pending 與 confirmed 都算
- 完全沒帳時兩個陣列都是空的
- 同一筆支出他既是付款人又在分攤裡，只算一次
- 確認框文案：沒帳、有支出沒付款、兩者都有，三種各一

**規則測試**（`npm run test:rules`，目前只能在裝了 JDK 21 的機器上跑）：

- admin 可以刪 member 文件
- 一般成員不能刪
- 外人不能刪
- 封存的任務不能刪
- 刪虛擬成員與刪真實成員都可以

**手動驗證**（repository 層沒有自動化測試）：

1. 建一個沒有任何支出的成員 → 移除 → 不跳選擇、直接消失、結算頁也沒有他
2. 建一個有支出的成員 → 移除 → 跳選擇 → 選「保留」→ 行為跟現在完全一樣
3. 同上 → 選「真實移除」→ 他的支出消失、結算頁沒有他、`expenseCount` 對得上
4. 一筆別人付、他有分攤的支出 → 真實移除 → 那筆整個不見（**這是刻意的**）
5. 移除前先產生一次結算紀錄 → 真實移除後 → 紀錄裡他的名字還在（**刻意的**）
6. 兩邊都要驗：網頁版做完，用 Flutter 版看同一個任務，反之亦然

## 前置條件

規則測試在開發機上跑不起來 —— `firebase-tools` 要 JDK 21，實測這台是
JDK 11.0.16，而公司擋了 Microsoft Store、winget 取不到來源。
2026-08-28 決定不用 GitHub Actions，改為手動測試。

**這次開放的是刪除權**，所以動工前要先想清楚怎麼驗這條規則。可行的做法是從
[Adoptium](https://adoptium.net) 直接下載 JDK 21 的 zip 解壓（不需要
Microsoft Store），讓 `npm run test:rules` 能在本機跑。
