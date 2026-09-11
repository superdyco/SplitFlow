import 'package:test/test.dart';
import 'package:splitflow/domain/error_message.dart';

/// `tests/validation.test.ts` 裡 `firebaseErrorMessage` 那一組的 Dart 版，
/// 案例一比一 —— 兩邊對同一個錯誤要給使用者同一句話。
///
/// FlutterFire 的 code 不帶 `functions/`、`storage/` 前綴，網頁版帶；
/// 兩種寫法這裡都測，因為對照表只有一份規則。
void main() {
  group('friendlyError', () {
    test('缺索引的原文不能給使用者看 —— 那裡面有 Console 網址與專案 id', () {
      const raw = 'The query requires an index. See its status here: '
          'https://console.firebase.google.com/v1/r/project/splitflow-e39c0/firestore/indexes';
      final message = friendlyError(code: 'failed-precondition', message: raw);
      expect(message, isNot(contains('console.firebase.google.com')));
      expect(message, '這一頁還在準備中，請稍後再試一次。');
    });

    test('認的是 code 不是訊息 —— 訊息會隨 SDK 版本改寫', () {
      expect(
        friendlyError(code: 'unavailable', message: 'whatever the SDK says today'),
        '連不上伺服器。檢查一下網路，或稍後再試。',
      );
    });

    test('權限不足翻成中文，不再把 Firebase 的英文原文丟給使用者', () {
      final message = friendlyError(
        code: 'permission-denied',
        message: 'Missing or insufficient permissions.',
      );
      expect(message, contains('沒有權限'));
      expect(message, isNot(contains('Missing')));
    });

    test('雲端函式自己寫的中文理由照原樣顯示', () {
      expect(friendlyError(code: 'failed-precondition', message: '請先設定暱稱'), '請先設定暱稱');
      expect(
        friendlyError(code: 'functions/not-found', message: '這個邀請連結不存在或已停用'),
        '這個邀請連結不存在或已停用',
      );
    });

    test('雲端函式的通用錯誤（英文的 internal）翻成中文', () {
      expect(friendlyError(code: 'internal', message: 'internal'), contains('伺服器出了點問題'));
    });

    test('Storage 的錯誤碼也認得，帶不帶前綴都一樣', () {
      expect(friendlyError(code: 'unauthorized', message: 'User does not have permission'),
          '沒有權限存取這個檔案。');
      expect(friendlyError(code: 'storage/unauthorized', message: 'User does not have permission'),
          '沒有權限存取這個檔案。');
      expect(friendlyError(code: 'retry-limit-exceeded', message: 'Max retry time exceeded'),
          contains('太久沒有回應'));
    });

    test('不認得的 code 照原樣傳出去，不要憑空發明訊息', () {
      expect(
        friendlyError(code: 'some-brand-new-code', message: 'Something new happened'),
        'Something new happened',
      );
    });

    test('連訊息都沒有的時候至少留下 code', () {
      expect(friendlyError(code: 'some-brand-new-code'), 'some-brand-new-code');
    });
  });

  group('withoutExceptionPrefix', () {
    test('拿掉 Dart 自己加的「Exception: 」—— 那不是給使用者看的', () {
      expect(
        withoutExceptionPrefix('Exception: 免登入試用還沒有在 Firebase Console 啟用。'),
        '免登入試用還沒有在 Firebase Console 啟用。',
      );
    });

    test('其他文字不動', () {
      expect(withoutExceptionPrefix('Bad state: No element'), 'Bad state: No element');
      expect(withoutExceptionPrefix('暱稱為必填'), '暱稱為必填');
    });
  });
}
