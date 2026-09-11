/// 訪客（Firebase 匿名登入）的判斷。`src/utils/guest.ts` 的 Dart 版。
///
/// 刻意不 import Firebase：domain 層的測試要能不初始化 Firebase 就跑。
/// 呼叫端把 `user.isAnonymous` 與 providerId 清單傳進來。
///
/// 判斷一律看 `isAnonymous`，不比對 provider 字串 —— 綁定帳號之後同一個 User
/// 的 isAnonymous 會變成 false，那才是「他還是不是訪客」的唯一來源。
library;

const String guestProviderId = 'anonymous';

/// 寫進 `users/{uid}.provider` 的值。
///
/// 訪客的 providerData 是空的，不特別處理的話會寫成 'unknown'，後台與個人頁
/// 就說不出這個人是訪客。
String providerIdOf({
  required bool isAnonymous,
  required List<String> providerIds,
}) {
  if (isAnonymous) return guestProviderId;
  return providerIds.isEmpty ? 'unknown' : providerIds.first;
}
