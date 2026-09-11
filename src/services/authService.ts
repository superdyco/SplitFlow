import { FirebaseError } from "firebase/app";
import {
  FacebookAuthProvider,
  GoogleAuthProvider,
  OAuthProvider,
  fetchSignInMethodsForEmail,
  onAuthStateChanged,
  signInAnonymously,
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

export async function signIn(name: SignInProvider): Promise<User> {
  try {
    const credential = await signInWithPopup(auth, buildProvider(name));
    return credential.user;
  } catch (err) {
    throw await toSignInError(err, name);
  }
}

/**
 * 免登入試用。拿到的是一個真的匿名帳號 —— 建任務、記帳、加入別人的任務都跟
 * 正式帳號一樣，rules 不必為它開任何例外。
 *
 * 沒有彈窗，所以 iOS PWA 上彈窗被擋、跨來源 iframe 暖機那一串問題，訪客都不會遇到。
 */
export async function signInAsGuest(): Promise<User> {
  try {
    const credential = await signInAnonymously(auth);
    return credential.user;
  } catch (err) {
    if (err instanceof FirebaseError && err.code === "auth/operation-not-allowed") {
      throw new Error("免登入試用還沒有在 Firebase Console 啟用。");
    }
    throw err;
  }
}

export function logout(): Promise<void> {
  return signOut(auth);
}
