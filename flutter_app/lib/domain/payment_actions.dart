import 'models.dart';

/// 誰可以對一筆付款做什麼。`SettlementPanel.vue` 裡三個 `can*` 的 Dart 版。
///
/// 抽成純函式而不是寫在 widget 裡，是因為這些是**規則**，不是畫面：
/// firestore.rules 擋的是同一組條件，兩邊講的話必須一樣。UI 只是先把
/// 按不到的按鈕收起來，不要讓人按了才失敗。

/// 記錄一筆「A 付給 B」。
///
/// 付款人自己記，或管理員代記 —— 被移除的成員沒辦法自己記，那時只剩代記。
bool canRecordPayment({
  required bool canWrite,
  required String currentUid,
  required String from,
  required bool isAdmin,
}) {
  return canWrite && (currentUid == from || isAdmin);
}

/// 確認收到錢。
///
/// 只有收款人（或管理員）能確認 —— 付款人說「我付了」不算數，
/// 不然任何人都能把自己的欠款一鍵清掉。已確認的不能再確認。
bool canConfirmPayment({
  required bool canWrite,
  required String currentUid,
  required Payment payment,
  required bool isAdmin,
}) {
  if (!canWrite) return false;
  if (payment.status == 'confirmed') return false;
  return currentUid == payment.to || isAdmin;
}

/// 刪掉記錯的付款。付款人、收款人、管理員都可以 —— 兩邊的當事人
/// 都看得出來這筆是不是記錯了。
bool canDeletePayment({
  required bool canWrite,
  required String currentUid,
  required Payment payment,
  required bool isAdmin,
}) {
  if (!canWrite) return false;
  return currentUid == payment.from ||
      currentUid == payment.to ||
      isAdmin;
}

/// 新付款要寫進 Firestore 的欄位。
///
/// 收款人自己記的話當下就算確認 —— 本來就只有他能證明錢收到了，
/// 再要他確認自己一次是多按一下而已。
Map<String, dynamic> paymentInput({
  required String from,
  required String to,
  required int amount,
  required String currency,
  required String currentUid,
}) {
  return {
    'from': from,
    'to': to,
    'amount': amount,
    // 結算永遠用任務的預設幣別算，這裡存的是「當時的預設幣別是什麼」——
    // 網頁版也存，兩邊寫出來的文件要長得一樣。
    'currency': currency,
    'status': currentUid == to ? 'confirmed' : 'pending',
  };
}
