import 'package:flutter/material.dart';

import '../domain/currency.dart';
import '../domain/expense_date.dart';
import '../domain/models.dart';
import '../domain/place_bias.dart' as domain;
import 'place_map.dart';
import 'remote_receipt.dart';
import 'theme.dart';

/// 唯讀的支出詳情。`src/pages/ExpenseDetailPage.vue` 的 Flutter 版。
///
/// 為什麼需要它：編輯頁只讓「自己建的、自己先付的、或管理員」動得了，
/// 其他人點進去只會在存檔時被規則擋下。而列表標了「📎」，點下去卻沒有
/// 東西可看 —— 收據的用途就是對帳，看不到照片等於這個功能對半數的人不存在。
///
/// **不重讀支出，直接接收列表已經有的那個物件。** 網頁版要依 id 重讀是因為
/// 它的入口是一條 URL，重新整理之後手上什麼都沒有；App 的導航本來就帶著
/// 物件走，再讀一次只是多一趟網路、多一個載入狀態，離線時還會壞掉。
///
/// 這一頁不寫入，所以不判斷封存與否：封存的任務照樣讀得到 —— 那時候
/// 正是最需要翻帳的時候。
class ExpenseDetailPage extends StatelessWidget {
  final Expense expense;

  /// uid → 顯示名稱，由任務頁算好傳進來（被移除的成員也還在裡面，
  /// 舊支出才查得到暱稱）。
  final Map<String, String> memberNames;

  /// 任務的主要幣別，用來顯示換算後的金額。
  final String baseCurrency;

  const ExpenseDetailPage({
    super.key,
    required this.expense,
    required this.memberNames,
    required this.baseCurrency,
  });

  String _nameOf(String uid) => memberNames[uid] ?? '已離開的成員';

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final meta = categoryMeta(expense.category);

    // 外幣才需要顯示換算，同幣別再寫一次只是重複。
    final foreign = expense.currency != baseCurrency;
    final converted = foreign && expense.baseAmount != null
        ? formatAmount(expense.baseAmount!, baseCurrency)
        : null;

    final time = expenseTime(expense);
    final shown =
        time.isEmpty ? expenseDate(expense) : '${expenseDate(expense)} $time';

    // 分攤依金額由大到小 —— 對帳時想找的通常是「誰分最多」。
    final splits = expense.splits.entries.toList()
      ..sort((a, b) => b.value.compareTo(a.value));

    final place = expense.place;
    final receipt = expense.receipt;

    return Scaffold(
      appBar: AppBar(title: const Text('支出詳情')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _Card(
            child: Column(
              children: [
                Text(meta.icon, style: const TextStyle(fontSize: 30)),
                const SizedBox(height: 8),
                Text(
                  expense.title,
                  style: text.titleLarge,
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 8),
                Text(
                  '${expense.currency} '
                  '${formatAmount(expense.amount, expense.currency)}',
                  style: text.headlineSmall?.copyWith(
                    fontWeight: FontWeight.w700,
                    fontFeatures: const [FontFeature.tabularFigures()],
                  ),
                ),
                if (converted != null)
                  Text('約 $baseCurrency $converted', style: text.bodySmall),
                // 缺匯率的要講出來 —— 它沒被算進任何一個總額。
                if (foreign && expense.baseAmount == null)
                  Text(
                    '這筆沒有匯率，沒有被算進結算裡。',
                    style: text.bodySmall?.copyWith(color: AppColors.danger),
                    textAlign: TextAlign.center,
                  ),
              ],
            ),
          ),
          const SizedBox(height: 12),

          _Card(
            child: Column(
              children: [
                _Row(label: '分類', value: meta.label),
                _Row(label: '日期', value: shown),
                _Row(label: '誰先付', value: _nameOf(expense.paidBy)),
                _Row(
                  label: '分攤方式',
                  value: expense.splitMode == SplitMode.custom ? '自訂金額' : '均分',
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),

          _Card(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _SectionTitle('分攤（${splits.length} 人）'),
                for (final split in splits)
                  _Row(
                    label: _nameOf(split.key),
                    value: formatAmount(split.value, expense.currency),
                    labelIsName: true,
                  ),
              ],
            ),
          ),

          if (place != null) ...[
            const SizedBox(height: 12),
            _Card(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const _SectionTitle('地點'),
                  Text('📍 ${place.name}', style: text.bodyMedium),
                  if (place.address != null && place.address!.isNotEmpty)
                    Text(place.address!, style: text.bodySmall),
                  if (place.lat != null && place.lng != null) ...[
                    const SizedBox(height: 8),
                    PlaceMap.enabled
                        ? PlaceMap.single(
                            center: domain.LatLng(place.lat!, place.lng!),
                            title: place.name,
                          )
                        : const PlaceMapUnavailable(),
                  ],
                ],
              ),
            ),
          ],

          if (expense.note.isNotEmpty) ...[
            const SizedBox(height: 12),
            _Card(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const _SectionTitle('備註'),
                  // 列表被截成一行，這一頁是唯一看得到全文的地方，不截斷。
                  Text(expense.note, style: text.bodyMedium),
                ],
              ),
            ),
          ],

          if (receipt != null && !receipt.isEmpty) ...[
            const SizedBox(height: 12),
            _Card(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const _SectionTitle('收據'),
                  if (receipt.pending)
                    // 講清楚比留一個永遠轉圈的區塊好：那張圖還在別人手機裡，
                    // 這裡等到天亮也不會出現。
                    Text(
                      '這張收據還在拍攝者的手機裡等著上傳，'
                      '他連上網路之後你才看得到。',
                      style: text.bodySmall,
                    )
                  else
                    _Receipt(path: receipt.path!),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// 收據縮圖，點下去放大。收據是要看得清楚金額的，能放大才有意義。
class _Receipt extends StatelessWidget {
  final String path;

  const _Receipt({required this.path});

  void _view(BuildContext context) {
    showDialog<void>(
      context: context,
      builder: (context) => Dialog(
        insetPadding: const EdgeInsets.all(12),
        child: GestureDetector(
          onTap: () => Navigator.of(context).pop(),
          child: InteractiveViewer(
            maxScale: 5,
            child: RemoteReceipt(path: path, fit: BoxFit.contain),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () => _view(context),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(12),
        child: SizedBox(
          width: double.infinity,
          height: 220,
          child: RemoteReceipt(path: path, fit: BoxFit.cover),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------- 小元件

class _Card extends StatelessWidget {
  final Widget child;

  const _Card({required this.child});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.line),
      ),
      child: child,
    );
  }
}

class _SectionTitle extends StatelessWidget {
  final String text;

  const _SectionTitle(this.text);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Text(
        text,
        style: Theme.of(context)
            .textTheme
            .bodyMedium
            ?.copyWith(fontWeight: FontWeight.w700),
      ),
    );
  }
}

class _Row extends StatelessWidget {
  final String label;
  final String value;

  /// 分攤明細那一組左邊是人名，不該印成標籤的灰色。
  final bool labelIsName;

  const _Row({
    required this.label,
    required this.value,
    this.labelIsName = false,
  });

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Text(
              label,
              style: labelIsName
                  ? text.bodyMedium
                  : text.bodySmall?.copyWith(color: AppColors.muted),
            ),
          ),
          const SizedBox(width: 12),
          Text(
            value,
            style: text.bodyMedium?.copyWith(
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
            textAlign: TextAlign.end,
          ),
        ],
      ),
    );
  }
}
