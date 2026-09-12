import 'package:test/test.dart';
import 'package:splitflow/domain/member_name.dart';
import 'package:splitflow/domain/models.dart';

/// `tests/memberName.test.ts` 的 Dart 版，案例一比一照搬。
TaskMember member({
  String nickname = '小美',
  bool active = true,
  bool deleted = false,
  bool left = false,
}) =>
    TaskMember(
      uid: 'u1',
      nickname: nickname,
      role: 'member',
      active: active,
      deleted: deleted,
      left: left,
    );

void main() {
  group('memberDisplayName', () {
    test('正常成員就是暱稱本身', () {
      expect(memberDisplayName(member()), '小美');
    });

    test('被移除的成員標成已離開', () {
      expect(memberDisplayName(member(active: false)), '小美（已離開）');
    });

    test('自己退出的人標成已退出，不是已離開', () {
      expect(memberDisplayName(member(active: false, left: true)), '小美（已退出）');
    });

    test('刪除帳號的人標成已刪除，不是已離開', () {
      expect(memberDisplayName(member(active: false, deleted: true)), '小美（已刪除）');
    });

    test('刪掉帳號壓過退出', () {
      expect(memberDisplayName(member(active: false, left: true, deleted: true)), '小美（已刪除）');
    });

    test('沒有暱稱時不要只留下一個括號', () {
      expect(memberDisplayName(member(nickname: '', active: false)), '（沒有暱稱）（已離開）');
    });
  });
}
