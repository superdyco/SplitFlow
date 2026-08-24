import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  type DocumentData
} from "firebase/firestore";
import { db } from "@/firebase/config";
import type { FavoriteInput, FavoriteReport } from "@/types/favorite";
import { favoriteId } from "@/utils/favorites";

/**
 * 收藏的讀寫。全部掛在 `users/{uid}/favorites` 底下，規則只認 isSelf(uid) ——
 * 收藏是私人的，別人不該知道你存了誰的旅程。
 */

/** 一次最多列這麼多。收藏頁是一個清單，不是無限捲軸。 */
const MAX_FAVORITES = 100;

function favoritesRef(uid: string) {
  return collection(db, "users", uid, "favorites");
}

function toFavorite(id: string, data: DocumentData): FavoriteReport {
  return { id, ...data } as FavoriteReport;
}

/**
 * 加入收藏。用 setDoc 而不是 addDoc：id 是算出來的，重複按只會蓋寫同一份，
 * 不會產生兩筆一樣的收藏。
 */
export function addFavorite(uid: string, input: FavoriteInput): Promise<void> {
  return setDoc(doc(favoritesRef(uid), favoriteId(input.taskId, input.reportId)), {
    ...input,
    savedAt: serverTimestamp()
  });
}

export function removeFavorite(uid: string, taskId: string, reportId: string): Promise<void> {
  return deleteDoc(doc(favoritesRef(uid), favoriteId(taskId, reportId)));
}

/** 單一份報告收藏過了沒。一次 doc 讀取，不用把整份清單撈下來。 */
export async function isFavorited(
  uid: string,
  taskId: string,
  reportId: string
): Promise<boolean> {
  const snap = await getDoc(doc(favoritesRef(uid), favoriteId(taskId, reportId)));
  return snap.exists();
}

/** 新收藏的排前面 —— 剛存起來的那份要馬上看得到，不用捲到最後。 */
export async function listFavorites(uid: string): Promise<FavoriteReport[]> {
  const snap = await getDocs(
    query(favoritesRef(uid), orderBy("savedAt", "desc"), limit(MAX_FAVORITES))
  );
  return snap.docs.map(item => toFavorite(item.id, item.data()));
}

/**
 * 收藏過的 id 集合。探索頁一次畫很多張卡，每張都問一次「收藏了嗎」會是
 * N 趟往返；改成一次把清單撈下來自己比對。
 */
export async function favoritedIds(uid: string): Promise<Set<string>> {
  const snap = await getDocs(query(favoritesRef(uid), limit(MAX_FAVORITES)));
  return new Set(snap.docs.map(item => item.id));
}
