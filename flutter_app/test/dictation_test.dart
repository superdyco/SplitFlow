import 'package:test/test.dart';
import 'package:splitflow/domain/dictation.dart';

void main() {
  group('tidyDictation', () {
    test('削掉句尾的標點 —— 中文辨識很愛補一個句號', () {
      expect(tidyDictation('晚餐。'), '晚餐');
      expect(tidyDictation('計程車，'), '計程車');
      expect(tidyDictation('門票!'), '門票');
    });

    test('連續好幾個標點也一起削掉', () {
      expect(tidyDictation('晚餐。。。'), '晚餐');
    });

    test('中間的標點留著 —— 那是使用者真的講出來的', () {
      expect(tidyDictation('晚餐，加小費。'), '晚餐，加小費');
    });

    test('前後空白一起處理', () {
      expect(tidyDictation('  晚餐 '), '晚餐');
    });

    test('沒有標點的原樣不動', () {
      expect(tidyDictation('晚餐'), '晚餐');
    });

    test('整段都是標點時會變成空字串 —— 呼叫端要自己擋掉空的結果', () {
      expect(tidyDictation('。。'), '');
    });
  });

  group('dictationMessage', () {
    test('權限被拒要說得出下一步怎麼做', () {
      expect(dictationMessage('error_permission'), contains('系統設定'));
    });

    test('沒聽出內容講人話，不是印錯誤碼', () {
      expect(dictationMessage('error_no_match'), '沒有聽出內容，再試一次。');
    });

    test('講完的逾時不是錯誤，不要跳紅字', () {
      // 使用者講完停頓就會走到這裡。跟「壞掉」是兩件事。
      expect(dictationMessage('error_speech_timeout'), '');
    });

    test('連按兩下造成的 client 錯誤也不用告訴使用者', () {
      expect(dictationMessage('error_client'), '');
    });

    test('沒有中文語音資料要指出可以去下載', () {
      expect(
        dictationMessage('error_language_not_supported'),
        contains('下載'),
      );
    });

    test('認不得的錯誤碼原樣印出來 —— 查得到比講一句漂亮話有用', () {
      expect(dictationMessage('error_weird'), '語音輸入失敗（error_weird）');
    });
  });
}
