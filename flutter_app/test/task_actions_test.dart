import 'package:splitflow/domain/models.dart';
import 'package:splitflow/domain/task_actions.dart';
import 'package:splitflow/domain/task_status.dart';
import 'package:test/test.dart';

void main() {
  Task task({
    String name = '京都・大阪 五天四夜',
    int expenseCount = 0,
    int memberCount = 4,
    String ownerId = 'me',
  }) {
    return Task(
      id: 't1',
      name: name,
      defaultCurrency: 'TWD',
      ownerId: ownerId,
      adminIds: const [],
      memberIds: const [],
      memberCount: memberCount,
      expenseCount: expenseCount,
      status: 'active',
      inviteCode: 'abc',
      startDate: null,
      endDate: null,
    );
  }

  group('封存與解除', () {
    test('封存要講清楚資料還在、而且可以解除', () {
      final prompt = taskActionPrompt(task(), TaskStatus.archived);
      expect(prompt.confirmLabel, '封存');
      expect(prompt.message, contains('資料留著'));
      expect(prompt.message, contains('隨時可以解除'));
    });

    test('封存跟解除都不是破壞性的，不用打字確認', () {
      for (final next in [TaskStatus.archived, TaskStatus.active]) {
        final prompt = taskActionPrompt(task(expenseCount: 100), next);
        expect(prompt.requireText, isNull, reason: next.name);
        expect(prompt.destructive, isFalse, reason: next.name);
      }
    });
  });

  group('刪除', () {
    test('訊息要講出實際規模 —— 「無法復原」對空任務跟對 100 筆是同一句話', () {
      final prompt = taskActionPrompt(
        task(memberCount: 15, expenseCount: 100),
        TaskStatus.deleted,
      );
      expect(prompt.message, contains('15 位成員'));
      expect(prompt.message, contains('100 筆支出'));
      expect(prompt.message, contains('無法復原'));
      expect(prompt.destructive, isTrue);
    });

    test('有支出的要打出任務名字才刪得掉', () {
      final prompt = taskActionPrompt(
        task(name: '曼谷旅行', expenseCount: 1),
        TaskStatus.deleted,
      );
      expect(prompt.requireText, '曼谷旅行');
    });

    test('空任務不用打字 —— 建錯的東西刪掉風險是零，不該被懲罰', () {
      final prompt = taskActionPrompt(
        task(expenseCount: 0),
        TaskStatus.deleted,
      );
      expect(prompt.requireText, isNull);
      // 但它仍然是破壞性操作，按鈕要紅的。
      expect(prompt.destructive, isTrue);
    });

    test('分界線是「有沒有支出」，不是筆數多寡', () {
      expect(
        taskActionPrompt(task(expenseCount: 1), TaskStatus.deleted).requireText,
        isNotNull,
      );
      expect(
        taskActionPrompt(task(expenseCount: 0), TaskStatus.deleted).requireText,
        isNull,
      );
    });
  });

  group('canChangeTaskStatus', () {
    test('只有 owner 能封存與刪除', () {
      expect(canChangeTaskStatus(task(ownerId: 'me'), 'me'), isTrue);
      expect(canChangeTaskStatus(task(ownerId: 'someone'), 'me'), isFalse);
    });

    test('管理員也不行 —— 刪掉整趟旅程不是代記帳的權限', () {
      const t = Task(
        id: 't1',
        name: 'x',
        defaultCurrency: 'TWD',
        ownerId: 'someone',
        adminIds: ['me'],
        memberIds: [],
        memberCount: 2,
        expenseCount: 0,
        status: 'active',
        inviteCode: 'abc',
        startDate: null,
        endDate: null,
      );
      expect(canChangeTaskStatus(t, 'me'), isFalse);
    });
  });
}
