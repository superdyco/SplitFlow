# 免登入立即試用 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓人不用 Google/Apple 帳號就能用（Firebase 匿名登入），之後可以綁定帳號；綁定的帳號已經有資料時，由雲端函式把訪客合併進去。

**Architecture:** 訪客是真的 Firebase 匿名帳號，rules 不用改。綁定走 `link*`，uid 不變。撞到已存在的帳號時，用戶端先拿訪客的 ID token，換到正式帳號，再呼叫 `mergeGuest` callable；函式把訪客 uid 改名成「一定沒人用過的 id」—— 正式帳號不在的任務改成正式帳號，兩個身分都在的任務改成算出來的虛擬成員。

**Tech Stack:** Vue 3 + Pinia + Firebase JS SDK 12（網頁）、Flutter + Riverpod 2 + FlutterFire（原生）、Cloud Functions v2 + firebase-admin（TypeScript, vitest）、`@firebase/rules-unit-testing`。

**Spec:** `docs/superpowers/specs/2026-09-10-guest-trial-design.md`

## Global Constraints

- 訪客的 `provider` 一律寫字串 `"anonymous"`；顯示名稱是「訪客」。
- 判斷訪客只看 `user.isAnonymous`，不比對 provider 字串。
- callable region 一律 `asia-east1`。
- 虛擬成員 id 格式 `^v_[a-z0-9]{20}$`（見 `src/utils/virtualMember.ts`）。
- 虛擬成員暱稱「<訪客暱稱>（訪客）」，總長不超過 20 字（暱稱最多取 16 字）。
- 所有 `createdBy` 合併後一律是正式帳號 A；其餘 uid 欄位換成「改寫目標」。
- 單一 Firestore batch 最多寫 450 筆（留餘裕，同 `memberService.ts`）。
- 敘述、註解、UI 文字用中文；commit message 用英文，照 repo 慣例，結尾加 `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`。
- 這台 PowerShell 下多行 commit message 用 `git commit -F <檔案>`（here-string 遇雙引號會壞）。各 Task 的 `git commit -F <msg>` 指的是：把該行註解裡的英文訊息，加上空一行與 `Co-Authored-By` 那一行，寫進 scratchpad 的暫存檔，再用 `-F` 指向它。
- 這台沒有 Dart。Flutter 的改動只能靠 CI（推 main 觸發）驗證，CI 綠之前不得宣稱 Flutter 測過。
- rules 測試要 JDK 21：在 Git Bash 先 `export JAVA_HOME="/c/Program Files/Android/openjdk/jdk-21.0.8"; export PATH="$JAVA_HOME/bin:$PATH"`。

## 與 spec 的一處差異

spec 第 5 節說手動驗證用 Auth + Firestore + Functions emulator。實際上 `firebase.json` 只設了 firestore/storage emulator，`src/firebase/config.ts` 也沒有連 emulator，所以手動驗證改在正式專案做（Task 11），前提是先在 Console 開啟匿名登入、部署函式。

## 順手修的既有問題

網頁版個人頁的登出按鈕在 commit `5857a86` 被拿掉了（`signOut()` 還在但沒有按鈕，而同一次改動的註解說登出要「有重量」）。訪客登出需要這個入口，Task 7 把它加回來。

## File Map

| 檔案 | 動作 | 責任 |
|---|---|---|
| `functions/src/guestMerge.ts` | 新增 | 合併的純函式：目標 id、每種文件怎麼改寫、身分檢查 |
| `functions/src/guestMerge.test.ts` | 新增 | 上面那支的 vitest |
| `functions/src/index.ts` | 修改 | `mergeGuest` callable：讀資料、照純函式的答案寫回 |
| `src/utils/guest.ts` | 新增 | `GUEST_PROVIDER_ID`、`providerIdOf`、`isGuest` |
| `src/utils/authError.ts` | 修改 | `anonymous` →「訪客」、`signedInAs` |
| `tests/guest.test.ts` | 新增 | |
| `tests/authError.test.ts` | 修改 | |
| `tests/firestore.rules.test.mjs` | 修改 | 訪客防回歸 |
| `src/services/authService.ts` | 修改 | `signInAsGuest`、`linkGuest`、`guestIdToken`、`switchToAccount` |
| `src/services/accountService.ts` | 修改 | 訪客跳過重新驗證、`mergeGuest` |
| `src/services/userService.ts` | 修改 | provider 用 `providerIdOf`、`updateProviderFields` |
| `src/stores/auth.ts` | 修改 | `refresh(user)` |
| `src/pages/LoginPage.vue`、`src/pages/JoinTaskPage.vue` | 修改 | 試用按鈕 |
| `src/pages/OnboardingPage.vue` | 修改 | 登入方式那一行 |
| `src/pages/ProfilePage.vue` | 修改 | 綁定、合併、重試、登出 |
| `src/components/auth/GuestBanner.vue` | 新增 | 任務列表頂端的提示條 |
| `src/pages/TaskListPage.vue` | 修改 | 放提示條 |
| `flutter_app/lib/domain/guest.dart` | 新增 | Dart 版 `providerIdOf` |
| `flutter_app/lib/domain/auth_error.dart` | 修改 | `anonymous` 標籤、`signedInAs` |
| `flutter_app/test/support_test.dart` | 修改 | |
| `flutter_app/lib/data/auth_repository.dart` | 修改 | 試用、綁定、合併、刪除 |
| `flutter_app/lib/state/pending_guest_merge.dart` | 新增 | 換帳號後還沒合併完成的訪客 token |
| `flutter_app/lib/ui/sign_in_page.dart`、`onboarding_page.dart`、`profile_page.dart`、`task_list_page.dart` | 修改 | UI |
| `todo.md` | 修改 | 這次不做的兩件事 |

---

### Task 1: 合併的純函式 `guestMerge.ts`

**Files:**
- Create: `functions/src/guestMerge.ts`
- Test: `functions/src/guestMerge.test.ts`

**Interfaces:**
- Produces（Task 2 使用）:
  - `GUEST_PROVIDER: "anonymous"`
  - `interface MergeIds { guest: string; account: string; target: string }`
  - `virtualIdFor(guest: string, taskId: string): string`
  - `mergeTarget(input: { guest: string; account: string; taskId: string; accountHasMember: boolean }): string`
  - `rewriteExpense(data: Data, ids: MergeIds): Data | null`
  - `rewritePayment(data: Data, ids: MergeIds): Data | null`
  - `rewriteSettlement(data: Data, ids: MergeIds): Data | null`
  - `rewriteTask(task: Data, ids: MergeIds): Data`
  - `accountRoleAfterMerge(guestRole: unknown, accountRole: unknown): Role | null`
  - `movedMember(guestMember: Data, input: { ids: MergeIds; guestNickname: string; accountNickname: string }): Data`
  - `checkMergeCaller(input: { callerUid: string; callerProvider: string | undefined; guestUid: string; guestProvider: string | undefined }): string | null`
  - `type Data = Record<string, unknown>`、`type Role = "owner" | "admin" | "member"`
  - `rewrite*` 回傳 **只有要改的欄位**（給 `update()` 用），沒有要改的就回 `null`。

- [ ] **Step 1: 寫失敗的測試**

`functions/src/guestMerge.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  accountRoleAfterMerge,
  checkMergeCaller,
  mergeTarget,
  movedMember,
  rewriteExpense,
  rewritePayment,
  rewriteSettlement,
  rewriteTask,
  virtualIdFor,
  type MergeIds
} from "./guestMerge.js";

const G = "uid_guest_000000000000000000";
const A = "uid_account_0000000000000000";
const B = "uid_friend_00000000000000000";
const V = virtualIdFor(G, "task1");

const toAccount: MergeIds = { guest: G, account: A, target: A };
const toVirtual: MergeIds = { guest: G, account: A, target: V };

describe("virtualIdFor", () => {
  it("符合虛擬成員的格式", () => {
    expect(V).toMatch(/^v_[a-z0-9]{20}$/);
  });

  it("同樣的訪客與任務一定算出同一個 id —— 重跑才不會分裂成兩個人", () => {
    expect(virtualIdFor(G, "task1")).toBe(V);
  });

  it("不同任務算出不同的 id", () => {
    expect(virtualIdFor(G, "task2")).not.toBe(V);
  });
});

describe("mergeTarget", () => {
  it("正式帳號不在這個任務裡，目標就是正式帳號", () => {
    expect(mergeTarget({ guest: G, account: A, taskId: "task1", accountHasMember: false })).toBe(A);
  });

  it("正式帳號有成員文件（包含曾經被移出），目標是虛擬成員", () => {
    expect(mergeTarget({ guest: G, account: A, taskId: "task1", accountHasMember: true })).toBe(V);
  });
});

describe("rewriteExpense", () => {
  const expense = {
    title: "晚餐",
    paidBy: G,
    createdBy: G,
    splits: { [G]: 300, [B]: 300 },
    splitMemberIds: [G, B]
  };

  it("付款人、分攤、舊欄位換成目標；createdBy 一律給正式帳號", () => {
    expect(rewriteExpense(expense, toVirtual)).toEqual({
      paidBy: V,
      createdBy: A,
      splits: { [V]: 300, [B]: 300 },
      splitMemberIds: [V, B]
    });
  });

  it("目標是正式帳號時全部換成正式帳號", () => {
    expect(rewriteExpense(expense, toAccount)).toEqual({
      paidBy: A,
      createdBy: A,
      splits: { [A]: 300, [B]: 300 },
      splitMemberIds: [A, B]
    });
  });

  it("跟訪客無關的支出不改", () => {
    expect(rewriteExpense({ paidBy: B, createdBy: B, splits: { [B]: 100 } }, toAccount)).toBeNull();
  });

  it("冪等：改過的再改一次沒有東西要改", () => {
    const once = { ...expense, ...rewriteExpense(expense, toVirtual) };
    expect(rewriteExpense(once, toVirtual)).toBeNull();
  });
});

describe("rewritePayment", () => {
  it("共同任務裡訪客付給正式帳號，改寫後是虛擬成員付給正式帳號 —— 仍然是兩個人", () => {
    const changes = rewritePayment({ from: G, to: A, createdBy: G, amount: 100 }, toVirtual);
    expect(changes).toEqual({ from: V, createdBy: A });
    expect(changes?.from).not.toBe(A);
  });

  it("收款方是訪客也要換", () => {
    expect(rewritePayment({ from: B, to: G, createdBy: B }, toAccount)).toEqual({ to: A });
  });

  it("無關的付款不改", () => {
    expect(rewritePayment({ from: B, to: A, createdBy: B }, toAccount)).toBeNull();
  });
});

describe("rewriteSettlement", () => {
  const snapshot = {
    balances: [
      { uid: G, paid: 600, owed: 300, balance: 300 },
      { uid: B, paid: 0, owed: 300, balance: -300 }
    ],
    transfers: [{ from: B, to: G, amount: 300 }],
    memberNames: { [G]: "小試", [B]: "阿明" },
    createdBy: G
  };

  it("balances、transfers、memberNames 的 key 都換掉", () => {
    expect(rewriteSettlement(snapshot, toVirtual)).toEqual({
      balances: [
        { uid: V, paid: 600, owed: 300, balance: 300 },
        { uid: B, paid: 0, owed: 300, balance: -300 }
      ],
      transfers: [{ from: B, to: V, amount: 300 }],
      memberNames: { [V]: "小試", [B]: "阿明" },
      createdBy: A
    });
  });

  it("冪等", () => {
    const once = { ...snapshot, ...rewriteSettlement(snapshot, toVirtual) };
    expect(rewriteSettlement(once, toVirtual)).toBeNull();
  });
});

describe("rewriteTask", () => {
  it("非共同任務：訪客的位置整個交給正式帳號，人數不動", () => {
    const task = { ownerId: G, adminIds: [G], memberIds: [G, B], createdBy: G, memberCount: 2 };
    expect(rewriteTask(task, toAccount)).toEqual({
      ownerId: A,
      adminIds: [A],
      memberIds: [A, B],
      createdBy: A
    });
  });

  it("共同任務裡訪客是 owner：owner 給正式帳號，虛擬成員不進 adminIds", () => {
    const task = { ownerId: G, adminIds: [G], memberIds: [G, A, B], createdBy: G };
    expect(rewriteTask(task, toVirtual)).toEqual({
      ownerId: A,
      adminIds: [A],
      memberIds: [V, A, B],
      createdBy: A
    });
  });

  it("共同任務裡訪客是一般成員：只換 memberIds", () => {
    const task = { ownerId: B, adminIds: [B], memberIds: [B, A, G], createdBy: B };
    expect(rewriteTask(task, toVirtual)).toEqual({ memberIds: [B, A, V] });
  });

  it("共同任務裡訪客是 admin、正式帳號已經是 admin：adminIds 不重複", () => {
    const task = { ownerId: B, adminIds: [B, G, A], memberIds: [B, G, A] };
    expect(rewriteTask(task, toVirtual)).toEqual({ adminIds: [B, A], memberIds: [B, V, A] });
  });
});

describe("accountRoleAfterMerge", () => {
  it("訪客是 owner，正式帳號接 owner", () => {
    expect(accountRoleAfterMerge("owner", "member")).toBe("owner");
  });

  it("訪客是 admin、正式帳號是一般成員，升成 admin", () => {
    expect(accountRoleAfterMerge("admin", "member")).toBe("admin");
  });

  it("訪客是一般成員，正式帳號角色不變", () => {
    expect(accountRoleAfterMerge("member", "member")).toBeNull();
  });

  it("正式帳號已經是 admin，不必再寫", () => {
    expect(accountRoleAfterMerge("admin", "admin")).toBeNull();
  });
});

describe("movedMember", () => {
  const guestMember = { uid: G, nickname: "小試", role: "owner", joinedAt: "T0", active: true };

  it("目標是正式帳號：角色與 joinedAt 保留，暱稱用正式帳號的", () => {
    expect(movedMember(guestMember, { ids: toAccount, guestNickname: "小試", accountNickname: "阿華" })).toEqual({
      uid: A,
      nickname: "阿華",
      role: "owner",
      joinedAt: "T0",
      active: true
    });
  });

  it("目標是虛擬成員：一般成員、標上 virtual、暱稱加（訪客）", () => {
    expect(movedMember(guestMember, { ids: toVirtual, guestNickname: "小試", accountNickname: "阿華" })).toEqual({
      uid: V,
      nickname: "小試（訪客）",
      role: "member",
      joinedAt: "T0",
      active: true,
      virtual: true
    });
  });

  it("虛擬成員的暱稱不超過 20 字", () => {
    const long = "一二三四五六七八九十一二三四五六七八九十";
    const moved = movedMember(guestMember, { ids: toVirtual, guestNickname: long, accountNickname: "" });
    expect(Array.from(moved.nickname as string)).toHaveLength(20);
    expect(moved.nickname).toMatch(/（訪客）$/);
  });
});

describe("checkMergeCaller", () => {
  const ok = { callerUid: A, callerProvider: "google.com", guestUid: G, guestProvider: "anonymous" };

  it("正式帳號合併訪客，放行", () => {
    expect(checkMergeCaller(ok)).toBeNull();
  });

  it("呼叫者自己是訪客，拒絕", () => {
    expect(checkMergeCaller({ ...ok, callerProvider: "anonymous" })).not.toBeNull();
  });

  it("被合併的不是訪客，拒絕 —— 正式帳號之間不能互相吞", () => {
    expect(checkMergeCaller({ ...ok, guestProvider: "google.com" })).not.toBeNull();
  });

  it("合併到自己，拒絕", () => {
    expect(checkMergeCaller({ ...ok, guestUid: A })).not.toBeNull();
  });
});
```

- [ ] **Step 2: 跑測試，確認失敗**

Run: `npm --prefix functions test -- guestMerge`
Expected: FAIL，`Cannot find module './guestMerge.js'`（或同義訊息）

- [ ] **Step 3: 寫實作**

`functions/src/guestMerge.ts`:

```ts
/**
 * 訪客合併進正式帳號時，每一份文件要怎麼改。
 *
 * 全部是純函式 —— 讀資料、寫回去是 `index.ts` 裡 `mergeGuest` 的事。
 *
 * **核心原則：改寫的目標 id 永遠沒人用過。** 合併麻煩的根源是「兩個身分疊成
 * 一個人」：分攤要加總、自己付給自己的付款要刪、角色要比大小。只要目標是空的，
 * 每個任務都只是「把 X 改名成 Y」：
 *
 *   - 正式帳號不在這個任務裡 → 目標是正式帳號
 *   - 兩個身分都在 → 目標是一個算出來的虛擬成員
 *
 * 唯一的例外是 `createdBy`：一律給正式帳號。它決定 `canManageExpense`，給虛擬
 * 成員的話本人就改不了自己當訪客時記的帳。
 */
import { createHash } from "node:crypto";

export const GUEST_PROVIDER = "anonymous";

export type Role = "owner" | "admin" | "member";
export type Data = Record<string, unknown>;

export interface MergeIds {
  /** 訪客的 uid。 */
  guest: string;
  /** 正式帳號的 uid。 */
  account: string;
  /** 這個任務裡訪客要改成的 id：正式帳號本人，或算出來的虛擬成員。 */
  target: string;
}

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const NICKNAME_MAX = 20;
const GUEST_SUFFIX = "（訪客）";

/**
 * 共同任務裡訪客變成的虛擬成員 id。
 *
 * **算出來而不是隨機產生**：合併改到一半失敗再跑一次時，要落在同一個 id 上。
 * 隨機的話第二次會生出另一個虛擬成員，同一個人的帳就分裂成兩份。
 *
 * 格式跟 `src/utils/virtualMember.ts` 一致（`v_` + 20 碼小寫英數）——
 * `firestore.rules` 靠長度把它跟真實 uid 分開。
 */
export function virtualIdFor(guest: string, taskId: string): string {
  const bytes = createHash("sha256").update(`${guest}:${taskId}`).digest();
  let id = "v_";
  for (let i = 0; i < 20; i += 1) id += ALPHABET[bytes[i] % ALPHABET.length];
  return id;
}

/**
 * 看的是**成員文件在不在**，不是 memberIds：正式帳號可能曾被移出這個任務，
 * 成員文件與舊帳目都還在，直接改成他會撞上。
 */
export function mergeTarget(input: {
  guest: string;
  account: string;
  taskId: string;
  accountHasMember: boolean;
}): string {
  return input.accountHasMember ? virtualIdFor(input.guest, input.taskId) : input.account;
}

function swapId(value: unknown, from: string, to: string): unknown {
  return value === from ? to : value;
}

function swapInList(list: unknown, from: string, to: string): unknown {
  if (!Array.isArray(list) || !list.includes(from)) return list;
  return [...new Set(list.map(item => (item === from ? to : item)))];
}

/** 目標照理不會已經在 map 裡；萬一在，加總而不是蓋掉 —— 蓋掉就是少算一筆錢。 */
function renameKey(map: unknown, from: string, to: string): unknown {
  if (!map || typeof map !== "object" || !(from in map)) return map;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(map as Record<string, unknown>)) {
    const name = key === from ? to : key;
    const existing = result[name];
    result[name] =
      typeof existing === "number" && typeof value === "number" ? existing + value : value;
  }
  return result;
}

/** 只留下真的變了的欄位。沒有就回 null，呼叫端就不必寫。 */
function changedFields(before: Data, after: Data): Data | null {
  const changes: Data = {};
  for (const [key, value] of Object.entries(after)) {
    if (JSON.stringify(value) !== JSON.stringify(before[key])) changes[key] = value;
  }
  return Object.keys(changes).length ? changes : null;
}

function pick(data: Data, keys: string[]): Data {
  const result: Data = {};
  for (const key of keys) if (key in data) result[key] = data[key];
  return result;
}

export function rewriteExpense(data: Data, ids: MergeIds): Data | null {
  const before = pick(data, ["paidBy", "createdBy", "splits", "splitMemberIds"]);
  const after: Data = { ...before };
  if ("paidBy" in before) after.paidBy = swapId(before.paidBy, ids.guest, ids.target);
  if ("createdBy" in before) after.createdBy = swapId(before.createdBy, ids.guest, ids.account);
  if ("splits" in before) after.splits = renameKey(before.splits, ids.guest, ids.target);
  if ("splitMemberIds" in before) {
    after.splitMemberIds = swapInList(before.splitMemberIds, ids.guest, ids.target);
  }
  return changedFields(before, after);
}

export function rewritePayment(data: Data, ids: MergeIds): Data | null {
  const before = pick(data, ["from", "to", "createdBy"]);
  const after: Data = { ...before };
  if ("from" in before) after.from = swapId(before.from, ids.guest, ids.target);
  if ("to" in before) after.to = swapId(before.to, ids.guest, ids.target);
  if ("createdBy" in before) after.createdBy = swapId(before.createdBy, ids.guest, ids.account);
  return changedFields(before, after);
}

export function rewriteSettlement(data: Data, ids: MergeIds): Data | null {
  const before = pick(data, ["balances", "transfers", "memberNames", "createdBy"]);
  const after: Data = { ...before };
  if (Array.isArray(before.balances)) {
    after.balances = before.balances.map(row =>
      row && typeof row === "object"
        ? { ...row, uid: swapId((row as Data).uid, ids.guest, ids.target) }
        : row
    );
  }
  if (Array.isArray(before.transfers)) {
    after.transfers = before.transfers.map(row =>
      row && typeof row === "object"
        ? {
            ...row,
            from: swapId((row as Data).from, ids.guest, ids.target),
            to: swapId((row as Data).to, ids.guest, ids.target)
          }
        : row
    );
  }
  if ("memberNames" in before) {
    after.memberNames = renameKey(before.memberNames, ids.guest, ids.target);
  }
  if ("createdBy" in before) after.createdBy = swapId(before.createdBy, ids.guest, ids.account);
  return changedFields(before, after);
}

/**
 * 任務文件。`memberCount` 不動 —— 這只是改名。
 *
 * 共同任務（目標是虛擬成員）裡，訪客**從 adminIds 拿掉**而不是換成虛擬成員：
 * 合成 id 在 adminIds 裡不會讓任何人拿到權限，只會讓畫面顯示一個永遠不生效的
 * 管理員。訪客原本是 owner 或 admin 的話，那個身分交給正式帳號。
 * owner 一定在 adminIds 裡（`createsOwnTask`），所以這條也涵蓋了 owner。
 */
export function rewriteTask(task: Data, ids: MergeIds): Data {
  const shared = ids.target !== ids.account;
  const before = pick(task, ["ownerId", "adminIds", "memberIds", "createdBy"]);
  const after: Data = { ...before };

  if ("ownerId" in before) after.ownerId = swapId(before.ownerId, ids.guest, ids.account);
  if ("createdBy" in before) after.createdBy = swapId(before.createdBy, ids.guest, ids.account);
  if ("memberIds" in before) after.memberIds = swapInList(before.memberIds, ids.guest, ids.target);

  const admins = before.adminIds;
  if (Array.isArray(admins) && admins.includes(ids.guest)) {
    after.adminIds = shared
      ? [...new Set([...admins.filter(id => id !== ids.guest), ids.account])]
      : swapInList(admins, ids.guest, ids.account);
  }

  return changedFields(before, after) ?? {};
}

/** 共同任務裡，正式帳號的角色要不要升。回 null 代表不必寫。 */
export function accountRoleAfterMerge(guestRole: unknown, accountRole: unknown): Role | null {
  if (guestRole === "owner" && accountRole !== "owner") return "owner";
  if (guestRole === "admin" && accountRole === "member") return "admin";
  return null;
}

function guestLabel(nickname: string): string {
  const name = Array.from(nickname.trim())
    .slice(0, NICKNAME_MAX - GUEST_SUFFIX.length)
    .join("");
  return name ? `${name}${GUEST_SUFFIX}` : "訪客";
}

/**
 * 訪客的成員文件搬到目標名下。**joinedAt 一定保留** —— 結算的餘數是照加入
 * 順序分的，換掉它那一塊錢就落到別人頭上。
 */
export function movedMember(
  guestMember: Data,
  input: { ids: MergeIds; guestNickname: string; accountNickname: string }
): Data {
  const { ids } = input;
  if (ids.target === ids.account) {
    return {
      ...guestMember,
      uid: ids.account,
      nickname: input.accountNickname || guestMember.nickname
    };
  }
  return {
    ...guestMember,
    uid: ids.target,
    nickname: guestLabel(input.guestNickname || String(guestMember.nickname ?? "")),
    role: "member",
    virtual: true
  };
}

/**
 * 誰可以把誰合併進來。回 null 代表放行，否則回給使用者看的原因。
 *
 * 只接受匿名來源：正式帳號之間永遠不能互相合併。呼叫者自己也不能是匿名 ——
 * 否則一個訪客就能把另一個訪客吞掉。
 */
export function checkMergeCaller(input: {
  callerUid: string;
  callerProvider: string | undefined;
  guestUid: string;
  guestProvider: string | undefined;
}): string | null {
  if (input.callerProvider === GUEST_PROVIDER) return "要合併進去的必須是正式帳號";
  if (input.guestProvider !== GUEST_PROVIDER) return "只有訪客身分可以合併";
  if (input.guestUid === input.callerUid) return "不能合併到自己";
  return null;
}
```

- [ ] **Step 4: 跑測試，確認通過**

Run: `npm --prefix functions test -- guestMerge`
Expected: PASS（全部）

- [ ] **Step 5: Commit**

```bash
git add functions/src/guestMerge.ts functions/src/guestMerge.test.ts
git commit -F <msg>   # "Work out how each document changes when a guest merges in"
```

---

### Task 2: `mergeGuest` callable

**Files:**
- Modify: `functions/src/index.ts`（import 區、檔案結尾新增 callable）

**Interfaces:**
- Consumes: Task 1 的全部 export。
- Produces（Task 6、9 使用）: callable `mergeGuest`，region `asia-east1`，參數 `{ guestToken: string }`，回傳 `{ mergedTasks: number; virtualizedTasks: number }`。錯誤碼：`unauthenticated`、`invalid-argument`、`permission-denied`、`aborted`（任務剛好在變動，重試即可）。

- [ ] **Step 1: 改 import**

`functions/src/index.ts` 第 15–16 行改成：

```ts
import { getAuth, type DecodedIdToken } from "firebase-admin/auth";
import { FieldValue, getFirestore, type WriteBatch } from "firebase-admin/firestore";
```

第 28 行（`import { canDeleteReceipt } from "./receipt.js";`）之後加：

```ts
import {
  accountRoleAfterMerge,
  checkMergeCaller,
  mergeTarget,
  movedMember,
  rewriteExpense,
  rewritePayment,
  rewriteSettlement,
  rewriteTask,
  type Data,
  type MergeIds
} from "./guestMerge.js";
```

- [ ] **Step 2: 在檔案結尾加上 callable**

```ts
/** 一個 batch 上限 500 筆，留 50 筆餘裕。 */
const CHUNK = 450;

type Write = (batch: WriteBatch) => void;

async function commitInChunks(writes: Write[]): Promise<void> {
  for (let i = 0; i < writes.length; i += CHUNK) {
    const batch = db.batch();
    for (const write of writes.slice(i, i + CHUNK)) write(batch);
    await batch.commit();
  }
}

const LEDGER_REWRITES = [
  ["expenses", rewriteExpense],
  ["payments", rewritePayment],
  ["settlements", rewriteSettlement]
] as const;

/**
 * 把訪客合併進正式帳號。規則見 `guestMerge.ts`，這裡只負責讀與寫。
 *
 * **身分從兩個地方來**：正式帳號 A 取自 auth context（呼叫者本人），訪客 G 取自
 * 參數裡的 ID token（驗過簽章）。只收 uid 的話，任何人都能宣稱某個訪客是自己，
 * 把別人的任務吞掉。
 *
 * **可以重跑**：每個任務先改帳目（冪等），最後才在同一個 transaction 裡搬成員
 * 文件、更新任務。任務更新前下一次查詢還找得到它，更新後就找不到。而「A 的
 * 成員文件在不在」只在最後一步才會變，所以重跑判斷出來的目標跟第一次一樣。
 *
 * Auth 放最後刪，理由跟 `deleteAccount` 一樣：中途失敗 G 還在，還能重試。
 */
export const mergeGuest = onCall({ region: REGION }, async request => {
  const account = request.auth?.uid;
  if (!account) throw new HttpsError("unauthenticated", "請先登入");

  const guestToken = request.data?.guestToken;
  if (typeof guestToken !== "string" || !guestToken) {
    throw new HttpsError("invalid-argument", "缺少訪客憑證");
  }

  let decoded: DecodedIdToken;
  try {
    decoded = await getAuth().verifyIdToken(guestToken, true);
  } catch (error) {
    // 簽章沒問題、只是帳號已經不在 —— 上一次其實已經合併完成（Auth 是最後才刪的）。
    const code = (error as { code?: string }).code;
    if (code === "auth/user-not-found") return { mergedTasks: 0, virtualizedTasks: 0 };
    throw new HttpsError("permission-denied", "訪客憑證無效或已過期，請重新綁定一次");
  }

  const refusal = checkMergeCaller({
    callerUid: account,
    callerProvider: request.auth?.token.firebase?.sign_in_provider,
    guestUid: decoded.uid,
    guestProvider: decoded.firebase?.sign_in_provider
  });
  if (refusal) throw new HttpsError("permission-denied", refusal);

  const guest = decoded.uid;
  const [guestProfile, accountProfile] = await Promise.all([
    db.doc(`users/${guest}`).get(),
    db.doc(`users/${account}`).get()
  ]);
  const guestNickname = (guestProfile.get("nickname") as string | undefined) ?? "";
  const accountNickname = (accountProfile.get("nickname") as string | undefined) ?? "";

  let mergedTasks = 0;
  let virtualizedTasks = 0;

  const tasks = await db.collection("tasks").where("memberIds", "array-contains", guest).get();

  for (const taskSnap of tasks.docs) {
    const taskRef = taskSnap.ref;
    const accountMemberRef = taskRef.collection("members").doc(account);
    const guestMemberRef = taskRef.collection("members").doc(guest);

    const accountMember = await accountMemberRef.get();
    const target = mergeTarget({
      guest,
      account,
      taskId: taskSnap.id,
      accountHasMember: accountMember.exists
    });
    const ids: MergeIds = { guest, account, target };

    // 第一步：帳目。冪等 —— 已經改過的文件 rewrite 回 null，不會再寫。
    const ledgerWrites: Write[] = [];
    for (const [name, rewrite] of LEDGER_REWRITES) {
      const snap = await taskRef.collection(name).get();
      for (const docSnap of snap.docs) {
        const changes = rewrite(docSnap.data(), ids);
        if (changes) ledgerWrites.push(batch => batch.update(docSnap.ref, changes));
      }
    }
    await commitInChunks(ledgerWrites);

    // 第二步：成員文件與任務，一起落地。用 transaction 重讀，免得蓋掉這段期間
    // 剛加入的人（memberIds 是整個陣列寫回去的）。
    await db.runTransaction(async tx => {
      const [freshTask, freshAccountMember, freshGuestMember] = await tx.getAll(
        taskRef,
        accountMemberRef,
        guestMemberRef
      );
      if (!(freshTask.get("memberIds") as string[] | undefined)?.includes(guest)) return;

      // 第一步之後正式帳號剛好加入或離開這個任務，帳目改的目標就不對了。
      // 丟 aborted 讓用戶端重試：重跑會用新的判斷把帳目補改一次。
      if (freshAccountMember.exists !== accountMember.exists) {
        throw new HttpsError("aborted", "這個任務剛好有變動，請再試一次");
      }

      if (freshGuestMember.exists) {
        tx.set(
          taskRef.collection("members").doc(target),
          movedMember(freshGuestMember.data() as Data, { ids, guestNickname, accountNickname })
        );
        tx.delete(guestMemberRef);
      }

      if (target !== account) {
        const role = accountRoleAfterMerge(
          freshGuestMember.get("role"),
          freshAccountMember.get("role")
        );
        if (role) tx.update(accountMemberRef, { role });
      }

      tx.update(taskRef, {
        ...rewriteTask(freshTask.data() as Data, ids),
        updatedAt: FieldValue.serverTimestamp()
      });
    });

    if (target === account) mergedTasks += 1;
    else virtualizedTasks += 1;
  }

  // 任務以外：邀請、收藏。
  const invites = await db.collection("invites").where("createdBy", "==", guest).get();
  await commitInChunks(
    invites.docs.map(docSnap => (batch: WriteBatch) => batch.update(docSnap.ref, { createdBy: account }))
  );

  const [guestFavorites, accountFavorites] = await Promise.all([
    db.collection(`users/${guest}/favorites`).get(),
    db.collection(`users/${account}/favorites`).get()
  ]);
  const owned = new Set(accountFavorites.docs.map(docSnap => docSnap.id));
  await commitInChunks(
    guestFavorites.docs
      .filter(docSnap => !owned.has(docSnap.id))
      .map(docSnap => (batch: WriteBatch) =>
        batch.set(db.doc(`users/${account}/favorites/${docSnap.id}`), docSnap.data())
      )
  );

  await db.recursiveDelete(db.collection(`users/${guest}/tokens`));
  await db.recursiveDelete(db.collection(`users/${guest}/favorites`));
  await db.doc(`users/${guest}`).delete();

  try {
    await getAuth().deleteUser(guest);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code !== "auth/user-not-found") throw error;
  }

  logger.info("訪客已合併", { guest, account, mergedTasks, virtualizedTasks });
  return { mergedTasks, virtualizedTasks };
});
```

- [ ] **Step 3: 編譯與測試**

Run: `npm --prefix functions run build`
Expected: 沒有錯誤（`lib/` 產出，型別過）

Run: `npm --prefix functions test`
Expected: 全部 PASS（既有的測試加上 Task 1 的）

- [ ] **Step 4: Commit**

```bash
git add functions/src/index.ts
git commit -F <msg>   # "Merge a guest into an existing account on the server"
```

---

### Task 3: 網頁版的訪客判斷與登入方式文字

**Files:**
- Create: `src/utils/guest.ts`
- Modify: `src/utils/authError.ts`（`PROVIDER_ID_LABELS`、新增 `signedInAs`）
- Test: `tests/guest.test.ts`（新增）、`tests/authError.test.ts`（修改）

**Interfaces:**
- Produces（Task 5–7 使用）:
  - `GUEST_PROVIDER_ID = "anonymous"`
  - `isGuest(user: { isAnonymous: boolean } | null | undefined): boolean`
  - `providerIdOf(user: { isAnonymous: boolean; providerData: { providerId: string }[] }): string`
  - `signedInAs(providerId: string, email: string | null | undefined): string`
  - `providerLabel("anonymous") === "訪客"`

- [ ] **Step 1: 寫失敗的測試**

`tests/guest.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { GUEST_PROVIDER_ID, isGuest, providerIdOf } from "@/utils/guest";

describe("isGuest", () => {
  it("匿名登入的是訪客", () => {
    expect(isGuest({ isAnonymous: true })).toBe(true);
  });

  it("正式帳號與沒登入都不是", () => {
    expect(isGuest({ isAnonymous: false })).toBe(false);
    expect(isGuest(null)).toBe(false);
    expect(isGuest(undefined)).toBe(false);
  });
});

describe("providerIdOf", () => {
  it("訪客寫 anonymous，不是 unknown —— 訪客的 providerData 是空的", () => {
    expect(providerIdOf({ isAnonymous: true, providerData: [] })).toBe(GUEST_PROVIDER_ID);
  });

  it("正式帳號取第一個供應商", () => {
    expect(providerIdOf({ isAnonymous: false, providerData: [{ providerId: "google.com" }] })).toBe(
      "google.com"
    );
  });

  it("綁定之後的帳號不再是訪客", () => {
    expect(providerIdOf({ isAnonymous: false, providerData: [{ providerId: "apple.com" }] })).toBe(
      "apple.com"
    );
  });

  it("什麼都沒有時是 unknown，跟原本的行為一樣", () => {
    expect(providerIdOf({ isAnonymous: false, providerData: [] })).toBe("unknown");
  });
});
```

`tests/authError.test.ts`：import 清單加上 `signedInAs`，並在 `describe("providerLabel", …)` 裡加一條、檔案結尾加一組：

```ts
  it("訪客顯示成「訪客」", () => {
    expect(providerLabel("anonymous")).toBe("訪客");
  });
```

```ts
describe("signedInAs", () => {
  it("照實際的登入方式講，不是一律 Google", () => {
    expect(signedInAs("apple.com", "a@b.c")).toBe("已用 Apple 登入 · a@b.c");
    expect(signedInAs("google.com", "a@b.c")).toBe("已用 Google 登入 · a@b.c");
  });

  it("沒有 email 就不要留一個空的點", () => {
    expect(signedInAs("apple.com", "")).toBe("已用 Apple 登入");
  });

  it("訪客講清楚是訪客，也告訴他之後可以綁定", () => {
    expect(signedInAs("anonymous", null)).toBe("訪客模式 · 之後可以在個人設定綁定帳號");
  });
});
```

- [ ] **Step 2: 跑測試，確認失敗**

Run: `npx vitest run tests/guest.test.ts tests/authError.test.ts`
Expected: FAIL（`@/utils/guest` 找不到、`signedInAs` 不是函式、`providerLabel("anonymous")` 回 `"anonymous"`）

- [ ] **Step 3: 寫實作**

`src/utils/guest.ts`:

```ts
/**
 * 訪客（Firebase 匿名登入）的判斷。刻意不 import firebase，測試可以直接跑。
 *
 * 判斷一律看 `isAnonymous`，不比對 provider 字串 —— 綁定帳號之後同一個 User
 * 的 isAnonymous 會變成 false，那才是「他還是不是訪客」的唯一來源。
 */
export const GUEST_PROVIDER_ID = "anonymous";

export function isGuest(user: { isAnonymous: boolean } | null | undefined): boolean {
  return !!user?.isAnonymous;
}

/**
 * 寫進 `users/{uid}.provider` 的值。
 *
 * 訪客的 providerData 是空的，不特別處理的話會寫成 "unknown"，後台與個人頁
 * 就說不出這個人是訪客。
 */
export function providerIdOf(user: {
  isAnonymous: boolean;
  providerData: { providerId: string }[];
}): string {
  if (user.isAnonymous) return GUEST_PROVIDER_ID;
  return user.providerData[0]?.providerId || "unknown";
}
```

`src/utils/authError.ts`：
- 檔案最上面（第 4 行的註解之後）加 `import { GUEST_PROVIDER_ID } from "@/utils/guest";`
- `PROVIDER_ID_LABELS` 加一行 `anonymous: "訪客",`（放在 `password` 之前）
- `providerLabel` 之後加：

```ts
/**
 * 取暱稱頁那一行「你是用什麼登入的」。
 *
 * 原本寫死「已用 Google 登入」，用 Apple 登入的人也看到 Google。訪客沒有 email，
 * 也不該假裝用了任何一家。
 */
export function signedInAs(providerId: string, email: string | null | undefined): string {
  if (providerId === GUEST_PROVIDER_ID) return "訪客模式 · 之後可以在個人設定綁定帳號";
  const label = providerLabel(providerId);
  return email ? `已用 ${label} 登入 · ${email}` : `已用 ${label} 登入`;
}
```

- [ ] **Step 4: 跑測試，確認通過**

Run: `npx vitest run tests/guest.test.ts tests/authError.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/guest.ts src/utils/authError.ts tests/guest.test.ts tests/authError.test.ts
git commit -F <msg>   # "Know a guest when we see one, and stop saying everyone used Google"
```

---

### Task 4: rules 對訪客的防回歸測試

**Files:**
- Modify: `tests/firestore.rules.test.mjs`（插在 `main()` 結尾的 `await testEnv.cleanup();` 之前）

**Interfaces:**
- Consumes: 檔案裡既有的 `test`、`seed`、`seedProfile`、`newExpense`、`as`、`TASK`、`writeBatch`、`setDoc`、`updateDoc`、`getDoc`、`doc`、`serverTimestamp`、`assertSucceeds`、`assertFails`。
- Produces: 無。

rules 沒有改，所以這幾條**一寫完就會過**，不是 TDD 的紅燈。它們的價值是往後：哪天有人在 rules 加了排除匿名登入的條件，這裡會先響。

- [ ] **Step 1: 加測試**

在 `  await testEnv.cleanup();` 那一行之前插入：

```js
  // ---------------------------------------------------------------- 訪客（匿名登入）

  /*
    rules 沒有為訪客改任何一行。這幾條是防回歸：訪客的 request.auth 不是 null、
    有自己的 uid，現有的規則對他都該照常成立。哪天有人加了
    `sign_in_provider != "anonymous"` 之類的條件，這裡會先響。
  */
  const GUEST = "uid_guest";

  function asGuest() {
    return testEnv
      .authenticatedContext(GUEST, { firebase: { sign_in_provider: "anonymous" } })
      .firestore();
  }

  function guestTask(overrides = {}) {
    return {
      name: "試用的旅程",
      ownerId: GUEST,
      adminIds: [GUEST],
      memberIds: [GUEST],
      defaultCurrency: "TWD",
      startDate: null,
      endDate: null,
      status: "active",
      inviteCode: "guestcode",
      memberCount: 1,
      expenseCount: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      ...overrides
    };
  }

  await test("訪客可以建立自己的個人檔案", async () => {
    await testEnv.clearFirestore();
    await assertSucceeds(
      setDoc(doc(asGuest(), "users", GUEST), {
        uid: GUEST,
        nickname: "小試",
        email: "",
        photoURL: null,
        provider: "anonymous",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      })
    );
  });

  await test("訪客可以建立任務", async () => {
    await testEnv.clearFirestore();
    const db = asGuest();
    const batch = writeBatch(db);
    batch.set(doc(db, "tasks", "guestTask"), guestTask());
    batch.set(doc(db, "tasks", "guestTask", "members", GUEST), {
      uid: GUEST,
      nickname: "小試",
      role: "owner",
      joinedAt: serverTimestamp(),
      active: true
    });
    await assertSucceeds(batch.commit());
  });

  await test("訪客可以在自己的任務裡記帳", async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), "tasks", "guestTask"), guestTask());
    });
    await assertSucceeds(
      setDoc(
        doc(asGuest(), "tasks", "guestTask", "expenses", "e1"),
        newExpense({ paidBy: GUEST, splits: { [GUEST]: 25000 }, createdBy: GUEST })
      )
    );
  });

  await test("不是成員的訪客讀不到別人的任務", async () => {
    await seed();
    await assertFails(getDoc(doc(asGuest(), "tasks", TASK)));
  });

  // 綁定帳號之後 uid 不變，前端會把 provider、email、photoURL 補上。
  await test("綁定之後可以補上登入方式與 email", async () => {
    await seedProfile(GUEST);
    await assertSucceeds(
      updateDoc(doc(as(GUEST), "users", GUEST), {
        provider: "google.com",
        email: "guest@example.com",
        photoURL: null,
        updatedAt: serverTimestamp()
      })
    );
  });
```

- [ ] **Step 2: 跑 rules 測試**

在 Git Bash：

```bash
export JAVA_HOME="/c/Program Files/Android/openjdk/jdk-21.0.8"
export PATH="$JAVA_HOME/bin:$PATH"
cd "D:/Project/分帳系統" && npm run test:rules
```

Expected: 新的五條都印 `ok`，結尾 `0 failed`。

- [ ] **Step 3: Commit**

```bash
git add tests/firestore.rules.test.mjs
git commit -F <msg>   # "Pin down that the rules treat a guest like anyone else signed in"
```

---

### Task 5: 網頁版的試用入口

**Files:**
- Modify: `src/services/authService.ts`（新增 `signInAsGuest`）
- Modify: `src/services/userService.ts:35`（provider 改用 `providerIdOf`）
- Modify: `src/pages/LoginPage.vue`
- Modify: `src/pages/JoinTaskPage.vue:115`
- Modify: `src/pages/OnboardingPage.vue:60`

**Interfaces:**
- Consumes: Task 3 的 `providerIdOf`、`signedInAs`。
- Produces（Task 6 使用）: `signInAsGuest(): Promise<User>`（authService）。

這一段都是畫面接線，沒有新的純邏輯可以單元測試（純邏輯在 Task 3 已經測過）。驗證靠型別檢查、既有測試，以及 Task 11 的手動流程。

- [ ] **Step 1: `authService.ts` 加 `signInAsGuest`**

import 清單（第 2–12 行）加上 `signInAnonymously`。在 `signIn` 之後加：

```ts
/**
 * 免登入試用。拿到的是一個真的匿名帳號 —— 建任務、記帳、加入別人的任務都跟
 * 正式帳號一樣，rules 不必為它開任何例外。
 *
 * 沒有彈窗，所以 iOS PWA 上彈窗被擋、跨來源 iframe 暖機那一串問題，訪客都不會遇到。
 */
export async function signInAsGuest(): Promise<User> {
  try {
    const credential = await signInAnonymously(auth);
    return credential.user;
  } catch (err) {
    if (err instanceof FirebaseError && err.code === "auth/operation-not-allowed") {
      throw new Error("免登入試用還沒有在 Firebase Console 啟用。");
    }
    throw err;
  }
}
```

- [ ] **Step 2: `userService.ts` 的 provider**

第 1–4 行的 import 之後加 `import { providerIdOf } from "@/utils/guest";`，第 35 行改成：

```ts
    provider: providerIdOf(user),
```

- [ ] **Step 3: 登入頁加試用按鈕**

`src/pages/LoginPage.vue`：import 改成 `import { SignInCancelled, signIn, signInAsGuest, type SignInProvider } from "@/services/authService";`，在 `login` 之後加：

```ts
const guestPending = ref(false);

/** 訪客一定還沒有暱稱，直接去取暱稱頁，原本要去的地方跟著帶過去。 */
async function tryAsGuest() {
  guestPending.value = true;
  error.value = null;
  try {
    await signInAsGuest();
    const redirect = typeof route.query.redirect === "string" ? decodeURIComponent(route.query.redirect) : "/tasks";
    await router.push(`/onboarding?redirect=${encodeURIComponent(redirect)}`);
  } catch (err) {
    error.value = firebaseErrorMessage(err);
  } finally {
    guestPending.value = false;
  }
}
```

template 裡 `<ProviderButtons … />` 之後、`<p class="tiny">同一個 email…` 之前插入：

```html
      <button class="btn btn-block" :disabled="guestPending || pending !== null" @click="tryAsGuest">
        {{ guestPending ? "準備中..." : "免登入立即試用" }}
      </button>
      <p class="tiny">試用的資料先存在這台裝置，之後可以在個人設定綁定帳號。</p>
```

- [ ] **Step 4: 邀請頁加試用按鈕**

`src/pages/JoinTaskPage.vue`：import 改成 `import { SignInCancelled, signIn, signInAsGuest, type SignInProvider } from "@/services/authService";`，在 `login` 之後加：

```ts
const guestPending = ref(false);

/**
 * 被朋友拉進來的人最不想先登入 —— 這顆按鈕就是為他做的。
 * 訪客一定還沒有暱稱：取完暱稱會回到這一頁，再按「加入這個任務」。
 */
async function joinAsGuest() {
  guestPending.value = true;
  error.value = null;
  try {
    await signInAsGuest();
    await router.push(`/onboarding?redirect=${encodeURIComponent(route.fullPath)}`);
  } catch (err) {
    error.value = firebaseErrorMessage(err);
  } finally {
    guestPending.value = false;
  }
}
```

template 第 115 行

```html
        <ProviderButtons v-if="!authStore.user" :pending="pending" action="登入" @select="login" />
```

換成（`v-if` / `v-else-if` / `v-else` 的鏈不能斷，所以包成 `<template v-if>`）：

```html
        <template v-if="!authStore.user">
          <ProviderButtons :pending="pending" action="登入" @select="login" />
          <button class="btn btn-block" :disabled="guestPending || pending !== null" @click="joinAsGuest">
            {{ guestPending ? "準備中..." : "免登入，直接加入" }}
          </button>
        </template>
```

- [ ] **Step 5: 取暱稱頁的登入方式**

`src/pages/OnboardingPage.vue`：import 區加

```ts
import { signedInAs } from "@/utils/authError";
import { providerIdOf } from "@/utils/guest";
```

`canSubmit` 之後加：

```ts
const signedInLabel = computed(() =>
  authStore.user ? signedInAs(providerIdOf(authStore.user), authStore.user.email) : ""
);
```

第 60 行換成：

```html
      <p class="tiny">{{ signedInLabel }}</p>
```

- [ ] **Step 6: 型別檢查與測試**

Run: `npx vue-tsc --noEmit`
Expected: 沒有錯誤

Run: `npm test`
Expected: 全部 PASS

- [ ] **Step 7: Commit**

```bash
git add src/services/authService.ts src/services/userService.ts src/pages/LoginPage.vue src/pages/JoinTaskPage.vue src/pages/OnboardingPage.vue
git commit -F <msg>   # "Let people try the web app without signing in"
```

---

### Task 6: 網頁版的綁定與合併

**Files:**
- Modify: `src/services/authService.ts`（`linkGuest`、`guestIdToken`、`switchToAccount`）
- Modify: `src/services/accountService.ts`（新增 `mergeGuest`）
- Modify: `src/services/userService.ts`（新增 `updateProviderFields`）
- Modify: `src/stores/auth.ts`（新增 `refresh`）
- Modify: `src/pages/ProfilePage.vue`
- Create: `src/components/auth/GuestBanner.vue`
- Modify: `src/pages/TaskListPage.vue`

**Interfaces:**
- Consumes: Task 2 的 callable `mergeGuest`；Task 3 的 `isGuest`、`providerIdOf`；Task 5 的 `signInAsGuest` 所在的 authService。
- Produces（Task 7 使用）: ProfilePage 裡的 `guest` computed（`isGuest(authStore.user)`），以及：
  - `linkGuest(name: SignInProvider): Promise<LinkResult>`，`LinkResult = { kind: "linked"; user: User } | { kind: "taken"; credential: AuthCredential }`
  - `guestIdToken(): Promise<string>`
  - `switchToAccount(credential: AuthCredential): Promise<User>`
  - `mergeGuest(guestToken: string): Promise<{ mergedTasks: number; virtualizedTasks: number }>`
  - `updateProviderFields(user: User): Promise<void>`
  - `authStore.refresh(user: User | null): void`

**順序是這個功能最容易寫錯的地方**：訪客的 ID token 一定要在 `switchToAccount` **之前**拿，換過去之後就再也拿不到了。而 `switchToAccount` 成功之後才把 token 存進 `pendingGuestToken` —— 換帳號失敗時使用者還是訪客，留著 token 讓他按「重試合併」會變成訪客呼叫合併，被函式拒絕。

- [ ] **Step 1: `authService.ts` 的綁定三件事**

import 清單加上 `linkWithPopup`、`signInWithCredential`、`type AuthCredential`。在 `signInAsGuest` 之後加：

```ts
export type LinkResult =
  | { kind: "linked"; user: User }
  | { kind: "taken"; credential: AuthCredential };

function credentialFromError(name: SignInProvider, err: FirebaseError): AuthCredential | null {
  if (name === "google") return GoogleAuthProvider.credentialFromError(err);
  if (name === "facebook") return FacebookAuthProvider.credentialFromError(err);
  return OAuthProvider.credentialFromError(err);
}

/**
 * 訪客綁定正式帳號。成功的話 **uid 不變**，所有任務原封不動。
 *
 * 那個帳號以前就登入過（`credential-already-in-use`）時，把它的 credential
 * 交回去，由畫面問使用者要不要合併 —— 兩個 uid 沒辦法在用戶端合在一起。
 */
export async function linkGuest(name: SignInProvider): Promise<LinkResult> {
  const user = auth.currentUser;
  if (!user?.isAnonymous) throw new Error("只有訪客需要綁定帳號");
  try {
    const result = await linkWithPopup(user, buildProvider(name));
    return { kind: "linked", user: result.user };
  } catch (err) {
    if (err instanceof FirebaseError && err.code === "auth/credential-already-in-use") {
      const credential = credentialFromError(name, err);
      if (credential) return { kind: "taken", credential };
    }
    throw await toSignInError(err, name);
  }
}

/** 訪客的證明。**要在 switchToAccount 之前拿** —— 換過去之後就拿不到了。 */
export async function guestIdToken(): Promise<string> {
  const user = auth.currentUser;
  if (!user?.isAnonymous) throw new Error("目前不是訪客");
  return user.getIdToken();
}

/** 換成那個已經存在的帳號。 */
export async function switchToAccount(credential: AuthCredential): Promise<User> {
  const result = await signInWithCredential(auth, credential);
  return result.user;
}
```

- [ ] **Step 2: `accountService.ts` 的 `mergeGuest`**

檔案結尾加：

```ts
export interface MergeResult {
  mergedTasks: number;
  virtualizedTasks: number;
}

/**
 * 把訪客合併進目前登入的正式帳號。真正的改寫在雲端函式（`functions/src/index.ts`）。
 *
 * 函式可以重跑：失敗時畫面留著 token 讓使用者重試，一小時內有效。
 */
export async function mergeGuest(guestToken: string): Promise<MergeResult> {
  const call = httpsCallable<{ guestToken: string }, MergeResult>(
    getFunctions(app, "asia-east1"),
    "mergeGuest"
  );
  return (await call({ guestToken })).data;
}
```

- [ ] **Step 3: `userService.ts` 的 `updateProviderFields`**

檔案結尾加：

```ts
/**
 * 訪客綁定帳號之後，把登入方式、email、頭像補上。暱稱不動 —— 那是使用者自己取的。
 * 這四個欄位都在 rules 的 users update 允許清單裡。
 */
export async function updateProviderFields(user: User): Promise<void> {
  await updateDoc(doc(db, "users", user.uid), {
    email: user.email || "",
    photoURL: user.photoURL || null,
    provider: providerIdOf(user),
    updatedAt: serverTimestamp()
  });
}
```

- [ ] **Step 4: `stores/auth.ts` 的 `refresh`**

`actions` 裡 `init()` 之後加：

```ts
    /**
     * 綁定帳號之後 uid 不變，onAuthStateChanged 不會再響 —— 但 isAnonymous 與
     * providerData 已經變了。先放 null 再放回去，讓看著它的畫面重算一次。
     */
    refresh(user: User | null) {
      this.user = null;
      this.user = user;
    }
```

- [ ] **Step 5: 個人頁的 script**

`src/pages/ProfilePage.vue`：

第 7 行換成：

```ts
import {
  SignInCancelled,
  guestIdToken,
  linkGuest,
  logout,
  providerLabel,
  switchToAccount,
  type SignInProvider
} from "@/services/authService";
```

第 17 行換成 `import { deleteOwnAccount, mergeGuest } from "@/services/accountService";`，並在 import 區加：

```ts
import type { AuthCredential } from "firebase/auth";
import ProviderButtons from "@/components/auth/ProviderButtons.vue";
import { updateProviderFields } from "@/services/userService";
import { isGuest, providerIdOf } from "@/utils/guest";
```

第 35–39 行的 `loginMethod` 換成（訪客的 providerData 是空的，原本那行會落到 profile 裡的舊值）：

```ts
/** 有三種登入方式，記得自己是用哪一個進來的很重要，換一個就是另一個帳號。 */
const loginMethod = computed(() => {
  const id = authStore.user ? providerIdOf(authStore.user) : userStore.profile?.provider;
  return id ? providerLabel(id) : "";
});
const guest = computed(() => isGuest(authStore.user));
```

`</script>` 之前加：

```ts
const linking = ref<SignInProvider | null>(null);
const linkError = ref<string | null>(null);
/** 那個帳號已經有資料時，等使用者決定要不要合併。 */
const takenCredential = ref<AuthCredential | null>(null);
/**
 * 已經換到正式帳號、但合併還沒完成時留著的訪客證明。一小時內有效。
 * 這時使用者已經不是訪客了，所以重試區塊不能放在「只有訪客看得到」的卡片裡。
 */
const pendingGuestToken = ref<string | null>(null);
const merging = ref(false);

const mergeMessage = computed(
  () =>
    `要把訪客的 ${tasks.value.length} 個任務合併進去嗎？合併後這台裝置會改用那個帳號，訪客身分會消失。` +
    "如果那個帳號也在同一個任務裡，訪客記的帳會變成一位「（訪客）」成員，金額不變。"
);

async function bind(provider: SignInProvider) {
  linking.value = provider;
  linkError.value = null;
  try {
    const result = await linkGuest(provider);
    if (result.kind === "taken") {
      takenCredential.value = result.credential;
      return;
    }
    await updateProviderFields(result.user);
    authStore.refresh(result.user);
    await userStore.load(result.user.uid);
  } catch (err) {
    if (!(err instanceof SignInCancelled)) linkError.value = firebaseErrorMessage(err);
  } finally {
    linking.value = null;
  }
}

async function finishMerge() {
  const token = pendingGuestToken.value;
  if (!token) return;
  try {
    await mergeGuest(token);
    pendingGuestToken.value = null;
    userStore.clear();
    await router.push("/tasks");
  } catch (err) {
    linkError.value = `合併沒有完成：${firebaseErrorMessage(err)}`;
  }
}

async function mergeIntoTaken() {
  const credential = takenCredential.value;
  takenCredential.value = null;
  if (!credential) return;
  merging.value = true;
  linkError.value = null;
  try {
    // 順序不能換：換到正式帳號之後就再也拿不到訪客的證明了。
    const token = await guestIdToken();
    await switchToAccount(credential);
    // 換成功才留著 —— 換失敗時他還是訪客，拿這串 token 重試會被函式拒絕。
    pendingGuestToken.value = token;
    await finishMerge();
  } catch (err) {
    linkError.value = firebaseErrorMessage(err);
  } finally {
    merging.value = false;
  }
}

async function retryMerge() {
  merging.value = true;
  linkError.value = null;
  try {
    await finishMerge();
  } finally {
    merging.value = false;
  }
}
```

- [ ] **Step 6: 個人頁的 template**

第 203–206 行的電子郵件列加上 `v-if="!guest"`：

```html
        <div v-if="!guest" class="spread">
          <span class="muted">電子郵件</span>
          <strong>{{ authStore.user?.email || "未提供" }}</strong>
        </div>
```

帳號卡片結尾的 `</div>`（第 211 行，緊接在「登入方式」那一列之後）之後插入：

```html
      <!--
        綁定放在帳號卡片正下方：對訪客來說這是這一頁最重要的事，比改暱稱還重要 ——
        忘了做的後果是資料永久遺失。
      -->
      <div v-if="guest" class="card flat stack">
        <h2 class="card-head">綁定帳號</h2>
        <p class="tiny">
          你目前是訪客，資料只存在這台裝置 —— 清除瀏覽器資料就找不回來。綁定之後，任務都會留著。
        </p>
        <ProviderButtons :pending="linking" action="綁定" @select="bind" />
      </div>

      <div v-if="pendingGuestToken" class="card flat stack">
        <h2 class="card-head">合併沒有完成</h2>
        <p class="tiny">你已經換到正式帳號了，但訪客的任務還沒搬過來。一小時內都可以重試。</p>
        <button class="btn btn-primary btn-block" :disabled="merging" @click="retryMerge">
          {{ merging ? "合併中..." : "重試合併" }}
        </button>
      </div>

      <ErrorState v-if="guest || pendingGuestToken" :message="linkError" />
```

檔案裡既有的 `<ConfirmDialog …刪除帳號… />` 之後加：

```html
      <ConfirmDialog
        :open="takenCredential !== null"
        title="這個帳號已經有資料"
        :message="mergeMessage"
        confirm-label="合併"
        @confirm="mergeIntoTaken"
        @cancel="takenCredential = null"
      />
```

- [ ] **Step 7: 任務列表的提示條**

`src/components/auth/GuestBanner.vue`:

```vue
<script setup lang="ts">
/**
 * 訪客才看得到的提示條。**不能關掉**：忘了綁定的後果是資料永久遺失，
 * 而提示條只要綁定成功就會自己消失。
 *
 * 綁定本身在個人頁做，這裡只負責把人帶過去 —— 綁定與合併的流程只寫一份。
 */
import { RouterLink } from "vue-router";
</script>

<template>
  <div class="card flat guest-banner">
    <p class="tiny">目前是訪客，資料只存在這台裝置。綁定帳號才不會遺失。</p>
    <RouterLink to="/profile" class="btn btn-primary">綁定</RouterLink>
  </div>
</template>

<style scoped>
.guest-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.guest-banner p {
  margin: 0;
}
</style>
```

`src/pages/TaskListPage.vue`：import 區加

```ts
import GuestBanner from "@/components/auth/GuestBanner.vue";
import { isGuest } from "@/utils/guest";
```

template 裡標題列那個 `<div class="spread">…</div>`（第 319–325 行）之後插入：

```html
      <GuestBanner v-if="isGuest(authStore.user)" />
```

（`authStore` 已在第 27 行宣告。）

- [ ] **Step 8: 型別檢查、測試、建置**

Run: `npx vue-tsc --noEmit`
Expected: 沒有錯誤

Run: `npm test`
Expected: 全部 PASS

Run: `npm run build`
Expected: 成功，`check-chunks` 沒有報錯（`firebase/functions` 本來就是 `accountService` 在用，不會多出新的首屏 chunk）

- [ ] **Step 9: Commit**

```bash
git add src/services/authService.ts src/services/accountService.ts src/services/userService.ts src/stores/auth.ts src/pages/ProfilePage.vue src/components/auth/GuestBanner.vue src/pages/TaskListPage.vue
git commit -F <msg>   # "Let a web guest bind an account, or merge into one that already exists"
```

---

### Task 7: 網頁版的登出與刪除帳號

**Files:**
- Modify: `src/services/accountService.ts:17-32`（`deleteOwnAccount`）
- Modify: `src/pages/ProfilePage.vue`（加回登出按鈕、訪客登出的確認）

**Interfaces:**
- Consumes: Task 6 在 ProfilePage 裡加的 `guest` computed；檔案裡既有的 `signOut()`、`error`、`ConfirmDialog`、`deleteOwnAccount`、`firebaseErrorMessage`。
- Produces: 無。

- [ ] **Step 1: 訪客刪除帳號時跳過重新驗證**

`src/services/accountService.ts` 的 `deleteOwnAccount` 換成：

```ts
export async function deleteOwnAccount(): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error("請先登入");

  // 訪客沒有任何憑證可以重新驗證 —— 他的「帳號」就是這台裝置上的這份登入狀態。
  // 不擋的話 providerData 是空的，會落到 Google，跳出一個跟他無關的 Google 視窗。
  if (!user.isAnonymous) {
    const providerId = user.providerData[0]?.providerId ?? "google.com";
    const provider =
      providerId === "apple.com" ? new OAuthProvider("apple.com") : new GoogleAuthProvider();
    await reauthenticateWithPopup(user, provider);
  }

  // region 要跟函式一致，不然會打到 us-central1 然後找不到函式。
  const call = httpsCallable(getFunctions(app, "asia-east1"), "deleteAccount");
  await call();

  await signOut(auth);
}
```

- [ ] **Step 2: 個人頁的 script**

`src/pages/ProfilePage.vue` 既有的 `signOut()`（第 119–123 行）之後加：

```ts
const confirmingGuestSignOut = ref(false);

/** 訪客登出就是永久離開，所以先問一次；正式帳號照舊直接登出。 */
function askSignOut() {
  if (guest.value) confirmingGuestSignOut.value = true;
  else void signOut();
}

/**
 * 訪客的登出＝刪除訪客帳號。他沒有任何方式能再登入回來，與其留一個再也不會
 * 出現的成員掛在別人的任務裡，不如走 deleteAccount：owner 身分移交、只有他
 * 一個真人的任務刪掉、別人的任務裡標成已刪除。
 *
 * 錯誤放在儲存鈕旁邊的 error，不放 advancedError —— 進階區可能是收著的，
 * 使用者會按了登出、什麼都沒發生、也不知道為什麼。
 */
async function guestSignOut() {
  confirmingGuestSignOut.value = false;
  error.value = null;
  try {
    await deleteOwnAccount();
    userStore.clear();
    await router.push("/login");
  } catch (err) {
    error.value = firebaseErrorMessage(err);
  }
}
```

- [ ] **Step 3: 加回登出按鈕**

template 裡緊接在「儲存變更」那顆按鈕（`<button class="btn btn-primary btn-block" :disabled="loading || !canSubmit" @click="save">…</button>`）之後、`<!-- 收藏與探索自成一張卡` 那段註解之前，插入：

```html
      <!--
        commit 5857a86 整理這一頁時把這顆按鈕弄丟了 —— signOut() 還在，按鈕沒了，
        而同一次改動的註解說的是「讓上面的暱稱與登出有重量」。
      -->
      <button class="btn btn-danger btn-block" @click="askSignOut">登出</button>
```

檔案裡最後一個 `<ConfirmDialog … />`（Task 6 加的合併確認）之後加：

```html
      <ConfirmDialog
        :open="confirmingGuestSignOut"
        title="訪客登出後就回不來了"
        message="訪客沒有帳號可以再登入回來。登出會刪除這個訪客身分：只有你一個人的任務會一起刪掉，別人的任務裡你會顯示為已刪除。想留著資料，請先在上面綁定帳號。"
        confirm-label="仍要登出"
        danger
        @confirm="guestSignOut"
        @cancel="confirmingGuestSignOut = false"
      />
```

- [ ] **Step 4: 型別檢查與測試**

Run: `npx vue-tsc --noEmit`
Expected: 沒有錯誤

Run: `npm test`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/accountService.ts src/pages/ProfilePage.vue
git commit -F <msg>   # "Bring back the web sign-out button, and make a guest's sign-out a deletion"
```

---

### Task 8: Flutter 的訪客判斷與登入方式文字

**Files:**
- Create: `flutter_app/lib/domain/guest.dart`
- Modify: `flutter_app/lib/domain/auth_error.dart`（`providerIdLabels`、新增 `signedInAs`）
- Test: `flutter_app/test/support_test.dart`

**Interfaces:**
- Produces（Task 9、10 使用）:
  - `const String guestProviderId = 'anonymous'`
  - `String providerIdOf({required bool isAnonymous, required List<String> providerIds})`
  - `String signedInAs(String providerId, String? email)`（在 `auth_error.dart`）
  - `providerLabel('anonymous') == '訪客'`

這一層是純 Dart（domain 層的慣例，見 `auth_error.dart` 開頭的說明），不能 import Flutter 或 Firebase —— 呼叫端把 `user.isAnonymous` 與 providerId 清單傳進來。行為跟 Task 3 的網頁版一字不差。

**這台沒有 Dart**：Step 2 與 Step 4 的「跑測試」只能在 CI 做（Task 11 推 main 之後）。寫完先照著網頁版的測試逐條對一次字串，確認兩邊一致。

- [ ] **Step 1: 寫測試**

`flutter_app/test/support_test.dart` 的 import 區加：

```dart
import 'package:splitflow/domain/guest.dart';
```

在 `  group('成員顯示名稱', () {` 那一行之前插入：

```dart
  group('訪客', () {
    test('訪客寫 anonymous，不是 unknown —— 訪客的 providerData 是空的', () {
      expect(
        providerIdOf(isAnonymous: true, providerIds: const []),
        guestProviderId,
      );
    });

    test('正式帳號取第一個供應商', () {
      expect(
        providerIdOf(isAnonymous: false, providerIds: const ['google.com']),
        'google.com',
      );
    });

    test('什麼都沒有時是 unknown，跟原本的行為一樣', () {
      expect(
        providerIdOf(isAnonymous: false, providerIds: const []),
        'unknown',
      );
    });

    test('訪客顯示成「訪客」', () {
      expect(providerLabel('anonymous'), '訪客');
    });

    test('signedInAs 照實際的登入方式講，不是一律 Google', () {
      expect(signedInAs('apple.com', 'a@b.c'), '已用 Apple 登入 · a@b.c');
      expect(signedInAs('google.com', 'a@b.c'), '已用 Google 登入 · a@b.c');
    });

    test('signedInAs 沒有 email 就不要留一個空的點', () {
      expect(signedInAs('apple.com', ''), '已用 Apple 登入');
      expect(signedInAs('apple.com', null), '已用 Apple 登入');
    });

    test('signedInAs 對訪客講清楚是訪客，也告訴他之後可以綁定', () {
      expect(signedInAs('anonymous', null), '訪客模式 · 之後可以在個人設定綁定帳號');
    });
  });

```

- [ ] **Step 2: （CI）確認失敗**

本機無法執行。CI 上的預期：編譯失敗，`guest.dart` 找不到、`signedInAs` 未定義。

- [ ] **Step 3: 寫實作**

`flutter_app/lib/domain/guest.dart`:

```dart
/// 訪客（Firebase 匿名登入）的判斷。`src/utils/guest.ts` 的 Dart 版。
///
/// 刻意不 import Firebase：CI 跑的是 `dart test` 而不是 `flutter test`，
/// 這一層要保持純 Dart。呼叫端把 `user.isAnonymous` 與 providerId 清單傳進來。
///
/// 判斷一律看 `isAnonymous`，不比對 provider 字串 —— 綁定帳號之後同一個 User
/// 的 isAnonymous 會變成 false，那才是「他還是不是訪客」的唯一來源。
library;

const String guestProviderId = 'anonymous';

/// 寫進 `users/{uid}.provider` 的值。
///
/// 訪客的 providerData 是空的，不特別處理的話會寫成 'unknown'，後台與個人頁
/// 就說不出這個人是訪客。
String providerIdOf({
  required bool isAnonymous,
  required List<String> providerIds,
}) {
  if (isAnonymous) return guestProviderId;
  return providerIds.isEmpty ? 'unknown' : providerIds.first;
}
```

`flutter_app/lib/domain/auth_error.dart`：
- `library;` 之後加 `import 'guest.dart';`
- `providerIdLabels` 在 `'password'` 之前加一行 `'anonymous': '訪客',`
- `providerLabel` 之後加：

```dart
/// 取暱稱頁那一行「你是用什麼登入的」。
///
/// 原本寫死「已用 Google 登入」，用 Apple 登入的人也看到 Google。訪客沒有
/// email，也不該假裝用了任何一家。
String signedInAs(String providerId, String? email) {
  if (providerId == guestProviderId) return '訪客模式 · 之後可以在個人設定綁定帳號';
  final label = providerLabel(providerId);
  return (email == null || email.isEmpty)
      ? '已用 $label 登入'
      : '已用 $label 登入 · $email';
}
```

- [ ] **Step 4: （CI）確認通過**

本機無法執行。CI 上的預期：`support_test.dart` 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add flutter_app/lib/domain/guest.dart flutter_app/lib/domain/auth_error.dart flutter_app/test/support_test.dart
git commit -F <msg>   # "Teach the Flutter app to tell a guest from an account"
```

---

### Task 9: Flutter 的資料層（試用、綁定、合併、刪除）

**Files:**
- Modify: `flutter_app/lib/data/auth_repository.dart`
- Create: `flutter_app/lib/state/pending_guest_merge.dart`

**Interfaces:**
- Consumes: Task 2 的 callable `mergeGuest`；Task 8 的 `providerIdOf`。
- Produces（Task 10 使用）:
  - `sealed class LinkOutcome`、`class Linked extends LinkOutcome { final User user; }`、`class AccountTaken extends LinkOutcome { final AuthCredential credential; }`
  - `AuthRepository.signInAsGuest(): Future<User>`
  - `AuthRepository.linkWithGoogle(): Future<LinkOutcome>`、`linkWithApple(): Future<LinkOutcome>`
  - `AuthRepository.guestIdToken(): Future<String>`
  - `AuthRepository.switchToAccount(AuthCredential credential): Future<User>`
  - `AuthRepository.mergeGuest(String guestToken): Future<void>`
  - `UserRepository.updateProviderFields(User user): Future<void>`
  - `class PendingGuestMerge { final String guestToken; final String? error; }`
  - `final pendingGuestMergeProvider = StateProvider<PendingGuestMerge?>`
  - `Future<bool> runGuestMerge(AuthRepository repo, StateController<PendingGuestMerge?> pending, String guestToken)`

資料層直接呼叫 Firebase SDK，沒有可以在 `flutter test` 裡單獨跑的純邏輯（純邏輯在 Task 8）。驗證靠 CI 的 `dart analyze` 與 `flutter build ios`，以及 Task 11 的實機流程。

**為什麼要有 `pendingGuestMergeProvider`**：換到正式帳號的那一刻 `authStateChanges` 會響，`userProfileProvider` 重算，個人頁整個重建 —— State 裡的東西會跟著消失，而訪客的 token 是重試唯一的依據。所以它放在 provider，不放在個人頁的 State。

- [ ] **Step 1: import 與 `LinkOutcome`**

`auth_repository.dart` 的 import 區加 `import '../domain/guest.dart';`。在 `class SignInCancelled …` 之後加：

```dart
/// 訪客綁定帳號的結果。
///
/// 那個帳號以前就登入過時不是錯誤，而是另一種結果：畫面要問使用者要不要合併。
sealed class LinkOutcome {
  const LinkOutcome();
}

/// 綁定成功，uid 不變。
class Linked extends LinkOutcome {
  final User user;
  const Linked(this.user);
}

/// 那個帳號已經有資料。拿著它的 credential，由畫面決定要不要合併過去。
class AccountTaken extends LinkOutcome {
  final AuthCredential credential;
  const AccountTaken(this.credential);
}

String _providerIdOfUser(User user) => providerIdOf(
      isAnonymous: user.isAnonymous,
      providerIds: user.providerData.map((info) => info.providerId).toList(),
    );
```

- [ ] **Step 2: 試用與綁定**

`AuthRepository` 裡 `signInWithApple` 之後加：

```dart
  /// 免登入試用。拿到的是一個真的匿名帳號 —— 建任務、記帳、加入別人的任務
  /// 都跟正式帳號一樣，rules 不必為它開任何例外。
  Future<User> signInAsGuest() async {
    try {
      final result = await _auth.signInAnonymously();
      final user = result.user;
      if (user == null) throw Exception('登入成功但沒有拿到使用者資料');
      return user;
    } on FirebaseAuthException catch (err) {
      if (err.code == 'operation-not-allowed') {
        throw Exception('免登入試用還沒有在 Firebase Console 啟用。');
      }
      rethrow;
    }
  }

  User _requireGuest() {
    final user = _auth.currentUser;
    if (user == null || !user.isAnonymous) throw Exception('只有訪客需要綁定帳號');
    return user;
  }

  /// 綁定失敗時的訊息。同一個 email 已經用別的方式註冊過，跟登入時是同一句話。
  Exception _linkError(FirebaseAuthException err, domain.SignInProvider provider) {
    if (domain.isCancelledSignIn(err.code)) return const SignInCancelled();
    if (err.code == 'email-already-in-use' ||
        err.code == 'account-exists-with-different-credential') {
      return Exception(domain.existingAccountMessage(err.email ?? '', const []));
    }
    final message = domain.describeSignInError(err.code, provider, err.message ?? err.code);
    return Exception(message ?? err.code);
  }

  /// 訪客綁定 Google。成功的話 **uid 不變**，所有任務原封不動。
  ///
  /// Google 的 credential 是自己用帳號選擇器拿到的，撞到已存在的帳號時手上
  /// 本來就有，不必靠錯誤物件帶回來（有帶就用帶回來的）。
  Future<LinkOutcome> linkWithGoogle() async {
    final user = _requireGuest();
    try {
      await _ensureInitialized();
      final account = await GoogleSignIn.instance.authenticate();
      final credential = GoogleAuthProvider.credential(
        idToken: account.authentication.idToken,
      );
      try {
        final result = await user.linkWithCredential(credential);
        return Linked(result.user ?? user);
      } on FirebaseAuthException catch (err) {
        if (err.code == 'credential-already-in-use') {
          return AccountTaken(err.credential ?? credential);
        }
        rethrow;
      }
    } on GoogleSignInException catch (err) {
      if (err.code == GoogleSignInExceptionCode.canceled) {
        throw const SignInCancelled();
      }
      rethrow;
    } on FirebaseAuthException catch (err) {
      throw _linkError(err, domain.SignInProvider.google);
    }
  }

  /// 訪客綁定 Apple。撞到已存在的帳號時，credential 只能從錯誤物件拿。
  Future<LinkOutcome> linkWithApple() async {
    final user = _requireGuest();
    try {
      final provider = AppleAuthProvider()
        ..addScope('email')
        ..addScope('name');
      final result = await user.linkWithProvider(provider);
      return Linked(result.user ?? user);
    } on FirebaseAuthException catch (err) {
      final credential = err.credential;
      if (err.code == 'credential-already-in-use' && credential != null) {
        return AccountTaken(credential);
      }
      throw _linkError(err, domain.SignInProvider.apple);
    }
  }

  /// 訪客的證明。**要在 switchToAccount 之前拿** —— 換過去之後就拿不到了。
  Future<String> guestIdToken() async {
    final token = await _requireGuest().getIdToken();
    if (token == null) throw Exception('拿不到訪客憑證');
    return token;
  }

  /// 換成那個已經存在的帳號。
  Future<User> switchToAccount(AuthCredential credential) async {
    final result = await _auth.signInWithCredential(credential);
    final user = result.user;
    if (user == null) throw Exception('登入成功但沒有拿到使用者資料');
    return user;
  }

  /// 把訪客合併進目前登入的正式帳號。真正的改寫在雲端函式裡，可以重跑。
  Future<void> mergeGuest(String guestToken) async {
    // region 要跟函式一致，不然會打到 us-central1 然後找不到函式。
    await FirebaseFunctions.instanceFor(region: 'asia-east1')
        .httpsCallable('mergeGuest')
        .call<void>({'guestToken': guestToken});
  }
```

- [ ] **Step 3: 刪除帳號時訪客跳過重新驗證**

把 `deleteAccount()` 整支換成下面兩支（重新驗證原封不動搬進 `_reauthenticate`）：

```dart
  /// 刪除自己的帳號。App Store 指引 5.1.1(v) 要求 App 內就能發起。
  ///
  /// 真正的刪除全在雲端函式裡（`functions/src/index.ts`）。現行規則下成員刪不掉
  /// 自己的成員文件，也改不了 `ownerId` —— 要在這裡做就得為一輩子用一次的操作
  /// 永久開兩個洞，而且跑到一半斷線會停在沒有人收拾得了的半刪除狀態。
  ///
  /// 訪客跳過重新驗證：他沒有任何憑證可以驗，他的「帳號」就是這台手機上的這份
  /// 登入狀態。不擋的話 providerData 是空的，會落到 Google，跳出一個跟他無關的
  /// 帳號選擇器。訪客的登出也走這裡（見個人頁）。
  Future<void> deleteAccount() async {
    final user = _auth.currentUser;
    if (user == null) throw Exception('請先登入');

    final guest = user.isAnonymous;
    if (!guest) await _reauthenticate(user);

    // region 要跟函式一致，不然會打到 us-central1 然後找不到函式。
    await FirebaseFunctions.instanceFor(region: 'asia-east1')
        .httpsCallable('deleteAccount')
        .call<void>();

    // 訪客從沒碰過 GoogleSignIn，沒有東西要登出。
    if (!guest) await GoogleSignIn.instance.signOut();
    await _auth.signOut();
  }

  /// 重新驗證不是形式：這個操作不可逆，而拿到一支沒鎖的手機的人不該能刪掉別人
  /// 的帳號。改由伺服器端刪除雖然技術上不受 `user.delete()` 的 recent-login
  /// 限制，但保護的理由沒變。
  Future<void> _reauthenticate(User user) async {
    final providerId = user.providerData.isEmpty
        ? 'google.com'
        : user.providerData.first.providerId;

    try {
      if (providerId == 'apple.com') {
        await user.reauthenticateWithProvider(AppleAuthProvider());
      } else {
        await _ensureInitialized();
        final account = await GoogleSignIn.instance.authenticate();
        await user.reauthenticateWithCredential(
          GoogleAuthProvider.credential(idToken: account.authentication.idToken),
        );
      }
    } on GoogleSignInException catch (err) {
      if (err.code == GoogleSignInExceptionCode.canceled) {
        throw const SignInCancelled();
      }
      rethrow;
    } on FirebaseAuthException catch (err) {
      if (domain.isCancelledSignIn(err.code)) throw const SignInCancelled();
      rethrow;
    }
  }
```

- [ ] **Step 4: `UserRepository`**

`createProfile` 裡 `'provider': …` 那三行換成：

```dart
      'provider': _providerIdOfUser(user),
```

`updateNickname` 之後加：

```dart
  /// 訪客綁定帳號之後，把登入方式、email、頭像補上。暱稱不動 —— 那是使用者
  /// 自己取的。這四個欄位都在 rules 的 users update 允許清單裡。
  Future<void> updateProviderFields(User user) {
    return usersRef.doc(user.uid).update({
      'email': user.email ?? '',
      'photoURL': user.photoURL,
      'provider': _providerIdOfUser(user),
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }
```

- [ ] **Step 5: `pending_guest_merge.dart`**

`flutter_app/lib/state/pending_guest_merge.dart`:

```dart
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/auth_repository.dart';

/// 已經換到正式帳號、但合併還沒完成的訪客證明。一小時內有效。
///
/// 放在 provider 而不是個人頁的 State：換帳號的那一刻 authStateChanges 會響，
/// 個人頁整個重建，State 裡的東西會跟著消失 —— 而這串 token 是重試唯一的依據。
/// 跟 `pending_invite.dart` 是同一個理由：流程中途畫面會換掉，東西不能跟著丟。
class PendingGuestMerge {
  final String guestToken;

  /// 上一次失敗的原因。null 代表還在跑或還沒跑過。
  final String? error;

  const PendingGuestMerge(this.guestToken, {this.error});
}

final pendingGuestMergeProvider =
    StateProvider<PendingGuestMerge?>((ref) => null);

/// 跑一次合併。成功回 true 並清掉 pending；失敗留著 token 與原因，給畫面顯示重試。
///
/// 收 repository 與 controller 而不是 ref：呼叫端在換帳號之前就要把它們拿好，
/// 換過去之後那個 widget 可能已經被丟掉，ref 不能再用。
Future<bool> runGuestMerge(
  AuthRepository repo,
  StateController<PendingGuestMerge?> pending,
  String guestToken,
) async {
  pending.state = PendingGuestMerge(guestToken);
  try {
    await repo.mergeGuest(guestToken);
    pending.state = null;
    return true;
  } catch (err) {
    pending.state = PendingGuestMerge(guestToken, error: '合併沒有完成：$err');
    return false;
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add flutter_app/lib/data/auth_repository.dart flutter_app/lib/state/pending_guest_merge.dart
git commit -F <msg>   # "Give the Flutter app guest sign-in, binding and merging"
```

（`dart analyze` 在 CI 跑。本機沒有 Dart，這一步之後不要宣稱編譯過。）

---

### Task 10: Flutter 的畫面

**Files:**
- Modify: `flutter_app/lib/ui/sign_in_page.dart`
- Modify: `flutter_app/lib/ui/onboarding_page.dart`
- Modify: `flutter_app/lib/ui/profile_page.dart`
- Modify: `flutter_app/lib/ui/task_list_page.dart`

**Interfaces:**
- Consumes: Task 8 的 `providerIdOf`、`signedInAs`；Task 9 的 `signInAsGuest`、`linkWithGoogle`、`linkWithApple`、`Linked`、`AccountTaken`、`guestIdToken`、`switchToAccount`、`updateProviderFields`、`pendingGuestMergeProvider`、`runGuestMerge`；既有的 `showConfirmDialog`、`LedgerCard`、`LedgerStrip`、`LedgerRow`、`LedgerDivider`、`AppColors`、`AppSpace`。
- Produces: 無。

Flutter 不需要另外處理邀請頁：點邀請連結時邀請碼先存在 `pendingInviteCodeProvider`，`_Root` 顯示登入頁；按試用、取完暱稱之後 `TaskListPage` 會消費它，照樣開加入頁。

- [ ] **Step 1: 登入頁的試用按鈕**

`sign_in_page.dart` 的 `_SignInPageState`：`_busy` 之後加 `bool _guestBusy = false;`，`_signIn` 之後加：

```dart
  Future<void> _tryAsGuest() async {
    setState(() {
      _guestBusy = true;
      _error = null;
    });
    try {
      await ref.read(authRepositoryProvider).signInAsGuest();
      // 不必導頁：_Root 看到登入狀態變了，會自己換成取暱稱頁。
    } catch (err) {
      if (mounted) setState(() => _error = err.toString());
    } finally {
      if (mounted) setState(() => _guestBusy = false);
    }
  }
```

`_ProviderButton` 的 `onPressed` 改成（試用進行中也不能按）：

```dart
                    onPressed: (_busy == null && !_guestBusy)
                        ? () => _signIn(provider)
                        : null,
```

provider 按鈕的 `for` 迴圈之後、`if (_error != null)` 之前插入：

```dart
                OutlinedButton(
                  onPressed: (_busy == null && !_guestBusy) ? _tryAsGuest : null,
                  child: Text(_guestBusy ? '準備中...' : '免登入立即試用'),
                ),
                const SizedBox(height: 4),
                Text(
                  '試用的資料先存在這台手機，之後可以在個人設定綁定帳號。',
                  style: text.bodySmall,
                ),
                const SizedBox(height: 12),
```

- [ ] **Step 2: 取暱稱頁**

`onboarding_page.dart` 的 import 區加：

```dart
import '../domain/auth_error.dart' show signedInAs;
import '../domain/guest.dart';
```

第 146–147 行的 `Text('已用 Google 登入 · ${widget.user.email ?? ''}', …)` 換成：

```dart
            Text(
              signedInAs(
                providerIdOf(
                  isAnonymous: widget.user.isAnonymous,
                  providerIds: widget.user.providerData
                      .map((info) => info.providerId)
                      .toList(),
                ),
                widget.user.email,
              ),
              style: text.bodySmall,
            ),
```

`_save` 之後加：

```dart
  /// 沒有「跳過」，但要有出路：登錯帳號的人不該被關在這一頁。
  ///
  /// 訪客走刪除而不是登出：登出之後這個匿名帳號就再也回不來，留著只是一筆永遠
  /// 不會被用到的帳號。走到這一頁的訪客還沒有暱稱，不可能建過或加入過任何任務，
  /// 刪掉不會影響任何人。
  Future<void> _leave() async {
    final auth = ref.read(authRepositoryProvider);
    try {
      if (widget.user.isAnonymous) {
        await auth.deleteAccount();
      } else {
        await auth.signOut(
          onBeforeSignOut: () =>
              ref.read(pushRepositoryProvider).removeToken(widget.user.uid),
        );
      }
    } catch (err) {
      if (mounted) setState(() => _error = err.toString());
    }
  }
```

最下面那顆 `TextButton`（第 160–169 行，含它上面那行註解）換成：

```dart
            TextButton(
              onPressed: _saving ? null : _leave,
              child: Text(widget.user.isAnonymous ? '改用帳號登入' : '用別的帳號登入'),
            ),
```

- [ ] **Step 3: 個人頁的 State 與方法**

`profile_page.dart` 的 import 區加：

```dart
import 'package:firebase_auth/firebase_auth.dart' show AuthCredential;
// defaultTargetPlatform 在 foundation，material 不轉出它。
import 'package:flutter/foundation.dart';

import '../state/pending_guest_merge.dart';
```

`_FormState` 的欄位（`String? _error;` 之後）加：

```dart
  auth.SignInProvider? _linking;
  bool _merging = false;
```

`_deleteAccount` 之後加：

```dart
  Future<void> _bind(auth.SignInProvider provider) async {
    setState(() {
      _linking = provider;
      _error = null;
    });
    try {
      final repo = ref.read(authRepositoryProvider);
      final outcome = provider == auth.SignInProvider.apple
          ? await repo.linkWithApple()
          : await repo.linkWithGoogle();
      switch (outcome) {
        case Linked(:final user):
          await ref.read(userRepositoryProvider).updateProviderFields(user);
          // uid 沒變，authStateChanges 不會再響 —— 手動作廢，畫面才看得到
          // isAnonymous 已經變了。
          ref.invalidate(authStateProvider);
          ref.invalidate(userProfileProvider);
        case AccountTaken(:final credential):
          await _offerMerge(credential);
      }
    } on SignInCancelled {
      // 自己取消不是錯誤。
    } catch (err) {
      if (mounted) setState(() => _error = err.toString());
    } finally {
      if (mounted) setState(() => _linking = null);
    }
  }

  Future<void> _offerMerge(AuthCredential credential) async {
    final tasks = ref.read(tasksProvider).value ?? const <Task>[];
    final ok = await showConfirmDialog(
      context,
      title: '這個帳號已經有資料',
      message: '要把訪客的 ${tasks.length} 個任務合併進去嗎？'
          '合併後這台手機會改用那個帳號，訪客身分會消失。'
          '如果那個帳號也在同一個任務裡，訪客記的帳會變成一位「（訪客）」成員，金額不變。',
      confirmLabel: '合併',
    );
    if (!ok || !mounted) return;

    // 換帳號的那一刻 authStateChanges 會響，這一頁整個重建、這個 State 會被丟掉 ——
    // 之後要用的東西全部先拿好，await 之後不能再 ref.read。
    final repo = ref.read(authRepositoryProvider);
    final pending = ref.read(pendingGuestMergeProvider.notifier);
    final navigator = Navigator.of(context);

    setState(() => _merging = true);
    try {
      // 順序不能換：換到正式帳號之後就再也拿不到訪客的證明了。
      final token = await repo.guestIdToken();
      await repo.switchToAccount(credential);
      if (await runGuestMerge(repo, pending, token)) {
        navigator.popUntil((route) => route.isFirst);
      }
    } catch (err) {
      if (mounted) setState(() => _error = err.toString());
    } finally {
      if (mounted) setState(() => _merging = false);
    }
  }

  Future<void> _retryMerge(String guestToken) async {
    final repo = ref.read(authRepositoryProvider);
    final pending = ref.read(pendingGuestMergeProvider.notifier);
    final navigator = Navigator.of(context);

    setState(() => _merging = true);
    final ok = await runGuestMerge(repo, pending, guestToken);
    if (mounted) setState(() => _merging = false);
    if (ok) navigator.popUntil((route) => route.isFirst);
  }

  /// 訪客的登出＝刪除訪客帳號。他沒有任何方式能再登入回來，與其留一個再也不會
  /// 出現的成員掛在別人的任務裡，不如走 deleteAccount：owner 身分移交、只有他
  /// 一個真人的任務刪掉、別人的任務裡標成已刪除。
  Future<void> _guestSignOut() async {
    final confirmed = await showConfirmDialog(
      context,
      title: '訪客登出後就回不來了',
      message: '訪客沒有帳號可以再登入回來。登出會刪除這個訪客身分：'
          '只有你一個人的任務會一起刪掉，別人的任務裡你會顯示為已刪除。'
          '想留著資料，請先在上面綁定帳號。',
      confirmLabel: '仍要登出',
      destructive: true,
    );
    if (!confirmed || !mounted) return;

    final navigator = Navigator.of(context);
    try {
      await ref.read(authRepositoryProvider).deleteAccount();
      navigator.pop();
    } catch (err) {
      if (mounted) setState(() => _error = err.toString());
    }
  }
```

- [ ] **Step 4: 個人頁的 build**

`build` 裡 `final user = …;` 之後加：

```dart
    final guest = user?.isAnonymous ?? false;
    final pendingMerge = ref.watch(pendingGuestMergeProvider);
```

電子郵件那一列與它下面的分隔線（第 237–241 行）換成：

```dart
            if (!guest) ...[
              LedgerRow(
                title: '電子郵件',
                trailing: Text(user?.email ?? '未提供', style: text.bodyMedium),
              ),
              const LedgerDivider(),
            ],
```

帳號卡片之後的提示文字（第 251–255 行，「下次請用同一種方式登入…」）換成：

```dart
        if (!guest) ...[
          const SizedBox(height: 12),
          Text(
            '下次請用同一種方式登入。換一個供應商會被視為另一個帳號，看不到現在的任務。',
            style: text.bodySmall,
          ),
        ],
        if (guest) ...[
          const SizedBox(height: 20),
          LedgerCard(
            children: [
              const LedgerStrip(title: '綁定帳號'),
              Padding(
                padding: const EdgeInsets.all(AppSpace.x4),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      '你目前是訪客，資料只存在這台手機 —— 刪掉 App 就找不回來。'
                      '綁定之後，任務都會留著。',
                      style: text.bodySmall,
                    ),
                    const SizedBox(height: AppSpace.x3),
                    for (final provider in auth.enabledProvidersFor(
                      isApplePlatform: defaultTargetPlatform == TargetPlatform.iOS,
                    )) ...[
                      OutlinedButton(
                        onPressed: (_linking == null && !_merging)
                            ? () => _bind(provider)
                            : null,
                        child: Text(
                          _linking == provider
                              ? '${auth.providerLabels[provider]} 綁定中...'
                              : '使用 ${auth.providerLabels[provider]} 綁定',
                        ),
                      ),
                      const SizedBox(height: AppSpace.x2),
                    ],
                  ],
                ),
              ),
            ],
          ),
        ],
        // 不看 guest：走到這裡時使用者已經換成正式帳號了。
        if (pendingMerge != null) ...[
          const SizedBox(height: 20),
          LedgerCard(
            children: [
              const LedgerStrip(title: '合併沒有完成'),
              Padding(
                padding: const EdgeInsets.all(AppSpace.x4),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      '你已經換到正式帳號了，但訪客的任務還沒搬過來。一小時內都可以重試。',
                      style: text.bodySmall,
                    ),
                    if (pendingMerge.error != null) ...[
                      const SizedBox(height: AppSpace.x2),
                      Text(
                        pendingMerge.error!,
                        style: text.bodySmall?.copyWith(color: AppColors.danger),
                      ),
                    ],
                    const SizedBox(height: AppSpace.x3),
                    FilledButton(
                      onPressed: _merging
                          ? null
                          : () => _retryMerge(pendingMerge.guestToken),
                      child: Text(_merging ? '合併中...' : '重試合併'),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ],
```

登出按鈕的 `onPressed`（第 308 行開始）最前面加兩行：

```dart
          onPressed: () async {
            if (guest) {
              await _guestSignOut();
              return;
            }
            // （以下是原本的程式碼，不動）
```

- [ ] **Step 5: 任務列表的提示條**

`task_list_page.dart`：`_openTask` 之後加：

```dart
  Future<void> _openProfile() async {
    await Navigator.of(context).push<void>(
      MaterialPageRoute(builder: (_) => const ProfilePage()),
    );
    // 改了暱稱之後，成員清單與結算上顯示的名字都要跟著更新。
    if (mounted) ref.invalidate(userProfileProvider);
  }
```

「個人設定」那顆 `IconButton` 的 `onPressed`（第 234–240 行）換成 `onPressed: _openProfile,`。

`build` 裡 `final text = …;` 之後加：

```dart
    final guest = ref.watch(authStateProvider).value?.isAnonymous ?? false;
```

`AppBar(` 裡 `actions: [...]` 之後加：

```dart
        // 放在標題列下方而不是列表裡：沒有任務時列表會換成空白狀態，
        // 提示條不能跟著消失。
        bottom: guest ? _GuestBanner(onBind: _openProfile) : null,
```

檔案結尾加：

```dart
/// 訪客才看得到的提示條。**不能關掉**：忘了綁定的後果是資料永久遺失，
/// 而綁定成功之後 isAnonymous 變成 false，它就自己消失。
///
/// 綁定本身在個人頁做，這裡只負責把人帶過去 —— 綁定與合併的流程只寫一份。
class _GuestBanner extends StatelessWidget implements PreferredSizeWidget {
  final VoidCallback onBind;

  const _GuestBanner({required this.onBind});

  @override
  Size get preferredSize => const Size.fromHeight(52);

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    // primaryDeep：文字印在 primarySoft 上，primary 只有 3.2:1，不夠。
    // 跟取暱稱頁頭像的文字是同一個修正。
    return Material(
      color: AppColors.primarySoft,
      child: SizedBox(
        height: preferredSize.height,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 8, 0),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  '目前是訪客，資料只存在這台手機。綁定帳號才不會遺失。',
                  style: text.bodySmall?.copyWith(color: AppColors.primaryDeep),
                ),
              ),
              TextButton(
                onPressed: onBind,
                style: TextButton.styleFrom(foregroundColor: AppColors.primaryDeep),
                child: const Text('綁定'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add flutter_app/lib/ui/sign_in_page.dart flutter_app/lib/ui/onboarding_page.dart flutter_app/lib/ui/profile_page.dart flutter_app/lib/ui/task_list_page.dart
git commit -F <msg>   # "Let people try the Flutter app without signing in"
```

（`dart analyze`、`flutter test`、`flutter build ios` 都在 CI 跑，見 Task 11。）

---

### Task 11: 收尾、全面驗證、上線前的手動步驟

**Files:**
- Modify: `todo.md`（檔案結尾）

**Interfaces:**
- Consumes: Task 1–10 的全部成果。
- Produces: 無。

這一個 Task 裡有三件事**必須先問使用者**，不能自己做：推上 main、部署函式、在 Firebase Console 開啟匿名登入。前兩件是對外的動作，第三件程式碼改不了。

- [ ] **Step 1: todo.md 記下這次不做的事**

`todo.md` 結尾加：

```md

## 免登入試用：這次不做

- **App Check**：擋有人大量產生匿名帳號。這是整個專案都缺的，不是訪客特有的問題。
- **自動清理閒置的匿名帳號**：要把 Firebase 專案升級到 Identity Platform。
- 訪客登出就等於刪除（見 `docs/superpowers/specs/2026-09-10-guest-trial-design.md`），
  匿名帳號不會一直累積，所以這兩件目前都不急。
```

Commit：

```bash
git add todo.md
git commit -F <msg>   # "Note what the guest trial leaves for later"
```

- [ ] **Step 2: 本機能跑的全部跑一遍**

```bash
cd "D:/Project/分帳系統"
npx vue-tsc --noEmit
npm test
npm run build
npm --prefix functions run build
npm --prefix functions test
export JAVA_HOME="/c/Program Files/Android/openjdk/jdk-21.0.8"
export PATH="$JAVA_HOME/bin:$PATH"
npm run test:rules
```

Expected: 每一步都沒有錯誤；rules 測試結尾 `0 failed`。任何一步失敗就停下來修，不要往下走。

- [ ] **Step 3: 問使用者，然後推 main 讓 CI 驗 Flutter**

先問：「本機的網頁、函式、rules 測試都過了。Flutter 只能靠 CI 驗，要我推上 main 嗎？」

同意後：

```bash
git push origin main
```

等 `Checks` 與 `iOS Build Check` 兩個 workflow 跑完（`gh run list --limit 5`、`gh run watch <id>`）。

Expected: 兩個都綠。`iOS Build Check` 的 `dart analyze`、`flutter test`、`flutter build ios` 三步都要過。紅的話看 log（`gh run view <id> --log-failed`），修掉再推，**CI 綠之前不宣稱 Flutter 測過**。

- [ ] **Step 4: 請使用者開啟匿名登入**

告訴使用者：Firebase Console → Authentication → Sign-in method → 新增供應商 → Anonymous → 啟用。沒開的話按「免登入立即試用」會看到「免登入試用還沒有在 Firebase Console 啟用。」

- [ ] **Step 5: 問使用者，然後部署函式**

先問：「要部署 `mergeGuest` 函式嗎？（`npm run deploy:functions`，會一起部署既有的函式）」

同意後：

```bash
npm run deploy:functions
```

Expected: `mergeGuest(asia-east1)` 出現在部署結果裡，沒有錯誤。

- [ ] **Step 6: 手動驗證（網頁版，正式專案，`npm run dev`）**

準備兩個 Google 帳號：**帳號甲**從沒登入過這個 App，**帳號乙**已經登入過而且有暱稱。每個情境開一個無痕視窗。

1. **一般綁定**：按「免登入立即試用」→ 取暱稱 → 建一個任務、記一筆帳 → 任務列表頂端看得到提示條 → 個人頁用帳號甲綁定。
   預期：提示條消失；個人頁顯示 email 與「Google」；任務與帳都在；Firestore 裡 `users/{uid}` 的 `provider` 是 `google.com`，uid 跟綁定前一樣。
2. **合併（含共同任務）**：用帳號乙建一個任務「共同」，拿到邀請連結。另開無痕視窗，打開邀請連結 → 按「免登入，直接加入」→ 取暱稱「小試」→ 加入「共同」→ 在「共同」記一筆由小試付、兩人均分的帳 → 再自己建一個任務「獨自」。記下「共同」的結算金額。然後在個人頁用帳號乙綁定。
   預期：跳出「這個帳號已經有資料」→ 按合併 → 回到任務列表，而且是帳號乙的身分。「獨自」的擁有者是帳號乙；「共同」的成員列多一位「小試（訪客）」，結算金額跟合併前一樣；Firebase Console 的 Authentication 裡那個匿名帳號已經不見。
3. **訪客登出**：新的無痕視窗 → 試用 → 取暱稱 → 用情境 2 的邀請連結加入「共同」→ 個人頁按登出 → 確認「仍要登出」。
   預期：回到登入頁；帳號乙在「共同」的成員列看到那位訪客標成已刪除。

任何一個情境不符預期，記下實際看到的畫面與 Firestore 資料，回到對應的 Task 修，不要在這裡硬改。

- [ ] **Step 7: 回報**

回報格式：本機檢查結果、CI 兩個 workflow 的結果（附 run 連結）、三個手動情境各自的結果。沒跑的步驟照實說沒跑。Flutter 實機（iOS/Android）上的綁定與合併這一輪沒有手動驗，要明講。
