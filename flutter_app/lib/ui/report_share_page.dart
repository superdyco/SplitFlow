import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/report_repository.dart';
import '../data/static_map.dart';
import '../domain/debug_log.dart';
import '../domain/models.dart';
import '../domain/offline_write.dart';
import '../domain/report.dart';
import '../domain/report_actions.dart';
import '../state/providers.dart';
import 'confirm_dialog.dart';
import 'report_page.dart';
import 'system_share.dart';
import 'theme.dart';

/// 產生與管理公開的旅費報告。`src/pages/TaskPage.vue` 的分享那一區的
/// Flutter 版，在手機上獨立成一頁 —— 那一區有五個開關與一段長連結，
/// 塞進已經有三個頁籤的任務頁只會把記帳擠下去。
///
/// **只有 owner 進得來**：公開別人的消費資料只有他能決定，rules 那邊也是
/// 同一條。列表那邊已經擋過一次，這裡再擋一次是因為以後任何新入口導進來，
/// 又會變成「填完才發現不行」。
class ReportSharePage extends ConsumerStatefulWidget {
  final Task task;

  const ReportSharePage({super.key, required this.task});

  @override
  ConsumerState<ReportSharePage> createState() => _ReportSharePageState();
}

class _ReportSharePageState extends ConsumerState<ReportSharePage> {
  bool _busy = false;
  String? _error;

  /// 報告產出來了、但地圖沒做出來的原因。
  ///
  /// 跟 `_error` 分開：報告是成功的，混在一起會讓人以為整份報告失敗了。
  String? _mapWarning;

  String get _taskId => widget.task.id;

  /// 產生順序刻意是「先算數字、再拍地圖、最後寫文件」，而且**地圖失敗不擋
  /// 流程** —— 地圖是加分不是必要，反過來設計的話 Static Maps 一出問題
  /// （配額、金鑰、網路）整個功能就掛了。
  Future<void> _generate(TripReport? existing) async {
    setState(() {
      _busy = true;
      _error = null;
      _mapWarning = null;
    });

    try {
      final repo = ref.read(reportRepositoryProvider);
      final expenses = await ref.read(expensesProvider(_taskId).future);

      // 沿用既有 id，連結才不會變。已經傳出去的網址得繼續有效。
      final reportId = existing?.id ?? repo.newReportId(_taskId);

      // 先算一次地點，拍地圖跟寫文件用的是同一份。
      final draft = buildReport(
        reportId: reportId,
        task: widget.task,
        expenses: expenses,
        mapPath: null,
        // 重新產生不該偷偷改變公開狀態：本來公開的維持公開。
        listed: existing?.listed ?? false,
      );

      final map = await fetchStaticMap(draft.places);
      String? mapPath;
      var warning = map.reason;
      final bytes = map.bytes;
      if (bytes != null) {
        if (bytes.length > maxMapBytes) {
          // 先自己擋一次，錯誤訊息才看得懂。交給規則擋只會拿到 unauthorized。
          warning = '地圖圖檔 ${(bytes.length / 1024).round()} KB，'
              '超過 Storage 規則的 1 MB 上限。';
        } else {
          try {
            mapPath = await repo.uploadMap(_taskId, reportId, bytes);
          } catch (err) {
            warning = '地圖上傳失敗：$err';
            logError('map', err);
          }
        }
      }

      final report = buildReport(
        reportId: reportId,
        task: widget.task,
        expenses: expenses,
        mapPath: mapPath,
        listed: existing?.listed ?? false,
      );

      await settleWrite(
        repo.saveReport(_taskId, report, isNew: existing == null),
      );

      if (mounted) setState(() => _mapWarning = warning);
      ref.invalidate(taskReportProvider(_taskId));
      ref.invalidate(publicReportsProvider);
    } catch (err) {
      if (mounted) setState(() => _error = '$err');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _setActive(TripReport report, bool active) async {
    if (!active) {
      final ok = await showConfirmDialog(
        context,
        title: '關閉這條連結？',
        message: '關掉之後拿到連結的人就看不到了，探索頁也會一併取消。'
            '之後可以再打開，網址不會變。',
        confirmLabel: '關閉連結',
        destructive: true,
      );
      if (!ok) return;
    }

    await _write(() => ref
        .read(reportRepositoryProvider)
        .setActive(_taskId, report.id, active));
  }

  /// 連結是關的就不能公開 —— 列出去只會是一張點進去讀不到的卡片。
  Future<void> _setListed(TripReport report, bool listed) async {
    if (listed && !report.active) return;
    await _write(() => ref
        .read(reportRepositoryProvider)
        .setListed(_taskId, report.id, listed));
  }

  Future<void> _write(Future<void> Function() action) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await settleWrite(action());
      ref.invalidate(taskReportProvider(_taskId));
      ref.invalidate(publicReportsProvider);
    } catch (err) {
      if (mounted) setState(() => _error = '$err');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final report = ref.watch(taskReportProvider(_taskId));

    return Scaffold(
      appBar: AppBar(title: const Text('旅費報告')),
      body: report.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, _) => _Centered('讀取報告失敗：$err'),
        data: (current) => ListView(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
          children: [
            Text(widget.task.name, style: text.titleMedium),
            const SizedBox(height: 4),
            Text(
              // 名稱現在會逐筆列出去，這句話以前寫「沒有支出名稱」——
              // 那是產生報告前唯一會被讀到的說明，不能留著不準的版本。
              '產生一份公開連結，讓沒去的人知道這樣玩一趟大概要花多少錢。'
              '裡面是算好的數字，加上逐筆的時間、支出名稱與金額 —— '
              '沒有成員名字，也沒有誰欠誰。',
              style: text.bodySmall,
            ),
            const SizedBox(height: 16),

            if (current == null)
              FilledButton(
                onPressed: _busy ? null : () => _generate(null),
                child: Text(_busy ? '產生中...' : '產生報告'),
              )
            else
              _Existing(
                taskId: _taskId,
                report: current,
                busy: _busy,
                onRegenerate: () => _generate(current),
                onActive: (value) => _setActive(current, value),
                onListed: (value) => _setListed(current, value),
              ),

            if (_mapWarning != null) ...[
              const SizedBox(height: 12),
              // 報告是成功的，只是沒有地圖 —— 用一般的顏色而不是紅字。
              Text('報告已產生，但沒有地圖：$_mapWarning', style: text.bodySmall),
            ],
            if (_error != null) ...[
              const SizedBox(height: 12),
              Text(
                _error!,
                style: text.bodySmall?.copyWith(color: AppColors.danger),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _Existing extends StatelessWidget {
  final String taskId;
  final TripReport report;
  final bool busy;
  final VoidCallback onRegenerate;
  final void Function(bool value) onActive;
  final void Function(bool value) onListed;

  const _Existing({
    required this.taskId,
    required this.report,
    required this.busy,
    required this.onRegenerate,
    required this.onActive,
    required this.onListed,
  });

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final url = reportUrl(taskId, report.id);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: AppColors.line),
          ),
          child: SelectableText(url, style: text.bodySmall),
        ),
        const SizedBox(height: 4),
        Text(
          // 連結指向網頁版：收到的人多半沒裝 App，而報告就是要給他們看的。
          '連結永遠不變，重新產生也是同一條。收到的人用瀏覽器打開就看得到，'
          '不用帳號、不用裝 App。',
          style: text.bodySmall,
        ),
        const SizedBox(height: 12),

        // 連結關著就不給分享與開啟 —— 給了的話按下去看到的是「找不到」，
        // 而發起人會以為連結還通著。
        if (report.active) ...[
          Builder(
            builder: (shareContext) => FilledButton.icon(
              icon: const Icon(Icons.share_outlined, size: 18),
              label: const Text('分享連結'),
              onPressed: busy
                  ? null
                  : () => shareText(
                        shareContext,
                        text: '「${report.taskName}」的旅費報告：\n$url',
                        title: '分享旅費報告',
                        subject: '「${report.taskName}」花了多少',
                      ),
            ),
          ),
          const SizedBox(height: 8),
          OutlinedButton.icon(
            icon: const Icon(Icons.copy, size: 18),
            label: const Text('複製連結'),
            onPressed: busy
                ? null
                : () async {
                    await Clipboard.setData(ClipboardData(text: url));
                    if (!context.mounted) return;
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('已複製報告連結')),
                    );
                  },
          ),
          const SizedBox(height: 8),
          OutlinedButton.icon(
            icon: const Icon(Icons.open_in_new, size: 18),
            label: const Text('看看別人會看到什麼'),
            onPressed: busy
                ? null
                : () => Navigator.of(context).push(
                      MaterialPageRoute<void>(
                        builder: (_) => ReportPage(
                          taskId: taskId,
                          reportId: report.id,
                        ),
                      ),
                    ),
          ),
        ],

        const SizedBox(height: 8),
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          value: report.active,
          onChanged: busy ? null : onActive,
          title: const Text('連結有效'),
          subtitle: const Text('關掉之後拿到連結的人立刻看不到。'),
        ),
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          value: report.listed,
          // 連結關著時整顆停用 —— 列出去只會是一張點進去讀不到的卡片。
          onChanged: busy || !report.active ? null : onListed,
          title: const Text('列進「探索」'),
          subtitle: const Text('讓其他使用者瀏覽得到，不只是拿到連結的人。'),
        ),

        const Divider(height: 24),
        Text(
          '報告是產生當下的快照。之後改了帳目要重新產生一次，'
          '數字才會跟著更新。',
          style: text.bodySmall,
        ),
        const SizedBox(height: 8),
        OutlinedButton(
          onPressed: busy ? null : onRegenerate,
          child: Text(busy ? '產生中...' : '重新產生'),
        ),
      ],
    );
  }
}

class _Centered extends StatelessWidget {
  final String text;
  const _Centered(this.text);

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Text(text, textAlign: TextAlign.center),
      ),
    );
  }
}
