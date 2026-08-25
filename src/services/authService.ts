import { FirebaseError } from "firebase/app";
import {
  FacebookAuthProvider,
  GoogleAuthProvider,
  OAuthProvider,
  fetchSignInMethodsForEmail,
  onAuthStateChanged,
  browserPopupRedirectResolver,
  getRedirectResult,
  signInWithPopup,
  signOut,
  type AuthProvider,
  type User
} from "firebase/auth";
import { auth } from "@/firebase/config";
import type { SignInProvider } from "@/utils/authError";
import { describeSignInError, existingAccountMessage, isCancelledSignIn } from "@/utils/authError";

export { PROVIDER_LABELS, providerLabel, type SignInProvider } from "@/utils/authError";

/** 使用者自己關掉彈窗不算錯誤，畫面不該跳紅字。 */
export class SignInCancelled extends Error {
  constructor() {
    super("已取消登入");
    this.name = "SignInCancelled";
  }
}

function buildProvider(name: SignInProvider): AuthProvider {
  if (name === "google") return new GoogleAuthProvider();

  if (name === "facebook") {
    const provider = new FacebookAuthProvider();
    provider.addScope("email");
    return provider;
  }

  const provider = new OAuthProvider("apple.com");
  provider.addScope("email");
  // Apple 只在「第一次」授權時回傳姓名，之後登入都拿不到。
  // 拿不到也沒關係，暱稱本來就是在 onboarding 讓使用者自己填。
  provider.addScope("name");
  return provider;
}

/**
 * 專案若開了 Email enumeration protection，`fetchSignInMethodsForEmail` 會回空陣列，
 * 這時只能給通用訊息，不能亂猜是哪個供應商。
 */
async function lookupExistingMethods(email: string): Promise<string[]> {
  if (!email) return [];
  try {
    return await fetchSignInMethodsForEmail(auth, email);
  } catch {
    return [];
  }
}

async function toSignInError(err: unknown, name: SignInProvider): Promise<Error> {
  if (!(err instanceof FirebaseError)) {
    return err instanceof Error ? err : new Error(String(err));
  }
  if (isCancelledSignIn(err.code)) return new SignInCancelled();

  if (err.code === "auth/account-exists-with-different-credential") {
    const email = (err.customData?.email as string) || "";
    return new Error(existingAccountMessage(email, await lookupExistingMethods(email)));
  }

  return new Error(describeSignInError(err.code, name, err.message) ?? err.message);
}

export function watchAuth(callback: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, callback);
}

/**
 * 先把彈窗登入要用的 resolver 初始化好。
 *
 * 為什麼需要：`signInWithPopup` 內部是這個順序 ——
 *
 *     this.eventManager = await this.resolver._initialize(this.auth);  // 先 await
 *     await this.onExecution();                                        // 才開彈窗
 *
 * resolver 沒暖過的話，第一行會當場去載 gapi 並開跨來源 iframe（手機 1.6 秒），
 * 等它回來時 iOS 早就把使用者手勢作廢了，`window.open` 被擋，然後那個 promise
 * 永遠在等一個不會來的事件 —— 畫面卡在「登入中」。
 *
 * 暖過之後 `_initialize` 會直接回傳快取好的 manager（`if (this.eventManagers[key])
 * return Promise.resolve(manager)`），不消耗手勢。
 *
 * 借 `getRedirectResult` 來觸發初始化，因為它是公開 API 而 `_initialize` 不是。
 * 這個 app 從來不用 `signInWithRedirect`，所以永遠沒有待處理的結果，它就只是
 * 回傳 null 順便把 resolver 建好。
 */
export async function warmSignIn(): Promise<void> {
  try {
    await getRedirectResult(auth, browserPopupRedirectResolver);
  } catch {
    /*
      暖機失敗不擋登入。按下去的時候 SDK 會自己再試一次 —— 那條路真的不通的話
      會是一個看得懂的錯誤（network-request-failed），不是卡住，因為 loadGapi
      自己帶 timeout。所以這裡安靜收掉，讓按鈕照樣可以按。
    */
  }
}

export async function signIn(name: SignInProvider): Promise<User> {
  try {
    // resolver 一定要自己傳 —— config.ts 沒有在初始化時設它。
    const credential = await signInWithPopup(auth, buildProvider(name), browserPopupRedirectResolver);
    return credential.user;
  } catch (err) {
    throw await toSignInError(err, name);
  }
}

export function logout(): Promise<void> {
  return signOut(auth);
}
