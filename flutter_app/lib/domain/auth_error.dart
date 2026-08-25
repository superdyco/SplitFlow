/// 登入錯誤訊息的對應。`src/utils/authError.ts` 的 Dart 版。
///
/// 刻意不 import Firebase：純函式才測得動，不用為了跑字串測試去初始化整個
/// Firebase App。錯誤碼是字串，由資料存取層傳進來。

enum SignInProvider { google, apple, facebook }

const Map<SignInProvider, String> providerLabels = {
  SignInProvider.google: 'Google',
  SignInProvider.apple: 'Apple',
  SignInProvider.facebook: 'Facebook',
};

/// 登入頁實際顯示的供應商。程式碼路徑都留著，之後要開哪個就把名字加回這個
/// 清單，其餘不用改。
///
/// Apple 拿掉：要 Apple Developer Program（年費 US$99）才建得出 Services ID
/// 與私密金鑰，沒有付費帳號時 Firebase Console 那格根本填不完。
///
/// Facebook 拿掉：Meta 現在要求 App 上線前得連結商業檔案、填隱私政策與資料
/// 刪除網址，流程太長，而 Google 登入沒有任何這類關卡。
///
/// 註：這個清單在原生版可能會變 —— iOS 上架時 Apple 會要求提供 Apple 登入。
/// 真的要送 App Store 時記得回來處理。
const List<SignInProvider> enabledProviders = [SignInProvider.google];

/// Firebase 回傳的 providerId 對應到人看得懂的名稱。
const Map<String, String> providerIdLabels = {
  'google.com': 'Google',
  'apple.com': 'Apple',
  'facebook.com': 'Facebook',
  'password': '電子郵件與密碼',
};

String providerLabel(String providerId) =>
    providerIdLabels[providerId] ?? providerId;

/// 使用者自己關掉彈窗、或連點兩次造成前一個彈窗被取消，都不算錯誤。
const Set<String> _cancelledCodes = {
  'popup-closed-by-user',
  'cancelled-popup-request',
  'user-cancelled',
  // FlutterFire 的原生流程會用這個碼表示使用者中途取消。
  'canceled',
};

/// 認碼時把 `auth/` 前綴去掉再比。
///
/// Firebase JS SDK 給的是 `auth/popup-closed-by-user`，FlutterFire 給的是
/// `popup-closed-by-user` —— 同一件事兩種寫法。統一在這裡剝掉，
/// 呼叫端不用管自己拿到的是哪一種。
String normalizeAuthCode(String code) =>
    code.startsWith('auth/') ? code.substring(5) : code;

bool isCancelledSignIn(String code) =>
    _cancelledCodes.contains(normalizeAuthCode(code));

/// 同一個 email 已經用別的方式註冊過時的訊息。
///
/// [methods] 查得到才點名是哪個供應商；查不到就給通用訊息，不要亂猜。
String existingAccountMessage(String email, List<String> methods) {
  final suffix = email.isEmpty ? '' : '（$email）';
  final labels = methods
      .map(providerLabel)
      .where((label) => label.isNotEmpty)
      .toList();

  if (labels.isNotEmpty) {
    return '這個帳號$suffix之前是用 ${labels.join('、')} 註冊的，請改用原本的方式登入。';
  }
  return '這個帳號$suffix之前用別的方式註冊過，請改用原本的登入方式。';
}

/// 把 Firebase 的錯誤碼轉成使用者看得懂的話。
///
/// 回傳 null 代表這是使用者自己取消的，畫面不該顯示錯誤。
String? describeSignInError(
  String code,
  SignInProvider provider,
  String fallback,
) {
  if (isCancelledSignIn(code)) return null;

  final label = providerLabels[provider];
  switch (normalizeAuthCode(code)) {
    case 'operation-not-allowed':
      return '$label 登入還沒有在 Firebase Console 啟用，或是設定還沒填完。';
    case 'unauthorized-domain':
      return '目前的網域不在 Firebase Authentication 的 Authorized domains 清單裡。';
    case 'popup-blocked':
      return '瀏覽器擋掉了登入彈窗，請允許彈出視窗後再試一次。';
    case 'invalid-credential':
      return '$label 回傳的憑證無效，請確認 Console 裡的設定是否正確。';
    case 'network-request-failed':
      return '網路連線失敗，請確認網路後再試一次。';
    default:
      return fallback;
  }
}
