/// 把 Firestore 文件裡的值轉成 `jsonEncode` 可接受的格式。
///
/// 這裡刻意不 import cloud_firestore，讓轉換邏輯可以用純 Dart 測試。Firestore
/// Timestamp 提供 `toDate()`，因此以能力檢查處理，也能涵蓋測試用的替身。
dynamic exportJsonValue(dynamic value) {
  if (value is DateTime) return value.toUtc().toIso8601String();
  if (value is List) return value.map(exportJsonValue).toList();
  if (value is Map) {
    return value.map(
      (key, item) => MapEntry(key.toString(), exportJsonValue(item)),
    );
  }

  try {
    final converted = value.toDate();
    if (converted is DateTime) return converted.toUtc().toIso8601String();
  } on NoSuchMethodError {
    // 一般 JSON 基本型別沒有 toDate，原樣回傳。
  }
  return value;
}
