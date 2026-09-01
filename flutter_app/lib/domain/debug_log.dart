/// 最近發生的錯誤，留在這台裝置上。`src/utils/debugLog.ts` 的 Dart 版。
///
/// 手機上打不開 console，而使用者的回報永遠是「它壞了」。這裡把錯誤攔下來留成
/// 一份清單，個人設定頁的診斷資訊會連它一起複製出去。
///
/// **只放在記憶體裡，關掉 App 就沒了。** 寫進檔案要處理容量、清除與多次啟動
/// 混在一起的問題，而真正要查的錯誤幾乎都是「剛剛那一下」—— 重開之後本來就
/// 重現不了，留著舊的只會讓人去追一個已經不存在的問題。
///
/// 純函式模組，不 import Firebase 也不 import Flutter，所以測得動。
library;

/// 50 筆是「查得到剛才發生什麼」與「不要無限吃記憶體」之間的折衷。
const int maxLoggedErrors = 50;

class LoggedError {
  final DateTime at;

  /// 從哪裡進來的：flutter、platform、firestore、storage ...
  final String source;
  final String message;

  /// 連續重複的同一個錯誤只佔一筆，用次數表示。
  final int count;

  const LoggedError({
    required this.at,
    required this.source,
    required this.message,
    required this.count,
  });

  LoggedError repeated(DateTime at) => LoggedError(
        at: at,
        source: source,
        message: message,
        count: count + 1,
      );
}

final List<LoggedError> _entries = [];

/// 把任何丟出來的東西變成一行字。
///
/// `code` 一定要留 —— Firebase 的錯誤訊息會隨版本改寫，`permission-denied`
/// 這種 code 才是能拿去查、能拿來比對規則的東西。
///
/// Dart 這邊拿不到統一的 `code` 欄位（`FirebaseException` 有，但那是
/// Firebase 的型別，而這個檔案不能 import 它），所以由呼叫端負責把 code
/// 併進訊息裡。這裡只保證不會印出沒有內容的型別名稱。
String describeError(Object? error) {
  if (error == null) return '(null)';
  if (error is String) return error;

  final text = error.toString();
  // `Instance of 'Foo'` 是 Dart 版的 `[object Object]` —— 有印跟沒印一樣，
  // 至少要留下型別名稱讓人知道是什麼東西炸了。
  if (text.startsWith("Instance of '")) return '${error.runtimeType}';
  return text;
}

void logError(String source, Object? error, {DateTime? at}) {
  final message = describeError(error);
  final now = at ?? DateTime.now();

  // 重試迴圈（背景重連、地圖重載）會用同一個錯誤在幾秒內灌滿 50 格，
  // 把最舊、通常也最接近起因的那幾筆擠掉。同樣的連續錯誤併成一筆。
  if (_entries.isNotEmpty) {
    final last = _entries.last;
    if (last.source == source && last.message == message) {
      _entries[_entries.length - 1] = last.repeated(now);
      return;
    }
  }

  _entries.add(
    LoggedError(at: now, source: source, message: message, count: 1),
  );
  if (_entries.length > maxLoggedErrors) _entries.removeAt(0);
}

/// 回傳複本：呼叫端拿去渲染，不該能改到這裡面的東西。
List<LoggedError> recentErrors() => List.unmodifiable(_entries);

void clearErrors() => _entries.clear();
