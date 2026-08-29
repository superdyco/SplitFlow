import 'models.dart';
import 'task_status.dart';

/// 封存／解除封存／刪除任務的確認內容。
/// `src/pages/TaskListPage.vue` 裡那組 `dialog*` computed 的 Dart 版。
///
/// 抽成純函式的理由跟 `removeMemberPrompt` 一樣：這些是**規則**不是畫面。
/// 尤其是下面那條分級摩擦 —— 它決定使用者會不會誤刪掉一整趟旅程的帳，
/// 值得有測試釘住。

class TaskActionPrompt {
  final String title;
  final String message;
  final String confirmLabel;

  /// 不是 null 的話，要使用者**照著打出這串字**才能按下確認。
  final String? requireText;

  const TaskActionPrompt({
    required this.title,
    required this.message,
    required this.confirmLabel,
    required this.requireText,
  });

  bool get destructive => requireText != null || confirmLabel == '刪除';
}

/// [next] 是要切換到的狀態。
TaskActionPrompt taskActionPrompt(Task task, TaskStatus next) {
  switch (next) {
    case TaskStatus.archived:
      return const TaskActionPrompt(
        title: '封存這個任務？',
        message: '封存之後資料留著可以查，但不能再記帳或修改。隨時可以解除。',
        confirmLabel: '封存',
        requireText: null,
      );

    case TaskStatus.active:
      return const TaskActionPrompt(
        title: '解除封存？',
        message: '解除之後這個任務就恢復正常，可以繼續記帳。',
        confirmLabel: '解除封存',
        requireText: null,
      );

    case TaskStatus.deleted:
      return TaskActionPrompt(
        title: '刪除這個任務？',
        // 講出實際規模，讓人知道自己在刪什麼。「無法復原」四個字對
        // 空任務跟對一趟 100 筆的旅程是同一句話，但後果差了十萬八千里。
        message: '這個任務有 ${task.memberCount} 位成員、${task.expenseCount} 筆支出。'
            '刪除之後所有成員都會看不到，而且無法復原。',
        confirmLabel: '刪除',
        // 分級摩擦：後果越嚴重、需要越刻意的動作。
        //
        // 建錯的空任務刪掉風險是零，不該被懲罰；有支出的任務被誤刪是
        // 不可逆的災難，值得逼他把名字打一次 —— 打的過程就是在確認
        // 自己刪的是哪一個。
        requireText: task.expenseCount > 0 ? task.name : null,
      );
  }
}

/// 只有 owner 能封存與刪除。
///
/// firestore.rules 也擋著，這裡收起按鈕只是不要讓人按了才失敗。
bool canChangeTaskStatus(Task task, String uid) => task.ownerId == uid;
