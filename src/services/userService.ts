import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import type { User } from "firebase/auth";
import { db } from "@/firebase/config";
import type { UserProfile } from "@/types/user";

export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? (snap.data() as UserProfile) : null;
}

export async function createUserProfile(user: User, nickname: string): Promise<void> {
  await setDoc(doc(db, "users", user.uid), {
    uid: user.uid,
    nickname,
    email: user.email || "",
    photoURL: user.photoURL || null,
    provider: user.providerData[0]?.providerId || "google.com",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true });
}

export async function updateNickname(uid: string, nickname: string): Promise<void> {
  await updateDoc(doc(db, "users", uid), {
    nickname,
    updatedAt: serverTimestamp()
  });
}
