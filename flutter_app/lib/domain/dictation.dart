/// 語音輸入裡不碰麥克風的那一半。`src/composables/useDictation.ts` 的
/// Dart 版 —— 收尾規則與錯誤翻譯抽出來，才測得動。
///
/// 剩下那一半（開麥克風、聽、停）在 `data/dictation_service.dart`。
library;

/// 中文語音辨識很愛在句尾補標點（「晚餐。」），但支出名稱不需要。
///
/// **只削尾巴**：中間的標點是使用者真的講出來的，留著。
String tidyDictation(String text) {
  return text.trim().replaceAll(RegExp(r'[。、，．.,！!？?\s]+$'), '');
}

/// 把辨識引擎的錯誤碼翻成人看得懂的話。
///
/// 回空字串代表「不要跟使用者說」—— 有些「錯誤」是正常結束的一部分：
/// 使用者自己按停、或講完之後引擎回報逾時，那些不是故障。
///
/// 錯誤碼是 Android `SpeechRecognizer` 那一組，iOS 端由 plugin 對應過來。
String dictationMessage(String code) {
  switch (code) {
    case 'error_permission':
    case 'error_permission_denied':
      return '沒有麥克風權限，可以到系統設定裡把它打開。';
    case 'error_no_match':
      return '沒有聽出內容，再試一次。';
    case 'error_speech_timeout':
      // 講完停頓就會走到這裡，跟「壞掉」是兩件事。
      return '';
    case 'error_audio':
    case 'error_audio_error':
      return '拿不到麥克風，可能被其他 App 佔用了。';
    case 'error_network':
    case 'error_network_timeout':
      return '語音辨識需要連線，目前連不上。';
    case 'error_busy':
      return '辨識服務忙碌中，等一下再試。';
    case 'error_language_not_supported':
    case 'error_language_unavailable':
      return '這台裝置沒有中文語音辨識，可以到系統設定裡下載語音資料。';
    case 'error_client':
      // 連按兩下、或引擎自己重啟時會回這個，使用者不需要知道。
      return '';
    default:
      return '語音輸入失敗（$code）';
  }
}
