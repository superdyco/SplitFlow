# 移除成員時可以選擇真實刪除 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓「加錯人」和「測試資料」清得掉 —— 移除成員時先數他有幾筆帳，沒帳就直接真刪，有帳就讓使用者選「保留結算資料」或「連帳一起真實移除」。

**Architecture:** 偵測與文案都是純函式，跑在正規化之後的 `Expense`／`Payment` 模型上，兩個 codebase 各一份、各自有測試。真實刪除是分批寫入，順序刻意設計成「member 文件最後才刪」，這樣中途失敗時那個人還在成員列表上，重按一次就能從頭再跑一遍。結算的算法完全不動 —— 參與者本來就從支出推導，把支出刪掉他自然就從結算消失。

**Tech Stack:** Vue 3 + TypeScript + Vite + Vitest（網頁版）、Flutter 3.47 / Dart 3.13 + Riverpod + `package:test`（原生版）、Firestore Security Rules。

**Spec:** `docs/superpowers/specs/2026-08-28-member-hard-delete-design.md`

## Global Constraints

- **⚠️ Flutter 在目前這台機器上驗證不了。** 實測 `flutter` 與 `dart` 都不在 PATH 上，`C:\dev\flutter`（README 寫的路徑）不存在，C: 與 D: 兩個磁碟都搜不到。**Flutter 的程式照寫，但 `dart test` 與 `dart analyze` 一律留到有環境的機器上跑。** 每個 Flutter 任務的最後都有一份「回家要驗的清單」，在跑完那份之前，那個任務只能算「已寫、未驗證」，commit message 不要宣稱通過測試。
- **規則測試也跑不了。** 實測本機是 JDK 11.0.16，而 `firebase-tools` 要 JDK 21（錯誤訊息：`firebase-tools no longer supports Java version before 21`）。2026-08-28 決定不用 GitHub Actions，改手動測試。規則測試照寫進 `tests/firestore.rules.test.mjs`，當作可執行的規格。
- **結算的算法一行都不能改。** `src/utils/settlement.ts` 的 `participants` 從支出與付款推導、不看 `memberIds`，這是對的。
- **真實刪除連別人付的支出一起刪** —— 只要那個人出現在 `splits` 裡。這是使用者明確選擇的行為，代價靠確認框揭露，不要在實作時自作主張改成別的。
- **結算紀錄快照（`settlements`）不刪。** 他的名字會留在裡面，這是刻意的。
- **偵測不必檢查 `splitMemberIds`** —— 網頁版的 `normalizeExpense()` 與 Flutter 的 `expenseFromMap()` 在讀取時就把它推回 `splits` 了。
- **收據沿用既有取捨**：best-effort 呼叫 `deleteReceipt()`，失敗就留孤兒檔，不發明新機制。
- 中文註解與 UI 文案沿用現有語氣：說明「為什麼」而不是複述程式碼。

---

# Part A：先補完虛擬成員的 Flutter 版

前一份計畫（`2026-08-28-virtual-members.md`）的 Task 3、6、8 因為環境問題沒做。
**它們跟這份計畫改同一批檔案**（`members_tab.dart`、`task_repository.dart`），
分開做一定會衝突，所以接到這裡一起完成。

網頁版的虛擬成員已經上線，規則也部署了 —— 這部分只補原生版。

---

### Task 1: Flutter 合成 id 產生器

網頁版 `src/utils/virtualMember.ts` 的 Dart 版，格式必須一模一樣。放在 `domain/`
而不是 `data/`，因為它是純函式、要用 `package:test` 測（`domain/` 不准 import
Flutter，是編譯器擋著的）。

**Files:**
- Create: `flutter_app/lib/domain/virtual_member.dart`
- Test: `flutter_app/test/virtual_member_test.dart`（**檔案已經存在**，是上一輪寫好但沒跑過的，內容照下面核對一次）

**Interfaces:**
- Consumes: 無
- Produces:
  - `virtualMemberIdPattern` (`RegExp`)
  - `generateVirtualMemberId() -> String`
  - `isVirtualMemberId(String id) -> bool`

- [ ] **Step 1: 核對既有的測試檔**

`flutter_app/test/virtual_member_test.dart` 應該是這個內容，不一樣就改成這樣：

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

- [ ] **Step 2: 寫實作**

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

- [ ] **Step 3: Commit（標明未驗證）**

```bash
git add flutter_app/lib/domain/virtual_member.dart flutter_app/test/virtual_member_test.dart
git commit -m "Mirror the virtual member id format on the native side"
```

- [ ] **Step 4: 回家要驗的清單**

```bash
export ANDROID_HOME=/c/dev/android-sdk
export PATH="/c/dev/flutter/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
cd flutter_app && dart test test/virtual_member_test.dart
```

Expected: 5 個測試全過。**同時確認 README 寫的那兩個路徑對不對** —— 目前這台機器上它們不存在，若你家那台也不是這個路徑，順手把 README 的「開發環境」那節改掉。

---

### Task 2: Flutter 資料層（虛擬成員）

順帶把 member 的 mapper 從 `task_repository.dart` 的私有 `_memberFrom` 搬到
`mappers.dart` 成為公開函式 —— 這次加的 `virtual` 正是「舊文件沒有這個欄位」
那一類最容易出錯的地方（`active` 當初就踩過，程式碼裡還留著那段註解），
而私有函式測不到。`mappers.dart` 的其他 `*FromMap` 都是公開且有測試的。

**Files:**
- Modify: `flutter_app/lib/domain/models.dart`（`TaskMember`，約第 313 行）
- Modify: `flutter_app/lib/data/mappers.dart`（新增 `memberFromMap`）
- Modify: `flutter_app/lib/data/task_repository.dart`（刪掉 `_memberFrom`、改用 `memberFromMap`、新增兩個方法）
- Test: `flutter_app/test/mappers_test.dart`

**Interfaces:**
- Consumes: `generateVirtualMemberId()`（Task 1）
- Produces:
  - `TaskMember.virtual` (`bool`，預設 `false`)
  - `memberFromMap(Map<String, dynamic> data) -> TaskMember`
  - `TaskRepository.createVirtualMember(String taskId, String nickname) -> Future<String>`
  - `TaskRepository.renameMember(String taskId, String uid, String nickname) -> Future<void>`

- [ ] **Step 1: 寫失敗的 mapper 測試**

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

- [ ] **Step 2: 模型加欄位**

`flutter_app/lib/domain/models.dart` 的 `TaskMember` 改成：

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

- [ ] **Step 3: mapper 搬家**

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

`flutter_app/lib/data/task_repository.dart`：刪掉 `_memberFrom`（約第 29-38 行），
把所有呼叫處改成 `memberFromMap`。確認檔案頂端有 `import 'mappers.dart';`，沒有就加。

- [ ] **Step 4: 加兩個寫入方法**

`flutter_app/lib/data/task_repository.dart` 頂端加
`import '../domain/virtual_member.dart';`，在 `joinTask()` 後面加：

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

- [ ] **Step 5: Commit（標明未驗證）**

```bash
git add flutter_app/lib/domain/models.dart flutter_app/lib/data/mappers.dart flutter_app/lib/data/task_repository.dart flutter_app/test/mappers_test.dart
git commit -m "Let the native app write a member who has no account"
```

- [ ] **Step 6: 回家要驗的清單**

Run: `cd flutter_app && dart test && dart analyze`
Expected: 全部通過（原本 166 項 + 新增的），analyzer 乾淨。
特別注意 `memberFromMap` 搬家後 `task_repository.dart` 有沒有漏改的呼叫處 —— analyzer 會抓到。

---

### Task 3: Flutter 介面（虛擬成員）

**Files:**
- Modify: `flutter_app/lib/ui/members_tab.dart`

**Interfaces:**
- Consumes: `createVirtualMember()`、`renameMember()`、`TaskMember.virtual`（Task 2）
- Produces: 無（終端介面）

- [ ] **Step 1: `_MemberCard` 隱藏升降級、標出無帳號、加改名**

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

按鈕區：升級／降級那兩顆的條件改用 `showRoleActions`，「移除」那顆維持
`showActions`，另外在虛擬成員時多一顆「改名」：

```dart
                if (showActions && member.virtual)
                  TextButton(
                    onPressed: busy ? null : onRename,
                    child: const Text('改名'),
                  ),
```

`_MemberCard` 的欄位與建構子多一個 `final VoidCallback onRename;`
（`required this.onRename`），呼叫端在 Step 3 接上。

- [ ] **Step 2: `_MembersTabState` 加建立與改名**

加狀態與 `dispose`：

```dart
  final _virtualNickname = TextEditingController();
  bool _addingVirtual = false;

  @override
  void dispose() {
    _virtualNickname.dispose();
    super.dispose();
  }
```

加兩個方法：

```dart
  /// 長輩這類沒有 Google 帳號的人，由管理者代為建立。
  ///
  /// 沒有走 _run 是因為那支函式要一個 uid 來標示哪一列在忙，而這裡還沒有人
  /// 可以標 —— id 要等寫入成功才存在。
  Future<void> _addVirtual() async {
    final nickname = _virtualNickname.text.trim();
    if (nickname.isEmpty || _addingVirtual) return;

    setState(() {
      _addingVirtual = true;
      _error = null;
    });
    try {
      // settleWrite 吃的是 Future<void>，而 createVirtualMember 回傳
      // Future<String>。Dart 的 void 是 top type，可以直接傳。
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

- [ ] **Step 3: 接上 onRename 並加入建立卡片**

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

- [ ] **Step 4: Commit（標明未驗證）**

```bash
git add flutter_app/lib/ui/members_tab.dart
git commit -m "Add someone to the trip who does not have an account"
```

- [ ] **Step 5: 回家要驗的清單**

```bash
cd flutter_app && dart analyze && flutter run
```

1. 成員頁新增「阿嬤」→ 出現在列表、標著「成員 · 無帳號」、沒有升降級、有「改名」
2. 改名成「外婆」→ 列表跟著變
3. 新增支出，付款人選外婆、分攤含外婆 → 結算頁看她有沒有被算進去
4. 記一筆付給外婆的款 → 停在 pending → 用 admin 身分確認 → 結算金額跟著動
5. **打開網頁版看同一個任務** → 外婆在成員列表、標著無帳號、沒有升級按鈕

---

# Part B：真實刪除

---

### Task 4: 網頁版純函式（偵測與文案）

**Files:**
- Create: `src/utils/memberFootprint.ts`
- Modify: `src/utils/memberRemoval.ts`
- Test: `tests/memberFootprint.test.ts`
- Test: `tests/memberRemoval.test.ts`（**檔案已存在**，加一組）

**Interfaces:**
- Consumes: 無
- Produces:
  - `MemberFootprint { expenseIds: string[]; paymentIds: string[] }`
  - `memberFootprint(uid: string, expenses: Expense[], payments: Payment[]): MemberFootprint`
  - `hasRecords(footprint: MemberFootprint): boolean`
  - `RemoveMemberPrompt { title: string; message: string; hasRecords: boolean; requireText: string | null }`
  - `removeMemberPrompt(input: RemoveMemberPromptInput): RemoveMemberPrompt`

- [ ] **Step 1: 寫失敗的偵測測試**

`tests/memberFootprint.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { hasRecords, memberFootprint } from "@/utils/memberFootprint";
import type { Expense } from "@/types/expense";
import type { Payment } from "@/types/payment";

function expense(id: string, paidBy: string, splits: Record<string, number>): Expense {
  return {
    id,
    title: "晚餐",
    category: "food",
    amount: 1000,
    currency: "TWD",
    rate: 1,
    baseAmount: 1000,
    paidBy,
    splitMode: "even",
    splits,
    note: "",
    place: null,
    receipt: null,
    date: "2026-08-28",
    time: "",
    createdBy: paidBy,
    createdAt: null,
    updatedAt: null
  } as unknown as Expense;
}

function payment(id: string, from: string, to: string, status: string): Payment {
  return { id, from, to, amount: 500, currency: "TWD", status, createdBy: from } as unknown as Payment;
}

describe("memberFootprint", () => {
  it("認得他是付款人的支出", () => {
    const result = memberFootprint("amma", [expense("e1", "amma", { ming: 1000 })], []);
    expect(result.expenseIds).toEqual(["e1"]);
  });

  it("認得他被分攤的支出 —— 就算是別人付的", () => {
    const result = memberFootprint("amma", [expense("e1", "ming", { ming: 500, amma: 500 })], []);
    expect(result.expenseIds).toEqual(["e1"]);
  });

  // 分攤金額是 0 也算參與 —— 自訂分攤可以給某個人 0 元。
  it("分攤金額 0 也算", () => {
    const result = memberFootprint("amma", [expense("e1", "ming", { ming: 1000, amma: 0 })], []);
    expect(result.expenseIds).toEqual(["e1"]);
  });

  it("既是付款人又在分攤裡，只算一次", () => {
    const result = memberFootprint("amma", [expense("e1", "amma", { amma: 500, ming: 500 })], []);
    expect(result.expenseIds).toEqual(["e1"]);
  });

  it("跟他無關的支出不算", () => {
    const result = memberFootprint("amma", [expense("e1", "ming", { ming: 500, hua: 500 })], []);
    expect(result.expenseIds).toEqual([]);
  });

  it("認得付款的兩端，pending 與 confirmed 都算", () => {
    const result = memberFootprint("amma", [], [
      payment("p1", "amma", "ming", "pending"),
      payment("p2", "ming", "amma", "confirmed"),
      payment("p3", "ming", "hua", "confirmed")
    ]);
    expect(result.paymentIds).toEqual(["p1", "p2"]);
  });

  it("完全沒帳時兩個陣列都是空的", () => {
    const result = memberFootprint("amma", [expense("e1", "ming", { ming: 1000 })], []);
    expect(result).toEqual({ expenseIds: [], paymentIds: [] });
  });
});

describe("hasRecords", () => {
  it("有支出就算有帳", () => {
    expect(hasRecords({ expenseIds: ["e1"], paymentIds: [] })).toBe(true);
  });

  it("只有付款也算有帳", () => {
    expect(hasRecords({ expenseIds: [], paymentIds: ["p1"] })).toBe(true);
  });

  it("兩個都空才是沒帳", () => {
    expect(hasRecords({ expenseIds: [], paymentIds: [] })).toBe(false);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm test -- tests/memberFootprint.test.ts`
Expected: FAIL —— 找不到模組 `@/utils/memberFootprint`

- [ ] **Step 3: 寫偵測實作**

`src/utils/memberFootprint.ts`：

```ts
/**
 * 一個成員在這個任務裡留下了哪些帳。
 *
 * 用來回答「移除他之後，結算頁還會不會看到他」——會，因為結算的參與者是從
 * 支出與付款推導的，不是從 `memberIds`。所以要讓他真的消失，得刪掉這些東西。
 *
 * **不必檢查 `splitMemberIds`**：那是自訂分攤之前的舊欄位，`normalizeExpense()`
 * 在讀取時就把它推回 `splits` 了，這裡拿到的一律是正規化之後的模型。
 */
import type { Expense } from "@/types/expense";
import type { Payment } from "@/types/payment";

export interface MemberFootprint {
  expenseIds: string[];
  paymentIds: string[];
}

function inSplits(expense: Expense, uid: string): boolean {
  // 用 hasOwnProperty 而不是 `uid in splits`：後者會命中原型鏈上的東西，
  // 例如 uid 剛好叫 "toString" 的話會誤判。分攤金額可以是 0，所以不能用
  // `splits[uid] ?` 之類的真值判斷。
  return Object.prototype.hasOwnProperty.call(expense.splits, uid);
}

export function memberFootprint(uid: string, expenses: Expense[], payments: Payment[]): MemberFootprint {
  return {
    expenseIds: expenses
      .filter(expense => expense.paidBy === uid || inSplits(expense, uid))
      .map(expense => expense.id),
    paymentIds: payments
      .filter(payment => payment.from === uid || payment.to === uid)
      .map(payment => payment.id)
  };
}

export function hasRecords(footprint: MemberFootprint): boolean {
  return footprint.expenseIds.length > 0 || footprint.paymentIds.length > 0;
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npm test -- tests/memberFootprint.test.ts`
Expected: PASS，10 個案例全過

- [ ] **Step 5: 寫失敗的文案測試**

`tests/memberRemoval.test.ts` 加一組（檔案已存在，import 補上 `removeMemberPrompt`）：

```ts
describe("removeMemberPrompt", () => {
  const base = { name: "阿嬤", balance: 0, currency: "TWD" };

  it("沒有帳時不給選擇，也不要求打字", () => {
    const prompt = removeMemberPrompt({ ...base, expenseCount: 0, paymentCount: 0 });
    expect(prompt.hasRecords).toBe(false);
    expect(prompt.requireText).toBeNull();
    expect(prompt.message).toContain("還沒有任何支出與付款記錄");
  });

  it("有帳時要求打出名字才能真刪", () => {
    const prompt = removeMemberPrompt({ ...base, expenseCount: 12, paymentCount: 2 });
    expect(prompt.hasRecords).toBe(true);
    expect(prompt.requireText).toBe("阿嬤");
  });

  it("把筆數數給使用者看", () => {
    const prompt = removeMemberPrompt({ ...base, expenseCount: 12, paymentCount: 2 });
    expect(prompt.message).toContain("12 筆支出");
    expect(prompt.message).toContain("2 筆付款記錄");
  });

  // 這兩句是整個功能的風險揭露，少一句都不行。
  it("講明會誤傷別人的帳", () => {
    const prompt = removeMemberPrompt({ ...base, expenseCount: 12, paymentCount: 0 });
    expect(prompt.message).toContain("別人付的");
  });

  it("講明結算紀錄裡他還在", () => {
    const prompt = removeMemberPrompt({ ...base, expenseCount: 12, paymentCount: 0 });
    expect(prompt.message).toContain("結算紀錄");
  });

  it("只有付款沒有支出時不會冒出「0 筆支出」", () => {
    const prompt = removeMemberPrompt({ ...base, expenseCount: 0, paymentCount: 3 });
    expect(prompt.message).toContain("3 筆付款記錄");
    expect(prompt.message).not.toContain("0 筆支出");
  });

  it("沒有名字時用代稱", () => {
    const prompt = removeMemberPrompt({ ...base, name: "", expenseCount: 0, paymentCount: 0 });
    expect(prompt.title).toContain("這位成員");
  });
});
```

- [ ] **Step 6: 跑測試確認失敗**

Run: `npm test -- tests/memberRemoval.test.ts`
Expected: FAIL —— `removeMemberPrompt` 不存在

- [ ] **Step 7: 寫文案實作**

`src/utils/memberRemoval.ts` 末尾加（`removeMemberMessage()` 保持不動，
「保留結算資料」那條路還在用它）：

```ts
export interface RemoveMemberPromptInput {
  name: string;
  expenseCount: number;
  paymentCount: number;
  balance: number;
  currency: string;
}

export interface RemoveMemberPrompt {
  title: string;
  message: string;
  /** true 代表要給「保留 / 真實移除」兩個選擇；false 代表直接刪。 */
  hasRecords: boolean;
  /** 真實移除要照著打的字。沒有帳時是 null —— 沒東西可失去就不該有摩擦。 */
  requireText: string | null;
}

/**
 * 移除成員的對話框內容。
 *
 * 分級摩擦跟 `ConfirmDialog` 的 `requireText` 是同一個道理：沒有帳的人刪掉
 * 風險是零，逼他打字只是懲罰；有 12 筆支出要一起消失就不一樣了。
 */
export function removeMemberPrompt({
  name,
  expenseCount,
  paymentCount,
  balance,
  currency
}: RemoveMemberPromptInput): RemoveMemberPrompt {
  const who = name || "這位成員";
  const title = `移除「${who}」`;

  if (expenseCount === 0 && paymentCount === 0) {
    return {
      title,
      message: `${who} 還沒有任何支出與付款記錄，會直接從這個任務移除。`,
      hasRecords: false,
      requireText: null
    };
  }

  // 只列真的有的那幾項，不然會出現「0 筆支出」這種讀起來很怪的句子。
  const counts = [
    expenseCount > 0 ? `${expenseCount} 筆支出` : null,
    paymentCount > 0 ? `${paymentCount} 筆付款記錄` : null
  ]
    .filter(Boolean)
    .join("、");

  const lines = [
    `${who} 出現在 ${counts}裡。`,
    "",
    `・保留結算資料：${removeMemberMessage({ name: who, balance, currency })}`,
    "",
    `・真實移除：連同那 ${counts}一起刪除，無法復原。其中有些支出是別人付的，刪掉之後那些人的帳也會跟著不見。結算紀錄裡仍然看得到他的名字。`
  ];

  return {
    title,
    message: lines.join("\n"),
    hasRecords: true,
    requireText: who
  };
}
```

- [ ] **Step 8: 跑測試確認通過**

Run: `npm test -- tests/memberRemoval.test.ts tests/memberFootprint.test.ts`
Expected: PASS

- [ ] **Step 9: 型別檢查與全部測試**

Run: `npm run check && npm test`
Expected: 無型別錯誤，全部測試通過

- [ ] **Step 10: Commit**

```bash
git add src/utils/memberFootprint.ts src/utils/memberRemoval.ts tests/memberFootprint.test.ts tests/memberRemoval.test.ts
git commit -m "Work out what a member would take with them"
```

---

### Task 5: Flutter 純函式（偵測與文案）

Task 4 的 Dart 版。行為必須一致 —— 兩邊對同一份資料要給出同樣的筆數，
不然使用者在 App 上看到 12 筆、在網頁上看到 11 筆。

**Files:**
- Create: `flutter_app/lib/domain/member_footprint.dart`
- Modify: `flutter_app/lib/domain/expense_actions.dart`（`removeMemberMessage` 就在這裡）
- Test: `flutter_app/test/member_footprint_test.dart`

**Interfaces:**
- Consumes: 無
- Produces:
  - `MemberFootprint`（欄位 `expenseIds`、`paymentIds`，都是 `List<String>`；`hasRecords` getter）
  - `memberFootprint(String uid, List<Expense> expenses, List<Payment> payments) -> MemberFootprint`
  - `RemoveMemberPrompt`（欄位 `title`、`message`、`hasRecords`、`requireText`）
  - `removeMemberPrompt({required String name, required int expenseCount, required int paymentCount, required int balance, required String currency}) -> RemoveMemberPrompt`

- [ ] **Step 1: 寫測試**

`flutter_app/test/member_footprint_test.dart`：

```dart
import 'package:test/test.dart';
import 'package:splitflow/domain/member_footprint.dart';
import 'package:splitflow/domain/models.dart';

/// `tests/memberFootprint.test.ts` 的 Dart 版。兩邊要對同一份資料給出
/// 同樣的筆數 —— 不然使用者在 App 上看到 12 筆、在網頁上看到 11 筆。
Expense _expense(String id, String paidBy, Map<String, int> splits) => Expense(
      id: id,
      title: '晚餐',
      category: ExpenseCategory.food,
      amount: 1000,
      currency: 'TWD',
      rate: 1,
      baseAmount: 1000,
      paidBy: paidBy,
      splitMode: SplitMode.even,
      splits: splits,
      note: '',
      place: null,
      receipt: null,
      date: '2026-08-28',
      time: '',
      createdBy: paidBy,
    );

Payment _payment(String id, String from, String to, String status) => Payment(
      id: id,
      from: from,
      to: to,
      amount: 500,
      currency: 'TWD',
      status: status,
      createdBy: from,
    );

void main() {
  group('memberFootprint', () {
    test('認得他是付款人的支出', () {
      final result = memberFootprint('amma', [_expense('e1', 'amma', {'ming': 1000})], []);
      expect(result.expenseIds, ['e1']);
    });

    test('認得他被分攤的支出 —— 就算是別人付的', () {
      final result =
          memberFootprint('amma', [_expense('e1', 'ming', {'ming': 500, 'amma': 500})], []);
      expect(result.expenseIds, ['e1']);
    });

    // 自訂分攤可以給某個人 0 元，那也算參與。
    test('分攤金額 0 也算', () {
      final result =
          memberFootprint('amma', [_expense('e1', 'ming', {'ming': 1000, 'amma': 0})], []);
      expect(result.expenseIds, ['e1']);
    });

    test('既是付款人又在分攤裡，只算一次', () {
      final result =
          memberFootprint('amma', [_expense('e1', 'amma', {'amma': 500, 'ming': 500})], []);
      expect(result.expenseIds, ['e1']);
    });

    test('跟他無關的支出不算', () {
      final result =
          memberFootprint('amma', [_expense('e1', 'ming', {'ming': 500, 'hua': 500})], []);
      expect(result.expenseIds, isEmpty);
    });

    test('認得付款的兩端，pending 與 confirmed 都算', () {
      final result = memberFootprint('amma', [], [
        _payment('p1', 'amma', 'ming', 'pending'),
        _payment('p2', 'ming', 'amma', 'confirmed'),
        _payment('p3', 'ming', 'hua', 'confirmed'),
      ]);
      expect(result.paymentIds, ['p1', 'p2']);
    });

    test('完全沒帳時 hasRecords 是 false', () {
      final result = memberFootprint('amma', [_expense('e1', 'ming', {'ming': 1000})], []);
      expect(result.hasRecords, isFalse);
    });
  });

  group('removeMemberPrompt', () {
    test('沒有帳時不給選擇，也不要求打字', () {
      final prompt = removeMemberPrompt(
          name: '阿嬤', expenseCount: 0, paymentCount: 0, balance: 0, currency: 'TWD');
      expect(prompt.hasRecords, isFalse);
      expect(prompt.requireText, isNull);
      expect(prompt.message, contains('還沒有任何支出與付款記錄'));
    });

    test('有帳時要求打出名字才能真刪', () {
      final prompt = removeMemberPrompt(
          name: '阿嬤', expenseCount: 12, paymentCount: 2, balance: 0, currency: 'TWD');
      expect(prompt.hasRecords, isTrue);
      expect(prompt.requireText, '阿嬤');
      expect(prompt.message, contains('12 筆支出'));
      expect(prompt.message, contains('2 筆付款記錄'));
    });

    test('風險揭露那兩句不能少', () {
      final prompt = removeMemberPrompt(
          name: '阿嬤', expenseCount: 12, paymentCount: 0, balance: 0, currency: 'TWD');
      expect(prompt.message, contains('別人付的'));
      expect(prompt.message, contains('結算紀錄'));
    });

    test('只有付款沒有支出時不會冒出「0 筆支出」', () {
      final prompt = removeMemberPrompt(
          name: '阿嬤', expenseCount: 0, paymentCount: 3, balance: 0, currency: 'TWD');
      expect(prompt.message, contains('3 筆付款記錄'));
      expect(prompt.message, isNot(contains('0 筆支出')));
    });
  });
}
```

**注意**：`Expense` 與 `Payment` 的建構子參數要跟 `lib/domain/models.dart` 實際的
定義對齊。上面是照目前的欄位寫的，若有出入以 `models.dart` 為準調整測試的
輔助函式，**不要改 `models.dart` 來遷就測試**。

- [ ] **Step 2: 寫偵測實作**

`flutter_app/lib/domain/member_footprint.dart`：

```dart
/// 一個成員在這個任務裡留下了哪些帳。
/// `src/utils/memberFootprint.ts` 的 Dart 版。
///
/// 用來回答「移除他之後，結算頁還會不會看到他」——會，因為結算的參與者是從
/// 支出與付款推導的，不是從 `memberIds`。要讓他真的消失就得刪掉這些東西。
///
/// **不必檢查 `splitMemberIds`**：那是自訂分攤之前的舊欄位，`expenseFromMap()`
/// 在讀取時就把它推回 `splits` 了，這裡拿到的一律是正規化之後的模型。
library;

import 'models.dart';

class MemberFootprint {
  final List<String> expenseIds;
  final List<String> paymentIds;

  const MemberFootprint({required this.expenseIds, required this.paymentIds});

  bool get hasRecords => expenseIds.isNotEmpty || paymentIds.isNotEmpty;
}

MemberFootprint memberFootprint(
  String uid,
  List<Expense> expenses,
  List<Payment> payments,
) {
  return MemberFootprint(
    // containsKey 而不是 `splits[uid] != null` —— 自訂分攤可以給某個人 0 元，
    // 那也算參與。
    expenseIds: expenses
        .where((e) => e.paidBy == uid || e.splits.containsKey(uid))
        .map((e) => e.id)
        .toList(),
    paymentIds: payments
        .where((p) => p.from == uid || p.to == uid)
        .map((p) => p.id)
        .toList(),
  );
}

class RemoveMemberPrompt {
  final String title;
  final String message;

  /// true 代表要給「保留 / 真實移除」兩個選擇；false 代表直接刪。
  final bool hasRecords;

  /// 真實移除要照著打的字。沒有帳時是 null —— 沒東西可失去就不該有摩擦。
  final String? requireText;

  const RemoveMemberPrompt({
    required this.title,
    required this.message,
    required this.hasRecords,
    required this.requireText,
  });
}
```

- [ ] **Step 3: 寫文案實作**

同一個檔案末尾（`removeMemberMessage` 從 `expense_actions.dart` import 進來）：

```dart
import 'expense_actions.dart';

/// 移除成員的對話框內容。`src/utils/memberRemoval.ts` 的 `removeMemberPrompt`
/// 的 Dart 版。
///
/// 分級摩擦跟 `TaskActionPrompt.requireText` 是同一個道理：沒有帳的人刪掉
/// 風險是零，逼他打字只是懲罰；有 12 筆支出要一起消失就不一樣了。
RemoveMemberPrompt removeMemberPrompt({
  required String name,
  required int expenseCount,
  required int paymentCount,
  required int balance,
  required String currency,
}) {
  final who = name.isEmpty ? '這位成員' : name;
  final title = '移除「$who」';

  if (expenseCount == 0 && paymentCount == 0) {
    return RemoveMemberPrompt(
      title: title,
      message: '$who 還沒有任何支出與付款記錄，會直接從這個任務移除。',
      hasRecords: false,
      requireText: null,
    );
  }

  // 只列真的有的那幾項，不然會出現「0 筆支出」這種讀起來很怪的句子。
  final counts = [
    if (expenseCount > 0) '$expenseCount 筆支出',
    if (paymentCount > 0) '$paymentCount 筆付款記錄',
  ].join('、');

  final keep = removeMemberMessage(
    name: who,
    balance: balance,
    currency: currency,
  );

  return RemoveMemberPrompt(
    title: title,
    message: '$who 出現在 $counts裡。\n\n'
        '・保留結算資料：$keep\n\n'
        '・真實移除：連同那 $counts一起刪除，無法復原。'
        '其中有些支出是別人付的，刪掉之後那些人的帳也會跟著不見。'
        '結算紀錄裡仍然看得到他的名字。',
    hasRecords: true,
    requireText: who,
  );
}
```

**注意**：`removeMemberMessage` 在 `expense_actions.dart:54`，先看一下它的具名參數
名稱是不是 `name`／`balance`／`currency`，不一樣就照實際的改。

- [ ] **Step 4: Commit（標明未驗證）**

```bash
git add flutter_app/lib/domain/member_footprint.dart flutter_app/test/member_footprint_test.dart
git commit -m "Work out what a member would take with them, on the native side"
```

- [ ] **Step 5: 回家要驗的清單**

Run: `cd flutter_app && dart test test/member_footprint_test.dart && dart analyze`
Expected: 11 個測試全過。**特別核對文案跟網頁版一字不差** ——
兩邊同一份資料要產生同樣的字，不然使用者換裝置會看到不同的警告。

---

### Task 6: Firestore 規則

**Files:**
- Modify: `firestore.rules`（`match /tasks/{taskId}/members/{uid}` 的 `allow delete`）
- Test: `tests/firestore.rules.test.mjs`

**Interfaces:**
- Consumes: 無
- Produces: admin 可以刪除非 owner 的 member 文件；Task 7、8 的刪除流程靠它

- [ ] **Step 1: 寫規則測試**

`tests/firestore.rules.test.mjs`，接在「虛擬成員」那一組後面。
`VIRTUAL` 常數與 `createVirtual()` 輔助函式在那一組裡已經有了：

```js
  // --- 真實刪除成員 ---
  await test("admin 可以真的刪掉 member 文件", async () => {
    await seed();
    await assertSucceeds(deleteDoc(doc(as(ADMIN), "tasks", TASK, "members", OTHER)));
  });

  await test("admin 可以真的刪掉虛擬成員", async () => {
    await seed();
    await createVirtual(as(ADMIN));
    await assertSucceeds(deleteDoc(doc(as(ADMIN), "tasks", TASK, "members", VIRTUAL)));
  });

  // 既有的軟刪走 managesMemberAsAdmin()，那裡面擋著 owner。
  // 新開的刪除路徑如果不擋，admin 就能把 owner 從任務裡刪掉 —— 比軟刪能做的還多。
  await test("admin 不能刪掉 owner", async () => {
    await seed();
    await assertFails(deleteDoc(doc(as(ADMIN), "tasks", TASK, "members", OWNER)));
  });

  await test("一般成員不能刪 member 文件", async () => {
    await seed();
    await assertFails(deleteDoc(doc(as(MEMBER), "tasks", TASK, "members", OTHER)));
  });

  await test("外人不能刪 member 文件", async () => {
    await seed();
    await assertFails(deleteDoc(doc(as(OUTSIDER), "tasks", TASK, "members", OTHER)));
  });

  await test("封存的任務不能刪 member 文件", async () => {
    await seed();
    await updateDoc(doc(as(OWNER), "tasks", TASK), { status: "archived", updatedAt: serverTimestamp() });
    await assertFails(deleteDoc(doc(as(ADMIN), "tasks", TASK, "members", OTHER)));
  });
```

- [ ] **Step 2: 改規則**

`firestore.rules` 的 `match /tasks/{taskId}/members/{uid}` 裡，
把 `allow delete: if false;` 換成：

```
        /*
          真實刪除。軟刪（active: false）留給「他確實參與過，但不該再看到這個
          任務」；這條是給「這個人根本不該在這裡」——加錯人、測試資料。

          role != "owner" 不能少：軟刪走 managesMemberAsAdmin()，那裡面擋著
          owner。這條不擋的話，admin 就能把 owner 從他自己的任務裡刪掉，
          變成新路徑能做的事比舊路徑還多。

          taskIsActive 是因為封存的任務唯讀 —— 封存之後不該還能改帳。
        */
        allow delete: if isTaskAdmin(taskId)
          && taskIsActive(taskId)
          && resource.data.role != "owner";
```

- [ ] **Step 3: 括號平衡檢查**

Run:
```bash
node -e "const s=require('fs').readFileSync('firestore.rules','utf8');const n=c=>(s.split(c).length-1);console.log('{',n('{'),'}',n('}'),'(',n('('),')',n(')'))"
```
Expected: `{` 與 `}` 相等、`(` 與 `)` 相等

- [ ] **Step 4: Commit（標明未驗證）**

```bash
git add firestore.rules tests/firestore.rules.test.mjs
git commit -m "Let admins delete a member outright"
```

- [ ] **Step 5: 部署前必須先驗**

⚠️ **這條規則開放的是刪除權，而且本機跑不了規則測試（JDK 11，需要 21）。**

**不要直接 `npm run deploy:rules`。** 先做到下列其中一件：

- 從 [Adoptium](https://adoptium.net) 下載 JDK 21 的 zip 解壓（不需要 Microsoft
  Store），設好 `JAVA_HOME` 後跑 `npm run test:rules`，確認上面 6 個新測試
  **以及既有的所有規則測試**都過
- 或在有 JDK 21 的機器上跑同一份測試

驗過之後才 `npm run deploy:rules`。**這一步要由使用者決定，不要自行部署。**

---

### Task 7: 網頁版刪除流程

**Files:**
- Modify: `src/services/memberService.ts`

**Interfaces:**
- Consumes: `MemberFootprint`（Task 4）、規則的刪除路徑（Task 6）
- Produces: `hardDeleteMember(taskId: string, uid: string, footprint: MemberFootprint): Promise<void>`

- [ ] **Step 1: 寫實作**

`src/services/memberService.ts` 頂端 import 補上 `deleteDoc`（從
`firebase/firestore`）與：

```ts
import type { MemberFootprint } from "@/utils/memberFootprint";
import { deleteReceipt } from "@/services/receiptService";
```

在 `removeMember()` 後面加：

```ts
/** 一個 writeBatch 上限 500 筆寫入，留 50 筆餘裕給同批的計數器更新。 */
const BATCH_LIMIT = 450;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * 真的把一個人從任務裡刪掉 —— 連同他的支出與付款。
 *
 * 給「這個人根本不該在這裡」用的：加錯人、測試資料。想保留帳目的話走
 * `removeMember()` 的軟刪。
 *
 * **順序是這支函式的核心。** 分批寫入不是原子的，所以 member 文件放到最後
 * 才刪：中途失敗時那個人還在成員列表上，使用者重按一次就從頭再跑，已刪的
 * 支出查不到、不會重複刪，剩下的繼續刪。反過來先刪 member 文件的話，失敗
 * 會留下「成員不見了但支出還在」，而且再也沒有介面可以重試。
 *
 * 收據是 best-effort —— `deleteReceipt()` 本來就吞掉所有錯誤，孤兒檔案是
 * 既有的設計取捨。
 */
export async function hardDeleteMember(
  taskId: string,
  uid: string,
  footprint: MemberFootprint
): Promise<void> {
  for (const ids of chunk(footprint.expenseIds, BATCH_LIMIT)) {
    const batch = writeBatch(db);
    for (const expenseId of ids) {
      batch.delete(doc(db, "tasks", taskId, "expenses", expenseId));
    }
    batch.update(doc(db, "tasks", taskId), {
      expenseCount: increment(-ids.length),
      updatedAt: serverTimestamp()
    });
    await batch.commit();
  }

  for (const ids of chunk(footprint.paymentIds, BATCH_LIMIT)) {
    const batch = writeBatch(db);
    for (const paymentId of ids) {
      batch.delete(doc(db, "tasks", taskId, "payments", paymentId));
    }
    await batch.commit();
  }

  // 最後才動成員本身。
  const batch = writeBatch(db);
  batch.delete(doc(db, "tasks", taskId, "members", uid));
  batch.update(doc(db, "tasks", taskId), {
    memberIds: arrayRemove(uid),
    adminIds: arrayRemove(uid),
    memberCount: increment(-1),
    updatedAt: serverTimestamp()
  });
  await batch.commit();

  // 帳都刪乾淨了才清照片。失敗不影響結果，孤兒檔案是既有取捨。
  await Promise.all(footprint.expenseIds.map(id => deleteReceipt(taskId, id)));
}
```

`deleteDoc` 其實用不到（batch.delete 就夠），**不要 import 沒用到的東西** ——
`npm run check` 會抓。

- [ ] **Step 2: 型別檢查與全部測試**

Run: `npm run check && npm test`
Expected: 無型別錯誤，全部測試通過

- [ ] **Step 3: Commit**

```bash
git add src/services/memberService.ts
git commit -m "Delete a member together with everything they brought"
```

---

### Task 8: Flutter 刪除流程

**Files:**
- Modify: `flutter_app/lib/data/task_repository.dart`

**Interfaces:**
- Consumes: `MemberFootprint`（Task 5）、規則的刪除路徑（Task 6）
- Produces: `TaskRepository.hardDeleteMember(String taskId, String uid, MemberFootprint footprint) -> Future<void>`

- [ ] **Step 1: 寫實作**

`flutter_app/lib/data/task_repository.dart` 頂端加
`import '../domain/member_footprint.dart';`，在 `removeMember()` 後面加：

```dart
  /// 一個 batch 上限 500 筆寫入，留 50 筆餘裕給同批的計數器更新。
  static const int _batchLimit = 450;

  /// 真的把一個人從任務裡刪掉 —— 連同他的支出與付款。
  /// `src/services/memberService.ts` 的 `hardDeleteMember` 的 Dart 版。
  ///
  /// 給「這個人根本不該在這裡」用的：加錯人、測試資料。想保留帳目的話走
  /// `removeMember()` 的軟刪。
  ///
  /// **順序是這支函式的核心。** 分批寫入不是原子的，所以 member 文件放到
  /// 最後才刪：中途失敗時那個人還在成員列表上，使用者重按一次就從頭再跑。
  /// 反過來先刪 member 文件的話，失敗會留下「成員不見了但支出還在」，
  /// 而且再也沒有介面可以重試。
  ///
  /// 收據**不在這裡**清。刪 Storage 要 `ReceiptRepository`，而 repository
  /// 之間不互相 import —— 那件事交給呼叫端做（見 Task 10），跟網頁版把
  /// `deleteReceipt()` 放在 service 層是同一個分層考量。
  Future<void> hardDeleteMember(
    String taskId,
    String uid,
    MemberFootprint footprint,
  ) async {
    for (var i = 0; i < footprint.expenseIds.length; i += _batchLimit) {
      final ids = footprint.expenseIds.skip(i).take(_batchLimit).toList();
      final batch = db.batch();
      for (final expenseId in ids) {
        batch.delete(expensesRef(taskId).doc(expenseId));
      }
      batch.update(taskRef(taskId), {
        'expenseCount': FieldValue.increment(-ids.length),
        'updatedAt': FieldValue.serverTimestamp(),
      });
      await batch.commit();
    }

    for (var i = 0; i < footprint.paymentIds.length; i += _batchLimit) {
      final ids = footprint.paymentIds.skip(i).take(_batchLimit).toList();
      final batch = db.batch();
      for (final paymentId in ids) {
        batch.delete(paymentsRef(taskId).doc(paymentId));
      }
      await batch.commit();
    }

    // 最後才動成員本身。
    final batch = db.batch();
    batch.delete(membersRef(taskId).doc(uid));
    batch.update(taskRef(taskId), {
      'memberIds': FieldValue.arrayRemove([uid]),
      'adminIds': FieldValue.arrayRemove([uid]),
      'memberCount': FieldValue.increment(-1),
      'updatedAt': FieldValue.serverTimestamp(),
    });
    await batch.commit();
  }
```

**注意**：`expensesRef` 與 `paymentsRef` 在 `lib/data/firestore_refs.dart`。
`task_repository.dart` 若還沒 import 到它們，補上；若那兩個 ref 定義在
`expense_repository.dart` 而不是共用檔，改成從 `firestore_refs.dart` 取，
**不要在 repository 之間互相 import**。

- [ ] **Step 2: Commit（標明未驗證）**

```bash
git add flutter_app/lib/data/task_repository.dart
git commit -m "Delete a member together with everything they brought, on the native side"
```

- [ ] **Step 3: 回家要驗的清單**

Run: `cd flutter_app && dart analyze`
Expected: 乾淨。特別確認 `expensesRef` / `paymentsRef` 的 import 對不對。

---

### Task 9: 網頁版介面

**Files:**
- Create: `src/components/member/RemoveMemberDialog.vue`
- Modify: `src/pages/TaskPage.vue`

**Interfaces:**
- Consumes: `memberFootprint()`、`hasRecords()`、`removeMemberPrompt()`（Task 4）、`hardDeleteMember()`（Task 7）
- Produces: 無（終端介面）

順帶解掉 `todo.md`「待辦：確認框統一」的一部分 —— 目前的移除走
`window.confirm`（`TaskPage.vue:301`），這次換掉。

- [ ] **Step 1: 建立對話框元件**

`src/components/member/RemoveMemberDialog.vue`：

```vue
<script setup lang="ts">
/**
 * 移除成員的對話框。
 *
 * 跟 ConfirmDialog 分開的理由是它給不了三個出口 —— 這裡要「取消 / 保留結算
 * 資料 / 真實移除」。摩擦機制（照著打名字才按得下去）比照 ConfirmDialog 的
 * requireText，理由一樣：後果越嚴重、需要越刻意的動作。
 *
 * 沒有帳的人不給選擇也不要求打字 —— 沒東西可失去，逼他打字只是懲罰。
 */
import { computed, ref, watch } from "vue";
import type { RemoveMemberPrompt } from "@/utils/memberRemoval";

const props = defineProps<{
  open: boolean;
  prompt: RemoveMemberPrompt;
  busy: boolean;
}>();

const emit = defineEmits<{
  (e: "soft"): void;
  (e: "hard"): void;
  (e: "cancel"): void;
}>();

const typed = ref("");

// 每次重新開啟都要清空，不然上一次打的字會讓按鈕一開始就是啟用的。
watch(
  () => props.open,
  isOpen => {
    if (isOpen) typed.value = "";
  }
);

const canHardDelete = computed(
  () => !props.prompt.requireText || typed.value.trim() === props.prompt.requireText
);
</script>

<template>
  <div v-if="open" class="overlay" role="dialog" aria-modal="true" @click.self="emit('cancel')">
    <div class="card dialog stack">
      <strong class="section-title">{{ prompt.title }}</strong>
      <p class="tiny message">{{ prompt.message }}</p>

      <label v-if="prompt.requireText" class="field">
        <span class="label">請輸入「{{ prompt.requireText }}」以確認真實移除</span>
        <input v-model="typed" class="input" :disabled="busy" />
      </label>

      <div class="actions">
        <button class="btn btn-ghost" :disabled="busy" @click="emit('cancel')">取消</button>
        <button v-if="prompt.hasRecords" class="btn" :disabled="busy" @click="emit('soft')">
          保留結算資料
        </button>
        <button class="btn btn-danger" :disabled="busy || !canHardDelete" @click="emit('hard')">
          {{ busy ? "刪除中…" : prompt.hasRecords ? "真實移除" : "刪除" }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgb(26 22 19 / 45%);
  z-index: 50;
}

.dialog {
  width: min(440px, 100%);
}

.message {
  white-space: pre-line;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}
</style>
```

**注意**：`.overlay` 的樣式照抄 `src/components/common/ConfirmDialog.vue` 的
`<style scoped>`，讓兩個對話框長得一樣。上面是依照它的結構寫的，
**打開那個檔案核對一次**，尺寸或顏色不同就以它為準。

- [ ] **Step 2: TaskPage 接上**

script 區 import 補上：

```ts
import RemoveMemberDialog from "@/components/member/RemoveMemberDialog.vue";
import { hasRecords, memberFootprint } from "@/utils/memberFootprint";
import { removeMemberPrompt, type RemoveMemberPrompt } from "@/utils/memberRemoval";
import { createVirtualMember, hardDeleteMember, removeMember, renameMember, setMemberRole } from "@/services/memberService";
```

把現有的 `removeTaskMember()` 整支換成：

```ts
const removing = ref<{
  uid: string;
  prompt: RemoveMemberPrompt;
  footprint: ReturnType<typeof memberFootprint>;
} | null>(null);

/**
 * 按下「移除」只負責算出後果並開對話框，真正動手的是下面兩支。
 *
 * 沒有帳的人也走同一個對話框 —— 只是它不給選擇、也不要求打字。
 */
function removeTaskMember(targetUid: string) {
  const target = memberState.members.value.find(member => member.uid === targetUid);
  const footprint = memberFootprint(targetUid, expenseState.expenses.value, paymentState.payments.value);
  // 沒出現在 balances 代表他還沒參與任何一筆支出，當作已結清。
  const balance = settlement.value.balances.find(item => item.uid === targetUid)?.balance ?? 0;

  removing.value = {
    uid: targetUid,
    footprint,
    prompt: removeMemberPrompt({
      name: target?.nickname || "",
      expenseCount: footprint.expenseIds.length,
      paymentCount: footprint.paymentIds.length,
      balance,
      currency: settlement.value.currency
    })
  };
}

/** 保留結算資料 —— 舊的軟刪，行為完全不變。 */
async function confirmSoftRemove() {
  const target = removing.value;
  if (!target) return;
  removing.value = null;
  await runMemberAction(target.uid, () => removeMember(taskId.value, target.uid));
}

/** 真實移除 —— 連他的支出與付款一起刪。 */
async function confirmHardRemove() {
  const target = removing.value;
  if (!target) return;
  await runMemberAction(target.uid, () =>
    hardDeleteMember(taskId.value, target.uid, target.footprint)
  );
  removing.value = null;
  // 支出也被刪了，列表要跟著重讀 —— runMemberAction 只重載任務與成員。
  await expenseState.load();
}
```

`expenseState` 與 `paymentState` 在 `TaskPage.vue:49-50` 就建好了
（`useExpenses(taskId.value)` / `usePayments(taskId.value)`），第 123-124 行的結算
計算用的就是 `expenseState.expenses.value` 與 `paymentState.payments.value`。
**沿用同一個來源，不要自己新增載入邏輯。**

模板最外層（跟其他對話框放一起）加：

```vue
      <RemoveMemberDialog
        :open="removing !== null"
        :prompt="removing?.prompt ?? { title: '', message: '', hasRecords: false, requireText: null }"
        :busy="busyUid === removing?.uid"
        @soft="confirmSoftRemove"
        @hard="confirmHardRemove"
        @cancel="removing = null"
      />
```

- [ ] **Step 3: 型別檢查與全部測試**

Run: `npm run check && npm test`
Expected: 無型別錯誤，全部測試通過

- [ ] **Step 4: 手動驗證**

Run: `npm run dev`

⚠️ **要等 Task 6 的規則部署之後才會成功** —— 線上規則還是 `allow delete: if false`。

1. 建一個沒有支出的成員 → 移除 → 對話框沒有「保留結算資料」、不用打字 → 刪掉 → 成員頁與結算頁都沒有他
2. 建一個有支出的成員 → 移除 → 對話框列出筆數、有兩個選擇 → 選「保留結算資料」→ 行為跟以前一樣（結算頁還看得到他）
3. 同上 → 選「真實移除」→ 名字打錯時按鈕不能按 → 打對 → 他的支出消失、結算頁沒有他
4. 一筆別人付、他有分攤的支出 → 真實移除 → 那筆整個不見（**這是刻意的**）
5. 移除前先產生一次結算紀錄 → 真實移除後 → 紀錄裡他的名字還在（**刻意的**）
6. 任務卡上的「N 筆支出」數字對得上

- [ ] **Step 5: Commit**

```bash
git add src/components/member/RemoveMemberDialog.vue src/pages/TaskPage.vue
git commit -m "Offer to take a member's records with them"
```

---

### Task 10: Flutter 介面

**Files:**
- Create: `flutter_app/lib/ui/remove_member_dialog.dart`
- Modify: `flutter_app/lib/ui/members_tab.dart`

**Interfaces:**
- Consumes: `memberFootprint()`、`removeMemberPrompt()`、`RemoveMemberPrompt`（Task 5）、`hardDeleteMember()`（Task 8）
- Produces: 無（終端介面）

- [ ] **Step 1: 建立對話框**

`flutter_app/lib/ui/remove_member_dialog.dart`：

```dart
import 'package:flutter/material.dart';

import '../domain/member_footprint.dart';
import 'theme.dart';

/// 移除成員的對話框。`src/components/member/RemoveMemberDialog.vue` 的 Flutter 版。
///
/// 跟 `showConfirmDialog` 分開的理由是它給不了三個出口 —— 這裡要
/// 「取消 / 保留結算資料 / 真實移除」。摩擦機制（照著打名字才按得下去）
/// 比照 `TaskActionPrompt.requireText`，理由一樣。
enum RemoveMemberChoice { cancel, soft, hard }

Future<RemoveMemberChoice> showRemoveMemberDialog(
  BuildContext context,
  RemoveMemberPrompt prompt,
) async {
  final choice = await showDialog<RemoveMemberChoice>(
    context: context,
    builder: (context) => _RemoveMemberDialog(prompt: prompt),
  );
  return choice ?? RemoveMemberChoice.cancel;
}

class _RemoveMemberDialog extends StatefulWidget {
  final RemoveMemberPrompt prompt;

  const _RemoveMemberDialog({required this.prompt});

  @override
  State<_RemoveMemberDialog> createState() => _RemoveMemberDialogState();
}

class _RemoveMemberDialogState extends State<_RemoveMemberDialog> {
  final _typed = TextEditingController();

  @override
  void dispose() {
    _typed.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final prompt = widget.prompt;
    final required = prompt.requireText;
    final canHardDelete = required == null || _typed.text.trim() == required;

    return AlertDialog(
      title: Text(prompt.title),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(prompt.message),
            if (required != null) ...[
              const SizedBox(height: 16),
              TextField(
                controller: _typed,
                decoration: InputDecoration(labelText: '請輸入「$required」以確認真實移除'),
                onChanged: (_) => setState(() {}),
              ),
            ],
          ],
        ),
      ),
      actions: [
        // 取消刻意用灰的：兩顆都是主色的話，紅的那顆就不顯眼了。
        TextButton(
          style: TextButton.styleFrom(foregroundColor: AppColors.muted),
          onPressed: () => Navigator.of(context).pop(RemoveMemberChoice.cancel),
          child: const Text('取消'),
        ),
        if (prompt.hasRecords)
          TextButton(
            onPressed: () => Navigator.of(context).pop(RemoveMemberChoice.soft),
            child: const Text('保留結算資料'),
          ),
        TextButton(
          style: TextButton.styleFrom(foregroundColor: AppColors.danger),
          onPressed:
              canHardDelete ? () => Navigator.of(context).pop(RemoveMemberChoice.hard) : null,
          child: Text(prompt.hasRecords ? '真實移除' : '刪除'),
        ),
      ],
    );
  }
}
```

- [ ] **Step 2: members_tab 換掉 `_remove`**

`flutter_app/lib/ui/members_tab.dart` 頂端加：

```dart
import '../domain/member_footprint.dart';
import 'remove_member_dialog.dart';
```

把現有的 `_remove()` 整支換成：

```dart
  /// 移除成員。先算出他留下了哪些帳，再讓使用者決定要不要一起刪。
  Future<void> _remove(TaskMember member) async {
    final expenses = ref.read(expensesProvider(widget.task.id)).value ?? const <Expense>[];
    final payments = ref.read(paymentsProvider(widget.task.id)).value ?? const <Payment>[];
    final footprint = memberFootprint(member.uid, expenses, payments);

    // 沒出現在 balances 代表他還沒參與任何一筆支出，當作已結清。
    final balance = ref
            .read(settlementProvider(widget.task.id))
            .value
            ?.balances
            .where((b) => b.uid == member.uid)
            .map((b) => b.balance)
            .firstOrNull ??
        0;

    final choice = await showRemoveMemberDialog(
      context,
      removeMemberPrompt(
        name: member.nickname,
        expenseCount: footprint.expenseIds.length,
        paymentCount: footprint.paymentIds.length,
        balance: balance,
        currency: widget.task.defaultCurrency,
      ),
    );

    if (!mounted || choice == RemoveMemberChoice.cancel) return;

    final repository = ref.read(taskRepositoryProvider);
    await _run(
      member.uid,
      () => choice == RemoveMemberChoice.soft
          ? repository.removeMember(widget.task.id, member.uid)
          : repository.hardDeleteMember(widget.task.id, member.uid, footprint),
    );

    // 真實移除連支出也刪了，那兩份快取要跟著失效。
    if (choice == RemoveMemberChoice.hard) {
      ref.invalidate(expensesProvider(widget.task.id));
      ref.invalidate(paymentsProvider(widget.task.id));

      // 帳都刪乾淨了才清照片，best-effort —— 孤兒檔案是既有的設計取捨
      // （見網頁版 receiptService 的 deleteReceipt 註解）。失敗不該讓
      // 已經成功的刪除看起來像失敗了。
      final receipts = ref.read(receiptRepositoryProvider);
      for (final expenseId in footprint.expenseIds) {
        try {
          await receipts.delete(widget.task.id, expenseId);
        } catch (_) {
          // 檔案本來就不存在、或現在離線 —— 都不影響結果。
        }
      }
    }
  }
```

**注意**：`Expense` 與 `Payment` 要從 `../domain/models.dart` import（檔案裡
應該已經有了）。`expensesProvider`、`paymentsProvider`、`settlementProvider`、
`receiptRepositoryProvider`（`providers.dart:43`）都在 `lib/state/providers.dart`，
`members_tab.dart` 已經 import 了那個檔案。

- [ ] **Step 3: Commit（標明未驗證）**

```bash
git add flutter_app/lib/ui/remove_member_dialog.dart flutter_app/lib/ui/members_tab.dart
git commit -m "Offer to take a member's records with them, on the native side"
```

- [ ] **Step 4: 回家要驗的清單**

```bash
cd flutter_app && dart test && dart analyze && flutter run
```

⚠️ **要等 Task 6 的規則部署之後才會成功。**

1. 沒有支出的成員 → 移除 → 沒有「保留結算資料」、不用打字 → 刪掉 → 成員頁與結算頁都沒有他
2. 有支出的成員 → 移除 → 列出筆數、兩個選擇 → 選「保留結算資料」→ 結算頁還看得到他
3. 同上 → 選「真實移除」→ 名字打錯按鈕不能按 → 打對 → 支出消失、結算頁沒有他
4. 別人付、他有分攤的支出 → 真實移除 → 那筆整個不見（**刻意的**）
5. 先產生結算紀錄 → 真實移除 → 紀錄裡名字還在（**刻意的**）
6. 任務卡的「N 筆支出」對得上
7. **打開網頁版看同一個任務** → 結果一致

---

## 收尾

- [ ] `npm run check && npm test`（網頁版）
- [ ] `cd flutter_app && dart test && dart analyze`（**要有 Flutter 環境**）
- [ ] `npm run test:rules`（**要有 JDK 21**）—— 特別確認既有的規則測試沒被弄壞
- [ ] `npm run deploy:rules`（**由使用者決定**）
- [ ] 更新 `todo.md`：加「已完成：虛擬成員」與「已完成：移除成員可選擇真實刪除」，
      並註明兩個刻意接受的不一致（結算快照保留他的名字、真實移除會誤傷別人付的支出）
- [ ] 更新 `todo.md` 的「待辦：確認框統一」：成員移除已改用對話框，
      剩下 `ExpenseFormPage` 的刪除支出與 `TaskPage` 改名的 `window.prompt`
- [ ] 更新 `flutter_app/README.md` 的「已經搬過來的」清單
