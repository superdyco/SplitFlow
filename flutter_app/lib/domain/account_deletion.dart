/// 刪除帳號的確認文案。`src/utils/accountDeletion.ts` 的 Dart 版。
///
/// **刻意不提未結清餘額。** 付款確認不是強制流程 —— 人可以在現實裡還完錢卻
/// 從不按「已收到」。App 裡的餘額因此不是事實，拿它去說「你還欠某某多少」是
/// 把內部狀態當成真實債務。這裡講的是「你會失去什麼」。
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
    // 什麼都還沒有的人刪掉風險是零，不該被懲罰。
    requireText: taskCount > 0 ? nickname : null,
  );
}
