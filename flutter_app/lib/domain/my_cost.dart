import 'models.dart';
import 'settlement.dart';

/// 「我花了多少錢」—— 指的是我該分攤的，不是我先付出去的。
/// 先付的錢會被還，所以不是這趟旅行的成本。
///
/// `src/utils/myCost.ts` 的 Dart 版。

/// 刻意複用 `settleExpenses` 而不是另寫一套加總。
///
/// 換算後的分攤金額沒有存在資料庫裡，是 `baseSplitsOf` 當場用原幣別金額當權重
/// 分配出來的，而餘數要分給誰取決於 `memberOrder`。自己寫一套的話，列表頁跟
/// 結算頁會差幾分錢，看起來就像 bug。走同一個函式，數字是構造上一致的。
///
/// payments 傳空陣列：要的是「支出的分攤」，已經還過多少錢不影響這趟花了多少。
int myTripCost(
  List<Expense> expenses,
  List<String> memberOrder,
  String uid,
  String baseCurrency,
) {
  final settlement = settleExpenses(expenses, const [], memberOrder, baseCurrency);
  for (final item in settlement.balances) {
    if (item.uid == uid) return item.owed;
  }
  return 0;
}

class CurrencyAmount {
  final String currency;
  final int amount;
  const CurrencyAmount(this.currency, this.amount);

  @override
  bool operator ==(Object other) =>
      other is CurrencyAmount &&
      other.currency == currency &&
      other.amount == amount;

  @override
  int get hashCode => Object.hash(currency, amount);

  @override
  String toString() => 'CurrencyAmount($currency, $amount)';
}

/// 跨旅程的總計依幣別分開列，不合併。
///
/// 每個任務有自己的主要幣別，把 TWD 跟 THB 加在一起是錯的。而且匯率是各筆
/// 支出記帳當下鎖定的，硬要再換一次會破壞「同一筆帳今天看跟下個月看一樣」。
List<CurrencyAmount> sumByCurrency(List<CurrencyAmount> items) {
  // LinkedHashMap（Dart 的預設）保留插入順序，跟 JS 的 Map 一樣 ——
  // 下面的排序有 tiebreaker，所以其實不依賴它，但行為對齊比較好推理。
  final totals = <String, int>{};
  for (final item in items) {
    totals[item.currency] = (totals[item.currency] ?? 0) + item.amount;
  }

  final result = totals.entries
      .map((entry) => CurrencyAmount(entry.key, entry.value))
      .where((item) => item.amount != 0)
      .toList()
    // 金額大的在前，平手時比幣別代碼 —— 一樣要有 tiebreaker，
    // 因為 Dart 的 sort 不保證穩定。
    ..sort((a, b) {
      final byAmount = b.amount.compareTo(a.amount);
      return byAmount != 0 ? byAmount : a.currency.compareTo(b.currency);
    });

  return result;
}
