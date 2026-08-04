/**
 * 旅費報告的靜態地圖。
 *
 * **刻意不用 Maps JS SDK。** 報告是公開連結，在那個頁面載 SDK 的話：
 * 每次有人開啟都算一次 API 呼叫（連結被轉傳＝帳單失控，而且你擋不住），
 * 而且金鑰會出現在一個設計上就是要到處轉傳的頁面裡。
 *
 * 改成產生報告時呼叫 Static Maps **一次**、把 PNG 存進 Storage，
 * 之後永遠是 0 次呼叫，公開頁面也完全不帶金鑰。代價是不能縮放拖曳。
 *
 * 注意這裡用的是 **Maps Static API**，跟 PlaceMap 用的 Maps JavaScript API
 * 在 Google Cloud 是兩個獨立的 API。同一把金鑰要兩個都開，只開一個的話
 * 這裡會拿到 403。
 */
import type { PlaceTotal } from "@/utils/placeTotals";

const STATIC_MAP_URL = "https://maps.googleapis.com/maps/api/staticmap";
const LANGUAGE = "zh-TW";
/** 標記太多會讓 URL 超過長度上限，取金額最大的前幾個就夠表達「去了哪一帶」。 */
const MAX_MARKERS = 20;
/** 搭配 scale=2，實際輸出是 1280x800，在高解析度螢幕上才不會糊。 */
const SIZE = "640x400";
/** Google 的錯誤訊息是一整段文字，截短才塞得進一行提示。 */
const MAX_REASON_LENGTH = 200;
/**
 * 這個數字跟 storage.rules 裡 map.png 的上限必須一致。
 * 不一致的話上傳會被規則擋掉，而錯誤碼是看不懂的 unauthorized。
 */
export const MAX_MAP_BYTES = 1 * 1024 * 1024;

export function staticMapEnabled(): boolean {
  return !!import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
}

export function reportMapPath(taskId: string, reportId: string): string {
  return `tasks/${taskId}/reports/${reportId}/map.png`;
}

/**
 * 地圖是加分不是必要，所以失敗一律不擋報告 —— 但要講得出原因。
 *
 * 原本每種失敗都回傳 null，結果「沒設金鑰」「地點沒座標」「API 沒開通」
 * 「配額用完」在畫面上長得一模一樣，等於沒有辦法查。
 */
export interface StaticMapResult {
  blob: Blob | null;
  /** blob 是 null 時說明為什麼，給產生報告的人看。成功時是 null。 */
  reason: string | null;
}

/** 有座標的地點才畫得上去。純文字輸入的地點沒有經緯度。 */
export function mappablePlaces(places: PlaceTotal[]): PlaceTotal[] {
  return places.filter(place => place.lat != null && place.lng != null).slice(0, MAX_MARKERS);
}

function shorten(text: string): string {
  const clean = text.trim().replace(/\s+/g, " ");
  return clean.length > MAX_REASON_LENGTH ? `${clean.slice(0, MAX_REASON_LENGTH)}...` : clean;
}

export async function fetchStaticMap(places: PlaceTotal[]): Promise<StaticMapResult> {
  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  if (!key) return { blob: null, reason: "沒有設定 VITE_GOOGLE_MAPS_API_KEY。" };

  const located = mappablePlaces(places);
  if (!located.length) {
    return {
      blob: null,
      reason: "支出裡沒有帶座標的地點 —— 用純文字打的地點沒有經緯度，畫不到地圖上。"
    };
  }

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
    if (!response.ok) {
      // Static Maps 的錯誤內容是 text/plain，而且寫得很清楚（沒開通這個 API、
      // referrer 不符、超出配額）。原文照抄比自己編一句有用得多。
      const detail = await response.text().catch(() => "");
      return {
        blob: null,
        reason: shorten(
          `地圖服務回應 ${response.status}${detail ? `：${detail}` : ""}` +
            `（這個功能用的是 Maps Static API，跟 Maps JavaScript API 要分開開通）`
        )
      };
    }
    return { blob: await response.blob(), reason: null };
  } catch (err) {
    return { blob: null, reason: shorten(`連不上地圖服務：${(err as Error).message}`) };
  }
}
