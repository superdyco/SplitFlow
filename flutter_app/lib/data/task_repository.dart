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

class TaskRepository {
  /// 我參與的所有任務。
  ///
  /// 只查一次，角色從 task 文件的 ownerId / adminIds 推導，不逐一讀
  /// `members/{uid}`。網頁版量測顯示那組扇出佔掉冷啟動的 44%，而且並行讀取
  /// 讓最慢的一筆決定全部 —— 一筆卡住整份清單都不會出現。
  ///
  /// 也刻意不在查詢裡過濾 status：多一個條件就要建複合索引，而 `!=` 還會帶來
  /// 排序限制。一個使用者的任務是幾十個等級，載回來在前端分堆比較划算。
  Future<List<Task>> listUserTasks(String uid) async {
    final snap =
        await tasksRef.where('memberIds', arrayContains: uid).get();
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
