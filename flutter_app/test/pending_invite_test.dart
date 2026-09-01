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

  group('reportFromUri', () {
    test('讀得出任務與報告 id', () {
      final report = reportFromUri(
        Uri.parse('https://splitflow-e39c0.web.app/r/t123/r456'),
      );

      expect(report?.taskId, 't123');
      expect(report?.reportId, 'r456');
    });

    test('query 與 fragment 不影響', () {
      final report = reportFromUri(
        Uri.parse('https://splitflow-e39c0.web.app/r/t123/r456?from=line#top'),
      );

      expect(report?.taskId, 't123');
    });

    test('拒絕其他網域、非 https 與段數不對的路徑', () {
      expect(reportFromUri(Uri.parse('https://example.com/r/t/r')), isNull);
      expect(
        reportFromUri(Uri.parse('http://splitflow-e39c0.web.app/r/t/r')),
        isNull,
      );
      expect(
        reportFromUri(Uri.parse('https://splitflow-e39c0.web.app/r/t123')),
        isNull,
      );
      expect(
        reportFromUri(Uri.parse('https://splitflow-e39c0.web.app/join/abc')),
        isNull,
      );
    });

    test('邀請連結不會被當成報告連結，反之亦然', () {
      final invite = Uri.parse('https://splitflow-e39c0.web.app/join/abc');
      final report = Uri.parse('https://splitflow-e39c0.web.app/r/t1/r1');

      expect(reportFromUri(invite), isNull);
      expect(inviteCodeFromUri(report), isNull);
    });
  });
}
