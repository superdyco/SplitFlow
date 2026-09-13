/// AI 讀收據在畫面這一側的規則。`src/utils/aiReceipt.ts` 的 Dart 版，
/// 規則與文案一字不差，改一邊要改另一邊。
///
/// 刻意不 import Firebase 或 Flutter：這一層要保持純 Dart，測試才跑得動。
library;

import 'currency.dart';

const int freeCredits = 3;
const String guestAiNotice = '綁定帳號就能用 AI 辨識';

class AiReceiptFields {
  final String? amount;
  final String? currency;
  final bool currencySupported;
  final String? date;
  final String? time;
  final String? title;

  /// 收據上印的地址。不是表單欄位，只用來搜地點候選。
  final String? address;
  final String? category;

  const AiReceiptFields({
    required this.amount,
    required this.currency,
    required this.currencySupported,
    required this.date,
    required this.time,
    required this.title,
    required this.address,
    required this.category,
  });

  factory AiReceiptFields.fromMap(Map<dynamic, dynamic> map) {
    String? text(String key) => map[key] is String ? map[key] as String : null;
    return AiReceiptFields(
      amount: text('amount'),
      currency: text('currency'),
      currencySupported: map['currencySupported'] == true,
      date: text('date'),
      time: text('time'),
      title: text('title'),
      address: text('address'),
      category: text('category'),
    );
  }
}

/// AI 讀完之後拿來搜地點候選的字串：店名＋地址。
///
/// 地址讓「すき家」這種到處都有的店名縮到那一家。兩個都沒有就回 null ——
/// 那時不查，查了也只是花一次錢拿到跟這張收據無關的結果。
String? placeQueryFrom(AiReceiptFields fields) {
  final parts = [fields.title, fields.address]
      .map((part) => part?.trim() ?? '')
      .where((part) => part.isNotEmpty)
      .toList();
  return parts.isEmpty ? null : parts.join(' ');
}

class AiReadResult {
  final String readResult;
  final AiReceiptFields fields;
  final int creditsLeft;

  const AiReadResult({
    required this.readResult,
    required this.fields,
    required this.creditsLeft,
  });

  /// callable 回來的巢狀物件在 Dart 這邊是 `Map<Object?, Object?>`，不是
  /// `Map<String, dynamic>` —— 直接 cast 會丟例外。
  factory AiReadResult.fromMap(Map<dynamic, dynamic> map) => AiReadResult(
        readResult: (map['readResult'] as String?) ?? 'unreadable',
        fields: AiReceiptFields.fromMap((map['fields'] as Map?) ?? const {}),
        creditsLeft: (map['creditsLeft'] as num?)?.toInt() ?? 0,
      );
}

enum AiButtonKind { ready, guest, empty, offline, busy }

class AiButton {
  final AiButtonKind kind;
  final String label;
  final bool disabled;
  const AiButton(this.kind, this.label, this.disabled);
}

AiButton aiButtonState({
  required bool guest,
  required bool online,
  required int? balance,
  required bool busy,
}) {
  if (busy) return const AiButton(AiButtonKind.busy, '辨識中…', true);
  // 訪客照樣按得下去：按下去才告訴他要綁定。停用的按鈕不會說明自己為什麼停用。
  if (guest) return const AiButton(AiButtonKind.guest, '用 AI 讀收據', false);
  if (!online) return const AiButton(AiButtonKind.offline, '需要網路', true);
  final left = balance ?? freeCredits;
  if (left <= 0) return const AiButton(AiButtonKind.empty, 'AI 點數用完了', true);
  return AiButton(AiButtonKind.ready, '用 AI 讀收據（剩 $left 點）', false);
}

class AiPatch {
  String? amount;
  String? currency;
  String? date;
  String? time;
  String? title;
  String? category;

  /// 「AI 已填入：…」那一行，照表單上的順序。
  final List<String> filled = [];
  String? warning;
}

String? _roundTo(String text, String currency) {
  final value = double.tryParse(text);
  if (value == null || !value.isFinite || value <= 0) return null;
  return value.toStringAsFixed(minorUnits(currency));
}

/// 讀到的全部蓋掉，沒讀到的不動。
///
/// 幣別不支援時改用主要幣別，金額照收據上的數字、依主要幣別的小數位整理。
/// **這樣存下來的金額是錯的幣別**，所以警告不會自己消失。
AiPatch aiPatch(
  AiReceiptFields fields, {
  required String baseCurrency,
  required String currentCurrency,
}) {
  final patch = AiPatch();
  final unsupported = fields.currency != null && !fields.currencySupported;
  final currency = (fields.currency != null && fields.currencySupported)
      ? fields.currency
      : (unsupported ? baseCurrency : null);

  final amount = fields.amount;
  if (amount != null) {
    // 支援的幣別函式已經整理好了；其他情況照最後會用的那個幣別整理。
    final value = fields.currencySupported
        ? amount
        : _roundTo(amount, currency ?? currentCurrency);
    if (value != null) {
      patch.amount = value;
      patch.filled.add('金額');
    }
  }
  if (currency != null) {
    patch.currency = currency;
    if (!unsupported) patch.filled.add('幣別');
  }
  if (fields.date != null) {
    patch.date = fields.date;
    patch.filled.add('日期');
  }
  if (fields.time != null) {
    patch.time = fields.time;
    patch.filled.add('時間');
  }
  if (fields.title != null) {
    patch.title = fields.title;
    patch.filled.add('支出名稱');
  }
  if (fields.category != null) {
    patch.category = fields.category;
    patch.filled.add('分類');
  }

  if (unsupported) {
    patch.warning = amount != null
        ? '收據上是 ${fields.currency} $amount，目前不支援這個幣別，已改用 $baseCurrency —— 金額請自己換算後再存'
        : '收據上的幣別是 ${fields.currency}，目前不支援，已改用 $baseCurrency';
  }
  return patch;
}

class SplitReset {
  /// null 代表分攤的人不動。
  final List<String>? memberIds;
  const SplitReset(this.memberIds);
}

/// 自訂分帳遇上 AI 改了金額或幣別：切回平分，給原本有填金額的那幾個人。
///
/// 不切的話各人金額加總對不上新的總額，儲存按不下去，而使用者看不出原因。
SplitReset? splitAfterAi({
  required bool custom,
  required Map<String, String> customAmounts,
  required bool changed,
}) {
  if (!custom || !changed) return null;
  final ids = [
    for (final entry in customAmounts.entries)
      if ((double.tryParse(entry.value.trim()) ?? 0) > 0) entry.key,
  ];
  return SplitReset(ids.isEmpty ? null : ids);
}

String aiMessage({
  required String readResult,
  required List<String> filled,
  required int creditsLeft,
  required bool splitReset,
}) {
  final base = readResult == 'read'
      ? 'AI 已填入：${filled.join('、')}（剩 $creditsLeft 點）'
      : (filled.isNotEmpty
          ? '沒有讀出金額（已扣 1 點），其他有讀到的欄位已填入'
          : '沒有讀出金額（已扣 1 點）');
  return splitReset ? '$base。分帳已改回平分' : base;
}
