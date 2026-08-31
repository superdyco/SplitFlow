/**
 * 登入錯誤訊息的對應。刻意不 import firebase，
 * 這樣測試可以直接跑，不用初始化整個 Firebase App。
 */
export type SignInProvider = "google" | "apple" | "facebook";

export const PROVIDER_LABELS: Record<SignInProvider, string> = {
  google: "Google",
  apple: "Apple",
  facebook: "Facebook"
};

/**
 * 登入頁實際顯示的供應商。程式碼路徑（`buildProvider` 的各個分支）都留著，
 * 之後要開哪個就把名字加回這個陣列，其餘不用改。
 *
 * Apple 打開：iOS 上架的硬性要求（App Store 指引 4.8 —— 提供第三方登入就
 * 必須同時提供 Sign in with Apple）。網頁版跟著開，不然用 Apple 註冊的人在
 * 桌機上登不進去，會以為自己的旅程不見了。需要 Apple Developer Program 的
 * Services ID、Return URL 與 .p8 私密金鑰，都填在 Firebase Console。
 *
 * Facebook 拿掉：Meta 現在要求 App 上線前得連結商業檔案、填隱私政策與資料刪除
 * 網址，流程太長，而 Google 登入沒有任何這類關卡。
 */
export const ENABLED_PROVIDERS: SignInProvider[] = ["google", "apple"];

/** Firebase 回傳的 providerId 對應到人看得懂的名稱。 */
export const PROVIDER_ID_LABELS: Record<string, string> = {
  "google.com": "Google",
  "apple.com": "Apple",
  "facebook.com": "Facebook",
  password: "電子郵件與密碼"
};

export function providerLabel(providerId: string): string {
  return PROVIDER_ID_LABELS[providerId] || providerId;
}

/** 使用者自己關掉彈窗、或連點兩次造成前一個彈窗被取消，都不算錯誤。 */
const CANCELLED_CODES = new Set([
  "auth/popup-closed-by-user",
  "auth/cancelled-popup-request",
  "auth/user-cancelled"
]);

export function isCancelledSignIn(code: string): boolean {
  return CANCELLED_CODES.has(code);
}

/**
 * 同一個 email 已經用別的方式註冊過時的訊息。
 * `methods` 查得到才點名是哪個供應商；查不到就給通用訊息，不要亂猜。
 */
export function existingAccountMessage(email: string, methods: string[]): string {
  const suffix = email ? `（${email}）` : "";
  const labels = methods.map(providerLabel).filter(Boolean);
  if (labels.length) {
    return `這個帳號${suffix}之前是用 ${labels.join("、")} 註冊的，請改用原本的方式登入。`;
  }
  return `這個帳號${suffix}之前用別的方式註冊過，請改用原本的登入方式。`;
}

/**
 * 把 Firebase 的錯誤碼轉成使用者看得懂的話。
 * 回傳 null 代表這是使用者自己取消的，畫面不該顯示錯誤。
 */
export function describeSignInError(code: string, provider: SignInProvider, fallback: string): string | null {
  if (isCancelledSignIn(code)) return null;

  const label = PROVIDER_LABELS[provider];
  switch (code) {
    case "auth/operation-not-allowed":
      return `${label} 登入還沒有在 Firebase Console 啟用，或是設定還沒填完。`;
    case "auth/unauthorized-domain":
      return "目前的網域不在 Firebase Authentication 的 Authorized domains 清單裡。";
    case "auth/popup-blocked":
      return "瀏覽器擋掉了登入彈窗，請允許彈出視窗後再試一次。";
    case "auth/invalid-credential":
      return `${label} 回傳的憑證無效，請確認 Console 裡的設定是否正確。`;
    case "auth/network-request-failed":
      return "網路連線失敗，請確認網路後再試一次。";
    default:
      return fallback;
  }
}
