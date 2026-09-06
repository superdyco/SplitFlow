import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import type { User } from "firebase/auth";
import { db } from "@/firebase/config";
import type { UserProfile } from "@/types/user";

export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? (snap.data() as UserProfile) : null;
}

/**
 * 建立個人檔案。
 *
 * **先讀一次，是為了不寫 createdAt。**
 *
 * merge 保得住沒提到的欄位，但保不住有提到的 —— 把 createdAt 放進 payload，
 * merge 就會拿新的時間蓋掉舊的。這條路平常碰不到（有檔案就不會走到取暱稱頁），
 * 但讀檔案失敗時碰得到：那時畫面會退回取暱稱頁，而那個人其實早就註冊過了。
 * 換句話說，一次網路不順就會把註冊日洗成今天，而註冊日正是後台用來看
 * 「這個月來了多少新人」的欄位。
 *
 * 而且從 affectedKeys 那次修正之後，這種寫入會直接被規則擋下來（createdAt
 * 不在 users 的 hasOnly 名單裡），使用者看到的是存不了暱稱。所以這一趟讀
 * 不只是為了資料好看。
 */
export async function createUserProfile(user: User, nickname: string): Promise<void> {
  const ref = doc(db, "users", user.uid);
  const existing = await getDoc(ref);

  const base = {
    uid: user.uid,
    nickname,
    email: user.email || "",
    photoURL: user.photoURL || null,
    provider: user.providerData[0]?.providerId || "unknown",
    updatedAt: serverTimestamp()
  };

  await setDoc(
    ref,
    existing.exists() ? base : { ...base, createdAt: serverTimestamp() },
    { merge: true }
  );
}

export async function updateNickname(uid: string, nickname: string): Promise<void> {
  await updateDoc(doc(db, "users", uid), {
    nickname,
    updatedAt: serverTimestamp()
  });
}
