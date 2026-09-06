/// 「今天要不要再蓋一次戳記」的規則。
///
/// 純函式，不碰 SharedPreferences 也不碰 Firestore —— 跟 `bias_memory.dart`
/// 同一個分工：規則放這裡，搬字串的放 `data/presence_store.dart`。
///
/// 戳記本身是給管理後台算活躍人數用的。個人檔案本來只有 createdAt 與
/// updatedAt，沒有任何欄位說得出「有多少人還在用」。
library;

/// 本地時區的某一天，`YYYY-MM-DD`。
///
/// 跟網頁版與後端彙總（台北時區）用同一種鍵。使用者都在同一個時區，
/// 所以本地日期就是彙總要的那一天。
String dayKey(DateTime now) {
  final month = now.month.toString().padLeft(2, '0');
  final day = now.day.toString().padLeft(2, '0');
  return '${now.year}-$month-$day';
}

/// 這一天蓋過了沒有。
///
/// 一天只寫一次：不擋的話就是每次開 App 都寫一次，而「今天有沒有來」這個
/// 問題一天寫一次就答得完整。
///
/// `stored` 是上次蓋章那天的鍵，讀不到（第一次、或偏好設定壞了）就當成沒蓋過。
bool shouldStamp(String? stored, String today) => stored != today;
