/// 成員在畫面上的名字。`src/utils/memberName.ts` 的 Dart 版。
///
/// 這段邏輯本來以 `'${m.nickname}${m.active ? '' : '（已離開）'}'` 的形式散在
/// expense_form_page 的三個地方，每加一種狀態就要改三次。集中在這裡。
///
/// 「已刪除」壓過「已離開」：刪掉帳號的人一定也是 inactive，但那兩件事對其他
/// 人意義不同 —— 已離開的人可以用邀請連結回來（規則裡的 `rejoinsSelf` 允許），
/// 刪掉帳號的人永遠不會。
library;

import 'models.dart';

String memberDisplayName(TaskMember member) {
  final name = member.nickname.isEmpty ? '（沒有暱稱）' : member.nickname;

  if (member.deleted) return '$name（已刪除）';
  if (!member.active) return '$name（已離開）';
  return name;
}
