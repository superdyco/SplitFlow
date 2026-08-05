/**
 * 公開報告的地點列表顯示規則：截斷數量、算長條比例。
 *
 * 抽出來是為了讓這幾條規則測得到 —— 塞在元件的 computed 裡就只能靠眼睛驗。
 *
 * 純函式，不 import firebase 也不 import vue。
 */
import { NO_PLACE_LABEL, type PlaceTotal } from "@/utils/placeTotals";

/**
 * 超過這個數量就收起來。地圖標記上限是 20，二十幾列會把報告拉得很長，
 * 而報告要傳給沒去的人看，越短越有人看完。
 */
export const PLACE_LIMIT = 8;

export interface PlaceRow extends PlaceTotal {
  /** 長條長度，0-1。「未指定地點」是 null，代表不畫。 */
  bar: number | null;
}

export interface VisiblePlaces {
  rows: PlaceRow[];
  /** 收起來沒顯示的地點數。沒有收起任何東西時是 0。 */
  hiddenCount: number;
}

export function visiblePlaces(places: PlaceTotal[], limit = PLACE_LIMIT): VisiblePlaces {
  const shown = places.slice(0, limit);

  // 基準有兩個講究：
  // 一、只看顯示出來的 —— 被收起來的使用者看不到，拿它當基準會讓第一列不滿格。
  // 二、排除「未指定地點」—— placeTotals 把它固定排最後，但它的金額可能是全場
  //     最大（一堆沒填地點的支出加總起來），拿它當基準會讓真正的地點全部縮水。
  const maxTotal = Math.max(
    0,
    ...shown.filter(row => row.name !== NO_PLACE_LABEL).map(row => row.total)
  );

  return {
    rows: shown.map(row => ({
      ...row,
      bar: row.name === NO_PLACE_LABEL || maxTotal <= 0 ? null : row.total / maxTotal
    })),
    hiddenCount: Math.max(0, places.length - shown.length)
  };
}
