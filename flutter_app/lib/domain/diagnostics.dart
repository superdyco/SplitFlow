import 'debug_log.dart';

/// 診斷資訊的純文字版本。`src/utils/diagnostics.ts` 的 Dart 版。
///
/// 目的很具體：**使用者按一下複製、貼進聊天室，就足以判斷問題在哪。**
/// 所以每一欄都要對應到一種真的發生過的故障 —— 跑的是舊版、金鑰沒設所以
/// 地點搜尋悄悄退回純文字輸入、推播 token 沒註冊所以收不到通知。
/// 看起來厲害但答不出問題的欄位不要放。
///
/// 欄位跟網頁版不完全一樣，因為故障不一樣：
///
///   - **沒有「待上傳收據」**：原生版刻意沒有離線佇列（見
///     `receipt_repository.dart`），沒有那個狀態就沒有那條線索。
///   - **沒有「啟動方式」**：原生版只有一種。
///   - **多了推播 token**：那是原生獨有的失敗（通知權限被拒、
///     沒有 Google Play 服務），而且從畫面上完全看不出來。
///
/// 跟 `settlement_text.dart` 一樣是純函式：不 import Firebase 也不 import
/// Flutter，呼叫端負責把值蒐集好傳進來，這裡只排版。

/// build 時帶進來的版本戳，例如 `--dart-define=APP_VERSION="abc1234 2026-09-01"`。
///
/// 這個 app 沒有自動更新，使用者手上那台跑的是哪一版從外面完全看不出來 ——
/// 而「他跑的是舊版」是回報問題時第一個要排除的可能。
const String _buildVersion = String.fromEnvironment('APP_VERSION');

String get appVersion =>
    _buildVersion.isEmpty ? '未帶版本號（開發建置）' : _buildVersion;

class DiagnosticsInput {
  /// build 時用 `--dart-define=APP_VERSION=...` 帶進來的。
  final String version;
  final String uid;

  /// 已經翻成中文的供應商名稱，空字串代表查不到。
  final String loginMethod;

  /// 例如 `android 14`。
  final String platform;

  /// 推播 token 有沒有拿到。null 代表沒問到（例如問的時候就丟了例外）。
  final bool? pushToken;

  final bool placesKey;
  final bool mapsKey;
  final List<LoggedError> errors;

  const DiagnosticsInput({
    required this.version,
    required this.uid,
    required this.loginMethod,
    required this.platform,
    required this.pushToken,
    required this.placesKey,
    required this.mapsKey,
    required this.errors,
  });
}

String _two(int value) => value.toString().padLeft(2, '0');

/// 只有時分秒 —— 這份清單講的是「剛才那一下」，印日期只是噪音。
String _clockTime(DateTime at) {
  final local = at.toLocal();
  return '${_two(local.hour)}:${_two(local.minute)}:${_two(local.second)}';
}

String _pushLine(bool? token) {
  if (token == null) return '推播 問不到（可能沒有 Google Play 服務）';
  return token ? '推播 已取得 token' : '推播 沒有 token（收不到通知）';
}

String buildDiagnosticsText(DiagnosticsInput input) {
  final lines = <String>[
    '簡單分帳診斷資訊',
    // 版本排第一：回報問題時第一個要問的就是「你跑的是哪一版」。
    '版本 ${input.version}',
    '使用者 ${input.uid.isEmpty ? '未登入' : input.uid}',
    '登入方式 ${input.loginMethod.isEmpty ? '查不到' : input.loginMethod}',
    '系統 ${input.platform}',
    _pushLine(input.pushToken),
    // **只講金鑰有沒有設定，絕不印出金鑰本身。**
    '地點搜尋金鑰 ${input.placesKey ? '已設定' : '未設定'}',
    '地圖金鑰 ${input.mapsKey ? '已設定' : '未設定'}',
    '',
  ];

  if (input.errors.isEmpty) {
    // 直說，不要留一個空的區塊讓人猜是沒有錯誤還是沒讀到。
    lines.add('這次開啟之後沒有記錄到錯誤。');
    return lines.join('\n');
  }

  lines.add('最近的錯誤（${input.errors.length} 筆，新的在下面）');
  for (final entry in input.errors) {
    final repeat = entry.count > 1 ? ' ×${entry.count}' : '';
    lines.add(
      '${_clockTime(entry.at)} [${entry.source}] ${entry.message}$repeat',
    );
  }

  return lines.join('\n');
}
