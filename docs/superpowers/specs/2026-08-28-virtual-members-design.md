# 虛擬成員

日期：2026-08-28

## 目標

讓沒有 Google 帳號的人（主要是長輩）也能被記進帳裡。

現在要成為成員，唯一的路是自己用 Google 登入再點邀請連結。長輩常常連 Gmail
都沒有，結果是**他們的花費只能算在代付的子女頭上**，帳目與現實不符。

虛擬成員是「帳目上的一個人，但沒有帳號」：可以被指定為付款人、可以被分攤、
會出現在結算與圖表裡，跟真實成員一模一樣 —— 差別只在他自己打不開 App。

## 範圍

**要做的**

- owner/admin 可以在成員頁新增虛擬成員（只填暱稱）
- 虛擬成員可改名、可移除，兩者都沿用現有的成員管理路徑
- 支出的付款人與分攤名單包含虛擬成員
- 結算、付款記錄、分類圖表包含虛擬成員
- 網頁版與 Flutter 版都做建立入口
- Firestore 規則：新增虛擬成員的建立路徑，並收緊既有的成員管理路徑

**明確不做的**

- **不做「認領」。** 虛擬成員永遠是虛擬的，不會換成真帳號。2026-08-28 定案：
  認領要把歷史資料裡的合成 id 全部改寫成真 uid（每筆支出的 `paidBy` 與
  `splits` 的 key、每筆付款的 `from`/`to`、`memberIds`、加上 member 文件本身
  ——文件 ID 就是 uid，等於刪一個建一個）。這是跨數十份文件的批次改寫，而且
  要在規則裡開一個「允許某人改寫他原本無權改的支出」的洞。這個專案沒有
  Cloud Functions（`firebase.json` 只有 hosting/firestore/storage），改寫只能
  在 client 做，風險與收益不成比例。
- **不做匿名登入。** 評估過，但匿名帳號在重裝 App、換手機、改用網頁版時會
  永久消失且無法還原 —— 同一個人會在帳目上變成兩份。而「手機怪怪的重灌一下」
  正是目標客群最常做的事。
- **不做手機號碼登入。** 它其實是這個問題最對症的解法（長輩沒 Gmail 但一定有
  手機號碼，且能跨裝置還原），但需要升 Blaze 方案與簡訊費用。留作日後選項。
- **不做代管人欄位。** 付款確認交給 admin，見下面。
- **不改公開旅費報告。** 虛擬成員在報告裡就是一個名字，本來就不區分。

## 資料模型

member 文件加一個欄位：

```ts
/** 這個成員沒有帳號，由 owner/admin 代為建立。舊文件沒有這個欄位。 */
virtual?: boolean;
```

加在網頁版的 `TaskMember`（`src/types/member.ts`）與 Flutter 的 `TaskMember`
（`lib/domain/models.dart`）上。讀取時一律 `?? false`，舊成員文件不需要回填。

### 文件 ID 用合成 id

虛擬成員的 member 文件 ID 是 `v_` + 20 個小寫英數字，例如 `v_k3n8x2p9qz1m4w7t6r0a`。

**為什麼不是隨便一個字串**：這個 id 會被寫進 `task.memberIds`，而 `memberIds`
同時是權限清單 —— `isTaskMember()` 判斷的是 `request.auth.uid in memberIds`。
格式必須讓它**不可能等於任何真實 uid**：

- Firebase Auth 的 uid 是 28 字元；合成 id 固定 22 字元。長度就對不上。
- 規則用 `^v_[a-z0-9]{20}$` 強制檢查，這是**安全必需而不是選配**。admin 本來
  就能往 `memberIds` 塞任意字串（`updatesTaskAsAdmin()` 沒有 `hasOnly`），
  如果建立路徑不驗格式，這條新規則就會變成「admin 可以偽造任何真實使用者的
  member 文件」的後門。

**為什麼同時要前綴和 `virtual` 欄位**：前綴是給規則用的（規則裡做不了跨文件
查詢，只能看 id 本身）；`virtual` 欄位是給 app 用的，兩個 codebase 都不必靠
解析字串前綴來判斷。

## 安全規則

規則檔只有兩處改動，也是整個功能唯一的風險點。

### 新增建立路徑

`match /tasks/{taskId}/members/{uid}` 現在的 `allow create` 開頭是
`isSelf(uid)` —— 只能建立自己的成員文件，所以建 `members/v_xxx` 一定被擋。

新增一個函式，與現有條件並聯：

```
function createsVirtualMember() {
  return isTaskAdmin(taskId)
    && uid.matches('^v_[a-z0-9]{20}$')
    && taskAfterData(taskId).status == "active"
    && uid in taskAfterData(taskId).memberIds
    && request.resource.data.uid == uid
    && request.resource.data.virtual == true
    && request.resource.data.active == true
    && request.resource.data.role == "member";
}
```

`allow create: if (現有的 isSelf 那一整串) || createsVirtualMember();`

用 `taskAfterData` 而不是 `taskData`，理由跟現有註解一樣：member 文件與 task
的 `memberIds` 在同一個 batch 裡寫。

### 收緊既有的管理路徑

`managesMemberAsAdmin()` 目前沒有 `hasOnly`，所以 admin 從那條路可以改 `role`、
`active`、`nickname`。虛擬成員要沿用它來改名與移除，但**不能被升成 admin**，
`virtual` 也不能被翻轉。加兩條：

```
&& request.resource.data.get("virtual", false) == resource.data.get("virtual", false)
&& (resource.data.get("virtual", false) == false
    || request.resource.data.role == "member")
```

用 `.get("virtual", false)` 是因為既有成員文件沒有這個欄位。

第一條擋住「把真實成員改成虛擬」與反向操作；第二條讓虛擬成員的角色只能是
`member`，但仍允許改 `active`（移除／復原）與 `nickname`（改名）。

### 不用改的

確認過都不用動：

- **`validNewParticipants()`** 只要求 `paidBy in memberIds` 與
  `splits.keys().hasOnly(memberIds)`。合成 id 進了 `memberIds` 就自動通過。
- **`updatesTaskAsAdmin()`** 沒有 `hasOnly`，admin 本來就能改 `memberIds`
  （現有的「移除成員」就是走這條）。加虛擬成員走同一條路。
- **付款規則**。見下一節。
- **支出的更新／刪除規則**。`canManageExpense()` 是 `createdBy` 或 `paidBy`
  等於自己，或是 admin。虛擬成員的支出由代記的人和 admin 管，語意正確。

## 付款確認

虛擬成員永遠不會來按「確認收到」，這是「沒有帳號」唯一會真正咬到人的地方。

**收虛擬成員的錢**（阿嬤欠小明）：小明是 `to`，現有規則的
`request.auth.uid == request.resource.data.to` 讓他能自己記錄，而且可以直接
記成 `confirmed`。**完全不用改。**

**付錢給虛擬成員**（小明欠阿嬤）：小明是 `from`，只能記成 `pending`；而確認
的權限是 `request.auth.uid == resource.data.to` —— 那是阿嬤。

**決議：由 admin 代為確認。** 現有規則的 `isTaskAdmin(taskId)` 已經涵蓋
（`allow update` 的 `request.auth.uid == resource.data.to || isTaskAdmin(taskId)`），
所以這個決議的規則改動是**零**。

語意也誠實：「有人替阿嬤確認收到了」，而不是「我說我付了就算數」。代價是每筆
都要 admin 多按一次；不做的話那筆付款會永遠卡在 pending，結算頁那句「有 N 筆
付款等待確認，還沒從下面的金額扣除」會永遠掛著，金額也永遠對不起來。

## 服務層

網頁版 `src/services/memberService.ts` 新增一個函式，形狀比照既有的
`joinTask()`（同一個 transaction 寫 member 文件與 task）：

```ts
export async function createVirtualMember(taskId: string, nickname: string): Promise<string>
```

- 產生合成 id
- `set` member 文件：`{ uid, nickname, role: "member", joinedAt, active: true, virtual: true }`
- `update` task：`memberIds: arrayUnion(id)`、`memberCount: increment(1)`、`updatedAt`
- 回傳合成 id

Flutter 的 `lib/data/task_repository.dart`（成員寫入目前在這裡）加對應的方法。

**改名與移除不寫新的**：改名走現有的 nickname 更新，移除走現有的
`removeMember()`（`active: false` + 移出 `memberIds`），行為與真實成員一致 ——
包括「被移除的成員仍留在原本的支出裡」，那是 `validEditedParticipants()`
已經處理好的。

**合成 id 的產生**是純函式，兩邊各一份、各自有測試：

```
generateVirtualMemberId() -> "v_" + 20 個 [a-z0-9] 隨機字元
```

## 介面

UI 細節這一輪不定案（配色與強調的整體調整另案處理），只定行為：

- 成員頁在 owner/admin 眼中多一個「新增虛擬成員」的入口，只填暱稱
- 成員列表要能一眼看出誰是虛擬成員
- 虛擬成員**不顯示**「升為管理員」——規則會擋，介面不該給出會失敗的選項
- 虛擬成員**照常顯示**改名與移除
- 兩個 codebase 都要改成員列（`src/components/member/MemberRow.vue`、
  `lib/ui/members_tab.dart`），因為兩邊讀同一個 Firestore，只改一邊會讓另一邊
  對虛擬成員給出無效操作

支出表單、結算頁、分類圖表**不必改** —— 它們拿的是成員清單，虛擬成員本來就在裡面。

## 測試

**純函式**（兩邊都有，沿用現有的測試方式）：

- `generateVirtualMemberId()` 產出符合 `^v_[a-z0-9]{20}$`
- 長度不等於 28，不可能撞到 Firebase uid
- 多次產生不重複

**規則測試**（`npm run test:rules`）：

- admin 可以建立合格的虛擬成員
- 一般 member **不能**建立
- id 不合格式（沒有 `v_`、長度不對、含大寫）被擋
- `virtual: false` 或缺欄位時走這條路被擋
- `role: "admin"` 被擋
- 不能把虛擬成員升成 admin
- 不能翻轉既有成員的 `virtual`
- 虛擬成員可以被改名、被移除
- 虛擬成員可以當 `paidBy`、可以在 `splits` 裡

**手動驗證**（repository 層沒有自動化測試，沿用既有做法）：建虛擬成員 → 記一筆
他付的支出 → 看結算有沒有把他算進去 → 記一筆付給他的款 → admin 確認 → 看金額
有沒有跟著動 → 移除他 → 確認舊支出仍查得到他的暱稱。

## 前置條件：規則測試要能跑

⚠️ **這是動工前要先解決的。**

這個功能的規則改動只有兩處，但它們同時是唯一的風險：寫錯的代價是
資料外洩或所有成員都建不進去。但 `todo.md` 記著本機跑不了規則測試
——firebase-tools 要 JDK 21，這台裝的是 11，而公司擋了 Microsoft Store 導致
winget 取不到來源。

`todo.md` 已經有「用 GitHub Actions 跑規則測試」這條待辦，理由寫得很清楚：
「規則會一直改，而規則出錯的代價是資料外洩或功能整個壞掉 —— 那正是最該有
自動化把關的地方」。

**建議把那條待辦當成這個功能的第一步做掉**，而不是先改規則再想辦法驗證。

## 未解的取捨

- **`memberCount` 要不要含虛擬成員**：本規格採「要」，因為他們確實參與分攤，
  而且這樣 `memberCount` 才等於 `memberIds.length`，與現有不變式一致。代價是
  任務卡上的「N 位成員」會包含打不開 App 的人。
- **同名虛擬成員**：不擋。真實成員本來也可以同名。
