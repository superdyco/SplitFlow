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
/// | `createdBy` | 不會缺，第一版就在寫 | 空字串（讀不出來時誰都不算作者） |
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
    weather: weatherFrom(data['weather']),
    receipt: _receiptFrom(data['receipt']),
    createdBy: (data['createdBy'] as String?) ?? '',
    note: (data['note'] as String?) ?? '',
  );
}

/// 收據欄位。收據功能之前的支出沒有這個欄位，是 null。
///
/// 兩個欄位都空的話回 null 而不是一個空殼 —— 「有一個什麼都沒有的收據」
/// 跟「沒有收據」對畫面是同一件事，讓呼叫端只要判斷一次。
ExpenseReceipt? _receiptFrom(dynamic value) {
  if (value is! Map) return null;
  final receipt = ExpenseReceipt(
    path: _nonEmpty(value['path']),
    localId: _nonEmpty(value['localId']),
  );
  return receipt.isEmpty ? null : receipt;
}

/// 結算快照。
///
/// 每個欄位都補得住預設值：快照是歷史紀錄，讀不出來的那一份不該讓整頁掛掉，
/// 顯示成一份空的結算至少還看得到日期與備註。
SettlementSnapshot settlementFromMap(
  String id,
  Map<String, dynamic> data,
  DateTime? createdAt,
) {
  return SettlementSnapshot(
    id: id,
    createdBy: (data['createdBy'] as String?) ?? '',
    createdAt: createdAt,
    data: SettlementSnapshotInput(
      currency: (data['currency'] as String?) ?? '',
      total: (data['total'] as num?)?.toInt() ?? 0,
      paidTotal: (data['paidTotal'] as num?)?.toInt() ?? 0,
      expenseCount: (data['expenseCount'] as num?)?.toInt() ?? 0,
      balances: _balances(data['balances']),
      transfers: _transfers(data['transfers']),
      memberNames: _names(data['memberNames']),
      note: (data['note'] as String?) ?? '',
    ),
  );
}

Map<String, String> _names(dynamic value) {
  if (value is! Map) return const {};
  return {
    for (final entry in value.entries) '${entry.key}': '${entry.value}',
  };
}

List<MemberBalance> _balances(dynamic value) {
  if (value is! List) return const [];
  return [
    for (final item in value)
      if (item is Map)
        MemberBalance(
          uid: (item['uid'] as String?) ?? '',
          paid: (item['paid'] as num?)?.toInt() ?? 0,
          owed: (item['owed'] as num?)?.toInt() ?? 0,
          balance: (item['balance'] as num?)?.toInt() ?? 0,
        ),
  ];
}

List<Transfer> _transfers(dynamic value) {
  if (value is! List) return const [];
  return [
    for (final item in value)
      if (item is Map)
        Transfer(
          from: (item['from'] as String?) ?? '',
          to: (item['to'] as String?) ?? '',
          amount: (item['amount'] as num?)?.toInt() ?? 0,
        ),
  ];
}

/// 快照寫進 Firestore 的形狀。**要跟網頁版寫出來的一模一樣** ——
/// 同一個任務的紀錄兩邊都讀得到。
Map<String, dynamic> settlementToMap(SettlementSnapshotInput input) {
  return {
    'currency': input.currency,
    'total': input.total,
    'paidTotal': input.paidTotal,
    'expenseCount': input.expenseCount,
    'balances': [
      for (final item in input.balances)
        {
          'uid': item.uid,
          'paid': item.paid,
          'owed': item.owed,
          'balance': item.balance,
        },
    ],
    'transfers': [
      for (final item in input.transfers)
        {'from': item.from, 'to': item.to, 'amount': item.amount},
    ],
    'memberNames': input.memberNames,
    'note': input.note,
  };
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

/// 天氣欄位。比照 _placeFrom：形狀不對就整個回 null，不丟例外。
///
/// 天氣是裝飾欄位，一筆支出不該因為它壞掉就整筆讀不出來。
///
/// 公開而不是私有，因為 report_mappers.dart 讀報告的時間軸時要用同一份。
/// 兩份一樣的解析遲早會分岔，而分岔的症狀是同一個天氣在兩個畫面不一樣。
Weather? weatherFrom(dynamic value) {
  if (value is! Map) return null;

  final code = (value['code'] as num?)?.toInt();
  final high = (value['high'] as num?)?.toInt();
  final low = (value['low'] as num?)?.toInt();
  if (code == null || high == null || low == null) return null;

  return Weather(
    code: code,
    high: high,
    low: low,
    // exact 沒有是正常的 —— 那代表這筆支出沒填時間。
    exact: (value['exact'] as num?)?.toInt(),
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

/// member 文件。`active` 與 `virtual` 都是後來才加的欄位，舊文件沒有 ——
/// 兩個都往「保守」的方向猜：還在、不是虛擬的。反過來猜的話，
/// 所有舊成員會一次消失或一次全變成虛擬。
TaskMember memberFromMap(Map<String, dynamic> data) {
  return TaskMember(
    uid: (data['uid'] as String?) ?? '',
    nickname: (data['nickname'] as String?) ?? '',
    role: (data['role'] as String?) ?? 'member',
    active: data['active'] != false,
    virtual: data['virtual'] == true,
    // 用 == true 而不是 as bool：舊文件沒有這個欄位，讀到的是 null，
    // 強制轉型會直接丟例外。
    deleted: data['deleted'] == true,
  );
}
