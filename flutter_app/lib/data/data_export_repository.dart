import 'dart:convert';
import 'dart:io';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:path_provider/path_provider.dart';

import '../domain/data_export.dart';
import '../domain/receipt_policy.dart';
import 'firestore_refs.dart';

class DataExportProgress {
  final String message;
  final int completedReceipts;
  final int totalReceipts;

  const DataExportProgress({
    required this.message,
    required this.completedReceipts,
    required this.totalReceipts,
  });
}

typedef ExportProgressCallback = void Function(DataExportProgress progress);

String? _receiptPath(Map<String, dynamic> expense) {
  final receipt = expense['receipt'];
  if (receipt is! Map) return null;
  final path = receipt['path'];
  return path is String && path.isNotEmpty ? path : null;
}

class _TaskSource {
  final String id;
  final Map<String, dynamic> task;
  final List<Map<String, dynamic>> members;
  final List<Map<String, dynamic>> expenses;
  final List<Map<String, dynamic>> payments;
  final List<Map<String, dynamic>> settlements;

  const _TaskSource({
    required this.id,
    required this.task,
    required this.members,
    required this.expenses,
    required this.payments,
    required this.settlements,
  });
}

class DataExportRepository {
  final FirebaseStorage _storage;

  DataExportRepository({FirebaseStorage? storage})
    : _storage = storage ?? FirebaseStorage.instance;

  Future<List<Map<String, dynamic>>> _documents(
    CollectionReference<Map<String, dynamic>> ref,
  ) async {
    final snap = await ref.get();
    return snap.docs.map((doc) => {'id': doc.id, ...doc.data()}).toList();
  }

  Future<Map<String, dynamic>> _exportReceipt(String path) async {
    try {
      final bytes = await _storage.ref(path).getData(maxUploadBytes);
      if (bytes == null) throw StateError('收據沒有內容');
      return {
        'mimeType': 'image/jpeg',
        'encoding': 'base64',
        'sizeBytes': bytes.length,
        'data': base64Encode(bytes),
      };
    } catch (error) {
      return {'unavailable': true, 'error': error.toString()};
    }
  }

  /// 逐筆把 JSON 寫進暫存檔。圖片只會一次有一張在記憶體裡。
  Future<File> export(String uid, {ExportProgressCallback? onProgress}) async {
    final taskSnap = await tasksRef
        .where('memberIds', arrayContains: uid)
        .get();
    final accountSnap = await usersRef.doc(uid).get();
    final sources = <_TaskSource>[];

    for (final taskDoc in taskSnap.docs) {
      final taskId = taskDoc.id;
      sources.add(
        _TaskSource(
          id: taskId,
          task: Map<String, dynamic>.from(taskDoc.data())..remove('inviteCode'),
          members: await _documents(membersRef(taskId)),
          expenses: await _documents(expensesRef(taskId)),
          payments: await _documents(paymentsRef(taskId)),
          settlements: await _documents(settlementsRef(taskId)),
        ),
      );
    }

    final totalReceipts = sources.fold<int>(
      0,
      (total, source) =>
          total +
          source.expenses.where((item) => _receiptPath(item) != null).length,
    );
    var completedReceipts = 0;
    final now = DateTime.now().toUtc();
    final directory = await getTemporaryDirectory();
    final date = now.toIso8601String().substring(0, 10);
    final file = File(
      '${directory.path}${Platform.pathSeparator}簡單分帳-資料匯出-$date.json',
    );
    final sink = file.openWrite();

    try {
      sink.write('{');
      sink.write('"format":"simple-split-data-export",');
      sink.write('"formatVersion":1,');
      sink.write('"exportedAt":${jsonEncode(now.toIso8601String())},');
      sink.write(
        '"account":${jsonEncode(exportJsonValue(accountSnap.exists ? {'uid': uid, ...accountSnap.data()!} : {'uid': uid}))},',
      );
      sink.write('"tasks":[');

      for (var taskIndex = 0; taskIndex < sources.length; taskIndex += 1) {
        final source = sources[taskIndex];
        if (taskIndex > 0) sink.write(',');
        sink.write('{');
        sink.write('"id":${jsonEncode(source.id)},');
        for (final entry in source.task.entries) {
          sink.write(
            '${jsonEncode(entry.key)}:${jsonEncode(exportJsonValue(entry.value))},',
          );
        }
        sink.write('"members":${jsonEncode(exportJsonValue(source.members))},');
        sink.write('"expenses":[');

        for (var index = 0; index < source.expenses.length; index += 1) {
          if (index > 0) sink.write(',');
          final expense = Map<String, dynamic>.from(source.expenses[index]);
          final path = _receiptPath(expense);
          if (path != null) {
            onProgress?.call(
              DataExportProgress(
                message:
                    '正在匯出「${source.task['name'] ?? '未命名任務'}」的收據 ${completedReceipts + 1}/$totalReceipts',
                completedReceipts: completedReceipts,
                totalReceipts: totalReceipts,
              ),
            );
            expense['receipt'] = await _exportReceipt(path);
            completedReceipts += 1;
          }
          sink.write(jsonEncode(exportJsonValue(expense)));
        }

        sink.write('],');
        sink.write(
          '"payments":${jsonEncode(exportJsonValue(source.payments))},',
        );
        sink.write(
          '"settlements":${jsonEncode(exportJsonValue(source.settlements))}',
        );
        sink.write('}');
      }

      sink.write(']}');
      await sink.flush();
      await sink.close();
      onProgress?.call(
        DataExportProgress(
          message: 'JSON 檔案已產生',
          completedReceipts: completedReceipts,
          totalReceipts: totalReceipts,
        ),
      );
      return file;
    } catch (_) {
      await sink.close();
      if (await file.exists()) await file.delete();
      rethrow;
    }
  }
}
