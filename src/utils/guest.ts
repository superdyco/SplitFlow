/**
 * 訪客（Firebase 匿名登入）的判斷。刻意不 import firebase，測試可以直接跑。
 *
 * 判斷一律看 `isAnonymous`，不比對 provider 字串 —— 綁定帳號之後同一個 User
 * 的 isAnonymous 會變成 false，那才是「他還是不是訪客」的唯一來源。
 */
export const GUEST_PROVIDER_ID = "anonymous";

export function isGuest(user: { isAnonymous: boolean } | null | undefined): boolean {
  return !!user?.isAnonymous;
}

/**
 * 寫進 `users/{uid}.provider` 的值。
 *
 * 訪客的 providerData 是空的，不特別處理的話會寫成 "unknown"，後台與個人頁
 * 就說不出這個人是訪客。
 */
export function providerIdOf(user: {
  isAnonymous: boolean;
  providerData: { providerId: string }[];
}): string {
  if (user.isAnonymous) return GUEST_PROVIDER_ID;
  return user.providerData[0]?.providerId || "unknown";
}
