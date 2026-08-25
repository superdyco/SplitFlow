import 'dart:math' as math;

/// 金額與幣別。`src/utils/currency.ts` 的 Dart 版。
///
/// 這一層刻意不 import Flutter —— 它是整個 app 最值錢也最該被測試的部分，
/// 不該因為需要 widget 環境才跑得起來。UI 之外的東西一律往這裡放。
///
/// **金額一律是最小單位整數**（TWD 450.50 存成 45050）。浮點數不碰錢，
/// 這是整份程式碼最重要的一條規則。

const List<String> currencies = [
  'TWD', 'JPY', 'THB', 'USD', 'VND', 'CNY', 'EGP', 'KRW', 'EUR', 'HKD',
];

const Map<String, int> _minorUnits = {
  'TWD': 2,
  'THB': 2,
  'USD': 2,
  'CNY': 2,
  'EGP': 2,
  'EUR': 2,
  'HKD': 2,
  'VND': 0,
  'KRW': 0,
  // 日圓沒有輔幣單位，1 円就是最小單位 —— 跟 VND、KRW 同一類。
  'JPY': 0,
};

int minorUnits(String currency) => _minorUnits[currency] ?? 2;

/// JS 的 Number.MAX_SAFE_INTEGER。
///
/// Dart 原生的 int 是 64 位元，本來沒有這個上限 —— 但網頁版讀寫的是同一批
/// Firestore 文件，而它跑在 JS 上就是 53 位元。兩邊要對同一份資料有共識，
/// 所以這裡沿用比較嚴格的那個界線。
const int _maxSafeInteger = 9007199254740991;

/// 把使用者輸入的金額字串換成最小單位整數，例如 TWD "450.5" -> 45050。
int parseAmountInput(String value, String currency) {
  final trimmed = value.trim();
  if (trimmed.isEmpty) throw const FormatException('金額為必填');

  final digits = minorUnits(currency);
  final pattern =
      digits > 0 ? RegExp('^\\d+(\\.\\d{1,$digits})?\$') : RegExp(r'^\d+$');
  if (!pattern.hasMatch(trimmed)) {
    throw FormatException(
      digits > 0 ? '金額只能是數字，最多 $digits 位小數' : '$currency 金額只能是整數',
    );
  }

  final parts = trimmed.split('.');
  final whole = parts[0];
  final fraction = parts.length > 1 ? parts[1] : '';
  final padded = (fraction + '0' * digits).substring(0, digits);

  final int amount;
  try {
    amount = int.parse(whole + padded);
  } on FormatException {
    // int.parse 自己的訊息是英文的內部細節，換成使用者看得懂的。
    throw const FormatException('金額太大');
  }

  if (amount > _maxSafeInteger) throw const FormatException('金額太大');
  if (amount <= 0) throw const FormatException('金額必須大於 0');
  return amount;
}

class _Parts {
  final bool negative;
  final String whole;
  final String fraction;
  const _Parts(this.negative, this.whole, this.fraction);
}

_Parts _splitAmount(int amount, String currency) {
  final digits = minorUnits(currency);
  final base = amount.abs().toString().padLeft(digits + 1, '0');
  return _Parts(
    amount < 0,
    base.substring(0, base.length - digits),
    digits > 0 ? base.substring(base.length - digits) : '',
  );
}

/// 千分位。
///
/// TS 版用的是 `\B(?=(\d{3})+(?!\d))` 這種零寬度前瞻的正則。這裡改成明寫的
/// 迴圈 —— 不是因為 Dart 不支援，而是因為零寬度比對在不同引擎上的行為
/// 需要實測才敢下結論，而這段程式碼寫出來的當下沒有 Dart SDK 可以驗。
/// 看一眼就知道對不對的寫法，在這種情況下比較有價值。
String _group(String whole) {
  final buffer = StringBuffer();
  for (var i = 0; i < whole.length; i += 1) {
    if (i > 0 && (whole.length - i) % 3 == 0) buffer.write(',');
    buffer.write(whole[i]);
  }
  return buffer.toString();
}

/// 最小單位整數轉成顯示字串，含千分位，例如 45050 / TWD -> "450.50"。
String formatAmount(int amount, String currency) {
  final parts = _splitAmount(amount, currency);
  final grouped = _group(parts.whole);
  final fraction = parts.fraction.isEmpty ? '' : '.${parts.fraction}';
  return '${parts.negative ? '-' : ''}$grouped$fraction';
}

/// 最小單位整數轉回表單輸入值，不含千分位。
String amountToInput(int amount, String currency) {
  final parts = _splitAmount(amount, currency);
  final fraction = parts.fraction.isEmpty ? '' : '.${parts.fraction}';
  return '${parts.negative ? '-' : ''}${parts.whole}$fraction';
}

/// 把 total 依 weights 的比例拆成整數，結果總和一定等於 total。
///
/// 除不盡的部分用最大餘數法補：小數部分大的先拿，平手時取索引小的，
/// 所以結果是確定的 —— 同一組輸入永遠拆出同一個答案。
///
/// 均分就是所有 weight 相同，換算幣別就是用原幣別的分攤金額當 weight。
List<int> allocate(int total, List<int> weights) {
  if (weights.isEmpty) return [];

  final sum = weights.fold<int>(0, (acc, weight) => acc + weight);
  // 權重全是 0 的話沒有比例可言，退回均分。
  if (sum <= 0) return allocate(total, List<int>.filled(weights.length, 1));

  final exact = weights.map((weight) => (total * weight) / sum).toList();
  final result = exact.map((value) => value.floor()).toList();
  final remainder = total - result.fold<int>(0, (acc, value) => acc + value);

  /*
    排序的比較子一定要有「平手時比索引」這一段。

    JS 的 Array.sort 在現代引擎是穩定排序，Dart 的 List.sort **不保證**穩定。
    少了這個 tiebreaker，兩邊在小數部分相同時可能給出不同的分配順序 ——
    也就是同一筆帳在兩個版本上，那一塊錢會落在不同的人身上。
  */
  final order = List<int>.generate(exact.length, (i) => i)
    ..sort((a, b) {
      final fractionA = exact[a] - exact[a].floorToDouble();
      final fractionB = exact[b] - exact[b].floorToDouble();
      final byFraction = fractionB.compareTo(fractionA);
      return byFraction != 0 ? byFraction : a.compareTo(b);
    });

  for (var i = 0; i < remainder; i += 1) {
    result[order[i % order.length]] += 1;
  }
  return result;
}

/// rate 是「1 單位 from 幣別等於多少 to 幣別」，兩邊小數位數不同要各自換算。
///
/// 註：JS 的 `Math.round` 是往正無窮方向進位（-0.5 → -0），Dart 的
/// `double.round()` 是往遠離零的方向（-0.5 → -1）。這裡的金額一律為正，
/// 兩邊結果相同；哪天出現負數金額要記得這個差異。
int convertAmount(int amount, String from, String to, double rate) {
  if (from == to) return amount;
  final fromUnits = math.pow(10, minorUnits(from));
  final toUnits = math.pow(10, minorUnits(to));
  return ((amount / fromUnits) * rate * toUnits).round();
}

/// 匯率輸入框的驗證，最多六位小數。
double parseRateInput(String value) {
  final trimmed = value.trim();
  if (trimmed.isEmpty) throw const FormatException('匯率為必填');
  if (!RegExp(r'^\d+(\.\d{1,6})?$').hasMatch(trimmed)) {
    throw const FormatException('匯率只能是數字，最多 6 位小數');
  }
  final rate = double.parse(trimmed);
  if (!(rate > 0)) throw const FormatException('匯率必須大於 0');
  return rate;
}

/// 把 parse 丟出來的訊息接住。空白回 null —— 還沒填不該在畫面上跳紅字。
String? _messageOf(String value, void Function(String input) parse) {
  if (value.trim().isEmpty) return null;
  try {
    parse(value);
    return null;
  } on FormatException catch (err) {
    return err.message;
  }
}

/// 金額字串在這個幣別下的錯誤訊息，合法或空白時是 null。
///
/// 存在的理由是一個實際發生過的 bug：編輯支出時換幣別，儲存鍵突然變灰、
/// 畫面上卻沒有任何說明。原因是既有的 "450.50" 在 THB 合法，換成 0 位小數的
/// VND 就不合法了，而呼叫端只拿得到 null，只能讓按鈕變灰。
String? amountInputError(String value, String currency) =>
    _messageOf(value, (input) => parseAmountInput(input, currency));

/// 匯率字串的錯誤訊息，理由同上：打錯字不該只是讓送出鍵默默變灰。
String? rateInputError(String value) => _messageOf(value, parseRateInput);
