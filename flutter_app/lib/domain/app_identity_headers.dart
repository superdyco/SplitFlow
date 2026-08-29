/// 把原生端回傳的身分換成 Google Maps Platform 認得的 header。
///
/// 放在 domain 而不是 MethodChannel 那支檔案裡，兩個平台的欄位缺一個時是否
/// 安全退回可以用純 Dart 測，不必啟動 Flutter engine。
Map<String, String>? appIdentityHeaders(Map<String, dynamic>? identity) {
  final package = identity?['package'];
  final sha1 = identity?['sha1'];
  if (package is String &&
      package.isNotEmpty &&
      sha1 is String &&
      sha1.isNotEmpty) {
    return {
      'X-Android-Package': package,
      'X-Android-Cert': sha1,
    };
  }

  final bundleId = identity?['iosBundleId'];
  if (bundleId is String && bundleId.isNotEmpty) {
    return {'X-Ios-Bundle-Identifier': bundleId};
  }

  return null;
}
