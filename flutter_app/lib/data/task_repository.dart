import 'dart:math';

import 'package:cloud_firestore/cloud_firestore.dart';

import '../domain/models.dart';
import 'firestore_refs.dart';

/// 任務與成員的讀寫。`src/services/taskService.ts` 與 `memberService.ts` 的
/// Dart 版。

Task _taskFrom(String id, Map<String, dynamic> data) {
  return Task(
    id: id,
    name: (data['name'] as String?) ?? '',
    ownerId: (data['ownerId'] as String?) ?? '',
    adminIds: (data['adminIds'] as List?)?.cast<String>() ?? const [],
    memberIds: (data['memberIds'] as List?)?.cast<String>() ?? const [],
    defaultCurrency: (data['defaultCurrency'] as String?) ?? 'TWD',
    startDate: data['startDate'] as String?,
    endDate: data['endDate'] as String?,
    // 沒有 status 的舊資料當成進行中 —— 猜錯的話那些任務會整個從列表消失。
    status: (data['status'] as String?) ?? 'active',
    inviteCode: (data['inviteCode'] as String?) ?? '',
    memberCount: (data['memberCount'] as num?)?.toInt() ?? 0,
    expenseCount: (data['expenseCount'] as num?)?.toInt() ?? 0,
  );
}

TaskMember _memberFrom(Map<String, dynamic> data) {
  return TaskMember(
    uid: (data['uid'] as String?) ?? '',
    nickname: (data['nickname'] as String?) ?? '',
    role: (data['role'] as String?) ?? 'member',
    // 這個欄位是移除成員功能之後才加的，舊文件沒有 —— 當成還在，
    // 反過來猜的話所有舊成員會一次消失。
    active: data['active'] != false,
  );
}

/// 邀請碼。16 bytes 的隨機十六進位字串，跟網頁版同一個格式。
///
/// 用 `Random.secure()` 而不是預設的 `Random()` —— 這串字是任務的唯一
/// 門禁，猜得到就進得來。預設的 Random 是可預測的偽隨機。
String createInviteCode() {
  final random = Random.secure();
  return List<int>.generate(16, (_) => random.nextInt(256))
      .map((b) => b.toRadixString(16).padLeft(2, '0'))
      .join();
}

class TaskRepository {
  /// 建立任務。
  ///
  /// 任務文件、owner 的成員文件、邀請文件**必須在同一個 batch 裡** ——
  /// 少了任何一個，使用者會拿到一個進不去或邀不了人的任務，而且沒有任何
  /// 錯誤訊息可以解釋。
  ///
  /// 回傳新任務的 id 與邀請碼。兩者都是 client 端產生的，所以離線也拿得到 ——
  /// 不用寫完再查一次，而查回來的那一步正是會出錯的地方（同名任務撈錯）。
  Future<({String taskId, String inviteCode})> createTask({
    required String name,
    required String defaultCurrency,
    required String? startDate,
    required String? endDate,
    required UserProfile owner,
  }) async {
    final taskDoc = tasksRef.doc();
    final inviteCode = createInviteCode();
    final now = FieldValue.serverTimestamp();

    final batch = db.batch();

    batch.set(taskDoc, {
      'name': name,
      'ownerId': owner.uid,
      'adminIds': [owner.uid],
      'memberIds': [owner.uid],
      'defaultCurrency': defaultCurrency,
      'startDate': startDate,
      'endDate': endDate,
      'status': 'active',
      'inviteCode': inviteCode,
      'memberCount': 1,
      'expenseCount': 0,
      'createdAt': now,
      'updatedAt': now,
    });

    batch.set(membersRef(taskDoc.id).doc(owner.uid), {
      'uid': owner.uid,
      'nickname': owner.nickname,
      'role': 'owner',
      'joinedAt': now,
      'active': true,
    });

    batch.set(invitesRef.doc(inviteCode), {
      'taskId': taskDoc.id,
      'taskName': name,
      'defaultCurrency': defaultCurrency,
      'startDate': startDate,
      'endDate': endDate,
      'createdBy': owner.uid,
      'active': true,
      'createdAt': now,
    });

    await batch.commit();
    return (taskId: taskDoc.id, inviteCode: inviteCode);
  }

  /// 用邀請碼查任務。
  ///
  /// 停用的邀請讀取會被 Security Rules 擋下來，對使用者來說跟「連結不存在」
  /// 是同一件事 —— 所以 permission-denied 也回 null，讓畫面說「連結無效」
  /// 而不是丟一個 Firebase 錯誤碼給他看。
  Future<Map<String, dynamic>?> getInvite(String inviteCode) async {
    try {
      final snap = await invitesRef.doc(inviteCode).get();
      return snap.data();
    } on FirebaseException catch (err) {
      if (err.code == 'permission-denied') return null;
      rethrow;
    }
  }

  /// 我參與的所有任務。
  ///
  /// 只查一次，角色從 task 文件的 ownerId / adminIds 推導，不逐一讀
  /// `members/{uid}`。網頁版量測顯示那組扇出佔掉冷啟動的 44%，而且並行讀取
  /// 讓最慢的一筆決定全部 —— 一筆卡住整份清單都不會出現。
  ///
  /// 也刻意不在查詢裡過濾 status：多一個條件就要建複合索引，而 `!=` 還會帶來
  /// 排序限制。一個使用者的任務是幾十個等級，載回來在前端分堆比較划算。
  Future<List<Task>> listUserTasks(String uid) async {
    final snap = await tasksRef.where('memberIds', arrayContains: uid).get();
    return snap.docs.map((doc) => _taskFrom(doc.id, doc.data())).toList();
  }

  Future<Task?> getTask(String taskId) async {
    final snap = await taskRef(taskId).get();
    final data = snap.data();
    return data == null ? null : _taskFrom(snap.id, data);
  }

  /// 封存、解除封存、刪除是同一個動作的三個值，不需要三支函式。
  ///
  /// 刻意不 await：呼叫端用 `settleWrite` 決定要等多久。
  Future<void> setTaskStatus(String taskId, String status) {
    return taskRef(taskId).update({
      'status': status,
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }

  Future<TaskMember?> getTaskMember(String taskId, String uid) async {
    final snap = await membersRef(taskId).doc(uid).get();
    final data = snap.data();
    return data == null ? null : _memberFrom(data);
  }

  /// 回傳所有成員文件，**包含已被移除的**（active: false）——
  /// 舊支出還查得到暱稱，而且結算的餘數分配依賴這個順序。
  Future<List<TaskMember>> listTaskMembers(String taskId) async {
    final snap = await membersRef(taskId).orderBy('joinedAt').get();
    return snap.docs.map((doc) => _memberFrom(doc.data())).toList();
  }

  /// 加入順序，給結算用。
  ///
  /// 順序不是裝飾：`allocate` 的餘數是照這個順序分的，換一個順序那一塊錢
  /// 就落在別人身上，跟網頁版算出來的數字會對不起來。
  Future<List<String>> memberOrder(String taskId) async {
    final members = await listTaskMembers(taskId);
    return members.map((member) => member.uid).toList();
  }

  /// 升級為 admin 或降級為 member。
  ///
  /// member 文件與 `task.adminIds` **必須一起改**，因為角色是從 task 文件
  /// 推導的（見 `taskRole`）。分開寫的話會出現「member 文件說 admin、
  /// adminIds 裡卻沒有他」這種對不起來的狀態。
  Future<void> setMemberRole(String taskId, String uid, String role) {
    final batch = db.batch();
    batch.update(membersRef(taskId).doc(uid), {'role': role});
    batch.update(taskRef(taskId), {
      'adminIds': role == 'admin'
          ? FieldValue.arrayUnion([uid])
          : FieldValue.arrayRemove([uid]),
      'updatedAt': FieldValue.serverTimestamp(),
    });
    return batch.commit();
  }

  /// 移除成員。
  ///
  /// member 文件留著並標成 active: false，這樣既有支出仍查得到暱稱；
  /// 但從 `task.memberIds` 拿掉之後 Security Rules 就不再讓他讀這個任務。
  ///
  /// 一起降回 member，之後若重新加入不會拿著 admin 角色但不在 adminIds 裡。
  Future<void> removeMember(String taskId, String uid) {
    final batch = db.batch();
    batch.update(membersRef(taskId).doc(uid), {
      'active': false,
      'role': 'member',
    });
    batch.update(taskRef(taskId), {
      'memberIds': FieldValue.arrayRemove([uid]),
      'adminIds': FieldValue.arrayRemove([uid]),
      'memberCount': FieldValue.increment(-1),
      'updatedAt': FieldValue.serverTimestamp(),
    });
    return batch.commit();
  }

  /// 用邀請連結加入。
  ///
  /// 走 transaction 而不是 batch：要先讀成員文件才知道是「第一次加入」還是
  /// 「被移除過又回來」，而那個讀取必須跟後面的寫入在同一個原子操作裡 ——
  /// 不然兩個人同時點連結會把 memberCount 加錯。
  Future<void> joinTask(String taskId, UserProfile profile) {
    return db.runTransaction((transaction) async {
      final memberDoc = membersRef(taskId).doc(profile.uid);
      final snap = await transaction.get(memberDoc);
      final existing = snap.data();

      // 已經是有效成員就什麼都不用做，重複點連結不該把人數加兩次。
      if (existing != null && existing['active'] != false) return;

      if (existing != null) {
        // 被移除過的人重新加入：沿用原本的文件，保住角色與加入時間。
        transaction.update(memberDoc, {
          'active': true,
          'nickname': profile.nickname,
        });
      } else {
        transaction.set(memberDoc, {
          'uid': profile.uid,
          'nickname': profile.nickname,
          'role': 'member',
          'joinedAt': FieldValue.serverTimestamp(),
          'active': true,
        });
      }

      transaction.update(taskRef(taskId), {
        'memberIds': FieldValue.arrayUnion([profile.uid]),
        'memberCount': FieldValue.increment(1),
        'updatedAt': FieldValue.serverTimestamp(),
      });
    });
  }
}
