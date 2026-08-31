import { GoogleAuthProvider, OAuthProvider, reauthenticateWithPopup, signOut } from "firebase/auth";
import { getFunctions, httpsCallable } from "firebase/functions";
import { app, auth } from "@/firebase/config";

/**
 * 刪除自己的帳號。App Store 指引 5.1.1(v) 要求 App 內就能發起，網頁版跟著做
 * 是因為兩邊是同一個帳號。
 *
 * 實際的刪除全在雲端函式裡（`functions/src/index.ts`）。現行規則下成員刪不掉
 * 自己的成員文件，也改不了 `ownerId` —— 要在這裡做就得為一輩子用一次的操作
 * 永久開兩個洞。
 *
 * 重新驗證不是形式：這個操作不可逆，而拿到一台沒鎖的電腦的人不該能刪掉別人的
 * 帳號。Firebase 對 `user.delete()` 本來就要求 recent login，我們改由伺服器端
 * 刪除雖然技術上不受此限，但保護的理由沒變。
 */
export async function deleteOwnAccount(): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error("請先登入");

  const providerId = user.providerData[0]?.providerId ?? "google.com";
  const provider =
    providerId === "apple.com" ? new OAuthProvider("apple.com") : new GoogleAuthProvider();

  await reauthenticateWithPopup(user, provider);

  // region 要跟函式一致，不然會打到 us-central1 然後找不到函式。
  const call = httpsCallable(getFunctions(app, "asia-east1"), "deleteAccount");
  await call();

  await signOut(auth);
}
