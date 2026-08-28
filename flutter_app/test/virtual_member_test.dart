import 'package:test/test.dart';
import 'package:splitflow/domain/virtual_member.dart';

/// `tests/virtualMember.test.ts` 的 Dart 版。格式必須跟網頁版一模一樣 ——
/// 兩邊寫進同一個 Firestore，也被同一條規則檢查。
void main() {
  group('generateVirtualMemberId', () {
    test('符合規則裡那條正規式', () {
      for (var i = 0; i < 50; i++) {
        expect(generateVirtualMemberId(), matches(virtualMemberIdPattern));
      }
    });

    // Firebase uid 是 28 字元。長度對不上，就不可能撞到真人的 uid ——
    // 而 memberIds 同時是權限清單，撞到就是權限漏洞。
    test('固定 22 字元，跟 Firebase uid 的 28 字元對不上', () {
      expect(generateVirtualMemberId().length, 22);
    });

    test('連續產生不重複', () {
      final ids = {for (var i = 0; i < 500; i++) generateVirtualMemberId()};
      expect(ids.length, 500);
    });
  });

  group('isVirtualMemberId', () {
    test('認得合格的 id', () {
      expect(isVirtualMemberId('v_k3n8x2p9qz1m4w7t6r0a'), isTrue);
    });

    test('擋掉格式不對的', () {
      expect(isVirtualMemberId('k3n8x2p9qz1m4w7t6r0ab'), isFalse, reason: '沒有前綴');
      expect(isVirtualMemberId('v_k3n8x2p9'), isFalse, reason: '長度不對');
      expect(isVirtualMemberId('v_K3n8x2p9qz1m4w7t6r0a'), isFalse, reason: '含大寫');
      expect(isVirtualMemberId('v_k3n8x2p9qz1m4w7t6r_a'), isFalse, reason: '含底線');
      expect(isVirtualMemberId('abcdefghijklmnopqrstuvwxyz12'), isFalse, reason: '真實 uid 長度');
      expect(isVirtualMemberId(''), isFalse, reason: '空字串');
    });
  });
}
