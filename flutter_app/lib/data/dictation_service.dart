import 'package:flutter/foundation.dart';
import 'package:speech_to_text/speech_to_text.dart';

import '../domain/debug_log.dart';
import '../domain/dictation.dart';

/// 語音輸入。`src/composables/useDictation.ts` 的 Dart 版。
///
/// 網頁版包的是 Web Speech API，原生這邊是 `speech_to_text` —— 底下在
/// Android 是 `SpeechRecognizer`、iOS 是 `SFSpeechRecognizer`。行為上跟
/// 網頁版最大的差別是**辨識可能在裝置上做**，所以不見得要連線；但兩邊
/// 都要麥克風權限，而權限被拒的症狀一樣是「按了沒反應」。
///
/// 做成 `ChangeNotifier` 而不是 provider：這個狀態只有那一個欄位在用，
/// 而且它綁著一個要 dispose 的原生資源 —— 跟著 widget 的生命週期最單純。
class DictationService extends ChangeNotifier {
  final SpeechToText _speech;

  DictationService({SpeechToText? speech}) : _speech = speech ?? SpeechToText();

  /// 這台裝置有沒有可用的辨識服務。初始化之前是 false。
  bool _available = false;
  bool get available => _available;

  bool _listening = false;
  bool get listening => _listening;

  String? _error;
  String? get error => _error;

  bool _initialized = false;

  /// 原生的回呼可能在頁面關掉之後才回來，那時 notifyListeners 會丟例外。
  bool _disposed = false;

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  /// 第一次要用的時候才初始化。
  ///
  /// **不在頁面一開就做**：初始化會碰原生的辨識服務，而多數人記一筆帳
  /// 根本不會用到語音。沒有辨識服務的裝置就讓按鈕不出現。
  Future<bool> ensureReady() async {
    if (_initialized) return _available;
    _initialized = true;

    try {
      _available = await _speech.initialize(
        onError: (err) => _fail(err.errorMsg),
        onStatus: (status) {
          // 講完、逾時、出錯最後都會走到 notListening / done，
          // 狀態統一在這裡收，不要每條路各關一次。
          final done = status == 'notListening' || status == 'done';
          if (done && _listening) {
            _listening = false;
            _notify();
          }
        },
      );
    } catch (err) {
      // 沒有辨識服務的裝置會在這裡丟。那不是故障，只是這台沒有這個功能。
      logError('dictation', err);
      _available = false;
    }

    _notify();
    return _available;
  }

  Future<void> toggle(void Function(String text) onText) async {
    if (_listening) {
      await _speech.stop();
      return;
    }

    if (!await ensureReady()) {
      // 這裡一定要講話。按了什麼都沒發生是最糟的失敗方式 —— 使用者會一直
      // 按，然後以為整個 App 壞了。
      _error = '這台裝置沒有可用的語音辨識服務。';
      _notify();
      return;
    }

    _error = null;
    _listening = true;
    _notify();

    try {
      await _speech.listen(
        onResult: (result) {
          // 只要定案的結果。中途的猜測會在欄位裡跳來跳去，看了很慌。
          if (!result.finalResult) return;
          final text = tidyDictation(result.recognizedWords);
          if (text.isNotEmpty) onText(text);
        },
        localeId: _locale,
        listenOptions: SpeechListenOptions(
          // 一次講一句就好：支出名稱是短句。
          partialResults: false,
          cancelOnError: true,
          localeId: _locale,
        ),
      );
    } catch (err) {
      logError('dictation', err);
      _fail('error_client');
    }
  }

  static const String _locale = 'zh_TW';

  void _fail(String code) {
    final message = dictationMessage(code);
    _listening = false;
    // 空訊息代表那不是使用者需要知道的事（自己按停、講完逾時）。
    if (message.isNotEmpty) _error = message;
    _notify();
  }

  @override
  void dispose() {
    _disposed = true;
    // 離開頁面時要收掉，不然麥克風會繼續開著。
    _speech.cancel();
    super.dispose();
  }
}
