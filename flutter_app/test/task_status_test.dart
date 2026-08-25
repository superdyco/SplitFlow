import 'package:test/test.dart';
import 'package:splitflow/domain/task_status.dart';

/// `tests/taskStatus.test.ts` 與 `taskRole.test.ts` 的 Dart 版。
void main() {
  group('taskStatusFrom', () {
    test('認得三種狀態', () {
      expect(taskStatusFrom('active'), TaskStatus.active);
      expect(taskStatusFrom('archived'), TaskStatus.archived);
      expect(taskStatusFrom('deleted'), TaskStatus.deleted);
    });

    test('沒有 status 的舊資料當成進行中 —— 不能讓它們從列表消失', () {
      expect(taskStatusFrom(null), TaskStatus.active);
      expect(taskStatusFrom(''), TaskStatus.active);
      expect(taskStatusFrom('沒看過的值'), TaskStatus.active);
    });
  });

  group('partitionTasks', () {
    // 測試用的最小形狀：只有 id 跟狀態。
    final rows = [
      ('t1', TaskStatus.active),
      ('t2', TaskStatus.archived),
      ('t3', TaskStatus.deleted),
      ('t4', TaskStatus.active),
    ];

    test('已刪除的絕對不會出現在任何一堆', () {
      final result = partitionTasks(rows, (row) => row.$2);
      final all = [...result.active, ...result.archived].map((r) => r.$1);
      expect(all, isNot(contains('t3')));
    });

    test('進行中與封存分開', () {
      final result = partitionTasks(rows, (row) => row.$2);
      expect(result.active.map((r) => r.$1).toList(), ['t1', 't4']);
      expect(result.archived.map((r) => r.$1).toList(), ['t2']);
    });

    test('保留原本的順序', () {
      final many = [
        ('a', TaskStatus.active),
        ('b', TaskStatus.active),
        ('c', TaskStatus.active),
      ];
      final result = partitionTasks(many, (row) => row.$2);
      expect(result.active.map((r) => r.$1).toList(), ['a', 'b', 'c']);
    });

    test('空清單不會爆', () {
      final result = partitionTasks(<(String, TaskStatus)>[], (row) => row.$2);
      expect(result.active, isEmpty);
      expect(result.archived, isEmpty);
    });
  });

  group('taskRole', () {
    test('owner 優先於 adminIds', () {
      // owner 通常也在 adminIds 裡，不能因此被判成 admin。
      expect(
        taskRole(ownerId: 'a', adminIds: ['a', 'b'], uid: 'a'),
        TaskRole.owner,
      );
    });

    test('在 adminIds 裡的是 admin', () {
      expect(
        taskRole(ownerId: 'a', adminIds: ['a', 'b'], uid: 'b'),
        TaskRole.admin,
      );
    });

    test('其他人是一般成員', () {
      expect(
        taskRole(ownerId: 'a', adminIds: ['a'], uid: 'c'),
        TaskRole.member,
      );
    });

    test('adminIds 是空的也算得出來', () {
      expect(taskRole(ownerId: 'a', adminIds: [], uid: 'c'), TaskRole.member);
    });
  });
}
