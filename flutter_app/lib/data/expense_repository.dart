import 'package:cloud_firestore/cloud_firestore.dart';

import '../domain/expense_date.dart';
import '../domain/models.dart';
import 'firestore_refs.dart';
import 'mappers.dart';

/// 支出與付款的讀寫。`src/services/expenseService.ts` 與 `paymentService.ts`
/// 的 Dart 版。

/// 建立支出的結果。
class CreateExpenseResult {
  /// Firestore 的文件 id。**client 端產生，離線也拿得到。**
  final String id;

  /// 伺服器確認的 Future。離線時不會完成，呼叫端要用 `settleWrite` 包起來。
  final Future<void> synced;

  const CreateExpenseResult(this.id, this.synced);
}

class ExpenseRepository {
  /// 這個任務的所有支出，已經排好序。
  ///
  /// 排序刻意放在前端而不是交給 Firestore 的 orderBy：對 `date` 排序會把
  /// 沒有這個欄位的舊文件整個排除掉，那些支出會直接從列表消失。
  Future<List<Expense>> listExpenses(String taskId) async {
    final snap = await expensesRef(taskId).get();
    final expenses = snap.docs
        .map((doc) => expenseFromMap(
              doc.id,
              doc.data(),
              toDateTime(doc.data()['createdAt']),
            ))
        .toList()
      ..sort(compareExpenses);
    return expenses;
  }

  Future<Expense?> getExpense(String taskId, String expenseId) async {
    final snap = await expensesRef(taskId).doc(expenseId).get();
    final data = snap.data();
    if (data == null) return null;
    return expenseFromMap(snap.id, data, toDateTime(data['createdAt']));
  }

  /*
    下面三個寫入都刻意不 await，把「要不要等伺服器」交給呼叫端用
    `settleWrite` 決定。

    Firestore 的寫入 Future 要等伺服器確認才完成，離線時永遠不會回來 ——
    但資料已經安全排進本機佇列了。在這裡 await 的話畫面會卡死在「儲存中...」。
  */

  /// 支出與任務的 expenseCount 一起寫，兩者不能分開 ——
  /// 列表頁顯示的筆數就是那個欄位，對不上就是使用者看得到的 bug。
  CreateExpenseResult createExpense(
    String taskId,
    Map<String, dynamic> input,
    String createdBy,
  ) {
    final expenseDoc = expensesRef(taskId).doc();
    final batch = db.batch();

    batch.set(expenseDoc, {
      ...input,
      'createdBy': createdBy,
      'createdAt': FieldValue.serverTimestamp(),
      'updatedAt': FieldValue.serverTimestamp(),
    });
    batch.update(taskRef(taskId), {
      'expenseCount': FieldValue.increment(1),
      'updatedAt': FieldValue.serverTimestamp(),
    });

    return CreateExpenseResult(expenseDoc.id, batch.commit());
  }

  Future<void> updateExpense(
    String taskId,
    String expenseId,
    Map<String, dynamic> input,
  ) {
    return expensesRef(taskId).doc(expenseId).update({
      ...input,
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }

  Future<void> deleteExpense(String taskId, String expenseId) {
    final batch = db.batch();
    batch.delete(expensesRef(taskId).doc(expenseId));
    batch.update(taskRef(taskId), {
      'expenseCount': FieldValue.increment(-1),
      'updatedAt': FieldValue.serverTimestamp(),
    });
    return batch.commit();
  }
}

class PaymentRepository {
  Future<List<Payment>> listPayments(String taskId) async {
    final snap =
        await paymentsRef(taskId).orderBy('createdAt', descending: true).get();
    return snap.docs.map((doc) => paymentFromMap(doc.id, doc.data())).toList();
  }

  /// 收款人自己記的話當下就算確認 —— 本來就只有他能證明錢收到了。
  Future<String> createPayment(
    String taskId,
    Map<String, dynamic> input,
    String createdBy,
  ) async {
    final paymentDoc = paymentsRef(taskId).doc();
    await paymentDoc.set({
      ...input,
      'createdBy': createdBy,
      'confirmedAt':
          input['status'] == 'confirmed' ? FieldValue.serverTimestamp() : null,
      'createdAt': FieldValue.serverTimestamp(),
      'updatedAt': FieldValue.serverTimestamp(),
    });
    return paymentDoc.id;
  }

  Future<void> confirmPayment(String taskId, String paymentId) {
    return paymentsRef(taskId).doc(paymentId).update({
      'status': 'confirmed',
      'confirmedAt': FieldValue.serverTimestamp(),
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }

  Future<void> deletePayment(String taskId, String paymentId) {
    return paymentsRef(taskId).doc(paymentId).delete();
  }
}
