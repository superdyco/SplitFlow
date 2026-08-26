import '../domain/currency.dart';
import '../domain/models.dart';

/// Firestore 文件 → 領域模型。`src/services/expenseService.ts` 的
/// `normalizeExpense` 與同類函式的 Dart 版。
///
/// **刻意不 import `cloud_firestore`。** 那是個 Flutter plugin，一旦 import
/// 進來這個檔案就只能用 `flutter test` 跑，而這裡正是最需要輕量測試的地方 ——
/// 「舊資料沒有這個欄位」的 bug 全都住在這一層。
///
/// 代價是時間戳要由呼叫端先轉成 DateTime 再傳進來，那一行留在 repository。

/// 這個 app 上線至今欄位加過好幾輪，讀取時一律要能吞下舊形狀：
///
/// | 欄位 | 什麼時候會缺 | 補什麼 |
/// | --- | --- | --- |
/// | `splits` | 自訂分攤之前 | 從 `splitMemberIds` 均分推回來 |
/// | `baseAmount` | 多幣別之前 | null（同幣別時結算會自己沿用 amount） |
/// | `splitMode` | 自訂分攤之前 | even |
/// | `date` / `time` | 日期欄位之前 | null（date 退回 createdAt 的日期） |
/// | `place` / `receipt` / `note` | 各自的功能之前 | null / null / 空字串 |
///
/// 補值的方向一律偏保守：寧可少一點資訊，也不要讓一筆支出因為缺欄位就
/// 整個讀不出來。
Expense expenseFromMap(
  String id,
  Map<String, dynamic> data,
  DateTime? createdAt,
) {
  final amount = (data['amount'] as num?)?.toInt() ?? 0;

  var splits = _intMap(data['splits']);
  if (splits == null) {
    // 自訂分攤之前的舊支出只存了參與者名單，金額要當場均分推回來。
    // 用同一支 allocate，餘數的分法才會跟結算頁一致。
    final legacyIds =
        (data['splitMemberIds'] as List?)?.cast<String>() ?? const [];
    final shares = allocate(amount, List<int>.filled(legacyIds.length, 1));
    splits = {
      for (var i = 0; i < legacyIds.length; i += 1) legacyIds[i]: shares[i],
    };
  }

  return Expense(
    id: id,
    title: (data['title'] as String?) ?? '',
    amount: amount,
    currency: (data['currency'] as String?) ?? '',
    baseAmount: (data['baseAmount'] as num?)?.toInt(),
    paidBy: (data['paidBy'] as String?) ?? '',
    splits: splits,
    category: categoryFrom(data['category'] as String?),
    splitMode:
        data['splitMode'] == 'custom' ? SplitMode.custom : SplitMode.even,
    date: _nonEmpty(data['date']),
    time: _nonEmpty(data['time']),
    createdAt: createdAt,
    place: _placeFrom(data['place']),
  );
}

Payment paymentFromMap(String id, Map<String, dynamic> data) {
  return Payment(
    id: id,
    from: (data['from'] as String?) ?? '',
    to: (data['to'] as String?) ?? '',
    amount: (data['amount'] as num?)?.toInt() ?? 0,
    // 認不得的狀態當成 pending —— 未確認的付款不影響餘額，
    // 猜錯的方向是「少扣」而不是「多扣」。
    status: data['status'] == 'confirmed' ? 'confirmed' : 'pending',
  );
}

ExpensePlace? _placeFrom(dynamic value) {
  if (value is! Map) return null;
  final name = value['name'];
  if (name is! String || name.isEmpty) return null;
  return ExpensePlace(
    name: name,
    address: value['address'] as String?,
    lat: (value['lat'] as num?)?.toDouble(),
    lng: (value['lng'] as num?)?.toDouble(),
    placeId: value['placeId'] as String?,
  );
}

/// 空字串跟「沒有這個欄位」在這裡是同一件事，一律回 null。
///
/// 這很重要：`date` 是空字串的話，`expenseDate` 會傳回空字串而不是退回
/// `createdAt` 的日期，那筆支出就會被分到一個叫「」的日期群組裡。
String? _nonEmpty(dynamic value) {
  if (value is! String || value.isEmpty) return null;
  return value;
}

/// Firestore 的數字可能是 int 或 double（例如經由 JSON 匯入的資料）。
/// 一律收斂成 int —— 金額是最小單位整數，浮點數不碰錢。
Map<String, int>? _intMap(dynamic value) {
  if (value is! Map) return null;
  final result = <String, int>{};
  value.forEach((key, item) {
    if (key is String && item is num) result[key] = item.toInt();
  });
  return result;
}
