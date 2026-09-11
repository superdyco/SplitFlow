import { FirebaseError } from "firebase/app";
import {
  FacebookAuthProvider,
  GoogleAuthProvider,
  OAuthProvider,
  fetchSignInMethodsForEmail,
  linkWithPopup,
  onAuthStateChanged,
  signInAnonymously,
  signInWithCredential,
  signInWithPopup,
  signOut,
  type AuthCredential,
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

export type LinkResult =
  | { kind: "linked"; user: User }
  | { kind: "taken"; credential: AuthCredential };

function credentialFromError(name: SignInProvider, err: FirebaseError): AuthCredential | null {
  if (name === "google") return GoogleAuthProvider.credentialFromError(err);
  if (name === "facebook") return FacebookAuthProvider.credentialFromError(err);
  return OAuthProvider.credentialFromError(err);
}

/**
 * 訪客綁定正式帳號。成功的話 **uid 不變**，所有任務原封不動。
 *
 * 那個帳號以前就登入過（`credential-already-in-use`）時，把它的 credential
 * 交回去，由畫面問使用者要不要合併 —— 兩個 uid 沒辦法在用戶端合在一起。
 */
export async function linkGuest(name: SignInProvider): Promise<LinkResult> {
  const user = auth.currentUser;
  if (!user?.isAnonymous) throw new Error("只有訪客需要綁定帳號");
  try {
    const result = await linkWithPopup(user, buildProvider(name));
    return { kind: "linked", user: result.user };
  } catch (err) {
    if (err instanceof FirebaseError && err.code === "auth/credential-already-in-use") {
      const credential = credentialFromError(name, err);
      if (credential) return { kind: "taken", credential };
    }
    throw await toSignInError(err, name);
  }
}

/** 訪客的證明。**要在 switchToAccount 之前拿** —— 換過去之後就拿不到了。 */
export async function guestIdToken(): Promise<string> {
  const user = auth.currentUser;
  if (!user?.isAnonymous) throw new Error("目前不是訪客");
  return user.getIdToken();
}

/** 換成那個已經存在的帳號。 */
export async function switchToAccount(credential: AuthCredential): Promise<User> {
  const result = await signInWithCredential(auth, credential);
  return result.user;
}

export function logout(): Promise<void> {
  return signOut(auth);
}
