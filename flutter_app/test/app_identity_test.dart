import 'package:splitflow/domain/app_identity_headers.dart';
import 'package:test/test.dart';

void main() {
  group('appIdentityHeaders', () {
    test('Android 需要 package 與 SHA-1', () {
      expect(
        appIdentityHeaders({'package': 'com.dyco.splitflow', 'sha1': 'ABC123'}),
        {
          'X-Android-Package': 'com.dyco.splitflow',
          'X-Android-Cert': 'ABC123',
        },
      );
      expect(appIdentityHeaders({'package': 'com.dyco.splitflow'}), isNull);
    });

    test('iOS 使用 bundle identifier', () {
      expect(
        appIdentityHeaders({'iosBundleId': 'com.dyco.splitflow'}),
        {'X-Ios-Bundle-Identifier': 'com.dyco.splitflow'},
      );
    });

    test('空值與未知形狀安全退回', () {
      expect(appIdentityHeaders(null), isNull);
      expect(appIdentityHeaders(const {}), isNull);
    });
  });
}
