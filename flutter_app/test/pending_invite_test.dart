import 'package:splitflow/domain/invite.dart';
import 'package:test/test.dart';

void main() {
  test('邀請分享文字包含任務名稱與可開啟的網址', () {
    expect(
      inviteShareText(taskName: '曼谷之旅', inviteCode: 'abc123'),
      '邀請你加入「曼谷之旅」的簡單分帳：\n'
      'https://splitflow-e39c0.web.app/join/abc123',
    );
  });

  group('inviteCodeFromUri', () {
    test('讀取正式網站的邀請碼', () {
      expect(
        inviteCodeFromUri(
          Uri.parse('https://splitflow-e39c0.web.app/join/abc123'),
        ),
        'abc123',
      );
    });

    test('query 與 fragment 不影響邀請碼', () {
      expect(
        inviteCodeFromUri(
          Uri.parse(
            'https://splitflow-e39c0.web.app/join/abc123?from=line#invite',
          ),
        ),
        'abc123',
      );
    });

    test('拒絕其他網域、非 https 與非邀請路徑', () {
      expect(
        inviteCodeFromUri(Uri.parse('https://example.com/join/abc123')),
        isNull,
      );
      expect(
        inviteCodeFromUri(
          Uri.parse('http://splitflow-e39c0.web.app/join/abc123'),
        ),
        isNull,
      );
      expect(
        inviteCodeFromUri(
          Uri.parse('https://splitflow-e39c0.web.app/tasks/abc123'),
        ),
        isNull,
      );
    });

    test('拒絕缺少或多出路徑片段的網址', () {
      expect(
        inviteCodeFromUri(Uri.parse('https://splitflow-e39c0.web.app/join/')),
        isNull,
      );
      expect(
        inviteCodeFromUri(
          Uri.parse('https://splitflow-e39c0.web.app/join/abc123/extra'),
        ),
        isNull,
      );
    });
  });
}
