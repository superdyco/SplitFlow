/// 任務狀態的顯示與分堆。`src/utils/taskStatus.ts` 與 `taskRole.ts` 的 Dart 版。
///
/// 分堆放在這裡而不是散在畫面的條件判斷，是因為「已刪除的絕對不能出現」是一條
/// 需要被測試釘住的規則 —— 漏在任何一個地方，使用者就會看到本來刪掉的東西。

/// active 進行中、archived 封存唯讀、deleted 軟刪除（前端一律濾掉）。
///
/// 用軟刪除是因為 Firestore 沒有 cascade delete —— 刪掉任務文件會讓底下的
/// members / expenses / payments / settlements 變成永遠的孤兒。
enum TaskStatus { active, archived, deleted }

const Map<TaskStatus, String> statusLabels = {
  TaskStatus.active: '進行中',
  TaskStatus.archived: '已封存',
  TaskStatus.deleted: '已刪除',
};

/// Firestore 存的是字串。**認不得的值一律當成進行中。**
///
/// 這個預設值的方向很重要：選錯的話（例如當成 deleted）那些任務會整個從
/// 列表消失，而使用者不會知道為什麼。這個功能之前建立的舊資料沒有 status 欄位。
TaskStatus taskStatusFrom(String? value) {
  switch (value) {
    case 'archived':
      return TaskStatus.archived;
    case 'deleted':
      return TaskStatus.deleted;
    default:
      return TaskStatus.active;
  }
}

/// 分堆的結果。已刪除的不在任何一堆裡 —— 它們被丟掉了，不是被藏起來。
class PartitionedTasks<T> {
  final List<T> active;
  final List<T> archived;
  const PartitionedTasks(this.active, this.archived);
}

/// 泛型而不是寫死某個 Task 型別：呼叫端手上通常是「任務 + 我的角色」這種組合，
/// 拆開再組回去只會讓它變麻煩。這裡只看 status，其餘原樣帶過。
PartitionedTasks<T> partitionTasks<T>(
  List<T> rows,
  TaskStatus Function(T row) statusOf,
) {
  final active = <T>[];
  final archived = <T>[];

  for (final row in rows) {
    final status = statusOf(row);
    if (status == TaskStatus.deleted) continue;
    if (status == TaskStatus.archived) {
      archived.add(row);
    } else {
      active.add(row);
    }
  }

  return PartitionedTasks(active, archived);
}

enum TaskRole { owner, admin, member }

/// 從 task 文件推導我的角色，不用再讀 members 子集合。
///
/// 這是安全的，因為兩邊永遠一起改：建立任務時同時寫 ownerId/adminIds 與
/// member 文件的 role，改角色與移除成員則是用同一個 batch 改兩邊，不會出現
/// member 文件說 admin、adminIds 裡卻沒有他的狀態。
///
/// 動機是速度：列表原本每個任務都要多讀一次 members/{uid}，量測顯示這組扇出
/// 佔掉整個冷啟動的 44%（四個任務 958ms），而且並行讀取讓最慢的那筆決定全部 ——
/// 三筆卡住時整份清單都不會出現。改成推導之後這段歸零。
TaskRole taskRole({
  required String ownerId,
  required List<String> adminIds,
  required String uid,
}) {
  if (ownerId == uid) return TaskRole.owner;
  return adminIds.contains(uid) ? TaskRole.admin : TaskRole.member;
}
