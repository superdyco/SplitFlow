import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../domain/currency.dart';
import '../domain/debug_log.dart';
import '../domain/favorites.dart';
import '../domain/models.dart';
import '../domain/place_totals.dart';
import '../domain/report.dart';
import '../state/providers.dart';
import 'report_card.dart';
import 'theme.dart';
import 'weather_chip.dart';

/// 一份公開的旅費報告。`src/pages/ReportPage.vue` 的 Flutter 版。
///
/// **主角是每人平均**，不是誰欠誰 —— 這一頁是給沒去的人看「這樣玩一趟大概
/// 要花多少」。報告文件裡本來就沒有 uid、暱稱與支出名稱，所以這一頁也印不
/// 出那些東西，就算想印也沒有資料。
///
/// 地圖是產生報告當下拍的一張 PNG，不是在這裡載地圖 SDK。理由是計費：
/// 連結被轉傳的次數擋不住，每次開啟都算一次 API 呼叫的話帳單會失控。
class ReportPage extends ConsumerStatefulWidget {
  final String taskId;
  final String reportId;

  const ReportPage({super.key, required this.taskId, required this.reportId});

  @override
  ConsumerState<ReportPage> createState() => _ReportPageState();
}

class _ReportPageState extends ConsumerState<ReportPage> {
  TripReport? _report;
  bool _loading = true;
  bool _saved = false;
  bool _favoriteBusy = false;
  String? _favoriteError;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    TripReport? report;
    try {
      report = await ref
          .read(reportRepositoryProvider)
          .getReport(widget.taskId, widget.reportId);
    } catch (err) {
      // 讀失敗與「不存在」在這裡是同一件事：規則會讓已撤銷的報告讀取失敗，
      // 所以分不出「連結錯了」與「已關閉」。而且就算分得出來也不該分 ——
      // 回「這份報告已關閉」等於告訴人家「這個 ID 是真的，只是被關起來」。
      //
      // 但那是**畫面上**不該分，查問題時要分得出來，所以錯誤留一份。
      logError('report', err);
      report = null;
    }

    if (!mounted) return;
    setState(() {
      _report = report;
      _loading = false;
    });

    // 報告讀不到就不必問收藏了 —— 那個連結已經沒有意義。
    final uid = ref.read(authStateProvider).value?.uid;
    if (uid == null || report == null) return;
    try {
      final saved = await ref
          .read(favoriteRepositoryProvider)
          .isFavorited(uid, widget.taskId, widget.reportId);
      if (mounted) setState(() => _saved = saved);
    } catch (_) {
      // 問不到就當作沒收藏。按下去會蓋寫同一個 id，不會變成兩筆。
    }
  }

  Future<void> _toggleFavorite() async {
    final uid = ref.read(authStateProvider).value?.uid;
    final report = _report;
    if (uid == null || report == null || _favoriteBusy) return;

    final wasSaved = _saved;
    setState(() {
      _favoriteBusy = true;
      _favoriteError = null;
      // 樂觀更新：這顆按鈕的回饋要立即，不然會被連按。失敗再改回去。
      _saved = !wasSaved;
    });

    try {
      final favorites = ref.read(favoriteRepositoryProvider);
      if (wasSaved) {
        await favorites.remove(uid, widget.taskId, widget.reportId);
      } else {
        await favorites.add(
          uid,
          toFavorite(widget.taskId, widget.reportId, report),
        );
      }
      ref.invalidate(favoritesProvider);
      ref.invalidate(favoritedIdsProvider);
    } catch (err) {
      if (mounted) {
        setState(() {
          _saved = wasSaved;
          _favoriteError = '$err';
        });
      }
    } finally {
      if (mounted) setState(() => _favoriteBusy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final report = _report;

    return Scaffold(
      appBar: AppBar(title: const Text('旅費報告')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : report == null
              ? const _Centered(
                  '找不到這份報告。連結可能不完整，或發起人已經把它關閉了。',
                )
              : _Body(
                  taskId: widget.taskId,
                  reportId: widget.reportId,
                  report: report,
                  saved: _saved,
                  busy: _favoriteBusy,
                  error: _favoriteError,
                  signedIn: ref.watch(authStateProvider).value != null,
                  onToggleFavorite: _toggleFavorite,
                ),
    );
  }
}

class _Body extends StatelessWidget {
  final String taskId;
  final String reportId;
  final TripReport report;
  final bool saved;
  final bool busy;
  final String? error;
  final bool signedIn;
  final VoidCallback onToggleFavorite;

  const _Body({
    required this.taskId,
    required this.reportId,
    required this.report,
    required this.saved,
    required this.busy,
    required this.error,
    required this.signedIn,
    required this.onToggleFavorite,
  });

  String get _dateRange {
    final start = report.startDate;
    final end = report.endDate;
    if (start == null || end == null) return '';
    return '$start – $end';
  }

  String get _facts {
    final items = <String>[];
    if (_dateRange.isNotEmpty) items.add(_dateRange);
    if (report.days != null) items.add('${report.days} 天');
    items.add('${report.memberCount} 人');
    return items.join(' · ');
  }

  /// 報告上只要看得出「這份是哪天的」，不需要時分秒。
  String _shortDate(DateTime value) {
    final local = value.toLocal();
    return '${local.year}/${local.month}/${local.day}';
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final places = visiblePlaces(report.places);

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
      children: [
        Text(report.taskName, style: text.titleLarge, textAlign: TextAlign.center),
        const SizedBox(height: 4),
        Text(_facts, style: text.bodySmall, textAlign: TextAlign.center),
        const SizedBox(height: 12),

        // 收藏放在標題與數字之間：看到是誰的旅程之後、還沒往下捲之前。
        if (signedIn)
          Center(
            child: saved
                ? OutlinedButton.icon(
                    onPressed: busy ? null : onToggleFavorite,
                    icon: const Icon(Icons.favorite, size: 18),
                    label: const Text('已收藏'),
                  )
                : FilledButton.icon(
                    onPressed: busy ? null : onToggleFavorite,
                    icon: const Icon(Icons.favorite_border, size: 18),
                    label: const Text('收藏這趟旅程'),
                  ),
          ),
        if (error != null) ...[
          const SizedBox(height: 6),
          Text(
            '收藏沒有存成功：$error',
            style: text.bodySmall?.copyWith(color: AppColors.danger),
            textAlign: TextAlign.center,
          ),
        ],
        const SizedBox(height: 16),

        /*
          每人平均是這一頁唯一的主角，所以字最大、而且是這一頁唯一有顏色的字。

          底色從 primarySoft 換回白：primaryDark 印在 primarySoft 上只有
          4.17:1，過不了 4.5。要嘛字不上色、要嘛底是白的，選後者 ——
          這一頁需要一個主張，而顏色是它最便宜的表達方式。
          theme_contrast_test 裡有一條把這個組合釘死成「不准」。

          字級走 figure() 而不是 text.headlineMedium：這個 app 的 textTheme
          根本沒有定義 headlineMedium，那一行一直在吃 Material 的預設值。
        */
        Card(
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 20, horizontal: 16),
            child: Column(
              children: [
                Text('每人平均', style: text.bodySmall),
                const SizedBox(height: 4),
                Text(
                  '${report.currency} '
                  '${formatAmount(report.perPerson, report.currency)}',
                  style: figure(size: 38, color: AppColors.primaryDark),
                ),
                const SizedBox(height: AppSpace.x3),
                // 三個數字排成一列格子，而不是用「·」串成一句話：
                // 它們是三個獨立的量，串起來讀的人要自己斷句。
                _StatRow(
                  labels: const ['總花費', '筆數', '地點'],
                  values: [
                    formatAmount(report.total, report.currency),
                    '${report.expenseCount}',
                    '${report.places.length}',
                  ],
                ),
              ],
            ),
          ),
        ),

        if (report.categories.isNotEmpty) ...[
          const SizedBox(height: 12),
          _Section(
            title: '花在哪',
            children: [
              for (final item in report.categories)
                _BarRow(
                  icon: categoryMeta(item.category).icon,
                  label: categoryMeta(item.category).label,
                  note: '${item.share.round()}%',
                  amount: formatAmount(item.total, report.currency),
                  bar: item.share / 100,
                  soft: false,
                ),
            ],
          ),
        ],

        if (report.mapPath != null) ...[
          const SizedBox(height: 12),
          _ReportMap(taskId: taskId, reportId: reportId),
        ],

        if (places.rows.isNotEmpty) ...[
          const SizedBox(height: 12),
          _Section(
            title: '去過的地方',
            children: [
              for (final row in places.rows)
                _BarRow(
                  label: row.place.name,
                  note: '${row.place.expenseCount} 筆',
                  amount: formatAmount(row.place.total, report.currency),
                  bar: row.bar,
                  soft: true,
                ),
              if (places.hiddenCount > 0)
                Text('還有 ${places.hiddenCount} 個地點', style: text.bodySmall),
            ],
          ),
        ],

        // 時間軸放在最後：前面幾區回答「花了多少、花在哪」，
        // 這一區回答「怎麼過的」。
        if (report.timeline.isNotEmpty) ...[
          const SizedBox(height: 12),
          _Timeline(report: report),
        ],

        // 報告是快照，讀的人要看得出來這份是什麼時候的。
        // 離線寫入時 serverTimestamp 還沒回來，那時就不印。
        if (report.updatedAt != null) ...[
          const SizedBox(height: 16),
          Text(
            '產生於 ${_shortDate(report.updatedAt!)}',
            style: text.bodySmall,
            textAlign: TextAlign.center,
          ),
        ],
      ],
    );
  }
}

/// 產生報告當下拍的靜態地圖。
///
/// 讀不到就整塊不出現：這張圖是加分，而一個破掉的圖示比沒有圖更難看懂。
class _ReportMap extends ConsumerWidget {
  final String taskId;
  final String reportId;

  const _ReportMap({required this.taskId, required this.reportId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final url = ref.watch(reportMapUrlProvider((taskId, reportId)));

    return url.when(
      // 8:5 對應那張 640x400 的靜態圖：先把位置佔住，圖載完才填進去。
      // 不佔位的話下面整塊內容會在圖載好的瞬間被推走。
      loading: () => const _MapSlot(child: ColoredBox(color: AppColors.line)),
      // 讀不到就整塊不出現。這張圖是加分，一個破掉的圖示比沒有圖更難看懂。
      error: (_, __) => const SizedBox.shrink(),
      data: (value) => _MapSlot(
        child: Image.network(
          value,
          fit: BoxFit.cover,
          errorBuilder: (_, __, ___) => const SizedBox.shrink(),
        ),
      ),
    );
  }
}

class _MapSlot extends StatelessWidget {
  final Widget child;

  const _MapSlot({required this.child});

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(12),
      child: AspectRatio(aspectRatio: 8 / 5, child: child),
    );
  }
}

class _Timeline extends StatelessWidget {
  final TripReport report;

  const _Timeline({required this.report});

  /// 年份在標題的日期區間就講過了，每一天再印一次太吵。
  String _dayLabel(String date) =>
      date.length >= 10 ? date.substring(5).replaceAll('-', '/') : date;

  /// 整份都沒有時間就把時間欄整欄收掉，不要留一排「—」。
  /// 只要有一筆有時間就整份都留欄位，這樣每一天的縮排才會一致。
  bool get _showTimes => report.timeline
      .any((day) => day.entries.any((entry) => entry.time.isNotEmpty));

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;

    return _Section(
      title: '每天怎麼過的',
      children: [
        for (final day in report.timeline) ...[
          Padding(
            padding: const EdgeInsets.only(top: 8, bottom: 4),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    'Day ${day.day} · ${_dayLabel(day.date)}',
                    style:
                        text.bodyMedium?.copyWith(fontWeight: FontWeight.w700),
                  ),
                ),
                // 舊報告沒有這個欄位，一定要判斷而不是假設它存在。
                if (day.weather != null) ...[
                  WeatherChip(weather: day.weather!, size: 11),
                  const SizedBox(width: AppSpace.x3),
                ],
                Text(
                  formatAmount(day.total, report.currency),
                  style: text.bodyMedium,
                ),
              ],
            ),
          ),
          for (final entry in day.entries)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 3),
              child: Row(
                children: [
                  if (_showTimes)
                    SizedBox(
                      width: 46,
                      // 沒記時間的那幾筆用破折號佔位，時間欄才不會忽寬忽窄。
                      child: Text(
                        entry.time.isEmpty ? '—' : entry.time,
                        style: text.bodySmall,
                      ),
                    ),
                  Icon(
                    categoryMeta(entry.category).icon,
                    size: 16,
                    color: AppColors.primaryDark,
                  ),
                  const SizedBox(width: AppSpace.x2),
                  Expanded(
                    child: Text(
                      // 沒有支出名稱可放（報告裡刻意沒有），
                      // 所以沒地點時退回顯示分類。
                      entry.place ?? categoryMeta(entry.category).label,
                      style: text.bodySmall,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  Text(
                    formatAmount(entry.amount, report.currency),
                    style: text.bodySmall,
                  ),
                ],
              ),
            ),
        ],
      ],
    );
  }
}

class _Section extends StatelessWidget {
  final String title;
  final List<Widget> children;

  const _Section({required this.title, required this.children});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title, style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            ...children,
          ],
        ),
      ),
    );
  }
}

/// 一列：名稱、筆數或百分比、金額，底下一條長條。
/// 一列等寬的統計格子。報告頁的「總花費／筆數／地點」與任務列表的
/// 各幣別總計是同一個形狀。
class _StatRow extends StatelessWidget {
  final List<String> labels;
  final List<String> values;

  const _StatRow({required this.labels, required this.values});

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;

    return DecoratedBox(
      decoration: BoxDecoration(
        border: Border.all(color: AppColors.rowLine),
        borderRadius: BorderRadius.circular(AppRadius.md),
      ),
      child: IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            for (var i = 0; i < labels.length; i++) ...[
              if (i > 0)
                const VerticalDivider(
                  width: 1,
                  thickness: 1,
                  color: AppColors.rowLine,
                ),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: AppSpace.x3,
                    vertical: 9,
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(labels[i], style: text.bodySmall),
                      Text(
                        values[i],
                        style: figure(size: 14, weight: FontWeight.w600),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _BarRow extends StatelessWidget {
  /// null 就不畫圖示。地點那一組沒有分類可放，分類那一組有。
  final IconData? icon;
  final String label;
  final String note;
  final String amount;

  /// null 就不畫長條（未指定地點）。
  final double? bar;
  final bool soft;

  const _BarRow({
    this.icon,
    required this.label,
    required this.note,
    required this.amount,
    required this.bar,
    required this.soft,
  });

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              if (icon != null) ...[
                Icon(icon, size: 16, color: AppColors.primaryDark),
                const SizedBox(width: AppSpace.x2),
              ],
              Expanded(
                child: Text(
                  label,
                  style: text.bodyMedium,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              /*
                百分比與金額走固定欄寬。長條本來就是整寬畫在下面那一行，
                所以它們一直是對齊的 —— 沒對齊的是這兩欄：名稱長的那幾列
                把數字往右推，一整欄看下來是歪的。
              */
              SizedBox(
                width: 34,
                child: Text(
                  note,
                  textAlign: TextAlign.right,
                  style: text.bodySmall,
                ),
              ),
              const SizedBox(width: AppSpace.x2),
              SizedBox(
                width: 62,
                child: Text(
                  amount,
                  textAlign: TextAlign.right,
                  style: figure(size: 14, weight: FontWeight.w600),
                ),
              ),
            ],
          ),
          if (bar != null) ...[
            const SizedBox(height: 4),
            ReportBar(value: bar!, soft: soft),
          ],
        ],
      ),
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
