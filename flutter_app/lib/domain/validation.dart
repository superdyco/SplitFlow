/// 表單驗證。`src/utils/firestore.ts` 裡跟 Firebase 無關的那幾支。
///
/// 只搬驗證，不搬 `firebaseErrorMessage` —— 那支要認 Firestore 的錯誤碼，
/// 屬於資料存取層，而且原生的錯誤形狀跟 JS SDK 不一樣。

library;

/// 送出前的把關：空白就丟例外，有值就回傳去掉頭尾空白的版本。

String required(String value, String label) {
  final trimmed = value.trim();
  if (trimmed.isEmpty) throw FormatException('$label為必填');
  return trimmed;
}

/// 表單即時提示用。回傳 null 代表沒問題。
///
/// 跟 [required] 不同的是不會丟例外，而且**還沒開始輸入時不嘮叨** ——
/// [touched] 是 false 時空白不算錯，不然一進表單就滿江紅。
String? textFieldError(
  String value,
  String label, {
  int? max,
  bool touched = true,
}) {
  final trimmed = value.trim();
  if (trimmed.isEmpty) return touched ? '$label為必填' : null;
  if (max != null && trimmed.length > max) return '$label最多 $max 個字';
  return null;
}

/// 結束日期不能早於開始日期。兩邊都有填才檢查。
///
/// 直接比字串就夠了：`"YYYY-MM-DD"` 的字典序等於時間序，而且不用碰時區。
String? dateRangeError(String startDate, String endDate) {
  if (startDate.isEmpty || endDate.isEmpty) return null;
  return endDate.compareTo(startDate) < 0 ? '結束日期不能早於開始日期' : null;
}
