/// 錯誤碼 → 給使用者看的中文。`src/utils/firestore.ts` 的
/// `firebaseErrorMessage` 的 Dart 版，對照表與規則一字不差。
///
/// 刻意不 import Firebase：這一層要保持純 Dart，測試才跑得動。呼叫端把
/// code 與 message 拆出來傳進來（見 `data/error_text.dart`）。
///
/// 規則三條，依序：
///
///   1. 訊息本身已經是中文就照原樣 —— 那是我們自己寫的（雲端函式的
///      「請先設定暱稱」、登入錯誤的說明），比任何通用文案都準確。
///   2. 認得的 code 翻成中文。
///   3. 不認得的照原文 —— 不要憑空發明一句話。
///
/// 原文照樣進錯誤清單（呼叫端負責），診斷資訊撈得到，開發者不會少掉線索。
library;

/// FlutterFire 的 code 不帶前綴（`not-found`），網頁版帶（`functions/not-found`、
/// `storage/unauthorized`）。這裡一律用不帶前綴的 key，查的時候把前綴去掉。
const Map<String, String> _friendly = {
  'permission-denied': '你沒有權限做這件事。可能已經被移出這個任務，或任務已經封存。',
  'unauthorized': '沒有權限存取這個檔案。',
  'unauthenticated': '登入狀態過期了，請重新登入。',
  'not-found': '找不到這筆資料，可能已經被刪除。',
  'object-not-found': '找不到這筆資料，可能已經被刪除。',
  'already-exists': '這筆資料已經存在。',
  'resource-exhausted': '用量已經到上限，請稍後再試。',
  'quota-exceeded': '用量已經到上限，請稍後再試。',
  // 幾乎都是缺索引，而那則原文附著 Console 網址與專案 id。
  'failed-precondition': '這一頁還在準備中，請稍後再試一次。',
  'aborted': '剛好有其他人同時在修改，請再試一次。',
  'unavailable': '連不上伺服器。檢查一下網路，或稍後再試。',
  'deadline-exceeded': '伺服器太久沒有回應。檢查一下網路，或稍後再試。',
  'retry-limit-exceeded': '伺服器太久沒有回應。檢查一下網路，或稍後再試。',
  'cancelled': '已經取消了。',
  'canceled': '已經取消了。',
  'internal': '伺服器出了點問題，請稍後再試。一直發生的話，請到個人設定複製診斷資訊給開發者。',
  'unknown': '伺服器出了點問題，請稍後再試。一直發生的話，請到個人設定複製診斷資訊給開發者。',
  'data-loss': '伺服器出了點問題，請稍後再試。一直發生的話，請到個人設定複製診斷資訊給開發者。',
  'invalid-argument': '送出的資料格式不對，請檢查一下再試。',
  'out-of-range': '送出的資料格式不對，請檢查一下再試。',
  'unimplemented': '這個功能目前無法使用。',
};

final RegExp _chinese = RegExp(r'[一-鿿]');

String? _lookup(String? code) {
  if (code == null || code.isEmpty) return null;
  final slash = code.lastIndexOf('/');
  final bare = slash >= 0 ? code.substring(slash + 1) : code;
  return _friendly[code] ?? _friendly[bare];
}

/// 給使用者看的一句話。
String friendlyError({String? code, String? message}) {
  final text = message?.trim() ?? '';
  if (_chinese.hasMatch(text)) return text;
  final friendly = _lookup(code);
  if (friendly != null) return friendly;
  if (text.isNotEmpty) return text;
  return (code == null || code.isEmpty) ? '發生了沒有預期到的錯誤。' : code;
}

/// `Exception('…').toString()` 會變成「Exception: …」—— 那是 Dart 加的，
/// 不是給使用者看的。這個 App 到處都用 `throw Exception('中文說明')`。
String withoutExceptionPrefix(String text) =>
    text.startsWith('Exception: ') ? text.substring('Exception: '.length) : text;
