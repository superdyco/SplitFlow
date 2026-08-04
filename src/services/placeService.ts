import type { ExpensePlace } from "@/types/expense";
import { locationBias, type LatLng } from "@/utils/placeBias";

/**
 * 用 Places API (New) 的 REST 端點，不載 Maps JavaScript SDK。
 * 地點搜尋只需要兩個 fetch，為了它多背一整包 SDK 不划算。
 *
 * 需要 `VITE_GOOGLE_PLACES_API_KEY`。這把 key 會出現在前端原始碼裡，
 * 所以一定要在 Google Cloud Console 設 HTTP referrer 限制，否則別人撿去用是算你的帳單。
 */
const AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete";
const DETAILS_URL = "https://places.googleapis.com/v1/places";
const LANGUAGE = "zh-TW";

function apiKey(): string {
  // 只設一把 key 也能動：沒有專用的 Places key 就沿用地圖那把。
  return import.meta.env.VITE_GOOGLE_PLACES_API_KEY || import.meta.env.VITE_GOOGLE_MAPS_API_KEY || "";
}

/** 沒設 key 的話地點欄位會退回純文字輸入，功能不會壞掉。 */
export function placesEnabled(): boolean {
  return !!apiKey();
}

export interface PlaceSuggestion {
  placeId: string;
  primary: string;
  secondary: string;
}

/**
 * Autocomplete 與後續的 details 用同一個 session token 才算一次計費，
 * 所以每次「開始打字到選定地點」共用一個 token，選完就換一個新的。
 */
export function newSessionToken(): string {
  return crypto.randomUUID();
}

/**
 * 記住每個任務最後用過的座標，當作下次搜尋的位置偏好。
 *
 * 存 localStorage 而不是回頭查 Firestore：表單頁本來不需要載入整份支出清單，
 * 為了一個座標多讀一次全部支出不划算。代價是換裝置就沒有記憶，那時只是
 * 退回原本的全球搜尋，不會壞掉。
 *
 * 依任務分開存 —— 不同旅程在不同城市，共用一個座標會偏到錯的地方。
 */
const BIAS_KEY = "splitflow:place-bias";
/** 只留最近這幾個任務，免得用久了無限長大。 */
const BIAS_LIMIT = 20;

type BiasMap = Record<string, LatLng>;

function readBiasMap(): BiasMap {
  try {
    const raw = localStorage.getItem(BIAS_KEY);
    return raw ? (JSON.parse(raw) as BiasMap) : {};
  } catch {
    // 無痕模式、儲存被拒、或存進去的內容壞掉 —— 都只是沒有偏好而已。
    return {};
  }
}

export function recallPlaceBias(taskId: string): LatLng | null {
  const entry = readBiasMap()[taskId];
  return entry && typeof entry.lat === "number" && typeof entry.lng === "number" ? entry : null;
}

export function rememberPlaceBias(taskId: string, place: ExpensePlace): void {
  if (place.lat == null || place.lng == null) return;
  try {
    const map = readBiasMap();
    delete map[taskId];

    // 重新插入讓它排到最後，超量時砍掉最前面（也就是最久沒用到）的那些。
    const trimmed = Object.entries(map).slice(-(BIAS_LIMIT - 1));
    localStorage.setItem(
      BIAS_KEY,
      JSON.stringify({ ...Object.fromEntries(trimmed), [taskId]: { lat: place.lat, lng: place.lng } })
    );
  } catch {
    // 存不進去就算了，下次搜尋沒有偏好而已，不該讓使用者的操作失敗。
  }
}

async function readError(response: Response): Promise<string> {
  try {
    const payload = await response.json();
    return payload?.error?.message || `地點服務回應 ${response.status}`;
  } catch {
    return `地點服務回應 ${response.status}`;
  }
}

/**
 * `bias` 讓「星巴克」這種到處都有的名字優先回傳附近的分店。
 * 它是 autocomplete 請求上的一個欄位，不是另一個 API —— 加了不會多花錢。
 */
export async function autocompletePlaces(
  input: string,
  sessionToken: string,
  bias: LatLng | null = null
): Promise<PlaceSuggestion[]> {
  const key = apiKey();
  const trimmed = input.trim();
  if (!key || !trimmed) return [];

  const response = await fetch(AUTOCOMPLETE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key
    },
    body: JSON.stringify({
      input: trimmed,
      sessionToken,
      languageCode: LANGUAGE,
      // undefined 的欄位不會被 JSON.stringify 送出去，所以沒有偏好時
      // 請求內容跟以前完全一樣。
      locationBias: locationBias(bias)
    })
  });
  if (!response.ok) throw new Error(await readError(response));

  const payload = await response.json();
  return (payload.suggestions ?? [])
    .filter((item: Record<string, any>) => item.placePrediction)
    .map((item: Record<string, any>) => {
      const prediction = item.placePrediction;
      return {
        placeId: prediction.placeId,
        primary: prediction.structuredFormat?.mainText?.text ?? prediction.text?.text ?? "",
        secondary: prediction.structuredFormat?.secondaryText?.text ?? ""
      };
    })
    .filter((item: PlaceSuggestion) => item.placeId && item.primary);
}

export async function getPlaceDetails(placeId: string, sessionToken: string): Promise<ExpensePlace> {
  const key = apiKey();
  if (!key) throw new Error("沒有設定地點服務金鑰");

  const params = new URLSearchParams({ sessionToken, languageCode: LANGUAGE });
  const response = await fetch(`${DETAILS_URL}/${encodeURIComponent(placeId)}?${params}`, {
    headers: {
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "id,displayName,formattedAddress,location"
    }
  });
  if (!response.ok) throw new Error(await readError(response));

  const payload = await response.json();
  return {
    name: payload.displayName?.text || "",
    address: payload.formattedAddress || null,
    lat: payload.location?.latitude ?? null,
    lng: payload.location?.longitude ?? null,
    placeId: payload.id || placeId
  };
}
