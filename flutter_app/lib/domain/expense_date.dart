import 'models.dart';

/// 支出的「發生日期」。`src/utils/expenseDate.ts` 的 Dart 版。
///
/// `date` 是 `"YYYY-MM-DD"` 字串而不是時間戳，因為日期不該有時區：
/// 在曼谷凌晨一點買的東西，存成帶時區的時間之後換個地方看就變成前一天了。
///
/// 舊資料沒有這個欄位，退回用 `createdAt` 的日期 —— 跟 `baseAmount` 同樣的
/// fallback 模式。

String _pad(int n) => n.toString().padLeft(2, '0');

/// 日期輸入框要的 `"YYYY-MM-DD"`。
///
/// 刻意用本地時區的欄位而不是 `toIso8601String()` —— 後者是 UTC，
/// 台灣時間凌晨記的帳會被算成前一天。
String toDateInput(DateTime date) =>
    '${date.year}-${_pad(date.month)}-${_pad(date.day)}';

/// 表單新增時的預設值。
String todayInput() => toDateInput(DateTime.now());

/// 時間輸入框要的 `"HH:MM"`，24 小時制。同樣走本地時區，理由同上。
String toTimeInput(DateTime date) => '${_pad(date.hour)}:${_pad(date.minute)}';

/// 表單新增時的預設值：現在幾點。記帳當下通常就是消費當下。
String nowTimeInput() => toTimeInput(DateTime.now());

/// 這筆支出的時間，沒記就是空字串。
///
/// 刻意**不**用 `createdAt` 當退路 —— `date` 可以，因為「哪一天」不記也猜得到；
/// 但補記昨天晚餐的人是今天下午按的送出，拿 createdAt 當時間就是憑空捏造。
/// 沒記時間就是沒有，顯示與排序都當它不存在。
String expenseTime(Expense expense) => expense.time ?? '';

String expenseDate(Expense expense) {
  final date = expense.date;
  if (date != null && date.isNotEmpty) return date;
  final createdAt = expense.createdAt;
  return createdAt == null ? '' : toDateInput(createdAt);
}

/// 日期新的在前；同一天有記時間的先比時間（晚的在前），都沒記才比後記的在前。
///
/// 為什麼有記時間的排在沒記的前面：`"HH:MM"` 跟空字串比大小，空字串一定小，
/// 所以降冪排下來自然沉底。這也是想要的順序 —— 說得出幾點的那幾筆先排好，
/// 剩下不知道幾點的接在後面，總比把它們插在中間某個猜出來的位置好。
///
/// 排序刻意放在前端而不是交給 Firestore 的 orderBy：對 `date` 排序會把
/// 沒有這個欄位的文件整個排除掉，舊支出會直接從列表消失。
int compareExpenses(Expense a, Expense b) {
  final byDate = expenseDate(b).compareTo(expenseDate(a));
  if (byDate != 0) return byDate;

  final byTime = expenseTime(b).compareTo(expenseTime(a));
  if (byTime != 0) return byTime;

  // createdAt 還沒回來代表這是剛送出的那一筆，讓它待在當天最上面。
  // 用一個一定比任何真實時間大的值，效果等同 TS 版的 Infinity。
  final farFuture = DateTime.utc(9999);
  final timeOfA = a.createdAt ?? farFuture;
  final timeOfB = b.createdAt ?? farFuture;
  return timeOfB.compareTo(timeOfA);
}
