import 'dart:convert';

import 'package:http/http.dart' as http;

/// 匯率來源：open.er-api.com，免費且不需要 API key。
/// `src/services/rateService.ts` 的 Dart 版。
///
/// 匯率只在記帳當下抓一次，換算結果會寫進支出文件，之後結算不再重抓。
/// 分帳記的是已經發生的事，金額不該因為今天匯率變了就跟著變。

const String _endpoint = 'https://open.er-api.com/v6/latest';
const Duration _cacheTtl = Duration(hours: 12);

class _RateTable {
  /// 1 單位 base 幣別等於多少該幣別。
  final Map<String, double> rates;
  final String updatedAt;
  final DateTime fetchedAt;

  const _RateTable(this.rates, this.updatedAt, this.fetchedAt);
}

/// 只放記憶體。網頁版還會寫 sessionStorage，原生這裡先不做 ——
/// 這個快取的價值是「同一次記帳連續改幣別不要一直打 API」，
/// 跨啟動保留省不到什麼，而多一個儲存就多一個要處理的失敗情境。
final Map<String, _RateTable> _cache = {};

class RateQuote {
  /// 1 單位 from 幣別等於多少 to 幣別。
  final double rate;
  final String updatedAt;

  const RateQuote(this.rate, this.updatedAt);
}

Future<_RateTable> _fetchTable(String base) async {
  final cached = _cache[base];
  if (cached != null &&
      DateTime.now().difference(cached.fetchedAt) < _cacheTtl) {
    return cached;
  }

  final response =
      await http.get(Uri.parse('$_endpoint/${Uri.encodeComponent(base)}'));
  if (response.statusCode != 200) {
    throw Exception('匯率服務回應 ${response.statusCode}');
  }

  final payload = jsonDecode(response.body) as Map<String, dynamic>;
  if (payload['result'] != 'success' || payload['rates'] == null) {
    throw Exception(payload['error-type'] ?? '匯率服務沒有回傳資料');
  }

  final rates = <String, double>{};
  (payload['rates'] as Map).forEach((key, value) {
    if (key is String && value is num) rates[key] = value.toDouble();
  });

  final table = _RateTable(
    rates,
    (payload['time_last_update_utc'] as String?) ?? '',
    DateTime.now(),
  );
  _cache[base] = table;
  return table;
}

Future<RateQuote> getRate(String from, String to) async {
  if (from == to) return const RateQuote(1, '');

  // 用 to 當 base 拿到的是「1 to 等於多少 from」，取倒數才是我們要的方向。
  final table = await _fetchTable(to);
  final inverse = table.rates[from];
  if (inverse == null || inverse <= 0) {
    throw Exception('匯率服務沒有 $from 的資料');
  }

  return RateQuote(1 / inverse, table.updatedAt);
}
