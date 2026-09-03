/**
 * Open-Meteo 的網址組裝與回應解析。純函式，不碰網路 —— 真正的 fetch 在
 * `index.ts`，這裡只負責「該問什麼」與「答案怎麼讀」。
 *
 * 選 Open-Meteo 的決定性理由是**不需要 API 金鑰**。`.env.example` 對另外兩把
 * 金鑰寫了很長的警告（用量計費、被撿去用會算你的帳單），天氣這條完全繞開。
 */

/** 支出上存的天氣。攝氏整數。 */
export interface WeatherResult {
  /** WMO 天氣代碼 0–99。決定圖示。 */
  code: number;
  /** 當日最高溫。 */
  high: number;
  /** 當日最低溫。 */
  low: number;
  /** 那個小時的實測溫度。**只有支出填了時間才有。** */
  exact: number | null;
}

export interface WeatherQuery {
  lat: number;
  lng: number;
  /** `YYYY-MM-DD`，當地日期。 */
  date: string;
  /** `YYYY-MM-DD`，用來判斷 date 是不是過去。傳進來而不是自己取，才測得到。 */
  today: string;
}

const DAILY = "weather_code,temperature_2m_max,temperature_2m_min";
const HOURLY = "temperature_2m,weather_code";

/**
 * 過去用 archive，今天與未來用 forecast。
 *
 * 這跟直覺相反 —— archive 聽起來像「舊資料」，但它**連今天都有真值**而且回溯
 * 到 1940 年，所以 forecast 那個「往回 93 天」的界線根本用不到。
 *
 * 會用 forecast 只有兩個理由，都跟未來有關：archive 拒絕未來日期（回 400），
 * 而今天用 forecast 拿到的是完整的一天 —— archive 給的是「到目前為止」，
 * 早上八點記帳會拿到「今天最高 27°」，那天其實會到 33°。
 */
export function weatherUrl(query: WeatherQuery): string {
  const past = query.date < query.today;
  const host = past
    ? "https://archive-api.open-meteo.com/v1/archive"
    : "https://api.open-meteo.com/v1/forecast";

  const params = new URLSearchParams({
    latitude: String(query.lat),
    longitude: String(query.lng),
    start_date: query.date,
    end_date: query.date,
    daily: DAILY,
    hourly: HOURLY,
    // 支出的日期時間是**當地時間**。不帶這個參數回的是 UTC，
    // 曼谷的 19:05 會對到當地凌晨兩點的溫度，而畫面上完全看不出來。
    timezone: "auto"
  });

  return `${host}?${params.toString()}`;
}

function roundOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
}

/**
 * 那個小時的實測溫度。
 *
 * `hourly.time` 是**當地時間、沒有時區後綴**（`2026-08-20T19:00`），所以拿支出的
 * `HH:MM` 的小時去比對就對得上，不需要任何時區換算。
 *
 * 對不到就回 null 而不是找最近的一小時：找最近的會讓「03:00 的支出配到 06:00
 * 的溫度」看起來像正常資料。
 */
function hourlyTemp(body: Record<string, any>, time: string): number | null {
  if (!time) return null;

  const hour = time.slice(0, 2);
  const times: unknown[] = body.hourly?.time ?? [];
  const index = times.findIndex(
    item => typeof item === "string" && item.slice(11, 13) === hour
  );
  if (index < 0) return null;

  return roundOrNull(body.hourly?.temperature_2m?.[index]);
}

/**
 * 把回應讀成 {@link WeatherResult}，讀不出來就回 null。
 *
 * **任何情況都不丟例外。** 天氣缺席是正常狀態 —— 沒有天氣的支出跟沒有座標的
 * 地點是同一種缺席，不該讓一筆帳存不下去。
 *
 * `time` 是支出的 `HH:MM`，空字串代表沒記時間。
 */
export function readWeather(json: unknown, time: string): WeatherResult | null {
  if (!json || typeof json !== "object") return null;

  const body = json as Record<string, any>;
  // 錯誤是 HTTP 400 加 { error: true, reason }。先看 error 再讀資料。
  if (body.error) return null;

  const code = body.daily?.weather_code?.[0];
  const high = roundOrNull(body.daily?.temperature_2m_max?.[0]);
  const low = roundOrNull(body.daily?.temperature_2m_min?.[0]);

  if (typeof code !== "number" || high === null || low === null) return null;

  return { code, high, low, exact: hourlyTemp(body, time) };
}
