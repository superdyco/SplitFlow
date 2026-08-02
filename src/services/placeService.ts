import type { ExpensePlace } from "@/types/expense";

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

async function readError(response: Response): Promise<string> {
  try {
    const payload = await response.json();
    return payload?.error?.message || `地點服務回應 ${response.status}`;
  } catch {
    return `地點服務回應 ${response.status}`;
  }
}

export async function autocompletePlaces(input: string, sessionToken: string): Promise<PlaceSuggestion[]> {
  const key = apiKey();
  const trimmed = input.trim();
  if (!key || !trimmed) return [];

  const response = await fetch(AUTOCOMPLETE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key
    },
    body: JSON.stringify({ input: trimmed, sessionToken, languageCode: LANGUAGE })
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
