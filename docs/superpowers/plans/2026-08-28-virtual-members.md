# 虛擬成員 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓沒有 Google 帳號的人（主要是長輩）能被建立成「虛擬成員」記進帳裡 —— 可以被指定為付款人、可以被分攤、會出現在結算，只是他自己打不開 App。

**Architecture:** 虛擬成員就是一份 member 文件，文件 ID 是合成的 `v_` + 20 個小寫英數（固定 22 字元，Firebase uid 是 28 字元，長度就不可能碰撞），並且照常寫進 `task.memberIds`。因為記帳、分攤、結算的程式碼只把成員 id 當字串 key 在用，那三塊完全不必改。規則只動兩處：新增一條 admin 專用的建立路徑（用正規式強制 id 格式），以及收緊既有的 `managesMemberAsAdmin()` 不讓虛擬成員被升成 admin、也不讓 `virtual` 欄位被翻轉。

**Tech Stack:** Vue 3 + TypeScript + Vite + Vitest（網頁版）、Flutter 3.47 / Dart 3.13 + Riverpod + `package:test`（原生版）、Firestore Security Rules + `@firebase/rules-unit-testing`。

**Spec:** `docs/superpowers/specs/2026-08-28-virtual-members-design.md`

## Global Constraints

- **合成 id 格式固定為 `^v_[a-z0-9]{20}$`**（`v_` 前綴 + 20 個小寫英數 = 22 字元）。這個字串在四個地方各出現一次：網頁版產生器、Flutter 產生器、Firestore 規則、規則測試。**四處必須完全一致。**
- **前綴檢查是安全必需，不是選配。** admin 本來就能往 `task.memberIds` 塞任意字串（`updatesTaskAsAdmin()` 沒有 `hasOnly`），建立路徑若不驗格式，這條新規則會變成「admin 可以偽造任何真實使用者的 member 文件」的後門。
- **虛擬成員的 `role` 永遠是 `"member"`**，不能被升成 admin。
- **既有 member 文件沒有 `virtual` 欄位**。規則一律用 `.get("virtual", false)`；兩邊的程式碼一律當成 `false`，不做資料回填。
- **不做認領。** 虛擬成員永遠不會換成真帳號。
- **不改**：記帳、分攤、結算、支出規則、付款規則、公開旅費報告。
- 兩個 codebase 讀同一個 Firestore，所以**成員列都必須改**，否則另一邊會對虛擬成員給出會失敗的操作。
- 中文註解與 UI 文案沿用現有語氣：說明「為什麼」而不是複述程式碼。

---

### Task 1: 讓規則測試能在 CI 跑

規則改動是這個功能唯一的風險點，而本機跑不了規則測試（firebase-tools 需要 JDK 21，這台是 11，公司擋了 Microsoft Store 導致 winget 取不到來源）。`todo.md` 已有這條待辦。**先把驗證管道打通，再改規則。**

**Files:**
- Create: `.github/workflows/rules.yml`
- Modify: `todo.md`（把「待辦：用 GitHub Actions 跑規則測試」改成已完成）

**Interfaces:**
- Consumes: 無
- Produces: 每次 push 會執行 `npm run test:rules`，後續 Task 4 靠它驗證

- [ ] **Step 1: 建立 workflow**

`.github/workflows/rules.yml`：

```yaml
# Firestore / Storage 規則測試。
#
# 開發機（Windows）裝不了 JDK 21，而 firebase emulator 是 Java 程式，
# 所以規則測試只能在這裡跑。規則出錯的代價是資料外洩或功能整個壞掉，
# 那正是最不該依賴某一台機器環境的地方。
name: rules

on:
  push:
  pull_request:

jobs:
  test-rules:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      # emulator 需要 Java。runner 內建 JDK，這裡只是釘住版本。
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: 21

      - run: npm ci

      # 純函式測試順便一起跑，它們比規則測試快得多，先掛掉先知道。
      - run: npm test

      - run: npm run test:rules
```

- [ ] **Step 2: 確認 workflow 檔案寫得出預期內容**

Run: `node -e "const f=require('fs').readFileSync('.github/workflows/rules.yml','utf8'); if(!/test:rules/.test(f)) throw new Error('缺 test:rules'); console.log('ok')"`
Expected: 印出 `ok`

- [ ] **Step 3: 更新 todo.md**

把 `## 待辦：用 GitHub Actions 跑規則測試` 這個標題改成 `## 已完成：用 GitHub Actions 跑規則測試`，並在該段末尾補一行：

```markdown
`.github/workflows/rules.yml`：每次 push 與 PR 跑 `npm test` 與 `npm run test:rules`。
```

- [ ] **Step 4: Commit 並推上去看 CI 綠燈**

```bash
git add .github/workflows/rules.yml todo.md
git commit -m "Run the rules tests where Java actually exists"
git push
```

**驗收**：GitHub Actions 上這個 workflow 跑完且為綠。**這一步沒綠就不要往下做** —— 後面所有規則改動都靠它把關。

---

### Task 2: 合成 id 產生器（網頁版）

**Files:**
- Create: `src/utils/virtualMember.ts`
- Test: `tests/virtualMember.test.ts`

**Interfaces:**
- Consumes: 無
- Produces:
  - `VIRTUAL_MEMBER_ID_PATTERN: RegExp`
  - `generateVirtualMemberId(): string`
  - `isVirtualMemberId(id: string): boolean`

- [ ] **Step 1: 寫失敗的測試**

`tests/virtualMember.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import {
  VIRTUAL_MEMBER_ID_PATTERN,
  generateVirtualMemberId,
  isVirtualMemberId
} from "@/utils/virtualMember";

describe("generateVirtualMemberId", () => {
  it("符合規則裡那條正規式", () => {
    for (let i = 0; i < 50; i += 1) {
      expect(generateVirtualMemberId()).toMatch(VIRTUAL_MEMBER_ID_PATTERN);
    }
  });

  // Firebase uid 是 28 字元。長度對不上，就不可能有虛擬成員的 id
  // 撞到真人的 uid —— 而 memberIds 同時是權限清單，撞到就是權限漏洞。
  it("固定 22 字元，跟 Firebase uid 的 28 字元對不上", () => {
    expect(generateVirtualMemberId()).toHaveLength(22);
  });

  it("連續產生不重複", () => {
    const ids = new Set(Array.from({ length: 500 }, () => generateVirtualMemberId()));
    expect(ids.size).toBe(500);
  });
});

describe("isVirtualMemberId", () => {
  it("認得合格的 id", () => {
    expect(isVirtualMemberId("v_k3n8x2p9qz1m4w7t6r0a")).toBe(true);
  });

  it.each([
    ["沒有前綴", "k3n8x2p9qz1m4w7t6r0ab"],
    ["長度不對", "v_k3n8x2p9"],
    ["含大寫", "v_K3n8x2p9qz1m4w7t6r0a"],
    ["含底線", "v_k3n8x2p9qz1m4w7t6r_a"],
    ["真實 uid 長度", "abcdefghijklmnopqrstuvwxyz12"],
    ["空字串", ""]
  ])("擋掉%s", (_label, id) => {
    expect(isVirtualMemberId(id)).toBe(false);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm test -- tests/virtualMember.test.ts`
Expected: FAIL —— 找不到模組 `@/utils/virtualMember`

- [ ] **Step 3: 寫實作**

`src/utils/virtualMember.ts`：

```ts
/**
 * 虛擬成員的 member 文件 ID。
 *
 * 格式是 `v_` + 20 個小寫英數，固定 22 字元。這個 id 會被寫進
 * `task.memberIds`，而 `memberIds` 同時是權限清單（`isTaskMember()` 判斷的是
 * `request.auth.uid in memberIds`），所以它**必須不可能等於任何真實 uid**：
 * Firebase Auth 的 uid 是 28 字元，長度就對不上。
 *
 * 這條格式在四個地方各出現一次 —— 這裡、Flutter 的
 * `lib/domain/virtual_member.dart`、`firestore.rules`、規則測試。改一處就要改四處。
 */

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const BODY_LENGTH = 20;

export const VIRTUAL_MEMBER_ID_PATTERN = /^v_[a-z0-9]{20}$/;

/**
 * 用 `crypto.getRandomValues` 而不是 `Math.random`，理由是碰撞而不是保密 ——
 * 這個 id 不是門禁（邀請碼才是），知道它也進不來，但它一旦跟另一個虛擬成員
 * 撞號，兩個人的帳就會合在一起。
 *
 * `% ALPHABET.length` 有模數偏差，這裡無所謂：20 個字元的 36 進位有約 103 bits，
 * 偏差吃掉的那點熵離碰撞還差得很遠。
 */
export function generateVirtualMemberId(): string {
  const bytes = new Uint8Array(BODY_LENGTH);
  crypto.getRandomValues(bytes);

  let id = "v_";
  for (const byte of bytes) id += ALPHABET[byte % ALPHABET.length];
  return id;
}

export function isVirtualMemberId(id: string): boolean {
  return VIRTUAL_MEMBER_ID_PATTERN.test(id);
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npm test -- tests/virtualMember.test.ts`
Expected: PASS，全部案例通過

- [ ] **Step 5: 型別檢查**

Run: `npm run check`
Expected: 無錯誤

- [ ] **Step 6: Commit**

```bash
git add src/utils/virtualMember.ts tests/virtualMember.test.ts
git commit -m "Give account-less members an id that cannot be a real uid"
```

---

### Task 3: 合成 id 產生器（Flutter）

Task 2 的 Dart 版，格式必須一模一樣。放在 `domain/` 而不是 `data/`，因為它是純函式、要用 `package:test` 測（`domain/` 不准 import Flutter，是編譯器擋著的）。

**Files:**
- Create: `flutter_app/lib/domain/virtual_member.dart`
- Test: `flutter_app/test/virtual_member_test.dart`

**Interfaces:**
- Consumes: 無
- Produces:
  - `virtualMemberIdPattern` (`RegExp`)
  - `generateVirtualMemberId() -> String`
  - `isVirtualMemberId(String id) -> bool`

- [ ] **Step 1: 寫失敗的測試**

`flutter_app/test/virtual_member_test.dart`：

```dart
import 'package:test/test.dart';
import 'package:splitflow/domain/virtual_member.dart';

/// `tests/virtualMember.test.ts` 的 Dart 版。格式必須跟網頁版一模一樣 ——
/// 兩邊寫進同一個 Firestore，也被同一條規則檢查。
void main() {
  group('generateVirtualMemberId', () {
    test('符合規則裡那條正規式', () {
      for (var i = 0; i < 50; i++) {
        expect(generateVirtualMemberId(), matches(virtualMemberIdPattern));
      }
    });

    // Firebase uid 是 28 字元。長度對不上，就不可能撞到真人的 uid ——
    // 而 memberIds 同時是權限清單，撞到就是權限漏洞。
    test('固定 22 字元，跟 Firebase uid 的 28 字元對不上', () {
      expect(generateVirtualMemberId().length, 22);
    });

    test('連續產生不重複', () {
      final ids = {for (var i = 0; i < 500; i++) generateVirtualMemberId()};
      expect(ids.length, 500);
    });
  });

  group('isVirtualMemberId', () {
    test('認得合格的 id', () {
      expect(isVirtualMemberId('v_k3n8x2p9qz1m4w7t6r0a'), isTrue);
    });

    test('擋掉格式不對的', () {
      expect(isVirtualMemberId('k3n8x2p9qz1m4w7t6r0ab'), isFalse, reason: '沒有前綴');
      expect(isVirtualMemberId('v_k3n8x2p9'), isFalse, reason: '長度不對');
      expect(isVirtualMemberId('v_K3n8x2p9qz1m4w7t6r0a'), isFalse, reason: '含大寫');
      expect(isVirtualMemberId('v_k3n8x2p9qz1m4w7t6r_a'), isFalse, reason: '含底線');
      expect(isVirtualMemberId('abcdefghijklmnopqrstuvwxyz12'), isFalse, reason: '真實 uid 長度');
      expect(isVirtualMemberId(''), isFalse, reason: '空字串');
    });
  });
}
```

- [ ] **Step 2: 跑測試確認失敗**

先設好環境（每個 shell 要設一次）：

```bash
export ANDROID_HOME=/c/dev/android-sdk
export PATH="/c/dev/flutter/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
```

Run: `cd flutter_app && dart test test/virtual_member_test.dart`
Expected: FAIL —— 找不到 `package:splitflow/domain/virtual_member.dart`

- [ ] **Step 3: 寫實作**

`flutter_app/lib/domain/virtual_member.dart`：

```dart
import 'dart:math';

/// 虛擬成員的 member 文件 ID。`src/utils/virtualMember.ts` 的 Dart 版。
///
/// 格式是 `v_` + 20 個小寫英數，固定 22 字元。這個 id 會被寫進
/// `task.memberIds`，而 `memberIds` 同時是權限清單，所以它**必須不可能等於
/// 任何真實 uid** —— Firebase Auth 的 uid 是 28 字元，長度就對不上。
///
/// 這條格式在四個地方各出現一次：這裡、網頁版的 `src/utils/virtualMember.ts`、
/// `firestore.rules`、規則測試。改一處就要改四處。
library;

const String _alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
const int _bodyLength = 20;

final RegExp virtualMemberIdPattern = RegExp(r'^v_[a-z0-9]{20}$');

/// 用 `Random.secure()` 的理由是碰撞而不是保密 —— 這個 id 不是門禁
/// （邀請碼才是），但它一旦跟另一個虛擬成員撞號，兩個人的帳會合在一起。
String generateVirtualMemberId() {
  final random = Random.secure();
  final buffer = StringBuffer('v_');
  for (var i = 0; i < _bodyLength; i++) {
    buffer.write(_alphabet[random.nextInt(_alphabet.length)]);
  }
  return buffer.toString();
}

bool isVirtualMemberId(String id) => virtualMemberIdPattern.hasMatch(id);
```

- [ ] **Step 4: 跑測試確認通過**

Run: `cd flutter_app && dart test test/virtual_member_test.dart`
Expected: PASS

- [ ] **Step 5: 跑全部測試與 analyzer**

Run: `cd flutter_app && dart test && dart analyze`
Expected: 全部通過（原本 166 項 + 這次新增的），analyzer 無警告

- [ ] **Step 6: Commit**

```bash
git add flutter_app/lib/domain/virtual_member.dart flutter_app/test/virtual_member_test.dart
git commit -m "Mirror the virtual member id format on the native side"
```

---

### Task 4: Firestore 規則

整個功能唯一的規則改動，也是唯一的風險點。**先寫規則測試，確認它失敗，再改規則。**

**Files:**
- Modify: `firestore.rules`（`match /tasks/{taskId}/members/{uid}` 區塊，約 122-158 行）
- Test: `tests/firestore.rules.test.mjs`

**Interfaces:**
- Consumes: Task 2/3 定下的 `^v_[a-z0-9]{20}$`
- Produces: 規則允許 admin 建立虛擬成員；Task 5/6 的服務層靠它

- [ ] **Step 1: 寫失敗的規則測試**

先在 `tests/firestore.rules.test.mjs` 上方的常數區（`const CODE = "invitecode1";` 那一帶）加一行：

```js
const VIRTUAL = "v_k3n8x2p9qz1m4w7t6r0a";
```

然後在「移除成員」那一組測試後面加一整組。`seed()`、`as()`、`test()`、`assertFails`、`assertSucceeds` 都是檔案裡現成的：

```js
  // --- 虛擬成員 ---
  // 沒有帳號的人（長輩）由 admin 代為建立。合成 id 進得了 memberIds，
  // 但它永遠不等於任何 request.auth.uid，所以拿不到任何權限。
  async function createVirtual(db, id = VIRTUAL, overrides = {}) {
    const batch = writeBatch(db);
    batch.set(doc(db, "tasks", TASK, "members", id), {
      uid: id,
      nickname: "阿嬤",
      role: "member",
      joinedAt: new Date(),
      active: true,
      virtual: true,
      ...overrides
    });
    batch.update(doc(db, "tasks", TASK), {
      memberIds: arrayUnion(id),
      memberCount: increment(1),
      updatedAt: serverTimestamp()
    });
    return batch.commit();
  }

  await test("admin 可以建立虛擬成員", async () => {
    await seed();
    await assertSucceeds(createVirtual(as(ADMIN)));
  });

  await test("owner 可以建立虛擬成員", async () => {
    await seed();
    await assertSucceeds(createVirtual(as(OWNER)));
  });

  await test("一般成員不能建立虛擬成員", async () => {
    await seed();
    await assertFails(createVirtual(as(MEMBER)));
  });

  await test("外人不能建立虛擬成員", async () => {
    await seed();
    await assertFails(createVirtual(as(OUTSIDER)));
  });

  // 這條是安全核心：admin 本來就能往 memberIds 塞任意字串，
  // 建立路徑若不驗格式，就等於 admin 可以偽造任何真人的 member 文件。
  await test("id 沒有 v_ 前綴會被擋", async () => {
    await seed();
    await assertFails(createVirtual(as(ADMIN), "k3n8x2p9qz1m4w7t6r0ab"));
  });

  await test("id 長度不對會被擋", async () => {
    await seed();
    await assertFails(createVirtual(as(ADMIN), "v_k3n8x2p9"));
  });

  await test("id 含大寫會被擋", async () => {
    await seed();
    await assertFails(createVirtual(as(ADMIN), "v_K3n8x2p9qz1m4w7t6r0a"));
  });

  await test("admin 不能藉這條路建立真人的 member 文件", async () => {
    await seed();
    await assertFails(createVirtual(as(ADMIN), OUTSIDER));
  });

  await test("缺 virtual: true 走不了這條路", async () => {
    await seed();
    await assertFails(createVirtual(as(ADMIN), VIRTUAL, { virtual: false }));
  });

  await test("虛擬成員不能一開始就是 admin", async () => {
    await seed();
    await assertFails(createVirtual(as(ADMIN), VIRTUAL, { role: "admin" }));
  });

  await test("虛擬成員不能被升成 admin", async () => {
    await seed();
    await createVirtual(as(ADMIN));
    const db = as(ADMIN);
    const batch = writeBatch(db);
    batch.update(doc(db, "tasks", TASK, "members", VIRTUAL), { role: "admin" });
    batch.update(doc(db, "tasks", TASK), { adminIds: arrayUnion(VIRTUAL), updatedAt: serverTimestamp() });
    await assertFails(batch.commit());
  });

  await test("不能把真實成員翻成虛擬", async () => {
    await seed();
    await assertFails(updateDoc(doc(as(ADMIN), "tasks", TASK, "members", OTHER), { virtual: true }));
  });

  await test("不能把虛擬成員翻回真實", async () => {
    await seed();
    await createVirtual(as(ADMIN));
    await assertFails(updateDoc(doc(as(ADMIN), "tasks", TASK, "members", VIRTUAL), { virtual: false }));
  });

  await test("虛擬成員可以改名", async () => {
    await seed();
    await createVirtual(as(ADMIN));
    await assertSucceeds(updateDoc(doc(as(ADMIN), "tasks", TASK, "members", VIRTUAL), { nickname: "外婆" }));
  });

  await test("虛擬成員可以被移除", async () => {
    await seed();
    await createVirtual(as(ADMIN));
    const db = as(ADMIN);
    const batch = writeBatch(db);
    batch.update(doc(db, "tasks", TASK, "members", VIRTUAL), { active: false, role: "member" });
    batch.update(doc(db, "tasks", TASK), {
      memberIds: arrayRemove(VIRTUAL),
      adminIds: arrayRemove(VIRTUAL),
      memberCount: increment(-1),
      updatedAt: serverTimestamp()
    });
    await assertSucceeds(batch.commit());
  });

  await test("虛擬成員可以當支出的付款人與分攤對象", async () => {
    await seed();
    await createVirtual(as(ADMIN));
    const db = as(MEMBER);
    await assertSucceeds(
      setDoc(doc(db, "tasks", TASK, "expenses", "e_virtual"), {
        title: "阿嬤請客",
        category: "food",
        amount: 6000,
        currency: "TWD",
        rate: 1,
        baseAmount: 6000,
        paidBy: VIRTUAL,
        splitMode: "even",
        splits: { [VIRTUAL]: 3000, [MEMBER]: 3000 },
        createdBy: MEMBER,
        date: "2026-08-28",
        time: "",
        note: "",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      })
    );
  });
```

**注意**：最後那筆支出的欄位要跟 `seed()` 裡那筆 `e1` 完全對齊。若 `validExpenseShape()` 要求的欄位跟上面寫的對不上，**以 `seed()` 的 `e1` 為準補齊，不要改規則**。

- [ ] **Step 2: 跑規則測試確認新案例失敗**

本機跑不動（JDK 11）。推到分支讓 Task 1 的 CI 跑：

```bash
git add tests/firestore.rules.test.mjs
git commit -m "Describe what a virtual member may and may not do"
git push
```

Expected: CI 紅燈。「admin 可以建立虛擬成員」等案例 FAIL（現在的 `allow create` 只認 `isSelf(uid)`）。

- [ ] **Step 3: 改規則 —— 新增建立路徑**

在 `firestore.rules` 的 `match /tasks/{taskId}/members/{uid}` 區塊裡，`rejoinsSelf()` 後面加：

```
        /*
          虛擬成員：沒有帳號的人（長輩），由 owner/admin 代為建立。

          `uid.matches` 那條是**安全核心而不是格式潔癖**。admin 本來就能往
          task.memberIds 塞任意字串（updatesTaskAsAdmin 沒有 hasOnly），
          少了它，這條路就是「admin 可以替任何真人偽造 member 文件」的後門。
          合成 id 固定 22 字元，Firebase uid 是 28 字元，長度就對不上。

          用 taskAfterData 而不是 taskData，理由跟下面的 create 一樣：
          member 文件與 task.memberIds 在同一個 batch 裡寫。
        */
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

然後把 `allow create` 現有那一整串包起來，末尾接上這條路：

```
        allow create: if (
            isSelf(uid)
            && taskAfterData(taskId).status == "active"
            && uid in taskAfterData(taskId).memberIds
            && request.resource.data.uid == request.auth.uid
            && request.resource.data.active == true
            && request.resource.data.role in ["owner", "member"]
            && (
              request.resource.data.role == "member"
              || taskAfterData(taskId).ownerId == request.auth.uid
            )
          ) || createsVirtualMember();
```

- [ ] **Step 4: 改規則 —— 收緊 managesMemberAsAdmin()**

`managesMemberAsAdmin()` 沒有 `hasOnly`，所以 admin 從那條路可以改 `role`、`active`、`nickname`。虛擬成員要沿用它來改名與移除，但不能被升成 admin。在函式的 `return` 條件末尾加兩條：

```
            && request.resource.data.get("virtual", false) == resource.data.get("virtual", false)
            && (
              resource.data.get("virtual", false) == false
              || request.resource.data.role == "member"
            );
```

並在函式上方的註解補一段：

```
        // 虛擬成員只能停在 member —— 升成 admin 沒有意義（他沒有帳號，
        // adminIds 裡多一個合成 id 不會讓任何人拿到權限），但會讓成員列
        // 顯示一個永遠不會生效的「管理員」。virtual 本身也不准翻轉，
        // 否則真人與虛擬的界線就沒了。
        // 用 .get("virtual", false) 是因為既有成員文件沒有這個欄位。
```

- [ ] **Step 5: 推上去確認 CI 綠燈**

```bash
git add firestore.rules
git commit -m "Let admins add a member who has no account"
git push
```

Expected: CI 綠燈，新增的所有規則測試通過，**而且既有的規則測試一個都沒壞** —— 特別是「角色升降」與「移除成員」那兩組，Step 4 動的正是它們共用的函式。

- [ ] **Step 6: 部署規則**

Run: `npm run deploy:rules`
Expected: 部署成功。**CI 沒綠之前不要跑這一步。**

---

### Task 5: 網頁版資料層

**Files:**
- Modify: `src/types/member.ts`
- Modify: `src/services/memberService.ts`

**Interfaces:**
- Consumes: `generateVirtualMemberId()`（Task 2）、規則的建立路徑（Task 4）
- Produces:
  - `TaskMember.virtual?: boolean`
  - `createVirtualMember(taskId: string, nickname: string): Promise<string>`
  - `renameMember(taskId: string, uid: string, nickname: string): Promise<void>`

**為什麼要有 `renameMember`**：真實成員的暱稱來自個人資料，他自己改。虛擬成員沒有個人資料，名字是建立時打進去的 —— 沒有改名功能的話，打錯字就永遠改不掉（移除重建會讓舊支出留在前一個 id 上）。原本的 spec 誤寫成「沿用現有的 nickname 更新」，但成員管理從來沒有那條路。

- [ ] **Step 1: 型別加欄位**

`src/types/member.ts` 的 `TaskMember` 介面加：

```ts
  /**
   * 這個成員沒有帳號，由 owner/admin 代為建立，只存在於帳目上。
   * 舊文件沒有這個欄位，一律當成 false。
   */
  virtual?: boolean;
```

`listTaskMembers()` 與 `getTaskMember()` 都是 `snap.data() as TaskMember`，欄位會自己流過來，那兩個函式不用改。

- [ ] **Step 2: 加 createVirtualMember**

`src/services/memberService.ts` 頂部加 import：

```ts
import { generateVirtualMemberId } from "@/utils/virtualMember";
```

在 `joinTask()` 後面加：

```ts
/**
 * 建立一個沒有帳號的成員。給長輩這種連 Gmail 都沒有、但確實有參與分帳的人。
 *
 * 用 writeBatch 而不是 joinTask 那種 transaction：id 是現場產生的，不可能
 * 已經存在，所以沒有「先讀再決定」的需要。
 *
 * 回傳合成 id，呼叫端可以拿去預先選成付款人。
 */
export async function createVirtualMember(taskId: string, nickname: string): Promise<string> {
  const uid = generateVirtualMemberId();
  const batch = writeBatch(db);

  batch.set(doc(db, "tasks", taskId, "members", uid), {
    uid,
    nickname,
    role: "member",
    joinedAt: serverTimestamp(),
    active: true,
    virtual: true
  });
  batch.update(doc(db, "tasks", taskId), {
    memberIds: arrayUnion(uid),
    memberCount: increment(1),
    updatedAt: serverTimestamp()
  });

  await batch.commit();
  return uid;
}
```

`writeBatch`、`arrayUnion`、`increment`、`serverTimestamp`、`doc` 都已經在檔案的 import 清單裡，不用再加。

- [ ] **Step 3: 加 renameMember**

同一個檔案，接在 `createVirtualMember()` 後面：

```ts
/**
 * 改成員的暱稱。實務上只有虛擬成員會用到 —— 真實成員的暱稱來自個人資料，
 * 他自己改；虛擬成員沒有個人資料，名字是別人替他打的，所以打錯要有得改。
 *
 * 只動 member 文件，不碰 task。規則那邊走 managesMemberAsAdmin()。
 */
export async function renameMember(taskId: string, uid: string, nickname: string): Promise<void> {
  await updateDoc(doc(db, "tasks", taskId, "members", uid), { nickname });
}
```

`updateDoc` 目前**不在** import 清單裡，要加進 `firebase/firestore` 那一組。

- [ ] **Step 4: 型別檢查與既有測試**

Run: `npm run check && npm test`
Expected: 無型別錯誤；測試全過

- [ ] **Step 5: Commit**

```bash
git add src/types/member.ts src/services/memberService.ts
git commit -m "Let the web app write a member who has no account"
```

---

### Task 6: Flutter 資料層

順帶把 member 的 mapper 從 `task_repository.dart` 的私有 `_memberFrom` 搬到 `mappers.dart` 成為公開函式 —— 因為這次加的 `virtual` 正是「舊文件沒有這個欄位」那一類最容易出錯的地方（`active` 當初就踩過，程式碼裡還留著那段註解），而私有函式測不到。`mappers.dart` 的其他 `*FromMap` 都是公開且有測試的，跟著那個模式走。

**Files:**
- Modify: `flutter_app/lib/domain/models.dart`（`TaskMember`）
- Modify: `flutter_app/lib/data/mappers.dart`（新增 `memberFromMap`）
- Modify: `flutter_app/lib/data/task_repository.dart`（刪掉 `_memberFrom`、改用 `memberFromMap`、新增 `createVirtualMember`）
- Test: `flutter_app/test/mappers_test.dart`（加一組）

**Interfaces:**
- Consumes: `generateVirtualMemberId()`（Task 3）、規則的建立路徑（Task 4）
- Produces:
  - `TaskMember.virtual` (`bool`，預設 `false`)
  - `memberFromMap(Map<String, dynamic> data) -> TaskMember`
  - `TaskRepository.createVirtualMember(String taskId, String nickname) -> Future<String>`
  - `TaskRepository.renameMember(String taskId, String uid, String nickname) -> Future<void>`

- [ ] **Step 1: 先寫失敗的 mapper 測試**

`flutter_app/test/mappers_test.dart` 加一組（`mappers.dart` 與 `models.dart` 的 import 檔案裡已經有）：

```dart
  group('memberFromMap', () {
    test('讀得到虛擬成員', () {
      final member = memberFromMap({
        'uid': 'v_k3n8x2p9qz1m4w7t6r0a',
        'nickname': '阿嬤',
        'role': 'member',
        'active': true,
        'virtual': true,
      });
      expect(member.uid, 'v_k3n8x2p9qz1m4w7t6r0a');
      expect(member.nickname, '阿嬤');
      expect(member.virtual, isTrue);
    });

    // 這個欄位是虛擬成員功能之後才加的。舊文件沒有它 —— 猜成 true
    // 的話所有既有成員會一次全變成虛擬的。
    test('舊文件沒有 virtual 就當成真實成員', () {
      final member = memberFromMap({
        'uid': 'uid_member',
        'nickname': '小明',
        'role': 'member',
        'active': true,
      });
      expect(member.virtual, isFalse);
    });

    test('舊文件沒有 active 仍當成還在', () {
      final member = memberFromMap({'uid': 'u', 'nickname': 'n', 'role': 'member'});
      expect(member.active, isTrue);
      expect(member.virtual, isFalse);
    });
  });
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd flutter_app && dart test test/mappers_test.dart`
Expected: FAIL —— 沒有 `memberFromMap`

- [ ] **Step 3: 模型加欄位**

`flutter_app/lib/domain/models.dart` 的 `TaskMember`：

```dart
class TaskMember {
  final String uid;
  final String nickname;

  /// owner / admin / member。
  final String role;
  final bool active;

  /// 這個成員沒有帳號，由 owner/admin 代為建立，只存在於帳目上。
  /// 他不會登入，所以任何「他自己來操作」的介面都不該對他出現。
  final bool virtual;

  const TaskMember({
    required this.uid,
    required this.nickname,
    required this.role,
    required this.active,
    this.virtual = false,
  });
}
```

- [ ] **Step 4: mapper 搬家**

`flutter_app/lib/data/mappers.dart` 末尾加：

```dart
/// member 文件。`active` 與 `virtual` 都是後來才加的欄位，舊文件沒有 ——
/// 兩個都往「保守」的方向猜：還在、不是虛擬的。反過來猜的話，
/// 所有舊成員會一次消失或一次全變成虛擬。
TaskMember memberFromMap(Map<String, dynamic> data) {
  return TaskMember(
    uid: (data['uid'] as String?) ?? '',
    nickname: (data['nickname'] as String?) ?? '',
    role: (data['role'] as String?) ?? 'member',
    active: data['active'] != false,
    virtual: data['virtual'] == true,
  );
}
```

`flutter_app/lib/data/task_repository.dart`：刪掉 `_memberFrom`（約第 29-38 行），把所有呼叫處改成 `memberFromMap`。確認檔案頂端有 `import 'mappers.dart';`，沒有就加。

- [ ] **Step 5: 跑測試確認通過**

Run: `cd flutter_app && dart test test/mappers_test.dart`
Expected: PASS

- [ ] **Step 6: 加 createVirtualMember**

`flutter_app/lib/data/task_repository.dart` 頂端加 `import '../domain/virtual_member.dart';`，在 `joinTask()` 後面加：

```dart
  /// 建立一個沒有帳號的成員。給長輩這種連 Gmail 都沒有、但確實有參與分帳的人。
  ///
  /// 用 batch 而不是 joinTask 那種 transaction：id 是現場產生的，不可能
  /// 已經存在，所以沒有「先讀再決定」的需要。
  ///
  /// 回傳合成 id，呼叫端可以拿去預先選成付款人。
  Future<String> createVirtualMember(String taskId, String nickname) async {
    final uid = generateVirtualMemberId();
    final batch = db.batch();

    batch.set(membersRef(taskId).doc(uid), {
      'uid': uid,
      'nickname': nickname,
      'role': 'member',
      'joinedAt': FieldValue.serverTimestamp(),
      'active': true,
      'virtual': true,
    });
    batch.update(taskRef(taskId), {
      'memberIds': FieldValue.arrayUnion([uid]),
      'memberCount': FieldValue.increment(1),
      'updatedAt': FieldValue.serverTimestamp(),
    });

    await batch.commit();
    return uid;
  }

  /// 改成員的暱稱。實務上只有虛擬成員會用到 —— 真實成員的暱稱來自個人資料，
  /// 他自己改；虛擬成員沒有個人資料，名字是別人替他打的，所以打錯要有得改。
  ///
  /// 只動 member 文件，不碰 task。規則那邊走 managesMemberAsAdmin()。
  Future<void> renameMember(String taskId, String uid, String nickname) {
    return membersRef(taskId).doc(uid).update({'nickname': nickname});
  }
```

- [ ] **Step 7: 全部測試與 analyzer**

Run: `cd flutter_app && dart test && dart analyze`
Expected: 全過，analyzer 乾淨

- [ ] **Step 8: Commit**

```bash
git add flutter_app/lib/domain/models.dart flutter_app/lib/data/mappers.dart flutter_app/lib/data/task_repository.dart flutter_app/test/mappers_test.dart
git commit -m "Let the native app write a member who has no account"
```

---

### Task 7: 網頁版介面

**Files:**
- Modify: `src/components/member/MemberRow.vue`
- Modify: `src/pages/TaskPage.vue`（成員區塊約 500-518 行、script 約 253-263 行）

**Interfaces:**
- Consumes: `createVirtualMember()`、`renameMember()`、`TaskMember.virtual`（都來自 Task 5）
- Produces: 無（終端介面）

- [ ] **Step 1: MemberRow 認得虛擬成員**

`<script setup>` 加一個 computed，並在 `defineEmits` 加一個事件：

```ts
const isVirtual = computed(() => props.member.virtual === true);
```

```ts
const emit = defineEmits<{
  (e: "promote", uid: string): void;
  (e: "demote", uid: string): void;
  (e: "remove", uid: string): void;
  (e: "rename", uid: string): void;
}>();
```

模板改三處。角色標籤加註記：

```vue
      <p class="tiny">
        {{ ROLE_LABELS[member.role] }}<span v-if="isSelf"> · 你</span><span v-if="isVirtual"> · 無帳號</span>
      </p>
```

升降級按鈕加條件（「移除」那顆不動，照常顯示）：

```vue
      <button
        v-if="member.role === 'member' && !isVirtual"
        class="btn btn-ghost btn-sm"
        :disabled="busy"
        @click="emit('promote', member.uid)"
      >
        升為管理員
      </button>
      <button v-else-if="!isVirtual" class="btn btn-sm" :disabled="busy" @click="emit('demote', member.uid)">
        降為成員
      </button>
```

虛擬成員改放一顆「改名」（放在升降級的位置，「移除」照舊）：

```vue
      <button
        v-if="isVirtual"
        class="btn btn-ghost btn-sm"
        :disabled="busy"
        @click="emit('rename', member.uid)"
      >
        改名
      </button>
```

**為什麼收起升降級而不是讓它失敗**：規則會擋（Task 4），這裡收起只是不要讓人按了才知道 —— 跟 `members_tab.dart` 開頭那段註解同一個原則。

**為什麼虛擬成員需要改名**：真實成員的暱稱來自個人資料、他自己改；虛擬成員的名字是別人替他打的，打錯就沒有其他管道能修。

- [ ] **Step 2: TaskPage 加建立入口**

script 區把 import 補上：

```ts
import { createVirtualMember, removeMember, renameMember, setMemberRole } from "@/services/memberService";
```

加狀態與方法。刷新方式抄 `runMemberAction`（`TaskPage.vue:236-247`）—— 它成功後跑 `await Promise.all([taskState.load(), memberState.load()])`，錯誤走 `firebaseErrorMessage`，這裡照同一套：

```ts
const virtualNickname = ref("");
const addingVirtual = ref(false);

/** 長輩這類沒有 Google 帳號的人，由管理者代為建立。 */
async function addVirtualMember() {
  const nickname = virtualNickname.value.trim();
  if (!nickname || addingVirtual.value) return;

  addingVirtual.value = true;
  actionError.value = null;
  try {
    await createVirtualMember(taskId.value, nickname);
    virtualNickname.value = "";
    await Promise.all([taskState.load(), memberState.load()]);
  } catch (err) {
    actionError.value = firebaseErrorMessage(err);
  } finally {
    addingVirtual.value = false;
  }
}

/**
 * 改名只對虛擬成員開放。用 runMemberAction 是因為它已經處理好 busy 狀態、
 * 錯誤訊息與重新載入，跟升降級、移除走同一條路。
 */
function renameTaskMember(targetUid: string) {
  const target = memberState.members.value.find(member => member.uid === targetUid);
  const next = window.prompt("改成什麼名字？", target?.nickname ?? "")?.trim();
  if (!next || next === target?.nickname) return;

  return runMemberAction(targetUid, () => renameMember(taskId.value, targetUid, next.slice(0, 20)));
}
```

**注意 `window.prompt`**：`todo.md` 有一條「確認框統一」待辦，要把 `window.confirm` 換成 `ConfirmDialog`。`ConfirmDialog` 是確認框、不收文字輸入，所以這裡沒有現成元件可用。**先用 `window.prompt` 讓功能完整，並在 `todo.md` 那條待辦補一行說明這裡也要一起換掉** —— 不要為了改名順手做一個新的輸入對話框元件，那是另一件事。

`MemberRow` 迴圈要接上新事件：

```vue
              @rename="renameTaskMember"
```

模板的成員區塊，在 `MemberRow` 迴圈後面加：

```vue
            <div v-if="taskState.isAdmin.value" class="card stack">
              <strong>新增沒有帳號的成員</strong>
              <p class="tiny">
                長輩這類沒有 Google 帳號的人，可以先用名字記進帳裡 ——
                他會照常被分攤、出現在結算，只是不能自己打開這個網站。
              </p>
              <input
                v-model="virtualNickname"
                class="input"
                maxlength="20"
                placeholder="例如：阿嬤"
                @keyup.enter="addVirtualMember"
              />
              <button
                class="btn"
                :disabled="addingVirtual || !virtualNickname.trim()"
                @click="addVirtualMember"
              >
                {{ addingVirtual ? "新增中…" : "新增" }}
              </button>
            </div>
```

- [ ] **Step 3: 型別檢查與測試**

Run: `npm run check && npm test`
Expected: 無錯誤，測試全過

- [ ] **Step 4: 手動驗證**

Run: `npm run dev`

在瀏覽器裡：

1. 進一個任務的成員頁 → 新增「阿嬤」
2. 確認她出現在列表、標著「無帳號」、**沒有**「升為管理員」按鈕、**有**「改名」
3. 按「改名」改成「外婆」→ 列表跟著變
4. 去支出頁新增一筆支出、付款人選外婆 → 回結算頁確認她被算進去

- [ ] **Step 5: Commit**

```bash
git add src/components/member/MemberRow.vue src/pages/TaskPage.vue
git commit -m "Add someone to the trip who does not have an account"
```

---

### Task 8: Flutter 介面

**Files:**
- Modify: `flutter_app/lib/ui/members_tab.dart`

**Interfaces:**
- Consumes: `createVirtualMember()`、`renameMember()`、`TaskMember.virtual`（都來自 Task 6）
- Produces: 無（終端介面）

- [ ] **Step 1: `_MemberCard` 隱藏升降級、標出無帳號**

`_MemberCard.build` 裡，`showActions` 那一行下面加：

```dart
    // 虛擬成員沒有帳號，升成 admin 不會讓任何人拿到權限，規則也擋著。
    // 這裡收起來只是不要讓人按了才失敗。
    final showRoleActions = showActions && !member.virtual;
```

角色標籤改成：

```dart
    final label = switch (member.role) {
      'owner' => '擁有者',
      'admin' => '管理員',
      _ => member.virtual ? '成員 · 無帳號' : '成員',
    };
```

按鈕區：升級／降級那兩顆的條件改用 `showRoleActions`，「移除」那顆維持 `showActions`，另外在虛擬成員時多一顆「改名」：

```dart
                if (showActions && member.virtual)
                  TextButton(
                    onPressed: busy ? null : onRename,
                    child: const Text('改名'),
                  ),
```

`_MemberCard` 的建構子與欄位要跟著多一個 `final VoidCallback onRename;`（`required this.onRename`），呼叫端在 Step 4 接上。

- [ ] **Step 2: `_MembersTabState` 加建立流程**

加狀態：

```dart
  final _virtualNickname = TextEditingController();
  bool _addingVirtual = false;
```

加 `dispose` 與方法：

```dart
  @override
  void dispose() {
    _virtualNickname.dispose();
    super.dispose();
  }

  /// 長輩這類沒有 Google 帳號的人，由管理者代為建立。
  Future<void> _addVirtual() async {
    final nickname = _virtualNickname.text.trim();
    if (nickname.isEmpty || _addingVirtual) return;

    setState(() {
      _addingVirtual = true;
      _error = null;
    });
    try {
      await settleWrite(ref
          .read(taskRepositoryProvider)
          .createVirtualMember(widget.task.id, nickname));
      _virtualNickname.clear();
      ref.invalidate(membersProvider(widget.task.id));
      ref.invalidate(taskProvider(widget.task.id));
    } catch (err) {
      if (mounted) setState(() => _error = err.toString());
    } finally {
      if (mounted) setState(() => _addingVirtual = false);
    }
  }
```

**關於 `settleWrite` 的型別**：它的簽章是 `Future<WriteOutcome> settleWrite(Future<void> write, {Duration timeout})`（`lib/domain/offline_write.dart:28`）。`createVirtualMember` 回傳 `Future<String>`，但 Dart 的 `void` 是 top type，`Future<String>` 可以直接當 `Future<void>` 傳，上面的寫法會過。**不要為此改 `settleWrite`** —— 那是所有離線寫入的共用路徑。

- [ ] **Step 3: 加改名流程**

同一個 state class 再加一個方法：

```dart
  /// 改名只對虛擬成員開放 —— 真實成員的暱稱來自個人資料，他自己改。
  Future<void> _rename(TaskMember member) async {
    final controller = TextEditingController(text: member.nickname);
    final next = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('改名'),
        content: TextField(
          controller: controller,
          autofocus: true,
          maxLength: 20,
          decoration: const InputDecoration(counterText: ''),
          onSubmitted: (value) => Navigator.of(context).pop(value.trim()),
        ),
        actions: [
          TextButton(
            style: TextButton.styleFrom(foregroundColor: AppColors.muted),
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('取消'),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(controller.text.trim()),
            child: const Text('儲存'),
          ),
        ],
      ),
    );
    controller.dispose();

    if (next == null || next.isEmpty || next == member.nickname) return;

    await _run(
      member.uid,
      () => ref
          .read(taskRepositoryProvider)
          .renameMember(widget.task.id, member.uid, next),
    );
  }
```

- [ ] **Step 4: 接上 onRename 並加入建立卡片**

`build` 裡的 `_MemberCard(...)` 呼叫加一行：

```dart
              onRename: () => _rename(member),
```

`ListView` 裡，成員迴圈後面、那句「移除只拿掉權限…」說明文字前面插入：

```dart
          if (canManage) ...[
            Card(
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('新增沒有帳號的成員', style: text.titleMedium),
                    const SizedBox(height: 4),
                    Text(
                      '長輩這類沒有 Google 帳號的人，可以先用名字記進帳裡 —— '
                      '他會照常被分攤、出現在結算，只是不能自己打開這個 App。',
                      style: text.bodySmall,
                    ),
                    const SizedBox(height: 10),
                    TextField(
                      controller: _virtualNickname,
                      maxLength: 20,
                      decoration: const InputDecoration(
                        hintText: '例如：阿嬤',
                        counterText: '',
                      ),
                      onSubmitted: (_) => _addVirtual(),
                    ),
                    const SizedBox(height: 10),
                    FilledButton(
                      onPressed: _addingVirtual ? null : _addVirtual,
                      child: Text(_addingVirtual ? '新增中…' : '新增'),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),
          ],
```

- [ ] **Step 5: 測試與 analyzer**

Run: `cd flutter_app && dart test && dart analyze`
Expected: 全過，analyzer 乾淨

- [ ] **Step 6: 裝到模擬器手動驗證**

```bash
export ANDROID_HOME=/c/dev/android-sdk
export PATH="/c/dev/flutter/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
cd flutter_app && flutter run
```

照 README 那套「每個寫入都做完一次來回」的方式驗：

1. 成員頁新增「阿嬤」→ 她出現在列表、標著「無帳號」、沒有升降級按鈕、有「改名」
2. 按「改名」改成「外婆」→ 列表跟著變
3. 新增一筆支出，付款人選外婆、分攤含外婆 → 結算頁看她有沒有被算進去
4. 記一筆「付錢給外婆」的付款 → 確認它停在 pending → 用 admin 身分確認 → 看結算金額有沒有跟著動
5. 移除外婆 → 舊支出仍查得到她的暱稱
6. **打開網頁版看同一個任務** → 外婆在成員列表裡、也標著無帳號、沒有升級按鈕

第 4 步是這個功能的關鍵取捨在跑：虛擬成員永遠不會自己按「確認收到」，所以那筆付款只能由 admin 代為確認 —— 不做的話它會永遠卡在 pending，結算頁那句警告會永遠掛著。

第 5 步是重點：兩邊讀同一個 Firestore，這是唯一能驗證「另一邊沒被虛擬成員弄壞」的方法。

- [ ] **Step 7: Commit**

```bash
git add flutter_app/lib/ui/members_tab.dart
git commit -m "Add someone to the trip who does not have an account"
```

---

## 收尾

八個任務都做完後：

- [ ] `npm test && npm run check`（網頁版）
- [ ] `cd flutter_app && dart test && dart analyze`（原生版）
- [ ] CI 上 `npm run test:rules` 綠燈
- [ ] 更新 `todo.md`：加一段「已完成：虛擬成員」，並註明**刻意不做認領**與它的後果 —— 虛擬成員之後無法換成真帳號；若本人另外用 Google 登入加入，會是帳目上獨立的第二個人，沒有合併手段
- [ ] 更新 `todo.md` 的「待辦：確認框統一」：補上網頁版改名用了 `window.prompt`，換掉 `window.confirm` 時要一起處理
- [ ] 更新 `docs/superpowers/specs/2026-08-28-virtual-members-design.md`：把「改名走現有的 nickname 更新」改掉 —— 成員管理從來沒有那條路，改名是這次新做的
- [ ] 更新 `flutter_app/README.md` 的「已經搬過來的」清單
