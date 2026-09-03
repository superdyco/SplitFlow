import type { ExpensePlace } from "@/types/expense";

/**
 * 地點欄位裡不碰網路、也不碰 DOM 的那半。名字跟 Flutter 的
 * `lib/domain/place_search.dart` 對齊 —— 兩邊必須是同一個東西。
 *
 * 純函式，不 import vue。
 */

/** 定位抓到的座標。 */
export interface LatLngLike {
  lat: number;
  lng: number;
}

/**
 * 這一格現在代表哪個地點。
 *
 * 選過建議就是完整的那一份（含座標），空的就是 null。
 *
 * 名字跟選取的那一份對得起來才算數 —— 選完再改字的話，那一份就不算了。
 * 這條不是龜毛：留著座標會存進一個名字對不上位置的地點，
 * 而那種錯誤在畫面上看起來完全正常。
 *
 * **[located] 是例外，而且例外的理由是它講的是另一件事。**
 *
 * 從建議來的座標是一句斷言：「這是那家店」。改了名字那句話就不成立。
 * 定位來的座標是另一句：「我在這」。把它改名成「路邊攤」不會讓它變假 ——
 * 使用者描述的正是他站的地方。所以只打名字時它留著，選了建議時它讓位。
 */
export function currentPlace(
  query: string,
  selected: ExpensePlace | null,
  located: LatLngLike | null = null
): ExpensePlace | null {
  const text = query.trim();
  if (!text) return null;
  if (selected && selected.name === text) return selected;
  return {
    name: text,
    address: null,
    lat: located?.lat ?? null,
    lng: located?.lng ?? null,
    placeId: null
  };
}

/**
 * 太短就不要查 —— 每打一個字打一次 API 太浪費，而一兩個字也搜不出東西。
 */
export function shouldSearchPlace(query: string): boolean {
  return query.trim().length >= 2;
}
