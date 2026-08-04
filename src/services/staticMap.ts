/**
 * 旅費報告的靜態地圖。
 *
 * **刻意不用 Maps JS SDK。** 報告是公開連結，在那個頁面載 SDK 的話：
 * 每次有人開啟都算一次 API 呼叫（連結被轉傳＝帳單失控，而且你擋不住），
 * 而且金鑰會出現在一個設計上就是要到處轉傳的頁面裡。
 *
 * 改成產生報告時呼叫 Static Maps **一次**、把 PNG 存進 Storage，
 * 之後永遠是 0 次呼叫，公開頁面也完全不帶金鑰。代價是不能縮放拖曳。
 */
import type { PlaceTotal } from "@/utils/placeTotals";

const STATIC_MAP_URL = "https://maps.googleapis.com/maps/api/staticmap";
const LANGUAGE = "zh-TW";
/** 標記太多會讓 URL 超過長度上限，取金額最大的前幾個就夠表達「去了哪一帶」。 */
const MAX_MARKERS = 20;
/** 搭配 scale=2，實際輸出是 1280x800，在高解析度螢幕上才不會糊。 */
const SIZE = "640x400";

export function staticMapEnabled(): boolean {
  return !!import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
}

export function reportMapPath(taskId: string, reportId: string): string {
  return `tasks/${taskId}/reports/${reportId}/map.png`;
}

/**
 * 有座標的地點才畫得上去。回傳 null 代表沒有地圖可畫或抓失敗 ——
 * 呼叫端要把它當成「這份報告沒有地圖」，不是錯誤。
 */
export async function fetchStaticMap(places: PlaceTotal[]): Promise<Blob | null> {
  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  if (!key) return null;

  const located = places
    .filter(place => place.lat != null && place.lng != null)
    .slice(0, MAX_MARKERS);
  if (!located.length) return null;

  const params = new URLSearchParams({
    size: SIZE,
    scale: "2",
    maptype: "roadmap",
    language: LANGUAGE,
    key
  });
  // 不指定 center 與 zoom，Google 會自動框住所有標記。
  params.append(
    "markers",
    `color:0xe8590c|${located.map(place => `${place.lat},${place.lng}`).join("|")}`
  );

  try {
    const response = await fetch(`${STATIC_MAP_URL}?${params}`);
    if (!response.ok) return null;
    return await response.blob();
  } catch {
    // 地圖是加分不是必要。抓不到就沒有地圖，不能讓整份報告產不出來。
    return null;
  }
}
