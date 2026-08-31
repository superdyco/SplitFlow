# 帳號刪除 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓使用者能在 App 內刪除自己的帳號，滿足 App Store 指引 5.1.1(v)，同時把同行者的帳目完整留下。

**Architecture:** 一支 callable Cloud Function 用 Admin SDK 一次做完所有刪除與任務轉移，Firestore 規則一行都不用改。用戶端只負責確認、重新驗證、呼叫、登出。成員文件保留並加上 `deleted` 旗標，由畫面組成「小美（已刪除）」。

**Tech Stack:** Firebase Cloud Functions v2 (`onCall`, Node 22)、Firebase Admin SDK、Vue 3 + TypeScript（網頁）、Flutter + Riverpod（原生）、Vitest（網頁與 functions）、`package:test`（Dart）

**Spec:** `docs/superpowers/specs/2026-08-31-account-deletion-design.md`

## Global Constraints

- 函式 region 一律 `asia-east1`（與 Firestore 同區，跟既有的 `onExpenseCreated` 一致）
- `deleteAccount` **沒有參數**，uid 一律取自 `request.auth.uid`
- Auth 帳號**最後**才刪；整支函式必須可重複執行
- `lib/domain/` 底下**不得** import `package:flutter/*` —— CI 跑的是 `dart test`，混進 Flutter SDK 的 import 會讓整包測試跑不起來
- 讀取 `deleted` 欄位一律用「取不到就當 false」的預設值，舊文件沒有這個欄位
- 不計算、不顯示未結清餘額
- 這台機器沒有 Dart/Flutter。Task 6、7 的驗證靠 push 到 main 後的 `.github/workflows/ios-build.yml`

---

### Task 1: `pickSuccessor` — 誰接手任務

**Files:**
- Create: `functions/src/successor.ts`
- Test: `functions/src/successor.test.ts`

**Interfaces:**
- Produces: `pickSuccessor(adminIds: string[], members: SuccessorCandidate[], leavingUid: string): string | null`，以及 `interface SuccessorCandidate { uid: string; active: boolean; virtual: boolean }`。Task 2 會用它。`members` 必須已依 `joinedAt` 遞增排序，函式本身不排序。

- [x] **Step 1: 寫失敗的測試**

`functions/src/successor.test.ts`：

```typescript
import { describe, expect, it } from "vitest";
import { pickSuccessor } from "./successor.js";

const real = (uid: string) => ({ uid, active: true, virtual: false });

describe("pickSuccessor", () => {
  it("優先交給另一位 admin", () => {
    expect(
      pickSuccessor(["owner1", "admin1"], [real("owner1"), real("admin1"), real("m1")], "owner1")
    ).toBe("admin1");
  });

  it("沒有其他 admin 就交給最早加入的成員", () => {
    // members 進來時已依 joinedAt 排序，所以「最早」就是第一個。
    expect(
      pickSuccessor(["owner1"], [real("owner1"), real("m1"), real("m2")], "owner1")
    ).toBe("m1");
  });

  it("跳過虛擬成員 —— 他沒有帳號，接手了也沒有人能操作", () => {
    expect(
      pickSuccessor(
        ["owner1"],
        [real("owner1"), { uid: "v_aaaaaaaaaaaaaaaaaaaa", active: true, virtual: true }, real("m2")],
        "owner1"
      )
    ).toBe("m2");
  });

  it("跳過已被移除的成員 —— 他看不到這個任務", () => {
    expect(
      pickSuccessor(
        ["owner1"],
        [real("owner1"), { uid: "m1", active: false, virtual: false }, real("m2")],
        "owner1"
      )
    ).toBe("m2");
  });

  it("只剩他自己就回傳 null，呼叫端會把整個任務刪掉", () => {
    expect(pickSuccessor(["owner1"], [real("owner1")], "owner1")).toBeNull();
  });

  it("只剩虛擬成員也回傳 null —— 沒有人看得到這個任務", () => {
    expect(
      pickSuccessor(
        ["owner1"],
        [real("owner1"), { uid: "v_aaaaaaaaaaaaaaaaaaaa", active: true, virtual: true }],
        "owner1"
      )
    ).toBeNull();
  });

  it("adminIds 裡的人已經不在成員名單就不算數", () => {
    // 資料可能不一致（舊資料、寫入失敗）。挑一個不存在的人接手，
    // 任務會直接壞掉而且沒有人能修。
    expect(
      pickSuccessor(["owner1", "ghost"], [real("owner1"), real("m1")], "owner1")
    ).toBe("m1");
  });
});
```

- [x] **Step 2: 跑測試確認失敗**

Run: `cd functions && npx vitest run src/successor.test.ts`
Expected: FAIL，`Failed to resolve import "./successor.js"`

- [x] **Step 3: 寫最小實作**

`functions/src/successor.ts`：

```typescript
/**
 * 帳號被刪除的 owner，任務要交給誰。
 *
 * 回傳 null 代表**沒有人可以接手**，呼叫端應該把整個任務刪掉 —— 那時候
 * 留著任務也沒有任何真人看得到。
 *
 * `members` 必須已依 `joinedAt` 遞增排序。排序留給呼叫端，因為那是 Firestore
 * 查詢就能做完的事，拉進來只會讓這支函式需要一個它不該知道的欄位。
 */
export interface SuccessorCandidate {
  uid: string;
  active: boolean;
  virtual: boolean;
}

export function pickSuccessor(
  adminIds: string[],
  members: SuccessorCandidate[],
  leavingUid: string
): string | null {
  const eligible = members.filter(
    member => member.uid !== leavingUid && member.active && !member.virtual
  );

  // adminIds 可能列到已經不在成員名單裡的人（舊資料、寫入失敗）。挑一個不存在
  // 的人接手，任務會直接壞掉而且沒有人能修 —— 所以要跟成員名單交叉比對。
  const admin = eligible.find(member => (adminIds ?? []).includes(member.uid));
  if (admin) return admin.uid;

  // 沒有其他 admin 就交給最早加入的真人。members 已經排好序。
  return eligible[0]?.uid ?? null;
}
```

- [x] **Step 4: 跑測試確認通過**

Run: `cd functions && npx vitest run src/successor.test.ts`
Expected: PASS，7 passed

- [x] **Step 5: Commit**

```bash
git add functions/src/successor.ts functions/src/successor.test.ts
git commit -m "Work out who inherits a trip when its owner leaves"
```

---

### Task 2: `deleteAccount` callable function

**Files:**
- Modify: `functions/src/index.ts`（在檔案末端新增，不動 `onExpenseCreated`）

**Interfaces:**
- Consumes: `pickSuccessor`、`SuccessorCandidate`（Task 1）
- Produces: callable `deleteAccount`，無參數，回傳 `{ deletedTasks: number; transferredTasks: number; leftTasks: number }`。Task 5、7 的用戶端會呼叫它。

- [x] **Step 1: 加入 imports 與函式**

在 `functions/src/index.ts` 的 import 區塊補上（`getAuth` 與 `onCall` 目前都還沒有）：

```typescript
import { getAuth } from "firebase-admin/auth";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { pickSuccessor, type SuccessorCandidate } from "./successor.js";
```

- [x] **Step 2: 在檔案末端加上函式本體**

```typescript
/**
 * 刪除自己的帳號。App Store 指引 5.1.1(v) 要求 App 內就能發起。
 *
 * **帳目留下，身分標記為已刪除。** 一個人的支出不只是他自己的資料，也是
 * 同行者的共同紀錄 —— 單方面抽掉會讓別人已經算好的帳突然對不上，而他付過
 * 的錢別人可能還沒還。
 *
 * 為什麼在伺服器端做：現行規則下成員刪不掉自己的成員文件（`allow delete`
 * 要 admin），也沒有任何路徑改得了 `ownerId`。要在用戶端完成就得為一輩子
 * 用一次的操作永久開兩個洞。而且用戶端跑到一半斷線會停在半刪除狀態，
 * 沒有人收拾得了。
 */
export const deleteAccount = onCall({ region: REGION }, async request => {
  // uid 只從 auth context 拿。只要它來自參數，任何人就能刪任何人的帳號。
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "請先登入");
  }

  let deletedTasks = 0;
  let transferredTasks = 0;
  let leftTasks = 0;

  const tasks = await db.collection("tasks").where("memberIds", "array-contains", uid).get();

  for (const taskSnap of tasks.docs) {
    const task = taskSnap.data();
    const memberIds: string[] = task.memberIds ?? [];
    const adminIds: string[] = task.adminIds ?? [];

    // 冪等：上一次跑到一半就成功處理過的任務直接跳過。
    if (!memberIds.includes(uid)) continue;

    if (task.ownerId === uid) {
      const membersSnap = await taskSnap.ref.collection("members").orderBy("joinedAt").get();
      const candidates: SuccessorCandidate[] = membersSnap.docs.map(doc => ({
        uid: doc.id,
        active: doc.data().active !== false,
        virtual: doc.data().virtual === true
      }));

      const successor = pickSuccessor(adminIds, candidates, uid);

      if (successor === null) {
        // 沒有真人接得了手，留著任務也沒有人看得到。
        await db.recursiveDelete(taskSnap.ref);
        deletedTasks += 1;
        continue;
      }

      await taskSnap.ref.update({
        ownerId: successor,
        adminIds: [...new Set([...adminIds.filter(id => id !== uid), successor])],
        memberIds: memberIds.filter(id => id !== uid),
        memberCount: Math.max(0, memberIds.length - 1),
        updatedAt: FieldValue.serverTimestamp()
      });
      // 接手的人角色也要跟著改，不然成員列上不會顯示他是擁有者。
      await taskSnap.ref.collection("members").doc(successor).set({ role: "owner" }, { merge: true });
      transferredTasks += 1;
    } else {
      await taskSnap.ref.update({
        adminIds: adminIds.filter(id => id !== uid),
        memberIds: memberIds.filter(id => id !== uid),
        memberCount: Math.max(0, memberIds.length - 1),
        updatedAt: FieldValue.serverTimestamp()
      });
      leftTasks += 1;
    }

    // 成員文件留著。支出的 splits 以 uid 當 key，刪掉之後成員列與結算
    // 只剩一串裸 uid，其他人看不懂那筆帳是誰的。
    //
    // 暱稱不覆寫：畫面自己組「小美（已刪除）」。而且結算快照的 memberNames
    // 本來就永久保存了當時的暱稱，覆寫並不會真的抹掉什麼。
    await taskSnap.ref.collection("members").doc(uid).set(
      { active: false, deleted: true },
      { merge: true }
    );
  }

  await db.recursiveDelete(db.collection("users").doc(uid).collection("tokens"));
  await db.recursiveDelete(db.collection("users").doc(uid).collection("favorites"));
  await db.collection("users").doc(uid).delete();

  // Auth 放最後。反過來的話中途失敗使用者已經登不進來，永遠無法重試，
  // 資料就卡在半刪除狀態。放最後，任何一步失敗他都還在，再按一次即可。
  try {
    await getAuth().deleteUser(uid);
  } catch (error) {
    // 已經刪掉了就是成功 —— 這是重試會走到的路。
    const code = (error as { code?: string }).code;
    if (code !== "auth/user-not-found") throw error;
  }

  logger.info("帳號已刪除", { uid, deletedTasks, transferredTasks, leftTasks });
  return { deletedTasks, transferredTasks, leftTasks };
});
```

- [x] **Step 3: 補上 `FieldValue` 的 import**

`index.ts` 目前只 import 了 `getFirestore`。把那一行改成：

```typescript
import { FieldValue, getFirestore } from "firebase-admin/firestore";
```

- [x] **Step 4: 型別檢查與既有測試**

Run: `cd functions && npm run build && npx vitest run`
Expected: `tsc` 無輸出即成功；測試 34 passed（既有 27 + Task 1 的 7）

- [x] **Step 5: Commit**

```bash
git add functions/src/index.ts
git commit -m "Let people delete their account without taking the books with them"
```

---

### Task 3: 網頁的成員顯示名稱

**Files:**
- Create: `src/utils/memberName.ts`
- Test: `tests/memberName.test.ts`
- Modify: `src/types/member.ts`（加 `deleted?: boolean`）
- Modify: `src/pages/ExpenseFormPage.vue:245`、`:801`、`:832`、`:848`
- Modify: `src/pages/TaskPage.vue:102`
- Modify: `src/components/settlement/SettlementPanel.vue:47`
- Modify: `src/components/member/MemberRow.vue:30`

**Interfaces:**
- Produces: `memberDisplayName(member: { nickname: string; active?: boolean; deleted?: boolean }): string`。Task 4 不需要它，但 Task 6 的 Dart 版本要對齊同樣的行為。

- [x] **Step 1: 寫失敗的測試**

`tests/memberName.test.ts`：

```typescript
import { describe, expect, it } from "vitest";
import { memberDisplayName } from "@/utils/memberName";

describe("memberDisplayName", () => {
  it("正常成員就是暱稱本身", () => {
    expect(memberDisplayName({ nickname: "小美", active: true })).toBe("小美");
  });

  it("被移除的成員標成已離開", () => {
    expect(memberDisplayName({ nickname: "小美", active: false })).toBe("小美（已離開）");
  });

  it("刪除帳號的人標成已刪除，不是已離開", () => {
    // 兩件事對其他人意義不同：已離開的人可以用邀請連結回來，
    // 刪掉帳號的人永遠不會。
    expect(
      memberDisplayName({ nickname: "小美", active: false, deleted: true })
    ).toBe("小美（已刪除）");
  });

  it("舊文件沒有 deleted 欄位，當成沒刪除", () => {
    expect(memberDisplayName({ nickname: "小美", active: true })).toBe("小美");
  });

  it("沒有暱稱時不要只留下一個括號", () => {
    expect(memberDisplayName({ nickname: "", active: false })).toBe("（沒有暱稱）（已離開）");
  });
});
```

- [x] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/memberName.test.ts`
Expected: FAIL，找不到 `@/utils/memberName`

- [x] **Step 3: 寫實作**

`src/utils/memberName.ts`：

```typescript
/**
 * 成員在畫面上的名字。
 *
 * 這段邏輯本來以 `${nickname}${active ? "" : "（已離開）"}` 的形式散在
 * ExpenseFormPage 的三個地方，每加一種狀態就要改三次。集中在這裡。
 *
 * 「已刪除」壓過「已離開」：刪掉帳號的人一定也是 inactive，但那兩件事
 * 對其他人意義不同 —— 已離開的人可以用邀請連結回來（規則裡的 rejoinsSelf
 * 允許），刪掉帳號的人永遠不會。
 */
export interface DisplayableMember {
  nickname: string;
  active?: boolean;
  deleted?: boolean;
}

export function memberDisplayName(member: DisplayableMember): string {
  const name = member.nickname || "（沒有暱稱）";

  if (member.deleted === true) return `${name}（已刪除）`;
  if (member.active === false) return `${name}（已離開）`;
  return name;
}
```

- [x] **Step 4: 跑測試確認通過**

Run: `npx vitest run tests/memberName.test.ts`
Expected: PASS，5 passed

- [x] **Step 5: 型別加上欄位**

`src/types/member.ts` 的 `TaskMember` 介面，在 `virtual?: boolean;` 之後加：

```typescript
  /**
   * 這個人刪掉了自己的帳號。他的帳目留著，但他永遠不會回來。
   * 舊文件沒有這個欄位，一律當成 false。
   */
  deleted?: boolean;
```

- [x] **Step 6: 換掉所有行內組字**

`src/pages/ExpenseFormPage.vue`：先在 script 區塊加 `import { memberDisplayName } from "@/utils/memberName";`，然後

- 第 245 行 `return \`${member.nickname}${member.active ? "" : "（已離開）"}\`;`
  → `return memberDisplayName(member);`
- 第 801 行 `{{ member.nickname }}{{ member.uid === uid ? "（你）" : member.active ? "" : "（已離開）" }}`
  → `{{ member.uid === uid ? `${member.nickname}（你）` : memberDisplayName(member) }}`
- 第 832 行與第 848 行 `{{ member.nickname }}{{ member.active ? "" : "（已離開）" }}`
  → `{{ memberDisplayName(member) }}`

`src/pages/TaskPage.vue` 第 102 行：

```typescript
  Object.fromEntries(memberState.members.value.map(member => [member.uid, memberDisplayName(member)]))
```

`src/components/settlement/SettlementPanel.vue` 第 47 行：

```typescript
  Object.fromEntries(props.members.map(member => [member.uid, memberDisplayName(member)]))
```

`src/components/member/MemberRow.vue` 第 30 行：

```html
      <strong>{{ memberDisplayName(member) }}</strong>
```

三個檔案都要在 script 區塊加同一行 import。第 28 行的頭像縮寫維持用 `member.nickname`，不要換 —— 頭像要的是名字的第一個字，不是後綴。

- [x] **Step 7: 全套測試與型別檢查**

Run: `npm test && npm run check`
Expected: 測試全過（比之前多 5 個）、`vue-tsc` 無輸出

- [x] **Step 8: Commit**

```bash
git add src/utils/memberName.ts tests/memberName.test.ts src/types/member.ts src/pages/ExpenseFormPage.vue src/pages/TaskPage.vue src/components/settlement/SettlementPanel.vue src/components/member/MemberRow.vue
git commit -m "Say why a name is greyed out, in one place instead of six"
```

---

### Task 4: 網頁的刪除帳號文案

**Files:**
- Create: `src/utils/accountDeletion.ts`
- Test: `tests/accountDeletion.test.ts`

**Interfaces:**
- Produces: `deleteAccountPrompt(input: DeleteAccountPromptInput): DeleteAccountPrompt`，其中
  `DeleteAccountPromptInput = { nickname: string; taskCount: number; ownedTaskCount: number }`，
  `DeleteAccountPrompt = { title: string; message: string; confirmLabel: string; requireText: string | null }`。
  Task 5 會用它；Task 7 的 Dart 版行為要一致。

- [x] **Step 1: 寫失敗的測試**

`tests/accountDeletion.test.ts`：

```typescript
import { describe, expect, it } from "vitest";
import { deleteAccountPrompt } from "@/utils/accountDeletion";

describe("deleteAccountPrompt", () => {
  it("沒有任何任務就不要求打字 —— 剛註冊完就想刪的人風險是零", () => {
    const prompt = deleteAccountPrompt({ nickname: "小美", taskCount: 0, ownedTaskCount: 0 });
    expect(prompt.requireText).toBeNull();
  });

  it("有任務就要打出自己的暱稱", () => {
    const prompt = deleteAccountPrompt({ nickname: "小美", taskCount: 3, ownedTaskCount: 1 });
    expect(prompt.requireText).toBe("小美");
  });

  it("講明帳目會留下，不然人會以為刪帳號就抽得回自己的錢", () => {
    const prompt = deleteAccountPrompt({ nickname: "小美", taskCount: 3, ownedTaskCount: 0 });
    expect(prompt.message).toContain("留");
  });

  it("有擁有的任務就說會轉給別人", () => {
    const prompt = deleteAccountPrompt({ nickname: "小美", taskCount: 3, ownedTaskCount: 2 });
    expect(prompt.message).toContain("2 個");
    expect(prompt.message).toContain("轉給");
  });

  it("沒有擁有任務就不要提轉移，那句話對他沒有意義", () => {
    const prompt = deleteAccountPrompt({ nickname: "小美", taskCount: 3, ownedTaskCount: 0 });
    expect(prompt.message).not.toContain("轉給");
  });

  it("一定要說無法復原", () => {
    const prompt = deleteAccountPrompt({ nickname: "小美", taskCount: 0, ownedTaskCount: 0 });
    expect(prompt.message).toContain("無法復原");
  });

  it("建議先匯出資料", () => {
    const prompt = deleteAccountPrompt({ nickname: "小美", taskCount: 2, ownedTaskCount: 0 });
    expect(prompt.message).toContain("匯出");
  });

  it("不提未結清餘額 —— 付款確認不是強制流程，那個數字不是事實", () => {
    const prompt = deleteAccountPrompt({ nickname: "小美", taskCount: 5, ownedTaskCount: 1 });
    expect(prompt.message).not.toContain("欠");
    expect(prompt.message).not.toContain("未結清");
  });
});
```

- [x] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/accountDeletion.test.ts`
Expected: FAIL，找不到 `@/utils/accountDeletion`

- [x] **Step 3: 寫實作**

`src/utils/accountDeletion.ts`：

```typescript
/**
 * 刪除帳號的確認文案。
 *
 * 純函式，跟 `removeMemberPrompt`、`taskActionPrompt` 同一個形狀。
 *
 * **刻意不提未結清餘額。** 付款確認不是強制流程 —— 人可以在現實裡還完錢
 * 卻從不按「已收到」。App 裡的餘額因此不是事實，拿它去說「你還欠某某多少」
 * 是把內部狀態當成真實債務。這裡講的是「你會失去什麼」。
 */
export interface DeleteAccountPromptInput {
  nickname: string;
  /** 他參與的任務總數。 */
  taskCount: number;
  /** 其中他是擁有者的有幾個。 */
  ownedTaskCount: number;
}

export interface DeleteAccountPrompt {
  title: string;
  message: string;
  confirmLabel: string;
  /** null 代表按一次就好；有值代表要打出這串字才能繼續。 */
  requireText: string | null;
}

export function deleteAccountPrompt({
  nickname,
  taskCount,
  ownedTaskCount
}: DeleteAccountPromptInput): DeleteAccountPrompt {
  const lines = ["刪除之後你會登出，而且無法復原。"];

  if (taskCount > 0) {
    lines.push(
      `你在 ${taskCount} 個任務裡的支出、付款與結算紀錄都會留著 —— ` +
        "那些帳同時也是同行者的紀錄，抽掉他們的帳就對不上了。你的名字會顯示成「已刪除」。"
    );
  }

  if (ownedTaskCount > 0) {
    lines.push(
      `你擁有的 ${ownedTaskCount} 個任務會轉給裡面的另一個人。` +
        "只有你一個人的任務會連同資料一起刪除。"
    );
  }

  lines.push("如果想留一份自己的資料，請先用上面的「匯出 JSON 資料」。");

  return {
    title: "刪除帳號？",
    message: lines.join("\n\n"),
    confirmLabel: "刪除帳號",
    // 分級摩擦，沿用 taskActionPrompt 的原則：後果越嚴重、需要越刻意的動作。
    // 什麼都還沒有的人刪掉風險是零，不該被懲罰。
    requireText: taskCount > 0 ? nickname : null
  };
}
```

- [x] **Step 4: 跑測試確認通過**

Run: `npx vitest run tests/accountDeletion.test.ts`
Expected: PASS，8 passed

- [x] **Step 5: Commit**

```bash
git add src/utils/accountDeletion.ts tests/accountDeletion.test.ts
git commit -m "Write what deleting an account will and won't take away"
```

---

### Task 5: 網頁的刪除帳號介面

**Files:**
- Create: `src/services/accountService.ts`
- Modify: `src/pages/ProfilePage.vue`

**Interfaces:**
- Consumes: `deleteAccountPrompt`（Task 4）、callable `deleteAccount`（Task 2）
- Produces: `deleteOwnAccount(): Promise<void>` —— 重新驗證、呼叫函式、登出，一路做完

- [x] **Step 1: 寫服務層**

`src/services/accountService.ts`：

```typescript
import { getFunctions, httpsCallable } from "firebase/functions";
import { GoogleAuthProvider, OAuthProvider, reauthenticateWithPopup, signOut } from "firebase/auth";
import { app, auth } from "@/firebase/config";

/**
 * 刪除自己的帳號。
 *
 * 重新驗證不是形式：這個操作不可逆，而拿到一台沒鎖的電腦的人不該能刪掉
 * 別人的帳號。Firebase 對 `user.delete()` 本來就要求 recent login，我們改由
 * 伺服器端刪除雖然技術上不受此限，但保護的理由沒變。
 */
export async function deleteOwnAccount(): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error("請先登入");

  const providerId = user.providerData[0]?.providerId ?? "google.com";
  const provider =
    providerId === "apple.com" ? new OAuthProvider("apple.com") : new GoogleAuthProvider();

  await reauthenticateWithPopup(user, provider);

  // region 要跟函式一致，不然會打到 us-central1 然後 404。
  const call = httpsCallable(getFunctions(app, "asia-east1"), "deleteAccount");
  await call();

  await signOut(auth);
}
```

- [x] **Step 2: 在個人設定頁加入危險區**

`src/pages/ProfilePage.vue`。在 script 區塊加：

```typescript
import { deleteAccountPrompt } from "@/utils/accountDeletion";
import { deleteOwnAccount } from "@/services/accountService";

const deleting = ref(false);
const deleteError = ref<string | null>(null);

async function onDeleteAccount() {
  const prompt = deleteAccountPrompt({
    nickname: userStore.profile?.nickname ?? "",
    taskCount: tasks.value.length,
    ownedTaskCount: tasks.value.filter(task => task.ownerId === authStore.user?.uid).length
  });

  if (prompt.requireText) {
    const typed = window.prompt(`${prompt.message}\n\n請打出「${prompt.requireText}」以確認：`);
    if (typed?.trim() !== prompt.requireText) return;
  } else if (!window.confirm(prompt.message)) {
    return;
  }

  deleting.value = true;
  deleteError.value = null;
  try {
    await deleteOwnAccount();
    await router.push("/login");
  } catch (err) {
    deleteError.value = err instanceof Error ? err.message : String(err);
  } finally {
    deleting.value = false;
  }
}
```

頁面上 `router`（第 17 行）、`authStore`（第 18 行）、`userStore`（第 19 行）都已經有了。
任務清單沒有，用既有的 `listUserTasks` 補上，並把 `onMounted` 加進第 2 行的 vue import
（目前只有 `computed, ref`）：

```typescript
import { listUserTasks } from "@/services/taskService";
import type { Task } from "@/types/task";

const tasks = ref<Task[]>([]);
onMounted(async () => {
  const id = authStore.user?.uid;
  if (id) tasks.value = await listUserTasks(id);
});
```

- [x] **Step 3: 加上畫面**

放在登出按鈕之後，樣式上與其他區塊分開：

```html
      <section class="danger-zone">
        <h3>刪除帳號</h3>
        <p>你的支出與結算會留在同行的人那裡，但你的帳號、個人資料與收藏會永久消失。</p>
        <button class="danger" :disabled="deleting" @click="onDeleteAccount">
          {{ deleting ? "刪除中..." : "刪除帳號" }}
        </button>
        <p v-if="deleteError" class="error">{{ deleteError }}</p>
      </section>
```

- [x] **Step 4: 型別檢查與建置**

Run: `npm run check && npm test`
Expected: `vue-tsc` 無輸出、測試全過

- [x] **Step 5: Commit**

```bash
git add src/services/accountService.ts src/pages/ProfilePage.vue
git commit -m "Give people a way out on the web"
```

---

### Task 6: Flutter 的成員顯示名稱

**Files:**
- Create: `flutter_app/lib/domain/member_name.dart`
- Modify: `flutter_app/test/support_test.dart`（加一個 group）
- Modify: `flutter_app/lib/domain/models.dart`（`TaskMember` 加 `deleted`）
- Modify: `flutter_app/lib/data/mappers.dart`（讀那個欄位）
- Modify: `flutter_app/lib/ui/expense_form_page.dart:598`、`:630`、`:646`
- Modify: `flutter_app/lib/ui/settlement_tab.dart:192`
- Modify: `flutter_app/lib/ui/task_page.dart:282`
- Modify: `flutter_app/lib/ui/members_tab.dart:399`

**Interfaces:**
- Produces: `memberDisplayName(TaskMember member) -> String`，行為與 Task 3 的 TypeScript 版一致

- [x] **Step 1: 寫失敗的測試**

`flutter_app/test/support_test.dart`，在 `group('登入供應商清單', ...)` 之後加：

```dart
  group('成員顯示名稱', () {
    TaskMember member({
      String nickname = '小美',
      bool active = true,
      bool deleted = false,
    }) =>
        TaskMember(
          uid: 'u1',
          nickname: nickname,
          role: 'member',
          active: active,
          deleted: deleted,
        );

    test('正常成員就是暱稱本身', () {
      expect(memberDisplayName(member()), '小美');
    });

    test('被移除的成員標成已離開', () {
      expect(memberDisplayName(member(active: false)), '小美（已離開）');
    });

    test('刪除帳號的人標成已刪除，不是已離開', () {
      // 兩件事對其他人意義不同：已離開的人可以用邀請連結回來，
      // 刪掉帳號的人永遠不會。
      expect(
        memberDisplayName(member(active: false, deleted: true)),
        '小美（已刪除）',
      );
    });

    test('沒有暱稱時不要只留下一個括號', () {
      expect(memberDisplayName(member(nickname: '', active: false)), '（沒有暱稱）（已離開）');
    });
  });
```

檔案頂端補上 `import 'package:splitflow/domain/member_name.dart';`。

- [x] **Step 2: 加上模型欄位**

`flutter_app/lib/domain/models.dart` 的 `TaskMember`，在 `virtual` 之後加：

```dart
  /// 這個人刪掉了自己的帳號。他的帳目留著，但他永遠不會回來。
  /// 舊文件沒有這個欄位，一律當成 false。
  final bool deleted;
```

建構子加上 `this.deleted = false,`。

- [x] **Step 3: 寫實作**

`flutter_app/lib/domain/member_name.dart`：

```dart
/// 成員在畫面上的名字。`src/utils/memberName.ts` 的 Dart 版。
///
/// 這段邏輯本來以 `'${m.nickname}${m.active ? '' : '（已離開）'}'` 的形式散在
/// expense_form_page 的三個地方，每加一種狀態就要改三次。集中在這裡。
///
/// 「已刪除」壓過「已離開」：刪掉帳號的人一定也是 inactive，但那兩件事對
/// 其他人意義不同 —— 已離開的人可以用邀請連結回來（規則裡的 rejoinsSelf
/// 允許），刪掉帳號的人永遠不會。
library;

import 'models.dart';

String memberDisplayName(TaskMember member) {
  final name = member.nickname.isEmpty ? '（沒有暱稱）' : member.nickname;

  if (member.deleted) return '$name（已刪除）';
  if (!member.active) return '$name（已離開）';
  return name;
}
```

- [x] **Step 4: 讓 mapper 讀那個欄位**

`flutter_app/lib/data/mappers.dart` 裡建立 `TaskMember` 的地方，比照 `virtual` 的寫法加：

```dart
      deleted: data['deleted'] == true,
```

用 `== true` 而不是 `as bool`：舊文件沒有這個欄位，讀到的是 null，強制轉型會直接丟例外。

- [x] **Step 5: 換掉所有行內組字**

`flutter_app/lib/ui/expense_form_page.dart` 第 598、630、646 行的
`'${m.nickname}${m.active ? '' : '（已離開）'}'` → `memberDisplayName(m)`

`flutter_app/lib/ui/settlement_tab.dart` 第 192 行 `m.uid: m.nickname,` → `m.uid: memberDisplayName(m),`

`flutter_app/lib/ui/task_page.dart` 第 282 行同上

`flutter_app/lib/ui/members_tab.dart` 第 399 行
`member.nickname.isEmpty ? '（沒有暱稱）' : member.nickname` → `memberDisplayName(member)`

四個檔案都要 `import '../domain/member_name.dart';`。members_tab 第 383-385 行的頭像縮寫維持用 `member.nickname`，那要的是第一個字不是後綴。

- [x] **Step 6: Commit 並讓 CI 驗證**

這台機器沒有 Dart，`dart analyze` 與 `dart test` 只能在 CI 跑。

```bash
git add flutter_app/lib/domain/member_name.dart flutter_app/lib/domain/models.dart flutter_app/lib/data/mappers.dart flutter_app/lib/ui/expense_form_page.dart flutter_app/lib/ui/settlement_tab.dart flutter_app/lib/ui/task_page.dart flutter_app/lib/ui/members_tab.dart flutter_app/test/support_test.dart
git commit -m "Say why a name is greyed out, natively too"
git push origin main
```

推完後輪詢 `https://api.github.com/repos/superdyco/SplitFlow/actions/runs?per_page=5`，等 `iOS Build Check` 的結論。**CI 綠之前不要宣稱這一步完成。**

---

### Task 7: Flutter 的刪除帳號介面

**Files:**
- Modify: `flutter_app/pubspec.yaml`（加 `cloud_functions`）
- Create: `flutter_app/lib/domain/account_deletion.dart`
- Modify: `flutter_app/test/support_test.dart`（加一個 group）
- Modify: `flutter_app/lib/data/auth_repository.dart`（加 `deleteAccount`）
- Modify: `flutter_app/lib/ui/profile_page.dart`

**Interfaces:**
- Consumes: callable `deleteAccount`（Task 2）
- Produces: `deleteAccountPrompt({required String nickname, required int taskCount, required int ownedTaskCount}) -> DeleteAccountPrompt`，欄位與 Task 4 的 TypeScript 版相同：`title`、`message`、`confirmLabel`、`requireText`

- [x] **Step 1: 加相依**

`flutter_app/pubspec.yaml` 的 `dependencies`，在 `firebase_messaging` 之後加：

```yaml
  cloud_functions: ^5.1.3
```

- [x] **Step 2: 寫失敗的測試**

`flutter_app/test/support_test.dart` 加：

```dart
  group('刪除帳號文案', () {
    test('沒有任何任務就不要求打字', () {
      final prompt = deleteAccountPrompt(
        nickname: '小美',
        taskCount: 0,
        ownedTaskCount: 0,
      );
      expect(prompt.requireText, isNull);
    });

    test('有任務就要打出自己的暱稱', () {
      final prompt = deleteAccountPrompt(
        nickname: '小美',
        taskCount: 3,
        ownedTaskCount: 1,
      );
      expect(prompt.requireText, '小美');
    });

    test('講明帳目會留下', () {
      final prompt = deleteAccountPrompt(
        nickname: '小美',
        taskCount: 3,
        ownedTaskCount: 0,
      );
      expect(prompt.message, contains('留'));
    });

    test('有擁有的任務才提轉移', () {
      final owned = deleteAccountPrompt(
        nickname: '小美',
        taskCount: 3,
        ownedTaskCount: 2,
      );
      expect(owned.message, contains('轉給'));

      final none = deleteAccountPrompt(
        nickname: '小美',
        taskCount: 3,
        ownedTaskCount: 0,
      );
      expect(none.message, isNot(contains('轉給')));
    });

    test('不提未結清餘額 —— 付款確認不是強制流程，那個數字不是事實', () {
      final prompt = deleteAccountPrompt(
        nickname: '小美',
        taskCount: 5,
        ownedTaskCount: 1,
      );
      expect(prompt.message, isNot(contains('欠')));
      expect(prompt.message, isNot(contains('未結清')));
    });
  });
```

檔案頂端補上 `import 'package:splitflow/domain/account_deletion.dart';`。

- [x] **Step 3: 寫實作**

`flutter_app/lib/domain/account_deletion.dart`：

```dart
/// 刪除帳號的確認文案。`src/utils/accountDeletion.ts` 的 Dart 版。
///
/// **刻意不提未結清餘額。** 付款確認不是強制流程 —— 人可以在現實裡還完錢
/// 卻從不按「已收到」。App 裡的餘額因此不是事實，拿它去說「你還欠某某多少」
/// 是把內部狀態當成真實債務。這裡講的是「你會失去什麼」。
library;

class DeleteAccountPrompt {
  final String title;
  final String message;
  final String confirmLabel;

  /// null 代表按一次就好；有值代表要打出這串字才能繼續。
  final String? requireText;

  const DeleteAccountPrompt({
    required this.title,
    required this.message,
    required this.confirmLabel,
    required this.requireText,
  });
}

DeleteAccountPrompt deleteAccountPrompt({
  required String nickname,
  required int taskCount,
  required int ownedTaskCount,
}) {
  final lines = <String>['刪除之後你會登出，而且無法復原。'];

  if (taskCount > 0) {
    lines.add(
      '你在 $taskCount 個任務裡的支出、付款與結算紀錄都會留著 —— '
      '那些帳同時也是同行者的紀錄，抽掉他們的帳就對不上了。你的名字會顯示成「已刪除」。',
    );
  }

  if (ownedTaskCount > 0) {
    lines.add(
      '你擁有的 $ownedTaskCount 個任務會轉給裡面的另一個人。'
      '只有你一個人的任務會連同資料一起刪除。',
    );
  }

  lines.add('如果想留一份自己的資料，請先用上面的「匯出 JSON 資料」。');

  return DeleteAccountPrompt(
    title: '刪除帳號？',
    message: lines.join('\n\n'),
    confirmLabel: '刪除帳號',
    // 分級摩擦，沿用 taskActionPrompt 的原則：後果越嚴重、需要越刻意的動作。
    requireText: taskCount > 0 ? nickname : null,
  );
}
```

- [x] **Step 4: 在 auth_repository 加上呼叫**

`flutter_app/lib/data/auth_repository.dart`，頂端加
`import 'package:cloud_functions/cloud_functions.dart';`，然後在 `signOut` 之前加：

```dart
  /// 刪除自己的帳號。App Store 指引 5.1.1(v) 要求 App 內就能發起。
  ///
  /// 重新驗證不是形式：這個操作不可逆，而拿到一支沒鎖的手機的人不該能刪掉
  /// 別人的帳號。
  ///
  /// region 要跟函式一致，不然會打到 us-central1 然後找不到函式。
  Future<void> deleteAccount() async {
    final user = _auth.currentUser;
    if (user == null) throw Exception('請先登入');

    final providerId = user.providerData.isEmpty
        ? 'google.com'
        : user.providerData.first.providerId;

    if (providerId == 'apple.com') {
      await user.reauthenticateWithProvider(AppleAuthProvider());
    } else {
      await _ensureInitialized();
      final account = await GoogleSignIn.instance.authenticate();
      await user.reauthenticateWithCredential(
        GoogleAuthProvider.credential(idToken: account.authentication.idToken),
      );
    }

    await FirebaseFunctions.instanceFor(region: 'asia-east1')
        .httpsCallable('deleteAccount')
        .call<void>();

    await GoogleSignIn.instance.signOut();
    await _auth.signOut();
  }
```

- [x] **Step 5: 在個人設定頁加入危險區**

`flutter_app/lib/ui/profile_page.dart`，接在第 250 行的登出按鈕之後。

state class 加兩個欄位：

```dart
  bool _deleting = false;
  String? _deleteError;
```

處理函式：

```dart
  Future<void> _deleteAccount(String nickname, List<Task> tasks) async {
    final uid = ref.read(authStateProvider).value?.uid;
    if (uid == null) return;

    final prompt = deleteAccountPrompt(
      nickname: nickname,
      taskCount: tasks.length,
      ownedTaskCount: tasks.where((t) => t.ownerId == uid).length,
    );

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => _ConfirmDeleteDialog(prompt: prompt),
    );
    if (confirmed != true) return;

    setState(() {
      _deleting = true;
      _deleteError = null;
    });
    try {
      await ref.read(authRepositoryProvider).deleteAccount();
      if (mounted) Navigator.of(context).pop();
    } catch (err) {
      if (mounted) setState(() => _deleteError = err.toString());
    } finally {
      if (mounted) setState(() => _deleting = false);
    }
  }
```

畫面：

```dart
        const SizedBox(height: 32),
        const Divider(),
        const SizedBox(height: 16),
        Text('刪除帳號', style: text.titleMedium),
        const SizedBox(height: 8),
        Text(
          '你的支出與結算會留在同行的人那裡，但你的帳號、個人資料與收藏會永久消失。',
          style: text.bodySmall?.copyWith(color: AppColors.muted),
        ),
        const SizedBox(height: 12),
        OutlinedButton(
          style: OutlinedButton.styleFrom(foregroundColor: AppColors.danger),
          onPressed: _deleting ? null : () => _deleteAccount(nickname, tasks),
          child: Text(_deleting ? '刪除中...' : '刪除帳號'),
        ),
        if (_deleteError != null) ...[
          const SizedBox(height: 8),
          Text(_deleteError!, style: text.bodySmall?.copyWith(color: AppColors.danger)),
        ],
```

確認對話框。`requireText` 是 null 時只有兩顆按鈕，有值時要打對才啟用確認：

```dart
class _ConfirmDeleteDialog extends StatefulWidget {
  final DeleteAccountPrompt prompt;

  const _ConfirmDeleteDialog({required this.prompt});

  @override
  State<_ConfirmDeleteDialog> createState() => _ConfirmDeleteDialogState();
}

class _ConfirmDeleteDialogState extends State<_ConfirmDeleteDialog> {
  final _typed = TextEditingController();

  @override
  void dispose() {
    _typed.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final require = widget.prompt.requireText;
    final ready = require == null || _typed.text.trim() == require;

    return AlertDialog(
      title: Text(widget.prompt.title),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(widget.prompt.message),
            if (require != null) ...[
              const SizedBox(height: 16),
              Text('請打出「$require」以確認：'),
              TextField(
                controller: _typed,
                autofocus: true,
                onChanged: (_) => setState(() {}),
              ),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(false),
          child: const Text('取消'),
        ),
        FilledButton(
          style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
          onPressed: ready ? () => Navigator.of(context).pop(true) : null,
          child: Text(widget.prompt.confirmLabel),
        ),
      ],
    );
  }
}
```

`tasks` 這一頁目前沒有。用與 `task_list_page.dart` 相同的來源取得使用者的任務清單，
在建立畫面時讀一次即可 —— 這裡只需要總數與擁有的數量，不需要即時訂閱。

- [x] **Step 6: Commit 並讓 CI 驗證**

```bash
git add flutter_app/pubspec.yaml flutter_app/pubspec.lock flutter_app/lib/domain/account_deletion.dart flutter_app/lib/data/auth_repository.dart flutter_app/lib/ui/profile_page.dart flutter_app/test/support_test.dart
git commit -m "Give people a way out on the phone too"
git push origin main
```

輪詢 CI，**綠之前不要宣稱完成**。注意 `pubspec.lock` 會因為新相依而變動，要一起 commit。

---

### Task 8: 部署

**Files:** 無

- [x] **Step 1: 先部署函式**

```bash
cd functions && npm run build && npx vitest run
cd .. && npx firebase deploy --only functions
```

Expected: `deleteAccount(asia-east1)` **Successful create operation**

**順序不能反。** 用戶端先上線的話，按鈕會出現但呼叫失敗（`not-found`）。

- [x] **Step 2: 再部署網頁**

```bash
npm run deploy
```

- [ ] **Step 3: 在正式環境用一個測試帳號實際刪一次**

建一個測試帳號、建兩個任務（一個只有自己、一個多拉一個人進來），然後刪掉。確認：

- 只有自己的那個任務整個消失
- 有別人的那個任務還在，owner 換人，自己的名字顯示成「（已刪除）」，支出還在
- 用同一個 Google 帳號重新登入會走 onboarding 取暱稱（代表 `users/{uid}` 真的刪掉了）
