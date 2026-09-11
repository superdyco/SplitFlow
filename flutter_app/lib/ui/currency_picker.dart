import 'package:flutter/material.dart';

import '../domain/currency.dart';

/// 可以打字搜尋的幣別選單。`src/components/common/CurrencyPicker.vue` 的 Flutter 版。
///
/// 20 種幣別用原本的 DropdownButton 只能滑著找。這裡用 Material 的
/// DropdownMenu 開啟篩選：打「US」「美元」「美國」都找得到 USD，比對規則
/// 跟網頁版是同一支 `searchCurrencies`。
class CurrencyPicker extends StatelessWidget {
  final String value;
  final ValueChanged<String> onChanged;

  /// 置頂的幣別，通常是任務的主要幣別。
  final String? pinned;

  /// 欄位窄的時候，輸入框只顯示代碼；打開的清單仍然是「代碼 中文」。
  final bool compact;

  /// 給了就固定寬度，沒給就撐滿父層。
  final double? width;

  const CurrencyPicker({
    super.key,
    required this.value,
    required this.onChanged,
    this.pinned,
    this.compact = false,
    this.width,
  });

  @override
  Widget build(BuildContext context) {
    final entries = [
      for (final item in searchCurrencies('', pinned: pinned))
        DropdownMenuEntry<String>(
          value: item.code,
          // label 是輸入框裡顯示的字；清單上的樣子由 labelWidget 決定。
          label: compact ? item.code : currencyLabel(item.code),
          labelWidget: Text(currencyLabel(item.code)),
        ),
    ];
    final labels = {for (final entry in entries) entry.label};

    return DropdownMenu<String>(
      // 值從外面改變（例如編輯時載入既有支出）要重建，initialSelection 只在
      // 第一次生效。
      key: ValueKey(value),
      initialSelection: value,
      enableFilter: true,
      enableSearch: true,
      requestFocusOnTap: true,
      width: width,
      expandedInsets: width == null ? EdgeInsets.zero : null,
      menuHeight: 320,
      dropdownMenuEntries: entries,
      filterCallback: (all, filter) {
        // 剛打開時輸入框裡是目前選的那一項 —— 那不是在搜尋，給整份清單。
        if (labels.contains(filter)) return all;
        final byCode = {for (final entry in all) entry.value: entry};
        return [
          for (final item in searchCurrencies(filter, pinned: pinned))
            if (byCode[item.code] != null) byCode[item.code]!,
        ];
      },
      searchCallback: (shown, query) {
        if (shown.isEmpty) return null;
        // 停在目前選的那一個；在搜尋時就停在第一個結果，按 Enter 就選它。
        final current = shown.indexWhere((entry) => entry.label == query);
        return current >= 0 ? current : 0;
      },
      onSelected: (code) {
        if (code != null) onChanged(code);
      },
    );
  }
}
